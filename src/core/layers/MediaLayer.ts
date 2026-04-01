/**
 * MediaLayer — base class for layers backed by an external media asset
 * (image or video).
 *
 * Adds the `source` setting and the `fit` visual property (contain / cover)
 * on top of {@link VisualLayer}.
 *
 * Unlike Scrptly, VideoFlow does not support AI-generated media; the `source`
 * must always be a URL or file path.
 */

import VisualLayer, { VisualLayerProperties, VisualLayerSettings } from './VisualLayer';
import type { PropertyDefinition } from '../types';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type MediaLayerSettings = VisualLayerSettings & {
	/** URL or file path to the media asset. */
	source: string;
};

export type MediaLayerProperties = VisualLayerProperties & {
	/**
	 * How the media element is sized relative to the project canvas.
	 * - `'contain'` — fit inside the canvas without cropping
	 * - `'cover'`   — fill the canvas, cropping as needed
	 */
	fit?: 'contain' | 'cover';
};

// ---------------------------------------------------------------------------
//  Class
// ---------------------------------------------------------------------------

export default class MediaLayer extends VisualLayer {
	static type = 'media';
	declare settings: MediaLayerSettings;
	declare properties: MediaLayerProperties;

	constructor(parent: any, properties: MediaLayerProperties = {}, settings: MediaLayerSettings) {
		super(parent, properties, settings);
	}

	static get defaultSettings(): Partial<MediaLayerSettings> {
		return { ...super.defaultSettings };
	}

	static get defaultProperties(): Partial<MediaLayerProperties> {
		return { ...super.defaultProperties };
	}

	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {
			...super.propertiesDefinition,
			'fit': { enum: ['contain', 'cover'], default: 'contain', animatable: false },
		};
	}
}
