/**
 * VisualLayer — base class for all layers that produce visible output.
 *
 * Extends {@link BaseLayer} with a rich set of visual properties such as
 * opacity, position, scale, rotation, filters, borders, box-shadow, and more.
 * Each property maps to a CSS custom property or standard CSS property so the
 * rendering system can apply it directly via SVG `foreignObject` → canvas.
 *
 * The property definitions are adapted for VideoFlow's data model.
 */

import BaseLayer, { BaseLayerSettings, BaseLayerProperties } from './BaseLayer.js';
import type { Time, Easing, PropertyDefinition } from '../types.js';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type VisualLayerProperties = BaseLayerProperties & {
	visible?: boolean;
	opacity?: number;
	//blendMode?: string;
	position?: [number, number] | [number, number, number];
	scale?: number | [number, number] | [number, number, number];
	rotation?: number | [number, number, number];
	anchor?: [number, number] | [number, number, number];
	backgroundColor?: string;
	borderWidth?: number | [number, number, number, number];
	borderStyle?: string;
	borderColor?: string;
	borderRadius?: number | [number, number, number, number];
	boxShadow?: boolean;
	boxShadowBlur?: number;
	boxShadowOffset?: [number, number];
	boxShadowSpread?: number;
	boxShadowColor?: string;
	outlineWidth?: number;
	outlineStyle?: string;
	outlineColor?: string;
	outlineOffset?: number;
	filterBlur?: number;
	filterBrightness?: number;
	filterContrast?: number;
	filterGrayscale?: number;
	filterSepia?: number;
	filterInvert?: number;
	filterHueRotate?: number;
	filterSaturate?: number;
	perspective?: number;
};

export type VisualLayerSettings = BaseLayerSettings;

// ---------------------------------------------------------------------------
//  Class
// ---------------------------------------------------------------------------

export default class VisualLayer extends BaseLayer {
	static type = 'visual';
	declare properties: VisualLayerProperties;
	declare settings: VisualLayerSettings;

	constructor(parent: any, properties: VisualLayerProperties = {}, settings: VisualLayerSettings = {}) {
		super(parent, properties, settings);
	}

	static get defaultSettings(): Partial<VisualLayerSettings> {
		return { ...super.defaultSettings };
	}

	static get defaultProperties(): Partial<VisualLayerProperties> {
		return { ...super.defaultProperties };
	}

	/**
	 * Full property definitions for visual layers.
	 *
	 * Each entry specifies how a property maps to CSS, what units it accepts,
	 * its default value, and whether it can be smoothly interpolated between
	 * keyframes during animation.
	 */
	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {
			...super.propertiesDefinition,

			// --- Visibility & opacity ---
			'visible': { default: true, animatable: false },
			'opacity': { default: 1, animatable: true },

			// --- Transform ---
			'position': { cssProperty: '--position', default: [0.5, 0.5], animatable: true },
			'scale': { cssProperty: '--scale', default: 1, animatable: true },
			'rotation': { cssProperty: '--rotation', units: ['deg'], default: 0, animatable: true },
			'anchor': { cssProperty: '--anchor', default: [0.5, 0.5], animatable: true },

			// --- Background ---
			'backgroundColor': { cssProperty: 'background-color', default: 'transparent', animatable: true },

			// --- Border ---
			'borderWidth': { cssProperty: 'border-width', units: ['px'], default: 0, animatable: true },
			'borderStyle': { cssProperty: 'border-style', enum: ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'], default: 'solid', animatable: false },
			'borderColor': { cssProperty: 'border-color', default: '#000000', animatable: true },
			'outerBorder': { default: false, animatable: false },
			'borderRadius': { cssProperty: 'border-radius', units: ['', 'px', '%'], default: 0, animatable: true },

			// --- Box shadow ---
			'boxShadow': { default: false, animatable: false },
			'boxShadowBlur': { cssProperty: '--box-shadow-blur', units: ['px'], default: 0, animatable: true },
			'boxShadowOffset': { cssProperty: '--box-shadow-offset', units: ['px'], default: [0, 0], animatable: true },
			'boxShadowSpread': { cssProperty: '--box-shadow-spread', units: ['px'], default: 0, animatable: true },
			'boxShadowColor': { cssProperty: '--box-shadow-color', default: '#000000', animatable: true },

			// --- Outline ---
			'outlineWidth': { cssProperty: 'outline-width', units: ['px'], default: 0, animatable: true },
			'outlineStyle': { cssProperty: 'outline-style', enum: ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'], default: 'none', animatable: false },
			'outlineColor': { cssProperty: 'outline-color', default: '#000000', animatable: true },
			'outlineOffset': { cssProperty: 'outline-offset', units: ['px'], default: 0, animatable: true },

			// --- Filters (individual CSS filter functions) ---
			'filterBlur': { cssProperty: '--filter-blur', units: ['px'], default: 0, animatable: true },
			'filterBrightness': { cssProperty: '--filter-brightness', default: 1, animatable: true },
			'filterContrast': { cssProperty: '--filter-contrast', default: 1, animatable: true },
			'filterGrayscale': { cssProperty: '--filter-grayscale', default: 0, animatable: true },
			'filterSepia': { cssProperty: '--filter-sepia', default: 0, animatable: true },
			'filterInvert': { cssProperty: '--filter-invert', default: 0, animatable: true },
			'filterHueRotate': { cssProperty: '--filter-hue-rotate', units: ['deg'], default: 0, animatable: true },
			'filterSaturate': { cssProperty: '--filter-saturate', default: 1, animatable: true },

			// --- Blend mode & perspective ---
			//'blendMode': { cssProperty: 'mix-blend-mode', enum: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'], default: 'normal', animatable: false },
			'perspective': { cssProperty: '--perspective', units: ['px'], default: 2000, animatable: true },
		};
	}
}
