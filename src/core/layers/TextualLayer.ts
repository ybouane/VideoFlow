/**
 * TextualLayer — base class for text-bearing visual layers.
 *
 * Adds typography properties (font family, size, weight, style, colour, etc.)
 * on top of {@link VisualLayer}. Both {@link TextLayer} and
 * {@link CaptionsLayer} extend this class.
 */

import VisualLayer, { VisualLayerProperties, VisualLayerSettings } from './VisualLayer.js';
import type { PropertyDefinition } from '../types.js';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type TextualLayerProperties = VisualLayerProperties & {
	fontSize?: number;
	fontFamily?: string;
	fontWeight?: string | number;
	fontStyle?: string;
	fontStretch?: string;
	color?: string;
	textAlign?: string;
	verticalAlign?: string;
	padding?: number | [number, number, number, number];
	textStroke?: boolean;
	textStrokeWidth?: number;
	textStrokeColor?: string;
	textShadow?: boolean;
	textShadowColor?: string;
	textShadowOffset?: [number, number];
	textShadowBlur?: number;
	letterSpacing?: number;
	lineHeight?: number;
	textTransform?: string;
	textDecoration?: string;
	wordSpacing?: number;
	direction?: string;
	textIndent?: number;
};

export type TextualLayerSettings = VisualLayerSettings;

// ---------------------------------------------------------------------------
//  Class
// ---------------------------------------------------------------------------

export default class TextualLayer extends VisualLayer {
	static type = 'textual';
	static category = 'textual';
	declare properties: TextualLayerProperties;
	declare settings: TextualLayerSettings;

	constructor(parent: any, properties: TextualLayerProperties = {}, settings: TextualLayerSettings = {}) {
		super(parent, properties, settings);
	}

	static get defaultSettings(): Partial<TextualLayerSettings> {
		return { ...super.defaultSettings };
	}

	static get defaultProperties(): Partial<TextualLayerProperties> {
		return { ...super.defaultProperties };
	}

	/**
	 * Typography property definitions.
	 *
	 * These control font rendering, text alignment, strokes, shadows, and
	 * spacing.  Most map directly to their CSS counterparts.
	 *
	 * ### Unit conventions
	 *
	 * Size properties default to `em`. The project root font-size is 1% of
	 * the project width, so an un-styled text layer has `1em` = 1% of
	 * project width. Once `fontSize` is set, `em` on that same layer
	 * becomes relative to the layer's font-size (standard CSS cascade) —
	 * which is usually what you want for padding / stroke / shadow around
	 * text.
	 */
	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {
			...super.propertiesDefinition,
			/**
			 * Text size. Unitless = `em` at the project root, so `4` = 4% of
			 * project width (≈ 77px on a 1920-wide canvas). Default `4`.
			 */
			'fontSize': { cssProperty: 'font-size', units: ['em', 'px'], default: 4, animatable: true },
			/** Font family name — any Google Font, system font, or CSS stack. */
			'fontFamily': { cssProperty: 'font-family', default: 'Noto Sans', animatable: false },
			/** `100`–`900` or keywords (`normal` = 400, `bold` = 700). */
			'fontWeight': { cssProperty: 'font-weight', default: 600, animatable: true },
			/** `'normal'` or `'italic'`. */
			'fontStyle': { cssProperty: 'font-style', enum: ['normal', 'italic'], default: 'normal', animatable: false },
			/** Font width percentage — `100` = normal, `<100` = condensed, `>100` = expanded. */
			'fontStretch': { cssProperty: 'font-stretch', units: ['%'], default: 100, animatable: true },
			/** Text colour — any CSS colour string. */
			'color': { default: '#FFFFFF', animatable: true },
			/** Horizontal alignment within the layer box. */
			'textAlign': { cssProperty: 'text-align', enum: ['left', 'right', 'center', 'justify'], default: 'center', animatable: false },
			/** Vertical alignment within the layer box. */
			'verticalAlign': { cssProperty: 'vertical-align', enum: ['top', 'middle', 'bottom'], default: 'middle', animatable: false },
			/**
			 * Inner padding around the text. Unitless = `em` (relative to
			 * this layer's `fontSize`). Single number applies to all sides;
			 * use `[top, right, bottom, left]` for per-side values.
			 */
			'padding': { cssProperty: 'padding', units: ['em', 'px'], default: 0, animatable: true },

			// Text stroke
			/** Master switch — when `false`, stroke width/colour are ignored. */
			'textStroke': { default: false, animatable: false },
			/** Outline thickness around each glyph. Unitless = `em`. */
			'textStrokeWidth': { cssProperty: '-webkit-text-stroke-width', units: ['em', 'px'], default: 0, animatable: true },
			/** CSS colour string for the glyph outline. */
			'textStrokeColor': { cssProperty: '-webkit-text-stroke-color', default: '#000000', animatable: true },

			// Text shadow
			/** Master switch — when `false`, the shadow sub-props are ignored. */
			'textShadow': { default: false, animatable: false },
			/** Shadow colour — use `rgba()` for soft translucent shadows. */
			'textShadowColor': { cssProperty: '--text-shadow-color', default: '#000000', animatable: true },
			/** `[x, y]` shadow offset. Unitless = `em`. Positive = right/down. */
			'textShadowOffset': { cssProperty: '--text-shadow-offset', units: ['em', 'px'], default: [0, 0], animatable: true },
			/** Shadow blur radius. Unitless = `em`. `0` = hard shadow. */
			'textShadowBlur': { cssProperty: '--text-shadow-blur', units: ['em', 'px'], default: 0, animatable: true },

			// Spacing & formatting
			/** Extra space between characters. Unitless = `em`. Can be negative. */
			'letterSpacing': { cssProperty: 'letter-spacing', units: ['em', 'px'], default: '0em', animatable: true },
			/**
			 * Line height. Unitless = multiplier of font-size (CSS native):
			 * `1` = tight, `1.5` = roomy. Also accepts `em` / `px`.
			 */
			'lineHeight': { cssProperty: 'line-height', units: ['', 'em', 'px'], default: 1, animatable: true },
			/** Case transform. */
			'textTransform': { cssProperty: 'text-transform', enum: ['none', 'capitalize', 'uppercase', 'lowercase'], default: 'none', animatable: false },
			/** Decoration line. */
			'textDecoration': { cssProperty: 'text-decoration', enum: ['none', 'underline', 'overline', 'line-through'], default: 'none', animatable: false },
			/** Extra space between words. Unitless = `em`. */
			'wordSpacing': { cssProperty: 'word-spacing', units: ['em', 'px'], default: 0, animatable: true },
			/** First-line indent. Unitless = `em`. */
			'textIndent': { cssProperty: 'text-indent', units: ['em', 'px'], default: 0, animatable: true },
			/** `'ltr'` or `'rtl'` — writing direction for bidirectional text. */
			'direction': { cssProperty: 'direction', enum: ['ltr', 'rtl'], default: 'ltr', animatable: false },
		};
	}
}
