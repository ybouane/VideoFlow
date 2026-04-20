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
	 *
	 * ### Unit conventions
	 *
	 * Size properties accept `em` (default) or `px`. The renderer sets the
	 * root font-size to `1%` of the project width, so `1em` = 1% of project
	 * width and renders identically at any output resolution. Inside a text
	 * layer with a non-default `fontSize`, `em` is relative to that layer's
	 * font-size (standard CSS cascade), so sizes around text scale with the
	 * text.
	 *
	 * Colours accept any CSS colour string. Boolean toggles and enum values
	 * are plain strings / booleans. Angles are in degrees.
	 */
	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {
			...super.propertiesDefinition,

			// --- Visibility & opacity ---
			/** Hard on/off toggle. Not animatable — fades via `opacity`. */
			'visible': { default: true, animatable: false },
			/** `0` = fully transparent, `1` = fully opaque. */
			'opacity': { default: 1, animatable: true },

			// --- Transform ---
			/**
			 * `[x, y]` or `[x, y, z]`. `x` and `y` are normalised fractions of
			 * the project canvas — `0` = left/top edge, `1` = right/bottom
			 * edge, `0.5` = centred. `z` is a depth offset in `em` (1em = 1%
			 * of project width) — positive moves toward the camera.
			 */
			'position': { cssProperty: '--position', default: [0.5, 0.5], animatable: true },
			/**
			 * Uniform scale factor, or `[sx, sy]` / `[sx, sy, sz]` for
			 * non-uniform scaling. `1` = natural size, `2` = double size.
			 */
			'scale': { cssProperty: '--scale', default: 1, animatable: true },
			/**
			 * Rotation in degrees. Number = rotate around Z axis, or
			 * `[rx, ry, rz]` for per-axis rotation (X tilt / Y turn / Z roll).
			 */
			'rotation': { cssProperty: '--rotation', units: ['deg'], default: 0, animatable: true },
			/**
			 * Pivot point for rotation / scale, as normalised fractions
			 * (`[0, 0]` = top-left, `[0.5, 0.5]` = centre, `[1, 1]` = bottom-right).
			 * Also defines where `position` anchors on the layer.
			 */
			'anchor': { cssProperty: '--anchor', default: [0.5, 0.5], animatable: true },

			// --- Background ---
			/** CSS colour string (hex, `rgb()`, `rgba()`, `hsl()`, named, …). */
			'backgroundColor': { cssProperty: 'background-color', default: 'transparent', animatable: true },

			// --- Border ---
			/**
			 * Border thickness. Unitless = `em` (1em = 1% of project width).
			 * Single number applies to all sides; use `[top, right, bottom, left]`
			 * to set each side independently.
			 */
			'borderWidth': { cssProperty: 'border-width', units: ['em', 'px'], default: 0, animatable: true },
			/** One of the CSS border-style keywords. Not animatable. */
			'borderStyle': { cssProperty: 'border-style', enum: ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'], default: 'solid', animatable: false },
			/** CSS colour string. */
			'borderColor': { cssProperty: 'border-color', default: '#000000', animatable: true },
			/** When `true`, the border is drawn inside the layer box (`box-sizing: border-box`). */
			'innerBorder': { default: false, animatable: false },
			/**
			 * Corner radius. Unitless = `em`. Use `%` for proportional
			 * rounding (e.g. `50%` = perfect circle on a square). Single number
			 * applies to all four corners; array is `[tl, tr, br, bl]`.
			 */
			'borderRadius': { cssProperty: 'border-radius', units: ['em', 'px', '%'], default: 0, animatable: true },

			// --- Box shadow ---
			/** Master switch — when `false`, all box-shadow props are ignored. */
			'boxShadow': { default: false, animatable: false },
			/** Shadow blur radius. Unitless = `em`. `0` = hard edge. */
			'boxShadowBlur': { cssProperty: '--box-shadow-blur', units: ['em', 'px'], default: 0, animatable: true },
			/** `[x, y]` shadow offset. Unitless = `em`. Positive = right/down. */
			'boxShadowOffset': { cssProperty: '--box-shadow-offset', units: ['em', 'px'], default: [0, 0], animatable: true },
			/** Positive values grow the shadow, negative values shrink it. `em` units. */
			'boxShadowSpread': { cssProperty: '--box-shadow-spread', units: ['em', 'px'], default: 0, animatable: true },
			/** CSS colour string (use `rgba()` for soft translucent shadows). */
			'boxShadowColor': { cssProperty: '--box-shadow-color', default: '#000000', animatable: true },

			// --- Outline ---
			/** Outline thickness (drawn outside the border). Unitless = `em`. */
			'outlineWidth': { cssProperty: 'outline-width', units: ['em', 'px'], default: 0, animatable: true },
			/** One of the CSS outline-style keywords. Not animatable. */
			'outlineStyle': { cssProperty: 'outline-style', enum: ['none', 'solid', 'dashed', 'dotted', 'double', 'groove', 'ridge', 'inset', 'outset'], default: 'none', animatable: false },
			/** CSS colour string. */
			'outlineColor': { cssProperty: 'outline-color', default: '#000000', animatable: true },
			/** Gap between the layer and its outline. Unitless = `em`. */
			'outlineOffset': { cssProperty: 'outline-offset', units: ['em', 'px'], default: 0, animatable: true },

			// --- Filters (individual CSS filter functions) ---
			/** Gaussian blur radius. Unitless = `em`. `0` = no blur. */
			'filterBlur': { cssProperty: '--filter-blur', units: ['em', 'px'], default: 0, animatable: true },
			/** Unitless multiplier. `0` = black, `1` = original, `>1` = brighter. */
			'filterBrightness': { cssProperty: '--filter-brightness', default: 1, animatable: true },
			/** Unitless multiplier. `0` = grey, `1` = original, `>1` = higher contrast. */
			'filterContrast': { cssProperty: '--filter-contrast', default: 1, animatable: true },
			/** `0` = original colour, `1` = fully black-and-white. */
			'filterGrayscale': { cssProperty: '--filter-grayscale', default: 0, animatable: true },
			/** `0` = original colour, `1` = fully sepia-toned. */
			'filterSepia': { cssProperty: '--filter-sepia', default: 0, animatable: true },
			/** `0` = original colours, `1` = fully inverted (negative). */
			'filterInvert': { cssProperty: '--filter-invert', default: 0, animatable: true },
			/** Hue shift in degrees (`0`–`360`). */
			'filterHueRotate': { cssProperty: '--filter-hue-rotate', units: ['deg'], default: 0, animatable: true },
			/** Unitless multiplier. `0` = grey, `1` = original, `>1` = more saturated. */
			'filterSaturate': { cssProperty: '--filter-saturate', default: 1, animatable: true },

			// --- Blend mode & perspective ---
			//'blendMode': { cssProperty: 'mix-blend-mode', enum: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'], default: 'normal', animatable: false },
			/**
			 * 3D viewing distance for `rotation` / `position[z]`. Unitless = `em`.
			 * Default `100` (= `100em` = one project-width) gives a gentle 3D
			 * effect; smaller values exaggerate perspective, larger flatten it.
			 */
			'perspective': { cssProperty: '--perspective', units: ['em', 'px'], default: 100, animatable: true },
		};
	}
}
