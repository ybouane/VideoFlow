/**
 * CaptionsLayer — displays time-coded captions over the video.
 *
 * Accepts captions directly as a setting: an array of
 * `{ caption, startTime, endTime }` objects.
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

	static get settingsKeys(): string[] {
		return [...super.settingsKeys, 'captions', 'maxCharsPerLine', 'maxLines'];
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
			 * The caption text shown at the current frame. Driven by the
			 * `captions` setting array — no default value, and not directly
			 * settable by the user.
			 */
			'text': { cssProperty: false, default: undefined, animatable: false },
		};
	}
}
