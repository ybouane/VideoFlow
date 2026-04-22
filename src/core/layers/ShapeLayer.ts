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
 * Sizing is project-relative: the default unit is `em` (1em = 1% of project
 * width), so a shape keeps the same visual size when the project is scaled
 * up or down. `%` resolves against the project axis (width for `width`,
 * height for `height`), and `vmin` / `vmax` / `vw` / `vh` are also accepted.
 * If `width` / `height` are unset, the default depends on `shapeType`:
 * rectangles fill the whole project; other shapes fit within the project
 * (a square inscribed in the smaller axis).
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

export type ShapeLayerProperties = VisualLayerProperties & {
	width?: number | string;
	height?: number | string;
	fill?: string;
	strokeColor?: string;
	strokeWidth?: number | string;
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
			// Size units (in priority order): em (=1% project width), px, %,
			// vmin, vmax, vw, vh. No default — when unset, the runtime picks
			// a sensible default per `shapeType` (rectangle fills the project;
			// others fit within it).
			'width':  { cssProperty: false, units: ['em', 'px', '%', 'vmin', 'vmax', 'vw', 'vh'], default: undefined, animatable: true },
			'height': { cssProperty: false, units: ['em', 'px', '%', 'vmin', 'vmax', 'vw', 'vh'], default: undefined, animatable: true },

			// --- Fill / stroke -----------------------------------------------
			/** Fill colour. Use `'transparent'` to disable the fill. */
			'fill': { cssProperty: false, default: '#ffffff', animatable: true },
			/** Stroke colour. Only visible when `strokeWidth > 0`. */
			'strokeColor': { cssProperty: false, default: '#000000', animatable: true },
			/** Stroke thickness. `0` disables the stroke entirely. Unitless = `em`. */
			'strokeWidth': { cssProperty: false, units: ['em', 'px'], default: 0, animatable: true },

			// --- Shape-specific ----------------------------------------------
			/** Rounded corners (rectangle only). Unitless = `em`. Capped at half the shorter side. */
			'cornerRadius': { cssProperty: false, units: ['em', 'px', '%'], default: 0, animatable: true },
			/** Number of vertices for `polygon` / points for `star`. Integer ≥ 3. Not animatable. */
			'sides': { cssProperty: false, default: 6, animatable: false },
			/** Star-only. Ratio of inner to outer radius (`0..1`). Ignored by other shapes. */
			'innerRadius': { cssProperty: false, default: 0.5, animatable: true },
		};
	}
}
