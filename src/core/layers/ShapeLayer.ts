/**
 * ShapeLayer — renders a vector shape (rectangle, ellipse, polygon, star).
 *
 * Sits on top of {@link VisualLayer} so all the usual transform, opacity,
 * filter, shadow and box-shadow machinery works. The silhouette itself is
 * drawn via an inline `<svg>` with a `<rect>` / `<ellipse>` / `<polygon>`
 * primitive, giving crisp vector output at any scale. The shape rasterizes
 * through the normal per-layer pipeline; the renderer's cache shortcuts
 * frames where the resolved properties do not change.
 *
 * The choice of shape is a *setting* (`shapeType`), not a property — it is
 * fixed for the life of the layer. What you animate are the shape's
 * parameters: size, fill, stroke, corner radius, etc.
 *
 * Sizing is project-relative and the only accepted unit is `em`, where
 * `1em = min(projectWidth, projectHeight) / 100`. So `100em` always spans
 * the project's shorter axis. Default size is `100em × 100em`, which means:
 * a rectangle renders as a square inscribed in the shorter axis, and an
 * ellipse as a perfect circle of the same diameter — regardless of aspect
 * ratio. Scaling the project up or down leaves shapes visually identical.
 *
 * Stroke is enabled whenever `strokeWidth > 0`. There is no separate toggle.
 */

import VisualLayer, { VisualLayerProperties, VisualLayerSettings } from './VisualLayer.js';
import type { PropertyDefinition } from '../types.js';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type ShapeType = 'rectangle' | 'ellipse' | 'polygon' | 'star';

export type ShapeLayerSettings = VisualLayerSettings & {
	/** Which shape silhouette to draw. Defaults to `'rectangle'`. */
	shapeType?: ShapeType;
};

export type StrokeAlignment = 'inner' | 'center' | 'outer';
export type StrokeLinejoin = 'miter' | 'round' | 'bevel';

export type ShapeLayerProperties = VisualLayerProperties & {
	width?: number | string;
	height?: number | string;
	fill?: string;
	strokeColor?: string;
	strokeWidth?: number | string;
	strokeAlignment?: StrokeAlignment;
	strokeDash?: number | string;
	strokeGap?: number | string;
	strokeLinejoin?: StrokeLinejoin;
	cornerRadius?: number | string;
	sides?: number;
	innerRadius?: number;
};

// ---------------------------------------------------------------------------
//  Class
// ---------------------------------------------------------------------------

export default class ShapeLayer extends VisualLayer {
	static type = 'shape';
	declare properties: ShapeLayerProperties;
	declare settings: ShapeLayerSettings;

	constructor(parent: any, properties: ShapeLayerProperties = {}, settings: ShapeLayerSettings = {}) {
		super(parent, properties, settings);
	}

	static get settingsKeys(): string[] {
		return [...super.settingsKeys, 'shapeType'];
	}

	static get defaultSettings(): Partial<ShapeLayerSettings> {
		return { ...super.defaultSettings, shapeType: 'rectangle' };
	}

	static get defaultProperties(): Partial<ShapeLayerProperties> {
		return { ...super.defaultProperties };
	}

	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {
			...super.propertiesDefinition,

			// --- Shape box ----------------------------------------------------
			// Size units (in priority order): em (=1% project width)
			'width':  { cssProperty: false, units: ['em'], default: 100, animatable: true },
			'height': { cssProperty: false, units: ['em'], default: 100, animatable: true },

			// --- Fill / stroke -----------------------------------------------
			/** Fill colour. Use `'transparent'` to disable the fill. */
			'fill': { cssProperty: false, default: '#ffffff', animatable: true },
			/** Stroke colour. Only visible when `strokeWidth > 0`. */
			'strokeColor': { cssProperty: false, default: '#000000', animatable: true },
			/** Stroke thickness. `0` disables the stroke entirely. Unitless = `em`. */
			'strokeWidth': { cssProperty: false, units: ['em'], default: 0, animatable: true },
			/**
			 * Where the stroke sits relative to the shape's box edge:
			 * `'inner'` (default) — entire stroke is inside the box; the fill shrinks to fit.
			 * `'center'` — stroke straddles the edge; half inside, half outside.
			 * `'outer'` — entire stroke is outside the box; fill stays at box size.
			 */
			'strokeAlignment': { cssProperty: false, default: 'inner', animatable: false },
			/** Length of each dash. `0` (default) draws a solid stroke. Unitless = `em`. */
			'strokeDash': { cssProperty: false, units: ['em'], default: 0, animatable: true },
			/** Gap between dashes. Defaults to `strokeDash` when `0`. Unitless = `em`. */
			'strokeGap': { cssProperty: false, units: ['em'], default: 0, animatable: true },
			/** How stroke segments meet at corners: `'miter'` (sharp), `'round'`, or `'bevel'`. */
			'strokeLinejoin': { cssProperty: false, default: 'miter', animatable: false },

			// --- Shape-specific ----------------------------------------------
			/** Rounded corners (rectangle only). Unitless = `em`. Capped at half the shorter side. */
			'cornerRadius': { cssProperty: false, units: ['em'], default: 0, animatable: true },
			/** Number of vertices for `polygon` / points for `star`. Integer ≥ 3. Not animatable. */
			'sides': { cssProperty: false, default: 6, animatable: false },
			/** Star-only. Ratio of inner to outer radius (`0..1`). Ignored by other shapes. */
			'innerRadius': { cssProperty: false, default: 0.5, animatable: true },
		};
	}
}
