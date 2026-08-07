/**
 * ServerRenderer — server-side video rendering engine for VideoFlow.
 *
 * Uses Playwright to run a headless Chromium browser that executes the same
 * browser-based rendering logic (SVG foreignObject → Canvas). Two pipelines
 * are available, selected by `RenderOptions.ffmpeg`:
 *
 * **Browser export (default, `ffmpeg: false`):**
 * 1. Launch headless Chromium, open a page, serve the bundled renderer
 * 2. Pass the VideoJSON to the page via `window.loadProject()`
 * 3. The page creates a `BrowserRenderer` and initialises all layers
 * 4. The page calls `BrowserRenderer.exportVideo()` which encodes video +
 *    audio + MP4 mux entirely in the browser (Worker + WebCodecs + MediaBunny)
 * 5. The page POSTs the finished MP4 to a route that the server intercepts;
 *    the bytes go straight from the request body to a Node Buffer
 *
 * **Legacy ffmpeg (`ffmpeg: true`):**
 * 1. Launch headless Chromium, open a page, serve the bundled renderer
 * 2. For each frame: `window.renderFrame(n)` then `page.screenshot()` → pipe
 *    to ffmpeg stdin as JPEG
 * 3. Render audio via `window.renderAudio()` → write WAV file → mux with
 *    ffmpeg into the final MP4
 *
 * The browser path is typically several times faster because it eliminates
 * the per-frame screenshot round-trip and the JPEG → H.264 re-encode.
 *
 * ## External layer types
 *
 * The page runs in a separate Chromium realm, so runtime layer classes can't
 * be handed across — `page.evaluate` arguments and Playwright's structured
 * serialization carry data, not functions. Instead you register an absolute
 * *module path* and the module gets bundled into the page script:
 *
 * ```ts
 * const renderer = new ServerRenderer(videoJSON);
 * renderer.registerLayerType('custom', {
 *   modulePath: '/absolute/path/to/custom-layer-type.js',
 *   exportName: 'default',
 * });
 * await renderer.renderVideo(options);
 * ```
 *
 * The module must be browser-compatible and export
 * `{ runtime, propertiesDefinition }`.
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'child_process';
import crypto from 'crypto';
import path from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';
import type { VideoJSON, RenderOptions } from '@videoflow/core';
import { formatTime, delay } from '@videoflow/core';

// ---------------------------------------------------------------------------
//  Resolve paths relative to this file
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP_DIR = process.env.TMPDIR || process.env.TEMP || '/tmp';

// ---------------------------------------------------------------------------
//  Shared browser instance management
// ---------------------------------------------------------------------------

let sharedBrowser: Browser | null = null;

/**
 * Get or create the shared headless Chromium browser instance.
 * Reusing a single browser across renders avoids the startup cost.
 */
async function getSharedBrowser(): Promise<Browser> {
	if (sharedBrowser && sharedBrowser.isConnected()) return sharedBrowser;
	sharedBrowser = await chromium.launch({
		headless: true,
		channel: 'chrome',
		args: [
			'--no-sandbox',
			// NOT `--single-process`. In that mode the page renderer shares the
			// browser process, so ONE V8 heap cap covers the page, the compositor
			// and the accumulating encoded output — and a long export dies when it
			// hits the cap, taking the whole browser with it. It surfaces as
			// "Target page, context or browser has been closed", which reads
			// exactly like host memory exhaustion and sends you hunting the wrong
			// thing. Reproduced on a 25s 1080p / 751-frame export: it failed at the
			// SAME 89% on every attempt with 4.7GB free on the box, while every
			// individual frame rendered fine in isolation. Removing the flag and
			// giving V8 real headroom renders it to completion.
			'--js-flags=--max-old-space-size=4096',
			'--no-zygote',
			'--disable-gpu',
			'--disable-dev-shm-usage',
			'--disable-background-timer-throttling',
			'--disable-renderer-backgrounding',
			'--disable-features=site-per-process',
			'--disable-extensions',
		],
	});
	return sharedBrowser;
}

/**
 * Close the shared browser instance.  Call this when the server is shutting
 * down to release resources.
 */
export async function closeSharedBrowser(): Promise<void> {
	if (sharedBrowser && sharedBrowser.isConnected()) {
		await sharedBrowser.close();
		sharedBrowser = null;
	}
}

// ---------------------------------------------------------------------------
//  External layer types
// ---------------------------------------------------------------------------

/**
 * How a {@link ServerRenderer} locates an external layer type.
 *
 * Runtime classes are functions and cannot cross the Playwright boundary, so
 * the server records a module *path* and bundles that module into the page
 * script instead of trying to serialize the class.
 */
export type ServerLayerTypeModuleDescriptor = {
	/**
	 * Absolute local filesystem path to a **browser-compatible** module that
	 * exports a `{ runtime, propertiesDefinition }` descriptor.
	 *
	 * ```ts
	 * // /abs/path/to/custom-layer-type.js
	 * export default {
	 *   runtime: RuntimeCustomLayer,
	 *   propertiesDefinition: CustomLayer.propertiesDefinition,
	 * };
	 * ```
	 */
	modulePath: string;
	/** Export to read the descriptor from. Defaults to `'default'`. */
	exportName?: string;
};

