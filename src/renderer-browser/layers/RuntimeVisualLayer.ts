/**
 * RuntimeVisualLayer — runtime class for all layers with visible output.
 *
 * Mirrors Scrptly's VisualLayer renderer class. Adds:
 * - Filter composition (individual filter props → CSS filter string)
 * - Box shadow handling
 * - Border radius calculation
 * - Visible / outerBorder CSS overrides
 *
 * Sits between RuntimeBaseLayer and RuntimeTextualLayer/RuntimeMediaLayer.
 */

import type { PropertyDefinition } from '@videoflow/core/types';
import RuntimeBaseLayer from './RuntimeBaseLayer.js';

const FILTER_MAP: Record<string, string> = {
	blur: 'blur',
	brightness: 'brightness',
	contrast: 'contrast',
	grayscale: 'grayscale',
	hueRotate: 'hue-rotate',
	invert: 'invert',
	opacity: 'opacity',
	saturate: 'saturate',
	sepia: 'sepia',
};

const FILTER_DEFAULTS: Record<string, number> = {
	blur: 0,
	brightness: 1,
	contrast: 1,
	grayscale: 0,
	sepia: 0,
	invert: 0,
	hueRotate: 0,
	saturate: 1,
	opacity: 1,
};

export default class RuntimeVisualLayer extends RuntimeBaseLayer {
	get hasVisual(): boolean { return true; }

	/**
	 * Override applyProperties to pre-process visual props before CSS application.
	 * Mirrors Scrptly's VisualLayer.applyProperties:
	 * - Remove boxShadow sub-props if boxShadow is false
	 * - Build filter array from individual filter* props
	 */
	async applyProperties(props: Record<string, any>): Promise<void> {
		// Remove box shadow sub-properties if boxShadow is disabled
		if (!props.boxShadow) {
			delete props.boxShadowColor;
			delete props.boxShadowOffset;
			delete props.boxShadowBlur;
			delete props.boxShadowSpread;
		}

		// Build filter array from individual filter* properties
		// Only include filters with non-default values
		const nonDefaultFilters = Object.keys(FILTER_MAP).filter(p => {
			const propKey = `filter${p.charAt(0).toUpperCase()}${p.slice(1)}`;
			if (!Object.hasOwn(props, propKey)) return false;
			return props[propKey] !== FILTER_DEFAULTS[p];
		});
		if (nonDefaultFilters.length > 0) {
			props.filter = nonDefaultFilters;
		} else {
			delete props.filter;
		}

		return super.applyProperties(props);
	}

	/**
	 * Override applyCSSProperty for visual-specific CSS handling.
	 * Mirrors Scrptly's VisualLayer.applyCSSProperty.
	 */
	async applyCSSProperty(prop: string, value: any, definition?: PropertyDefinition): Promise<void> {
		if (prop === 'boxShadow') {
			if (value) {
				return super.applyCSSProperty(
					'box-shadow',
					'var(--box-shadow-offset-0) var(--box-shadow-offset-1) var(--box-shadow-blur) var(--box-shadow-spread) var(--box-shadow-color)',
					definition,
				);
			}
			return;
		}

		if (prop === 'filter') {
			if (Array.isArray(value) && value.length > 0) {
				return super.applyCSSProperty(
					'filter',
					value.map((v: string) => `${FILTER_MAP[v]}(var(--filter-${FILTER_MAP[v]}))`).join(' '),
					definition,
				);
			}
			return;
		}

		if (prop === 'border-radius') {
			// Scale border-radius relative to object dimensions (mirrors Scrptly)
			let vals = Array.isArray(value) ? value : [value];
			vals = vals.map(v => {
				if (typeof v === 'number' || (typeof v === 'string' && /^[0-9.]+$/.test(v))) {
					return `calc(${v} * 0.5px * min(var(--object-actual-width, var(--project-width)), var(--object-actual-height, var(--project-height))))`;
				}
				return v;
			});
			return super.applyCSSProperty(prop, vals.join(' '), definition);
		}

		if (prop === 'visible') {
			if (!value) {
				return super.applyCSSProperty('visibility', 'hidden', definition);
			}
			return;
		}

		if (prop === 'outerBorder') {
			if (value) {
				return super.applyCSSProperty('box-sizing', 'content-box', definition);
			}
			return;
		}

		return super.applyCSSProperty(prop, value, definition);
	}
}
