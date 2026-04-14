/**
 * VideoLayer — plays a video clip from a URL or file path.
 *
 * Combines {@link MediaLayer} (visual display with fit/position) with
 * audio properties from {@link AuditoryLayer} (volume, pan) so that the
 * video's audio track participates in the project's audio mix.
 *
 * The `source` setting must point to a video file.  The renderer seeks
 * the video to the correct time for each frame and draws it onto an
 * internal canvas.
 */

import MediaLayer, { MediaLayerSettings, MediaLayerProperties } from './MediaLayer.js';
import type { AuditoryLayerProperties } from './AuditoryLayer.js';
import type { PropertyDefinition } from '../types.js';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type VideoLayerSettings = MediaLayerSettings;

export type VideoLayerProperties = MediaLayerProperties & AuditoryLayerProperties;

// ---------------------------------------------------------------------------
//  Class
// ---------------------------------------------------------------------------

export default class VideoLayer extends MediaLayer {
	static type = 'video';
	declare settings: VideoLayerSettings;
	declare properties: VideoLayerProperties;

	constructor(parent: any, properties: VideoLayerProperties = {}, settings: VideoLayerSettings) {
		super(parent, properties, settings);
	}

	static get defaultSettings(): Partial<VideoLayerSettings> {
		return { ...super.defaultSettings };
	}

	static get defaultProperties(): Partial<VideoLayerProperties> {
		return { ...super.defaultProperties };
	}

	/**
	 * Video layers merge visual and auditory property definitions.
	 * The default `fit` is overridden to `'cover'`.
	 */
	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		const base = super.propertiesDefinition;
		return {
			...base,
			// Audio properties — same semantics as AuditoryLayer
			/** Gain multiplier — `0` = silence, `1` = full volume, `>1` amplifies. */
			'volume': { default: 1, animatable: true },
			/** Stereo panning — `-1` = full left, `0` = centre, `1` = full right. */
			'pan': { default: 0, animatable: true },
			/** Playback-rate pitch shift — `1` = normal. */
			'pitch': { default: 1, animatable: true },
			/** Silence the audio track without changing `volume`. Not animatable. */
			'mute': { default: false, animatable: false },
			/**
			 * Video defaults to `'cover'` so a clip always fills the canvas
			 * (instead of the `'contain'` default for static images).
			 */
			'fit': { ...base['fit'], default: 'cover' },
		};
	}
}
