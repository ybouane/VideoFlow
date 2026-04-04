/**
 * RuntimeTextualLayer — runtime class for text-bearing layers.
 *
 * Provides text-bearing layer rendering with:
 * - Text stroke / text shadow pre-processing
 * - text-align → CSS left/right positioning
 * - vertical-align → CSS top/bottom positioning
 * - textShadow → CSS text-shadow with var references
 * - font-family → font loading + fallback chain
 *
 * Creates a `<textual-layer>` custom element.
 */

import type { PropertyDefinition } from '@videoflow/core/types';
import RuntimeVisualLayer from './RuntimeVisualLayer.js';

export default class RuntimeTextualLayer extends RuntimeVisualLayer {
	async generateElement(): Promise<HTMLElement | null> {
		if (this.$element) return this.$element;
		this.$element = document.createElement('textual-layer');
		this.$element.setAttribute('data-element', this.json.type);
		this.$element.setAttribute('data-id', this.json.id);
		(this.$element as any).layerObject = this;
		return this.$element;
	}

	/**
	 * Override applyProperties to pre-process text props:
	 * - Remove textStroke sub-props if textStroke is false
	 * - Remove textShadow sub-props if textShadow is false
	 */
	async applyProperties(props: Record<string, any>): Promise<void> {
		if (!props.textStroke) {
			delete props.textStrokeWidth;
			delete props.textStrokeColor;
		}
		if (!props.textShadow) {
			delete props.textShadowOffset;
			delete props.textShadowBlur;
			delete props.textShadowColor;
		}
		return super.applyProperties(props);
	}

	/**
	 * Override applyCSSProperty for text-specific CSS handling.
	 */
	async applyCSSProperty(prop: string, value: any, definition?: PropertyDefinition): Promise<void> {
		if (prop === 'text-align') {
			// text-align also affects horizontal positioning
			if (value === 'left' || value === 'justify') {
				await super.applyCSSProperty('left', '50%', { units: ['%'], default: 0 } as PropertyDefinition);
			} else if (value === 'right') {
				await super.applyCSSProperty('right', '50%', { units: ['%'], default: 0 } as PropertyDefinition);
			}
		} else if (prop === 'vertical-align') {
			// vertical-align maps to top/bottom CSS position
			if (value === 'top') {
				return super.applyCSSProperty('top', '50%', { units: ['%'], default: 0 } as PropertyDefinition);
			} else if (value === 'bottom') {
				return super.applyCSSProperty('bottom', '50%', { units: ['%'], default: 0 } as PropertyDefinition);
			}
			return; // 'middle' = default centering, no extra CSS needed
		} else if (prop === 'textShadow') {
			if (value) {
				return super.applyCSSProperty(
					'text-shadow',
					'var(--text-shadow-offset-0) var(--text-shadow-offset-1) var(--text-shadow-blur) var(--text-shadow-color)',
					definition,
				);
			}
			return;
		} else if (prop === 'font-family') {
			await this.renderer.loadFont(value);
			value = `"${value}", "Noto Sans", Roboto, Verdana, Helvetica, sans-serif`;
		}

		return super.applyCSSProperty(prop, value, definition);
	}
}
