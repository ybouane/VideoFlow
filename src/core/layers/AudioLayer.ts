/**
 * AudioLayer — plays an audio track from a URL or file path.
 *
 * Inherits volume, pan, pitch, and mute properties from {@link AuditoryLayer}.
 * Audio layers have no visual output and are only processed during the audio
 * rendering pass.
 */

import AuditoryLayer, { AuditoryLayerProperties, AuditoryLayerSettings } from './AuditoryLayer.js';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type AudioLayerSettings = AuditoryLayerSettings & {
	/** URL or file path to the audio asset. */
	source: string;
};

export type AudioLayerProperties = AuditoryLayerProperties;

// ---------------------------------------------------------------------------
//  Class
// ---------------------------------------------------------------------------

export default class AudioLayer extends AuditoryLayer {
	static type = 'audio';
	declare settings: AudioLayerSettings;
	declare properties: AudioLayerProperties;

	constructor(parent: any, properties: AudioLayerProperties = {}, settings: AudioLayerSettings) {
		super(parent, properties, settings);
	}

	static get settingsKeys(): string[] {
		return [...super.settingsKeys, 'source', 'durationMedia', 'trimEnd'];
	}

	static get defaultSettings(): Partial<AudioLayerSettings> {
		return { ...super.defaultSettings };
	}

	static get defaultProperties(): Partial<AudioLayerProperties> {
		return { ...super.defaultProperties };
	}
}