/** A registration after defaulting and path normalisation. */
type NormalizedLayerTypeEntry = {
	type: string;
	modulePath: string;
	exportName: string;
};

/** {@link RenderOptions} plus the serializable external-layer-type list. */
export type ServerRenderOptions = RenderOptions & {
	/**
	 * External layer types to register before rendering. Purely a convenience
	 * wrapper over the instance API — {@link ServerRenderer.render} constructs
	 * a renderer and calls `registerLayerType()` for each entry.
	 */
	layerTypes?: Array<{ type: string } & ServerLayerTypeModuleDescriptor>;
};

// ---------------------------------------------------------------------------
//  Bundle cache
//
//  Keyed by the full external-layer-type registration set (names, absolute
//  paths, export names) plus each module's mtime/size, so two ServerRenderer
//  instances with different registrations never reuse each other's bundle and
//  editing an external module during development invalidates it.
// ---------------------------------------------------------------------------

const bundleCache: Map<string, string> = new Map();
/** Keep the cache bounded; distinct registration sets are usually few. */
const BUNDLE_CACHE_LIMIT = 16;

/** Resolve the page-script entry: `.ts` in the repo, `.js` once published. */
async function resolveRendererEntryPoint(): Promise<string> {
	const tsEntry = path.resolve(__dirname, 'renderer-page-script.ts');
	try {
		await fs.access(tsEntry);
		return tsEntry;
	} catch {
		return tsEntry.replace(/\.ts$/, '.js');
	}
}

/**
 * A path as a JS string literal. Backslashes are flipped to forward slashes
 * so Windows paths survive both the string literal and esbuild's resolver
 * (`path.sep` is `/` on POSIX, making this a no-op there).
 */
function pathLiteral(p: string): string {
	return JSON.stringify(p.split(path.sep).join('/'));
}

/** Hash the inputs that must invalidate a cached bundle. */
async function computeBundleCacheKey(entryPoint: string, entries: NormalizedLayerTypeEntry[]): Promise<string> {
	const hash = crypto.createHash('sha1');
	hash.update(entryPoint);
	for (const entry of entries) {
		hash.update(`\0${entry.type}\0${entry.modulePath}\0${entry.exportName}`);
		try {
			const stat = await fs.stat(entry.modulePath);
			hash.update(`\0${stat.mtimeMs}\0${stat.size}`);
		} catch {
			hash.update('\0missing');
		}
	}
	return hash.digest('hex');
}

/**
 * Generate the synthetic bundle entry: import the page bootstrap, import each
 * external layer-type module, and hand the descriptors to
 * `startRendererPage()`.
 *
 * Namespace imports (rather than named ones) keep arbitrary export names
 * working without worrying about JS identifier syntax, and let us emit a
 * precise error when a module doesn't export what was promised.
 */
function generateBundleEntry(entryPoint: string, entries: NormalizedLayerTypeEntry[]): string {
	const lines: string[] = [
		`import { startRendererPage } from ${pathLiteral(entryPoint)};`,
	];

	entries.forEach((entry, i) => {
		lines.push(`import * as __mod${i} from ${pathLiteral(entry.modulePath)};`);
	});

	entries.forEach((entry, i) => {
		const where = `layer type ${JSON.stringify(entry.type)} (${entry.modulePath})`;
		lines.push(
			`const __desc${i} = __mod${i}[${JSON.stringify(entry.exportName)}];`,
			`if (!__desc${i} || typeof __desc${i}.runtime !== "function") {`,
			`\tthrow new Error(${JSON.stringify(
				`VideoFlow: ${where} must export a { runtime, propertiesDefinition } descriptor as ` +
				`"${entry.exportName}".`,
			)});`,
			`}`,
		);
	});

	const list = entries
		.map((entry, i) => `{ type: ${JSON.stringify(entry.type)}, descriptor: __desc${i} }`)
		.join(', ');
	lines.push(`startRendererPage([${list}]);`);

	return lines.join('\n');
}

/**
 * Build the renderer page script using esbuild.
 *
 * Bundles the page script with all its dependencies (BrowserRenderer,
 * @videoflow/core, mediabunny) and every registered external layer-type module
 * into a single browser-compatible ES module.
 */
