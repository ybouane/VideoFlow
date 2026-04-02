/**
 * CaptionsLayer — displays time-coded captions over the video.
 *
 * Unlike Scrptly's CaptionsLayer which generates captions from an audio
 * source via AI, VideoFlow's CaptionsLayer accepts captions directly as a
 * setting: an array of `{ caption, startTime, endTime }` objects.
 *
 * The renderer shows the active caption text at each frame based on the
 * timing data.  Inherits all typography styling from {@link TextualLayer}.
 */

import TextualLayer, { TextualLayerProperties, TextualLayerSettings } from './TextualLayer.js';
import type { PropertyDefinition } from '../types.js';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

/** A single caption entry with timing information. */
export type CaptionEntry = {
	caption: string;
	startTime: number;
	endTime: number;
};

export type CaptionsLayerSettings = TextualLayerSettings & {
	/** Array of timed caption entries. */
	captions: CaptionEntry[];
	/** Maximum characters per line before wrapping. */
	maxCharsPerLine?: number;
	/** Maximum number of lines to display simultaneously. */
	maxLines?: number;
};

export type CaptionsLayerProperties = TextualLayerProperties;

// ---------------------------------------------------------------------------
//  Class
// ---------------------------------------------------------------------------

export default class CaptionsLayer extends TextualLayer {
	static type = 'captions';
	declare settings: CaptionsLayerSettings;
	declare properties: CaptionsLayerProperties;

	constructor(parent: any, properties: CaptionsLayerProperties = {}, settings: CaptionsLayerSettings) {
		super(parent, properties, settings);
	}

	static get defaultSettings(): Partial<CaptionsLayerSettings> {
		return {
			...super.defaultSettings,
			captions: [],
			maxCharsPerLine: 32,
			maxLines: 2,
		};
	}

	static get defaultProperties(): Partial<CaptionsLayerProperties> {
		return { ...super.defaultProperties };
	}

	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {
			...super.propertiesDefinition,
			/**
			 * The `text` property is overridden to have no default — the caption
			 * text is determined at render time from the `captions` setting array.
			 */
			'text': { cssProperty: false, default: undefined, animatable: false },
		};
	}
}
