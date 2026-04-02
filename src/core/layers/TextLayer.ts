/**
 * TextLayer — renders static or animated text content.
 *
 * The simplest text layer: it displays the value of its `text` property and
 * inherits all typography and visual styling from {@link TextualLayer}.
 */

import TextualLayer, { TextualLayerProperties, TextualLayerSettings } from './TextualLayer.js';
import type { PropertyDefinition } from '../types.js';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type TextLayerProperties = TextualLayerProperties & {
	text?: string;
};

export type TextLayerSettings = TextualLayerSettings;

// ---------------------------------------------------------------------------
//  Class
// ---------------------------------------------------------------------------

export default class TextLayer extends TextualLayer {
	static type = 'text';
	declare properties: TextLayerProperties;
	declare settings: TextLayerSettings;

	constructor(parent: any, properties: TextLayerProperties = {}, settings: TextLayerSettings = {}) {
		super(parent, properties, settings);
	}

	static get defaultSettings(): Partial<TextLayerSettings> {
		return { ...super.defaultSettings };
	}

	static get defaultProperties(): Partial<TextLayerProperties> {
		return { ...super.defaultProperties };
	}

	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {
			...super.propertiesDefinition,
			/** The text content to render.  Not a CSS property — applied via DOM. */
			'text': { cssProperty: false, default: 'Type your text here', animatable: false },
		};
	}
}