async function buildRendererBundle(entries: NormalizedLayerTypeEntry[] = []): Promise<string> {
	const entryPoint = await resolveRendererEntryPoint();

	// Sort by type so registration order alone can't fragment the cache.
	const sorted = [...entries].sort((a, b) => (a.type < b.type ? -1 : a.type > b.type ? 1 : 0));

	const cacheKey = await computeBundleCacheKey(entryPoint, sorted);
	const cached = bundleCache.get(cacheKey);
	if (cached) return cached;

	// Fail with a path-level message rather than an esbuild resolve error.
	for (const entry of sorted) {
		try {
			await fs.access(entry.modulePath);
		} catch {
			throw new Error(
				`ServerRenderer: layer type "${entry.type}" module not found: ${entry.modulePath}`,
			);
		}
	}

	const result = await esbuild.build({
		stdin: {
			contents: generateBundleEntry(entryPoint, sorted),
			resolveDir: __dirname,
			sourcefile: 'videoflow-renderer-page-entry.js',
			loader: 'js',
		},
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		target: 'esnext',
		minify: true,
		sourcemap: false,
		external: ['@videoflow/renderer-server'],
		define: {
			'process.env.mode': '"browser"',
		},
		loader: {
			'.ts': 'ts',
			'.css': 'text',
		},
	});

	const bundle = result.outputFiles[0].text;
	if (bundleCache.size >= BUNDLE_CACHE_LIMIT) {
		// Evict the oldest entry — Map preserves insertion order.
		const oldest = bundleCache.keys().next();
		if (!oldest.done) bundleCache.delete(oldest.value);
	}
	bundleCache.set(cacheKey, bundle);
	return bundle;
}

// ---------------------------------------------------------------------------
//  ServerRenderer class
// ---------------------------------------------------------------------------

/** MIME type lookup by file extension. */
const MIME_TYPES: Record<string, string> = {
	'.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
	'.avi': 'video/x-msvideo', '.mkv': 'video/x-matroska',
	'.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
	'.aac': 'audio/aac', '.flac': 'audio/flac', '.m4a': 'audio/mp4',
	'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
	'.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
	'.bmp': 'image/bmp', '.avif': 'image/avif',
};

/**
 * Per-render upload slot. Set when the browser-export path is in flight so
 * the route handler knows where to send the POSTed MP4 body. Cleared after
 * the upload arrives (or the render fails).
 */
type UploadSlot = {
	/** URL the page is expected to POST the finished MP4 to. */
	url: string;
	/** Resolved with the uploaded MP4 bytes once the route handler receives them. */
	resolve: (buf: Buffer) => void;
	/** Rejected if the upload route handler fails or the render aborts. */
	reject: (err: Error) => void;
};

export default class ServerRenderer {
	private videoJSON: VideoJSON;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private renderId: string;
	/** Map of UUID → local file path for serving local assets to the browser. */
	private localFileMap: Map<string, string> = new Map();
	/** Temporary files to clean up on destroy. */
	private tempFiles: string[] = [];
	/** Active upload slot for the in-flight browser-export render, if any. */
	private uploadSlot: UploadSlot | null = null;
	/** Forward progress reports from the page to the active render's callback. */
	private exportProgressHandler: ((progress: number) => void) | null = null;
	/**
	 * External layer types registered on this instance, keyed by type name so
	 * a duplicate registration replaces the earlier one. Bundled into the page
	 * script when the Chromium page is opened.
	 */
	private layerTypeModules: Map<string, NormalizedLayerTypeEntry> = new Map();

	constructor(videoJSON: VideoJSON) {
		this.videoJSON = videoJSON;
		this.renderId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
	}

	// -----------------------------------------------------------------------
	//  Layer-type registry
	// -----------------------------------------------------------------------

	/**
	 * Register (or replace) an external layer type for this render.
	 *
	 * ```ts
	 * const renderer = new ServerRenderer(videoJSON);
	 * renderer.registerLayerType('custom', {
	 *   modulePath: '/absolute/path/to/custom-layer-type.js',
	 *   exportName: 'default',
	 * });
	 * await renderer.renderVideo(options);
	 * ```
	 *
	 * `modulePath` must be an **absolute** local filesystem path to a
	 * browser-compatible module exporting a
	 * `{ runtime, propertiesDefinition }` descriptor. The module is bundled
	 * into the renderer page script and registered on the in-page
	 * `BrowserRenderer` before its first frame — runtime classes are functions
	 * and cannot be passed through `page.evaluate` or Playwright's structured
	 * serialization, so bundling is the only way across the realm boundary.
	 *
	 * Lifecycle: register after construction and **before** `renderVideo()` /
	 * `renderFrame()` / `renderAudio()`, i.e. before the headless page is
	 * opened. Registering afterwards throws.
	 */
	registerLayerType(type: string, descriptor: ServerLayerTypeModuleDescriptor): void {
		if (this.page) {
			throw new Error(
				`ServerRenderer.registerLayerType("${type}"): layer types must be registered before the first ` +
				`renderVideo() / renderFrame() / renderAudio() call — the headless page and its bundle are ` +
				`already built.`,
			);
		}
		if (typeof type !== 'string' || type.length === 0) {
			throw new Error('ServerRenderer.registerLayerType: "type" must be a non-empty string.');
		}
		const modulePath = descriptor?.modulePath;
		if (typeof modulePath !== 'string' || modulePath.length === 0) {
			throw new Error(
				`ServerRenderer.registerLayerType("${type}"): "modulePath" is required.`,
			);
		}
		if (!path.isAbsolute(modulePath)) {
			throw new Error(
				`ServerRenderer.registerLayerType("${type}"): "modulePath" must be an absolute local ` +
				`filesystem path, got "${modulePath}".`,
			);
		}
		this.layerTypeModules.set(type, {
			type,
			modulePath: path.normalize(modulePath),
			exportName: descriptor.exportName ?? 'default',
		});
	}

