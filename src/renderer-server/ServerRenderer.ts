/**
 * ServerRenderer — server-side video rendering engine for VideoFlow.
 *
 * Uses Playwright to run a headless Chromium browser that executes the same
 * browser-based rendering logic (SVG foreignObject → Canvas).  Each frame is
 * captured via `page.screenshot()` and piped into ffmpeg to produce the final
 * MP4 video file with audio.
 *
 * Architecture (mirrors Scrptly's renderServer.server.js):
 * 1. Launch a headless Chromium browser via Playwright
 * 2. Open a page, serve the renderer HTML + bundled script via route interception
 * 3. Pass the VideoJSON to the page via an exposed `window.loadProject()` function
 * 4. The page creates a BrowserRenderer and initialises all layers
 * 5. For each frame: call `window.renderFrame(n)` then `page.screenshot()` → pipe to ffmpeg
 * 6. Render audio via `window.renderAudio()` → write WAV file → mux into final MP4
 * 7. Return the resulting MP4 as a Buffer or write to a file
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { spawn, type ChildProcess } from 'child_process';
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
			'--single-process',
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
//  Bundle cache — we only need to build the renderer page script once
// ---------------------------------------------------------------------------

let cachedBundle: string | null = null;

/**
 * Build the renderer page script using esbuild.
 *
 * Bundles the page script with all its dependencies (BrowserRenderer,
 * @videoflow/core, mediabunny) into a single browser-compatible ES module.
 */
async function buildRendererBundle(): Promise<string> {
	if (cachedBundle) return cachedBundle;

	const entryPoint = path.resolve(__dirname, 'renderer-page-script.ts');

	// Check if the .ts source exists; if not, try .js (post-build)
	let entry = entryPoint;
	try {
		await fs.access(entry);
	} catch {
		entry = entryPoint.replace('.ts', '.js');
	}

	const result = await esbuild.build({
		entryPoints: [entry],
		bundle: true,
		write: false,
		format: 'esm',
		platform: 'browser',
		target: 'esnext',
		minify: true,
		sourcemap: false,
		define: {
			'process.env.mode': '"browser"',
		},
		loader: {
			'.ts': 'ts',
			'.css': 'text',
		},
	});

	cachedBundle = result.outputFiles[0].text;
	return cachedBundle;
}

// ---------------------------------------------------------------------------
//  ServerRenderer class
// ---------------------------------------------------------------------------

export default class ServerRenderer {
	private videoJSON: VideoJSON;
	private context: BrowserContext | null = null;
	private page: Page | null = null;
	private renderId: string;

	constructor(videoJSON: VideoJSON) {
		this.videoJSON = videoJSON;
		this.renderId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
	//  Static render entry point
	// -----------------------------------------------------------------------

	/**
	 * Render a {@link VideoJSON} to a Buffer or file.
	 *
	 * @param videoJSON - The compiled video JSON.
	 * @param options   - Rendering options (outputType, output path, signal).
	 * @returns A Buffer containing the MP4 (when outputType is 'buffer') or
	 *          the output file path (when outputType is 'file').
	 */
	static async render(videoJSON: VideoJSON, options: RenderOptions = {}): Promise<Buffer | string> {
		const renderer = new ServerRenderer(videoJSON);
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

		// Error logging bridge
		this.page.on('console', msg => {
			if (msg.type() === 'error') {
				console.error('Headless page error:', msg.text());
			}
		});

		// Build the renderer bundle
		const bundle = await buildRendererBundle();
		const htmlContent = await this.getRendererHTML();

		// Set up the project loading bridge
		await this.page.exposeFunction('logError', (error: string) => {
			console.error('Renderer error:', error);
		});
		await this.page.exposeFunction('loadProject', () => {
			return this.videoJSON;
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

			if (url.endsWith('/renderer-page.html') || url === 'https://videoflow.local/') {
				return route.fulfill({
					body: htmlContent,
					contentType: 'text/html',
				});
			}
			if (url.endsWith('/renderer-page-script.js') || url.includes('renderer-page-script')) {
				return route.fulfill({
					body: bundle,
					contentType: 'application/javascript',
				});
			}

			// Pass through external requests (fonts, media assets)
			try {
				const response = await route.fetch();
				const headers = {
					...response.headers(),
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
					'Access-Control-Allow-Headers': 'Content-Type',
				};
				await route.fulfill({ response, headers });
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
	private initFFmpeg(hasAudio: boolean): [ChildProcess, Promise<boolean>] {
		const ffmpeg = spawn('ffmpeg', [
			'-y',
			'-f', 'image2pipe',
			'-framerate', String(this.videoJSON.fps),
			'-i', 'pipe:0',
			...(hasAudio ? ['-i', this.audioFile] : []),
			'-c:v', 'libx264',
			'-crf', '17',
			...(hasAudio ? ['-c:a', 'aac'] : []),
			'-pix_fmt', 'yuv420p',
			this.videoFile,
		]);

		const onFinish = new Promise<boolean>((resolve) => {
			ffmpeg.on('close', (code) => resolve(code === 0));
			ffmpeg.once('error', () => resolve(false));
		});

		return [ffmpeg, onFinish];
	}

	// -----------------------------------------------------------------------
	//  Main render loop
	// -----------------------------------------------------------------------

	/**
	 * Execute the full server-side rendering pipeline.
	 *
	 * 1. Open headless page and load the project
	 * 2. Render audio to a temporary WAV file
	 * 3. Spawn ffmpeg
	 * 4. For each frame: renderFrame → screenshot → pipe to ffmpeg
	 * 5. Close ffmpeg stdin, wait for it to finish
	 * 6. Return the output as a Buffer or file path
	 */
	private async renderVideo(options: RenderOptions = {}): Promise<Buffer | string> {
		const signal = options.signal;
		const verbose = options.verbose ?? false;

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

		// Set up ffmpeg
		const nFrames = Math.round(this.videoJSON.duration * this.videoJSON.fps);
		const durationStr = formatTime(this.videoJSON.duration);
		if (verbose) console.log(`VideoFlow: Rendering ${durationStr} video (${nFrames} frames)...`);

		const [ffmpeg, onFinish] = this.initFFmpeg(hasAudio);

		// Frame rendering loop
		let lastTick = Date.now();
		for (let i = 0; i < nFrames; i++) {
			if (signal?.aborted) {
				ffmpeg.kill('SIGKILL');
				throw new DOMException('Render aborted', 'AbortError');
			}

			// Stall detection
			if (Date.now() - lastTick > 120_000) {
				ffmpeg.kill('SIGKILL');
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

			if (verbose && (i % 30 === 0 || i === nFrames - 1)) {
				const pct = ((i + 1) / nFrames * 100).toFixed(1);
				console.log(`VideoFlow: Frame ${i + 1}/${nFrames} (${pct}%)`);
			}
		}

		// Close ffmpeg and wait for output
		ffmpeg.stdin!.end();
		const success = await onFinish;

		if (!success) {
			throw new Error('ffmpeg encoding failed.');
		}

		if (verbose) console.log('VideoFlow: Render complete.');

		// Return result
		if (options.outputType === 'file' && options.output) {
			await fs.copyFile(this.videoFile, options.output);
			return options.output;
		}

		const outputBuffer = await fs.readFile(this.videoFile);
		return outputBuffer;
	}

	// -----------------------------------------------------------------------
	//  Cleanup
	// -----------------------------------------------------------------------

	/** Release all resources: browser context, temporary files. */
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
			]);
		} catch { /* ignore */ }
	}
}
