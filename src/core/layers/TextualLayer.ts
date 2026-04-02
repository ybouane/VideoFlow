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
	 */
	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {
			...super.propertiesDefinition,
			'fontSize': { cssProperty: 'font-size', units: ['em', 'px'], default: 1.0, animatable: true },
			'fontFamily': { cssProperty: 'font-family', default: 'Noto Sans', animatable: false },
			'fontWeight': { cssProperty: 'font-weight', default: 600, animatable: true },
			'fontStyle': { cssProperty: 'font-style', enum: ['normal', 'italic'], default: 'normal', animatable: false },
			'fontStretch': { cssProperty: 'font-stretch', units: ['%'], default: 100, animatable: true },
			'color': { default: '#FFFFFF', animatable: true },
			'textAlign': { cssProperty: 'text-align', enum: ['left', 'right', 'center', 'justify'], default: 'center', animatable: false },
			'verticalAlign': { cssProperty: 'vertical-align', enum: ['top', 'middle', 'bottom'], default: 'middle', animatable: false },
			'padding': { cssProperty: 'padding', units: ['px'], default: 0, animatable: true },

			// Text stroke
			'textStroke': { default: false, animatable: false },
			'textStrokeWidth': { cssProperty: '-webkit-text-stroke-width', units: ['px'], default: 0, animatable: true },
			'textStrokeColor': { cssProperty: '-webkit-text-stroke-color', default: '#000000', animatable: true },

			// Text shadow
			'textShadow': { default: false, animatable: false },
			'textShadowColor': { cssProperty: '--text-shadow-color', default: '#000000', animatable: true },
			'textShadowOffset': { cssProperty: '--text-shadow-offset', units: ['px'], default: [0, 0], animatable: true },
			'textShadowBlur': { cssProperty: '--text-shadow-blur', units: ['px'], default: 0, animatable: true },

			// Spacing & formatting
			'letterSpacing': { cssProperty: 'letter-spacing', units: ['em', 'px'], default: '0em', animatable: true },
			'lineHeight': { cssProperty: 'line-height', units: ['em', 'px', ''], default: 1, animatable: true },
			'textTransform': { cssProperty: 'text-transform', enum: ['none', 'capitalize', 'uppercase', 'lowercase'], default: 'none', animatable: false },
			'textDecoration': { cssProperty: 'text-decoration', enum: ['none', 'underline', 'overline', 'line-through'], default: 'none', animatable: false },
			'wordSpacing': { cssProperty: 'word-spacing', units: ['em', 'px'], default: 0, animatable: true },
			'textIndent': { cssProperty: 'text-indent', units: ['em', 'px'], default: 0, animatable: true },
			'direction': { cssProperty: 'direction', enum: ['ltr', 'rtl'], default: 'ltr', animatable: false },
		};
	}
}