	/** Every external layer type registered on this instance. */
	listLayerTypes(): string[] {
		return [...this.layerTypeModules.keys()];
	}

	/** Path for the temporary audio WAV file. */
	private get audioFile(): string {
		return path.join(TMP_DIR, `videoflow-audio-${this.renderId}.wav`);
	}

	/** Path for the temporary output MP4 file. */
	private get videoFile(): string {
		return path.join(TMP_DIR, `videoflow-video-${this.renderId}.mp4`);
	}

	// -----------------------------------------------------------------------
	//  Local file handling
	// -----------------------------------------------------------------------

	/**
	 * Check whether a source string refers to a local file (not a URL).
	 */
	private isLocalFile(source: string): boolean {
		if (!source) return false;
		if (/^https?:\/\//i.test(source)) return false;
		if (/^data:/i.test(source)) return false;
		if (/^blob:/i.test(source)) return false;
		return true;
	}

	/**
	 * Scan the VideoJSON for local file references in layer settings.source,
	 * assign each a UUID, and rewrite the source to a URL that the route
	 * handler can serve.  Also checks that the files exist.
	 *
	 * For audio-bearing layers (audio, video), also extracts audio to WAV
	 * using ffmpeg so that the browser's decodeAudioData can reliably decode
	 * it — headless Chromium may not support all container formats (e.g. MP4).
	 */
	private async rewriteLocalSources(): Promise<void> {
		const audioTypes = new Set(['audio', 'video']);

		// RECURSE INTO CHILDREN. This walked only the top level, so an image or
		// video inside a group kept its filesystem path, Chromium refused to
		// fetch it, and the child was disabled with a single console line — the
		// group rendered without its media and nothing threw. A composition
		// built as `group(background, screenshot, captions)` came out as
		// background plus captions, silently missing the product shot.
		const walk = async (layers: VideoJSON['layers']): Promise<void> => {
			for (const layer of layers ?? []) {
				const source = layer.settings?.source;
				if (typeof source === 'string' && this.isLocalFile(source)) {
					const absPath = path.resolve(source);
					try {
						await fs.access(absPath);
					} catch {
						throw new Error(`Local file not found: ${absPath} (layer ${layer.id})`);
					}

					const uuid = crypto.randomUUID();
					this.localFileMap.set(uuid, absPath);
					layer.settings.source = `https://videoflow.local/file/${uuid}`;
				}
				const children = (layer as { children?: VideoJSON['layers'] }).children;
				if (children?.length) await walk(children);
			}
		};
		await walk(this.videoJSON.layers);
	}

	// -----------------------------------------------------------------------
	//  Static render entry point
	// -----------------------------------------------------------------------

	/**
	 * Render a {@link VideoJSON} to a Buffer or file.
	 *
	 * Convenience wrapper over the instance API. External layer types can be
	 * passed as `options.layerTypes` (each entry is forwarded to
	 * {@link registerLayerType}); for anything more involved, construct a
	 * `ServerRenderer` and drive it directly.
	 *
	 * @param videoJSON - The compiled video JSON.
	 * @param options   - Rendering options (outputType, output path, signal,
	 *                    layerTypes).
	 * @returns A Buffer containing the MP4 (when outputType is 'buffer') or
	 *          the output file path (when outputType is 'file').
	 */
	static async render(videoJSON: VideoJSON, options: ServerRenderOptions = {}): Promise<Buffer | string> {
		const renderer = new ServerRenderer(videoJSON);
		for (const entry of options.layerTypes ?? []) {
			renderer.registerLayerType(entry.type, entry);
		}
		try {
			return await renderer.renderVideo(options);
		} finally {
			await renderer.cleanup();
		}
	}

	// -----------------------------------------------------------------------
	//  Headless browser management
	// -----------------------------------------------------------------------

	/**
	 * Open a headless browser page and load the renderer.
	 *
	 * Sets up route interception to serve the HTML page and bundled JS
	 * locally (no actual web server needed).  Exposes the `loadProject`
	 * bridge function that passes the VideoJSON to the page.
	 */
	private async openPage(): Promise<void> {
		const browser = await getSharedBrowser();
		this.context = await browser.newContext();

		this.page = await this.context.newPage();
		await this.page.setViewportSize({
			width: this.videoJSON.width,
			height: this.videoJSON.height,
		});
		await this.page.setDefaultTimeout(60_000);

		// Forward browser console messages to the server console
		this.page.on('console', msg => {
			const type = msg.type();
			if (type === 'error') {
				console.error('[Browser]', msg.text());
			} else if (type === 'warning') {
				console.warn('[Browser]', msg.text());
			} else {
				console.log('[Browser]', msg.text());
			}
		});

		// Capture unhandled page errors (exceptions, promise rejections)
		this.page.on('pageerror', error => {
			console.error('[Browser Error]', error.message);
		});

		// Rewrite local file paths to servable URLs before passing to browser
		await this.rewriteLocalSources();

		// Build the renderer bundle, statically importing every external
		// layer-type module registered on this instance.
		const bundle = await buildRendererBundle([...this.layerTypeModules.values()]);
		const htmlContent = await this.getRendererHTML();

		// Set up the project loading bridge
		await this.page.exposeFunction('logError', (error: string) => {
			console.error('Renderer error:', error);
		});
		await this.page.exposeFunction('loadProject', () => {
			return this.videoJSON;
		});

		// Bridge for the browser-export path. The page calls this from inside
		// `BrowserRenderer.exportVideo`'s onProgress; we forward to whichever
		// callback the current render set up.
		await this.page.exposeFunction('onExportProgress', (progress: number) => {
			this.exportProgressHandler?.(progress);
		});

		const loadedPromise = new Promise<void>(async (resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error('Timeout loading project')), 120_000);

			await this.page!.exposeFunction('projectLoaded', () => {
				clearTimeout(timeout);
				resolve();
			});
			await this.page!.exposeFunction('projectLoading', () => {
				// Reset timeout on progress
				clearTimeout(timeout);
				setTimeout(() => reject(new Error('Timeout loading project')), 120_000);
			});
		});

