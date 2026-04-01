/**
 * Headless page script — runs inside the Playwright browser context.
 *
 * This script is bundled with esbuild before being served to the headless
 * page.  It receives the VideoJSON via a `window.loadProject()` bridge
 * function exposed by the server, creates a BrowserRenderer, and exposes
 * `window.renderFrame()`, `window.captureFrame()`, and `window.renderAudio()`
 * for the server to call via `page.evaluate()`.
 *
 * The flow is:
 * 1. Server exposes `window.loadProject` returning the VideoJSON
 * 2. This script calls it, creates a BrowserRenderer, initialises layers
 * 3. Server calls `window.renderFrame(n)` → renders frame n to DOM
 * 4. Server takes a screenshot via Playwright's `page.screenshot()`
 * 5. Server calls `window.renderAudio()` → returns WAV as Uint8Array
 */

// These imports will be resolved by esbuild at bundle time
import { BrowserRenderer } from '@videoflow/renderer-browser';
import { audioBufferToWav } from '@videoflow/core';

declare global {
	interface Window {
		loadProject: () => Promise<any>;
		projectLoaded: () => Promise<void>;
		projectLoading: () => void;
		logError?: (msg: string) => void;
		renderFrame: (frame: number) => Promise<void>;
		captureFrame: (frame: number) => Promise<void>;
		renderAudio: () => Promise<Uint8Array | null>;
	}
}

// Self-executing async bootstrap
(async () => {
	if (!window.loadProject) return; // Not running in server mode

	try {
		const videoJSON = await window.loadProject();
		window.projectLoading?.();

		// Create the browser renderer with the video JSON
		const renderer = new BrowserRenderer(videoJSON);

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

		await window.projectLoaded();
	} catch (e) {
		console.error('Error loading project:', e);
		window.logError?.('Error loading project: ' + String(e));
	}
})();
