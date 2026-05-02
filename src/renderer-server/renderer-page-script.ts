/**
 * Headless page script — runs inside the Playwright browser context.
 *
 * This script is bundled with esbuild before being served to the headless
 * page. It receives the VideoJSON via a `window.loadProject()` bridge function
 * exposed by the server, creates a `BrowserRenderer`, and exposes a small
 * RPC surface that the server invokes via `page.evaluate()`:
 *
 * - `renderFrame(n)`     — render frame `n` to the DOM (legacy ffmpeg path)
 * - `captureFrame(n)`    — render and rasterise to canvas (legacy path)
 * - `renderAudio()`      — render the audio track and return WAV bytes
 * - `exportVideo(url)`   — encode the **entire** video (frames + audio +
 *                          MP4 muxing) inside the browser using
 *                          `BrowserRenderer.exportVideo()` and POST the
 *                          finished MP4 back to the server at `url`. This is
 *                          the default fast path; it skips the per-frame
 *                          screenshot round-trip and uses WebCodecs for
 *                          encoding.
 *
 * The browser-export path uses an `AbortController` parked on
 * `window.__exportAbort` so the server can cancel the in-flight render via
 * `page.evaluate(() => window.__exportAbort.abort())`.
 */

// These imports will be resolved by esbuild at bundle time
import { BrowserRenderer } from '@videoflow/renderer-browser';
import { audioBufferToWav } from '@videoflow/core/utils';

declare global {
	interface Window {
		loadProject: () => Promise<any>;
		projectLoaded: () => Promise<void>;
		projectLoading: () => void;
		logError?: (msg: string) => void;
		onExportProgress?: (progress: number) => void;
		renderFrame: (frame: number) => Promise<void>;
		captureFrame: (frame: number) => Promise<void>;
		renderAudio: () => Promise<Uint8Array | null>;
		exportVideo: (uploadUrl: string) => Promise<number>;
		__exportAbort?: AbortController;
	}
}

// Self-executing async bootstrap
(async () => {
	if (!window.loadProject) return; // Not running in server mode

	try {
		const videoJSON = await window.loadProject();
		window.projectLoading?.();

		// Set the page background color to the project's background color
		document.body.style.backgroundColor = videoJSON.backgroundColor || '#000000';

		// Create the browser renderer with the video JSON
		const renderer = new BrowserRenderer(videoJSON);

		// Move the renderer canvas on-screen so Playwright screenshots capture it
		const $canvas = document.querySelector('[data-renderer]') as HTMLElement;
		if ($canvas) {
			$canvas.style.position = 'absolute';
			$canvas.style.left = '0';
			$canvas.style.top = '0';
		}

		// Initialise all layers (load media, create DOM elements)
		// The renderer's initLayers is private, but renderFrame calls it on first use
		// We trigger it by rendering frame 0
		await renderer.renderFrame(0, true);
		window.projectLoading?.();

		// Expose rendering functions for the server to call
		window.renderFrame = async (frame: number) => {
			try {
				await renderer.renderFrame(frame, true);
			} catch (e) {
				console.error('Error rendering frame [' + frame + ']:', e);
				window.logError?.('Error rendering frame [' + frame + ']: ' + String(e));
			}
		};

		window.captureFrame = async (frame: number) => {
			try {
				await renderer.captureFrame(frame);
			} catch (e) {
				console.error('Error capturing frame [' + frame + ']:', e);
				window.logError?.('Error capturing frame [' + frame + ']: ' + String(e));
			}
		};

		window.renderAudio = async () => {
			try {
				const audioBuffer = await renderer.renderAudio();
				if (!audioBuffer) {
					console.warn('No audio rendered.');
					return null;
				}
				const wav = audioBufferToWav(audioBuffer);
				return new Uint8Array(wav);
			} catch (e) {
				console.error('Error rendering audio:', e);
				window.logError?.('Error rendering audio: ' + String(e));
				return null;
			}
		};

		// Browser-export fast path: encode video + audio + MP4 mux in the browser
		// via BrowserRenderer.exportVideo (Worker + WebCodecs + MediaBunny), then
		// POST the finished MP4 back to the server. The server intercepts the
		// POST through Playwright's route handler so the bytes never touch the
		// network — they go straight from the page's request body to a Buffer
		// in Node, with no JSON serialisation step.
		window.exportVideo = async (uploadUrl: string): Promise<number> => {
			// Fresh AbortController per export so subsequent renders aren't
			// poisoned by an earlier abort.
			const abort = new AbortController();
			window.__exportAbort = abort;

			let blob: Blob;
			try {
				blob = await renderer.exportVideo({
					signal: abort.signal,
					onProgress: (progress: number) => {
						// Bridge progress out to Node. Swallow callback errors so
						// they don't poison the encode pipeline.
						try { window.onExportProgress?.(progress); } catch { /* ignore */ }
					},
					// Workers default to true, which keeps the page responsive
					// during encode. No need to override here.
				});
			} catch (e) {
				if ((e as any)?.name === 'AbortError') throw e;
				const msg = 'Error exporting video: ' + String((e as any)?.message ?? e);
				console.error(msg);
				window.logError?.(msg);
				throw e;
			} finally {
				window.__exportAbort = undefined;
			}

			// POST the MP4 back to the server. The route handler reads the body
			// via `route.request().postDataBuffer()` and stashes it on the
			// ServerRenderer instance, so we don't pay any base64 / JSON tax.
			const res = await fetch(uploadUrl, {
				method: 'POST',
				headers: { 'Content-Type': 'video/mp4' },
				body: blob,
			});
			if (!res.ok) {
				throw new Error('Failed to upload exported video: HTTP ' + res.status);
			}
			return blob.size;
		};

		await window.projectLoaded();
	} catch (e) {
		console.error('Error loading project:', e);
		window.logError?.('Error loading project: ' + String(e));
	}
})();