		// Route interception: serve local files
		await this.page.route('**/*', async (route) => {
			const url = route.request().url();

			if (url == 'https://videoflow.local/renderer-page.html') {
				return route.fulfill({
					body: htmlContent,
					contentType: 'text/html',
				});
			}
			if (url == 'https://videoflow.local/renderer-page-script.js') {
				return route.fulfill({
					body: bundle,
					contentType: 'application/javascript',
				});
			}

			// Browser-export upload sink. The page POSTs the finished MP4 here
			// and the route handler hands the body straight to the active
			// upload slot — no JSON or base64 round-trip. Match against the
			// per-render URL so concurrent renders on different pages can't
			// cross-talk.
			if (this.uploadSlot && url === this.uploadSlot.url && route.request().method() === 'POST') {
				try {
					const body = route.request().postDataBuffer();
					if (!body) throw new Error('Empty upload body');
					this.uploadSlot.resolve(Buffer.from(body));
				} catch (err) {
					this.uploadSlot.reject(err instanceof Error ? err : new Error(String(err)));
				}
				return route.fulfill({ status: 200, body: '' });
			}

			// Serve local files mapped by UUID
			const fileMatch = url.match(/\/file\/([0-9a-f-]{36})$/);
			if (fileMatch) {
				const filePath = this.localFileMap.get(fileMatch[1]);
				if (filePath) {
					try {
						const body = await fs.readFile(filePath);
						const ext = path.extname(filePath).toLowerCase();
						const contentType = MIME_TYPES[ext] || 'application/octet-stream';
						return route.fulfill({
							body,
							contentType,
							headers: { 'Access-Control-Allow-Origin': '*' },
						});
					} catch (e) {
						console.error(`Failed to read local file: ${filePath}`, e);
						return route.fulfill({ status: 404, body: 'File not found' });
					}
				}
			}

			// Pass through external requests (fonts, media assets) and rewrite
			// CORS headers so the page can fetch from any origin — including
			// origins that don't otherwise allow cross-origin requests.
			//
			// Important: we read the body *bytes* explicitly via
			// `response.body()` and rebuild the fulfill payload from scratch,
			// rather than passing `{ response }` directly. Playwright auto-
			// decodes any `Content-Encoding` (gzip / brotli) when reading the
			// body, and forwarding the decoded body alongside the original
			// `Content-Encoding` / `Content-Length` headers leaves the browser
			// trying to re-decode plain bytes — which intermittently yields a
			// truncated or empty image when two or more such requests run
			// concurrently. Stripping the stale framing headers fixes it.
			try {
				const response = await route.fetch();
				const body = await response.body();
				const original = response.headers();
				const headers: Record<string, string> = {};
				for (const [k, v] of Object.entries(original)) {
					const lk = k.toLowerCase();
					if (lk === 'content-encoding' || lk === 'content-length' || lk === 'transfer-encoding') continue;
					headers[k] = v;
				}
				headers['Access-Control-Allow-Origin'] = '*';
				headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS';
				headers['Access-Control-Allow-Headers'] = 'Content-Type';
				await route.fulfill({
					status: response.status(),
					headers,
					body,
				});
			} catch {
				await route.abort();
			}
		});

