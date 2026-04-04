/**
 * RuntimeMediaLayer — runtime base class for canvas-based media layers
 * (image, video).
 *
 * Mirrors Scrptly's MediaLayer renderer class. Creates a `<canvas>` element,
 * stores decoded media and dimensions, and handles the `fit` property.
 */

import type { PropertyDefinition } from '@videoflow/core/types';
import RuntimeVisualLayer from './RuntimeVisualLayer.js';

export default class RuntimeMediaLayer extends RuntimeVisualLayer {
	ctx: CanvasRenderingContext2D | null = null;
	internalMedia: HTMLImageElement | HTMLVideoElement | null = null;
	dimensions: [number, number] = [0, 0];
	duration: number = 0;
	dataUrl: string | null = null;
	dataBlob: Blob | null = null;

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
	 * Mirrors Scrptly's MediaLayer.resetCSSProperties.
	 */
	resetCSSProperties(): void {
		super.resetCSSProperties();
		if (this.$element) {
			this.$element.removeAttribute('data-fit');
		}
	}

	/**
	 * Override applyProperties to ensure fit is always set.
	 * Mirrors Scrptly's MediaLayer.applyProperties.
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
	 * Mirrors Scrptly's MediaLayer.applyCSSProperty.
	 */
	async applyCSSProperty(prop: string, value: any, definition?: PropertyDefinition): Promise<void> {
		if (prop === 'fit') {
			if (this.$element) this.$element.setAttribute('data-fit', value);
			return;
		}
		return super.applyCSSProperty(prop, value, definition);
	}

	destroy(): void {
		if (this.dataUrl) {
			URL.revokeObjectURL(this.dataUrl);
			this.dataUrl = null;
		}
	}
}
