/**
 * AuditoryLayer — base class for layers that produce audio output.
 *
 * Provides audio-specific properties (volume, pan, pitch, mute) and their
 * definitions.  The actual audio mixing is handled by the renderer packages.
 */

import BaseLayer, { BaseLayerSettings, BaseLayerProperties } from './BaseLayer';
import type { PropertyDefinition } from '../types';

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
	 *
	 * - **volume** — gain multiplier (0 = silence, 1 = full)
	 * - **pan** — stereo panning (−1 = full left, 0 = centre, 1 = full right)
	 * - **pitch** — playback rate pitch shift (1 = normal)
	 * - **mute** — boolean toggle, silences without affecting volume value
	 */
	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {
			...super.propertiesDefinition,
			'volume': { default: 1, animatable: true },
			'pan': { default: 0, animatable: true },
			'pitch': { default: 1, animatable: true },
			'mute': { default: false, animatable: false },
		};
	}
}
