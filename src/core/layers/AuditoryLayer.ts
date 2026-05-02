/**
 * AuditoryLayer — base class for layers that produce audio output.
 *
 * Provides audio-specific properties (volume, pan, pitch, mute) and their
 * definitions.  The actual audio mixing is handled by the renderer packages.
 */

import BaseLayer, { BaseLayerSettings, BaseLayerProperties } from './BaseLayer.js';
import type { PropertyDefinition } from '../types.js';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type AuditoryLayerProperties = BaseLayerProperties & {
	volume?: number;
	pan?: number;
	pitch?: number;
	mute?: boolean;
};

export type AuditoryLayerSettings = BaseLayerSettings;

// ---------------------------------------------------------------------------
//  Class
// ---------------------------------------------------------------------------

export default class AuditoryLayer extends BaseLayer {
	static type = 'auditory';
	/**
	 * Broad layer family — see {@link VisualLayer.category}. Audio layers are
	 * filtered by transitions tagged `layerCategory: 'audio'` or `'all'`.
	 */
	static category = 'audio';
	declare properties: AuditoryLayerProperties;
	declare settings: AuditoryLayerSettings;

	constructor(parent: any, properties: AuditoryLayerProperties = {}, settings: AuditoryLayerSettings = {}) {
		super(parent, properties, settings);
	}

	static get defaultSettings(): Partial<AuditoryLayerSettings> {
		return { ...super.defaultSettings };
	}

	static get defaultProperties(): Partial<AuditoryLayerProperties> {
		return { ...super.defaultProperties };
	}

	/**
	 * Audio property definitions.
	 */
	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {
			...super.propertiesDefinition,
			/** Gain multiplier — `0` = silence, `1` = full volume, `>1` amplifies. */
			'volume': { default: 1, animatable: true },
			/** Stereo panning — `-1` = full left, `0` = centre, `1` = full right. */
			'pan': { default: 0, animatable: true },
			/** Playback-rate pitch shift — `1` = normal, `2` = one octave up, `0.5` = one octave down. */
			'pitch': { default: 1, animatable: true },
			/** Silence the layer without changing `volume`. Not animatable. */
			'mute': { default: false, animatable: false },
		};
	}
}
