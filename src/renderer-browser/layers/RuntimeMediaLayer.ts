/**
 * RuntimeMediaLayer — runtime base class for canvas-based media layers
 * (image, video).
 *
 * Creates a `<canvas>` element, stores decoded media and dimensions, and
 * handles the `fit` property.
 */

import type { PropertyDefinition } from '@videoflow/core/types';
import { loadedMedia, type MediaEntry } from '@videoflow/core';
import RuntimeVisualLayer from './RuntimeVisualLayer.js';

export default class RuntimeMediaLayer extends RuntimeVisualLayer {
	ctx: CanvasRenderingContext2D | null = null;
	internalMedia: HTMLImageElement | HTMLVideoElement | null = null;
	dimensions: [number, number] = [0, 0];
	duration: number = 0;
	/** Handle into the global media cache; null until initialize() runs. */
	cacheEntry: MediaEntry | null = null;

	/** Backwards-compatible accessor — returns the cached blob, if any. */
	get dataBlob(): Blob | null {
		return this.cacheEntry?.blob ?? null;
	}
	/** Backwards-compatible accessor — returns the cached object URL, if any. */
	get dataUrl(): string | null {
		return this.cacheEntry?.objectUrl ?? null;
	}

	get intrinsicDuration(): number | undefined {
		return this.duration > 0 ? this.duration : undefined;
	}

	async generateElement(): Promise<HTMLElement | null> {
		if (this.$element) return this.$element;
		this.$element = document.createElement('canvas');
		this.$element.setAttribute('data-element', this.json.type);
		this.$element.setAttribute('data-id', this.json.id);
		(this.$element as any).layerObject = this;
		return this.$element;
	}

	/**
	 * Override resetCSSProperties to clear data-fit and set object dimensions.
	 */
	resetCSSProperties(): void {
		super.resetCSSProperties();
		if (this.$element) {
			this.$element.removeAttribute('data-fit');
		}
	}

	/**
	 * Override applyProperties to ensure fit is always set.
	 */
	async applyProperties(props: Record<string, any>): Promise<void> {
		if (!props.fit) {
			const defaultProps = this.getPropertiesDefinition();
			props.fit = defaultProps.fit?.default ?? 'cover';
		}
		return super.applyProperties(props);
	}

	/**
	 * Override applyCSSProperty to handle the `fit` property via data attribute.
	 */
	async applyCSSProperty(prop: string, value: any, definition?: PropertyDefinition): Promise<void> {
		if (prop === 'fit') {
			if (this.$element) this.$element.setAttribute('data-fit', value);
			return;
		}
		return super.applyCSSProperty(prop, value, definition);
	}

	destroy(): void {
		if (this.cacheEntry) {
			const source = this.json.settings.source;
			if (typeof source === 'string') loadedMedia.release(source);
			this.cacheEntry = null;
		}
	}
}
