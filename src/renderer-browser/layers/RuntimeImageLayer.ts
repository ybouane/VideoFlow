/**
 * RuntimeImageLayer — runtime class for static image layers.
 *
 * Loads an image, draws it onto the canvas, and sets object dimensions
 * for CSS fit calculations.
 */

import { loadedMedia } from '@videoflow/core';
import RuntimeMediaLayer from './RuntimeMediaLayer.js';

export default class RuntimeImageLayer extends RuntimeMediaLayer {
	async initialize(): Promise<void> {
		if (this.cacheEntry) return; // Idempotent — already initialised.
		const source = this.json.settings.source;
		if (!source) return;

		this.cacheEntry = await loadedMedia.acquire(source);

		const img = document.createElement('img');
		this.internalMedia = img;
		// `decode()` returns a promise that resolves once the bytes are fully
		// decoded — no race with `onload` (which fires before any listener has
		// a chance to attach when the blob URL resolves on the same microtask)
		// and no need for crossOrigin since blob URLs are same-origin.
		img.src = this.cacheEntry.objectUrl;
		try {
			await img.decode();
		} catch (err) {
			throw new Error(`Failed to load image: ${source} (${(err as Error).message})`);
		}
		this.dimensions = [img.naturalWidth, img.naturalHeight];
		if (this.dimensions[0] === 0 || this.dimensions[1] === 0) {
			throw new Error(`Failed to load image: ${source} (decoded with zero dimensions)`);
		}
	}

	/**
	 * Create the canvas, size it to the image, and paint the decoded image
	 * onto it. Idempotent: when called a second time (e.g. when `initLayers`
	 * runs again after the bootstrap pre-render) we MUST NOT re-assign
	 * `canvas.width` / `canvas.height` because that resets the canvas bitmap
	 * to fully transparent, and the painted image would be lost.
	 */
	async generateElement(): Promise<HTMLElement | null> {
		// Already set up — return as-is, do not touch width/height.
		if (this.$element && this.ctx) return this.$element;

		const $ele = await super.generateElement();
		if (!$ele) return $ele;
		const canvas = $ele as HTMLCanvasElement;
		canvas.width = this.dimensions[0];
		canvas.height = this.dimensions[1];
		this.ctx = canvas.getContext('2d')!;
		this.ctx.imageSmoothingEnabled = true;
		this.ctx.imageSmoothingQuality = 'high';
		this.ctx.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
		if (this.internalMedia) {
			this.ctx.drawImage(
				this.internalMedia as HTMLImageElement,
				0, 0, this.dimensions[0], this.dimensions[1],
			);
		}
		return $ele;
	}

	/**
	 * Override resetCSSProperties to set object dimensions for fit calculations.
	 */
	resetCSSProperties(): void {
		super.resetCSSProperties();
		if (this.$element) {
			this.$element.style.setProperty('--object-width', String(this.dimensions[0]));
			this.$element.style.setProperty('--object-height', String(this.dimensions[1]));
		}
	}
}
