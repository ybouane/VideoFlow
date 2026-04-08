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

		this.internalMedia = document.createElement('img');
		(this.internalMedia as HTMLImageElement).src = this.cacheEntry.objectUrl;

		await new Promise<void>((resolve, reject) => {
			(this.internalMedia as HTMLImageElement).onload = () => {
				this.dimensions = [
					(this.internalMedia as HTMLImageElement).naturalWidth,
					(this.internalMedia as HTMLImageElement).naturalHeight,
				];
				resolve();
			};
			(this.internalMedia as HTMLImageElement).onerror = () =>
				reject(new Error(`Failed to load image: ${source}`));
		});
	}

	/**
	 * Override generateElement to set canvas dimensions and draw initial image.
	 */
	async generateElement(): Promise<HTMLElement | null> {
		const $ele = await super.generateElement();
		if ($ele) {
			($ele as HTMLCanvasElement).width = this.dimensions[0];
			($ele as HTMLCanvasElement).height = this.dimensions[1];
			if (!this.ctx) {
				this.ctx = ($ele as HTMLCanvasElement).getContext('2d')!;
				this.ctx.imageSmoothingEnabled = true;
				this.ctx.imageSmoothingQuality = 'high';
				this.ctx.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
				if (this.internalMedia) {
					this.ctx.drawImage(
						this.internalMedia as HTMLImageElement,
						0, 0, this.dimensions[0], this.dimensions[1],
					);
				}
			}
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