		// Navigate and wait for the project to load
		await this.page.goto('https://videoflow.local/renderer-page.html');
		await loadedPromise;
	}

	/** Read the renderer HTML template. */
	private async getRendererHTML(): Promise<string> {
		const htmlPath = path.resolve(__dirname, 'renderer-page.html');
		try {
			return await fs.readFile(htmlPath, 'utf-8');
		} catch {
			// Fallback inline HTML
			return `<!DOCTYPE html>
<html><head>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<style>*{margin:0;padding:0;box-sizing:border-box}body{padding:0;font-family:sans-serif;user-select:none}</style>
</head><body>
<div id="renderer"></div>
<script type="module" src="renderer-page-script.js"></script>
</body></html>`;
		}
	}

	// -----------------------------------------------------------------------
	//  Public instance methods — renderFrame / renderAudio
	// -----------------------------------------------------------------------

	/**
	 * Ensure the headless page is open and the project is loaded.
	 * Subsequent calls are no-ops.
	 */
	private async ensurePage(): Promise<void> {
		if (!this.page) await this.openPage();
	}

	/**
	 * Render a single frame and return it as a JPEG screenshot Buffer.
	 *
	 * Opens the headless page on first call, then renders the requested frame
	 * via the in-page BrowserRenderer.
	 *
	 * @param frame - The frame number to render.
	 * @returns A Buffer containing the JPEG screenshot of the rendered frame.
	 */
	async renderFrame(frame: number): Promise<Buffer> {
		await this.ensurePage();

		await this.page!.evaluate(async (f: number) => {
			await window.renderFrame(f);
		}, frame);

		return await this.page!.screenshot({ type: 'jpeg', quality: 95 });
	}

	/**
	 * Render the full audio track and return it as a WAV Buffer.
	 *
	 * Opens the headless page on first call, then renders all audio layers
	 * into a single WAV buffer via the in-page BrowserRenderer.
	 *
	 * @returns A Buffer containing WAV audio data, or `null` if there are no audio layers.
	 */
	async renderAudio(): Promise<Buffer | null> {
		await this.ensurePage();

		const audioData = await this.page!.evaluate(async () => {
			const buf = await window.renderAudio();
			if (!buf) return null;
			return Array.from(buf);
		});

		if (!audioData) return null;
		return Buffer.from(audioData);
	}

	// -----------------------------------------------------------------------
	//  Audio-to-file (used by the full render pipeline)
	// -----------------------------------------------------------------------

	/**
	 * Render audio in the headless browser and save as a WAV file.
	 *
	 * Calls `window.renderAudio()` in the page context, which returns a
	 * Uint8Array of WAV data.
	 *
	 * @returns `true` if audio was produced, `false` if the project has no audio.
	 */
	private async renderAudioToFile(): Promise<boolean> {
		const audioBuffer = await this.page!.evaluate(async () => {
			const buf = await window.renderAudio();
			if (!buf) return null;
			return Array.from(buf);
		});

		if (audioBuffer) {
			await fs.writeFile(this.audioFile, Buffer.from(audioBuffer));
			return true;
		}
		return false;
	}

	// -----------------------------------------------------------------------
	//  ffmpeg integration
	// -----------------------------------------------------------------------

	/**
	 * Spawn an ffmpeg process configured to receive JPEG frames on stdin
	 * and produce an MP4 output file.
	 *
	 * @param hasAudio - Whether to mux the rendered audio into the output.
	 * @returns A tuple of [ffmpeg process, completion promise].
	 */
	private initFFmpeg(hasAudio: boolean, outputPath: string): [ChildProcess, Promise<string>, () => void] {
		const ffmpeg = spawn('ffmpeg', [
			'-y',
			'-f', 'image2pipe',
			'-c:v', 'mjpeg',
			'-framerate', String(this.videoJSON.fps),
			'-i', 'pipe:0',
			...(hasAudio ? ['-i', this.audioFile] : []),
			'-c:v', 'libx264',
			'-crf', '17',
			...(hasAudio ? ['-c:a', 'aac'] : []),
			'-pix_fmt', 'yuv420p',
			'-metadata:s:v:0', 'handler_name=VideoFlow.dev',
			...(hasAudio ? ['-metadata:s:a:0', 'handler_name=VideoFlow.dev'] : []),
			outputPath,
		]);

		// Collect stderr for error reporting
		let stderr = '';
		ffmpeg.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

		// Track intentional kills so the promise doesn't reject on abort
		let killed = false;
		const kill = () => { killed = true; ffmpeg.kill('SIGKILL'); };

		const onFinish = new Promise<string>((resolve, reject) => {
			ffmpeg.on('close', (code) => {
				if (killed) resolve(stderr);
				else if (code === 0) resolve(stderr);
				else reject(new Error(`ffmpeg exited with code ${code}:\n${stderr}`));
			});
			ffmpeg.once('error', (err) => {
				if (!killed) reject(new Error(`ffmpeg failed to start: ${err.message}`));
			});
		});

		return [ffmpeg, onFinish, kill];
	}

	// -----------------------------------------------------------------------
	//  Main render loop
	// -----------------------------------------------------------------------

	/**
	 * Render the loaded project. Picks the encoding pipeline based on
	 * `options.ffmpeg`; defaults to the in-browser export path.
	 *
	 * This is the primary entry point when using external layer types —
	 * register them on the instance first, then call this:
	 *
	 * ```ts
	 * const renderer = new ServerRenderer(videoJSON);
	 * renderer.registerLayerType('custom', { modulePath: '/abs/path/custom.js' });
	 * const out = await renderer.renderVideo({ outputType: 'file', output: './out.mp4' });
	 * await renderer.cleanup();
	 * ```
	 *
	 * Callers own cleanup — call {@link cleanup} when done (the static
	 * {@link render} helper does this for you).
	 */
	async renderVideo(options: RenderOptions = {}): Promise<Buffer | string> {
		if (options.ffmpeg) {
			return this.renderVideoViaFFmpeg(options);
		}
		return this.renderVideoViaBrowser(options);
	}

	// -----------------------------------------------------------------------
	//  Browser-export pipeline (default — `ffmpeg: false`)
	// -----------------------------------------------------------------------

	/**
	 * Render the entire video inside the headless browser using
	 * `BrowserRenderer.exportVideo()` and stream the finished MP4 back to Node.
	 *
	 * The page calls `BrowserRenderer.exportVideo()`, which encodes video
	 * (WebCodecs H.264) and audio (AAC), muxes both into MP4 via MediaBunny,
	 * and POSTs the resulting Blob to a per-render URL. The server intercepts
	 * the POST through Playwright's route handler so the bytes go from the
	 * page's request body straight into a Node Buffer — no JSON round-trip.
	 *
	 * Cancellation is propagated from `options.signal` into the page by
	 * calling `window.__exportAbort.abort()` via `page.evaluate`. Stalls are
	 * detected by tracking the time since the last `onExportProgress` tick.
	 */
	private async renderVideoViaBrowser(options: RenderOptions = {}): Promise<Buffer | string> {
		const signal = options.signal;
		const verbose = options.verbose ?? false;
		const onProgress = options.onProgress;

		if (verbose) console.log('VideoFlow: Initializing browser-export renderer...');

		await this.ensurePage();
		if (signal?.aborted) throw new DOMException('Render aborted', 'AbortError');

		if (verbose) {
			const nFrames = Math.round(this.videoJSON.duration * this.videoJSON.fps);
			const durationStr = formatTime(this.videoJSON.duration);
			console.log(`VideoFlow: Rendering ${durationStr} video (${nFrames} frames) entirely in the browser...`);
		}

		// A per-render URL keeps multiple ServerRenderer instances on the same
		// shared browser from cross-talking through the route handler.
		const uploadUrl = `https://videoflow.local/render-output/${this.renderId}`;

		// Wire up the upload slot before kicking off the page-side export.
		const uploadPromise = new Promise<Buffer>((resolve, reject) => {
			this.uploadSlot = { url: uploadUrl, resolve, reject };
		});

		// Stall detection — the page reports progress per frame; if it goes
		// silent for too long we kill the render.
		let lastProgressAt = Date.now();
		let lastReported = 0;
		this.exportProgressHandler = (progress: number) => {
			lastProgressAt = Date.now();
			lastReported = progress;
			onProgress?.(progress);
			if (verbose && Math.floor(progress * 10) > Math.floor((progress - 0.001) * 10)) {
				console.log(`VideoFlow: Encoding ${(progress * 100).toFixed(0)}%`);
			}
		};

		// Propagate AbortSignal into the page. We push the abort across with
		// `page.evaluate` since exposeFunction is server→page only one-way.
		const onAbort = async () => {
			try {
				await this.page!.evaluate(() => window.__exportAbort?.abort());
			} catch { /* page may be closed */ }
		};
		signal?.addEventListener('abort', onAbort, { once: true });

		// Watchdog timer: poll for stalls. Re-armed on every progress tick.
		const STALL_MS = 120_000;
		const stallController = new AbortController();
		const stallWatcher = (async () => {
			while (!stallController.signal.aborted) {
				await delay(2000);
				if (stallController.signal.aborted) return;
				if (Date.now() - lastProgressAt > STALL_MS) {
					try {
						await this.page!.evaluate(() => window.__exportAbort?.abort());
					} catch { /* ignore */ }
					this.uploadSlot?.reject(new Error(
						`Rendering stalled — no progress for ${STALL_MS / 1000} seconds (last reported ${(lastReported * 100).toFixed(1)}%).`
					));
					return;
				}
			}
		})();

		let outputBuffer: Buffer | null = null;
		try {
			// Drive the in-page export. The page's `exportVideo` only resolves
			// AFTER its POST completes, so the upload promise is always
			// resolved by the time the evaluate promise resolves. Running them
			// through `Promise.all` means either one rejecting (page error,
			// stall, route handler failure) tears the whole thing down.
			const [size, buf] = await Promise.all([
				this.page!.evaluate(
					({ url, encodeOptions }: { url: string; encodeOptions: any }) => window.exportVideo(url, encodeOptions),
					{
						url: uploadUrl,
						encodeOptions: {
							videoQuality: options.videoQuality,
							videoBitrate: options.videoBitrate,
						},
					},
				),
				uploadPromise,
			]);
			outputBuffer = buf;

			if (verbose) {
				console.log(`VideoFlow: Encoded ${(size / 1024 / 1024).toFixed(2)} MB MP4 in browser.`);
			}
		} catch (err) {
			// Surface aborts as proper AbortError; otherwise rethrow.
			if (signal?.aborted) {
				throw new DOMException('Render aborted', 'AbortError');
			}
			throw err;
		} finally {
			stallController.abort();
			await stallWatcher.catch(() => {});
			signal?.removeEventListener('abort', onAbort);
			this.uploadSlot = null;
			this.exportProgressHandler = null;
		}

		if (!outputBuffer) {
			throw new Error('Browser export produced no output');
		}

		// Final delivery — write to disk if a path was requested, otherwise
		// hand back the Buffer.
		if (options.outputType === 'file' && options.output) {
			const outputPath = path.resolve(options.output);
			await fs.writeFile(outputPath, outputBuffer);
			if (verbose) console.log('VideoFlow: Render complete →', outputPath);
			return options.output;
		}

		if (verbose) console.log('VideoFlow: Render complete.');
		return outputBuffer;
	}

	// -----------------------------------------------------------------------
	//  Legacy ffmpeg pipeline (`ffmpeg: true`)
	// -----------------------------------------------------------------------

	/**
	 * Execute the legacy server-side rendering pipeline.
	 *
	 * 1. Open headless page and load the project
	 * 2. Render audio to a temporary WAV file
	 * 3. Spawn ffmpeg
	 * 4. For each frame: renderFrame → screenshot → pipe to ffmpeg
	 * 5. Close ffmpeg stdin, wait for it to finish
	 * 6. Return the output as a Buffer or file path
	 */
	private async renderVideoViaFFmpeg(options: RenderOptions = {}): Promise<Buffer | string> {
		const signal = options.signal;
		const verbose = options.verbose ?? false;
		const onProgress = options.onProgress;

		if (verbose) console.log('VideoFlow: Initializing renderer...');

		// Open headless page (no-op if already open)
		await this.ensurePage();
		if (signal?.aborted) throw new DOMException('Render aborted', 'AbortError');

		if (verbose) console.log('VideoFlow: Project loaded successfully.');

		// Render audio
		if (verbose) console.log('VideoFlow: Rendering audio...');
		const hasAudio = await this.renderAudioToFile();
		if (!hasAudio && verbose) console.log('VideoFlow: No audio detected.');
		if (signal?.aborted) throw new DOMException('Render aborted', 'AbortError');

		// Determine output path — write directly to the final file when possible,
		// otherwise use a temp file that will be read into a Buffer.
		const writeToFile = options.outputType === 'file' && options.output;
		const outputPath = writeToFile
			? path.resolve(options.output!)
			: this.videoFile;

		// Set up ffmpeg
		const nFrames = Math.round(this.videoJSON.duration * this.videoJSON.fps);
		const durationStr = formatTime(this.videoJSON.duration);
		if (verbose) console.log(`VideoFlow: Rendering ${durationStr} video (${nFrames} frames)...`);

		const [ffmpeg, onFinish, killFfmpeg] = this.initFFmpeg(hasAudio, outputPath);

		// Frame rendering loop
		let lastTick = Date.now();
		for (let i = 0; i < nFrames; i++) {
			if (signal?.aborted) {
				killFfmpeg();
				await onFinish;
				throw new DOMException('Render aborted', 'AbortError');
			}

			// Stall detection
			if (Date.now() - lastTick > 120_000) {
				killFfmpeg();
				await onFinish;
				throw new Error('Rendering stalled — no progress for 120 seconds.');
			}

			// Render and capture frame
			await this.page!.evaluate(async (frame: number) => {
				await window.renderFrame(frame);
			}, i);

			const buffer = await this.page!.screenshot({
				type: 'jpeg',
				quality: 95,
			});

			// Pipe to ffmpeg
			if (!ffmpeg.stdin!.write(buffer)) {
				await new Promise<void>((resolve) => ffmpeg.stdin!.once('drain', resolve));
			}

			lastTick = Date.now();

			onProgress?.((i + 1) / nFrames);

			if (verbose && (i % 30 === 0 || i === nFrames - 1)) {
				const pct = ((i + 1) / nFrames * 100).toFixed(1);
				console.log(`VideoFlow: Frame ${i + 1}/${nFrames} (${pct}%)`);
			}
		}

		// Close ffmpeg and wait for output (rejects on failure with stderr)
		ffmpeg.stdin!.end();
		await onFinish;

		if (verbose) console.log('VideoFlow: Render complete.');

		// Return result
		if (writeToFile) {
			return options.output!;
		}

		const outputBuffer = await fs.readFile(this.videoFile);
		return outputBuffer;
	}

	// -----------------------------------------------------------------------
	//  Cleanup
	// -----------------------------------------------------------------------

	/** Release all resources: browser context, temporary files, and shared browser. */
	async cleanup(): Promise<void> {
		try {
			await this.page?.close();
		} catch { /* ignore */ }
		try {
			await this.context?.close();
		} catch { /* ignore */ }
		try {
			await Promise.all([
				fs.unlink(this.videoFile).catch(() => {}),
				fs.unlink(this.audioFile).catch(() => {}),
				...this.tempFiles.map(f => fs.unlink(f).catch(() => {})),
			]);
		} catch { /* ignore */ }
		await closeSharedBrowser();
	}
}
