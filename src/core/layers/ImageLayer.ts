/**
 * ImageLayer — displays a static image from a URL or file path.
 *
 * Inherits all visual and media properties from {@link MediaLayer}.
 * The renderer loads the image, draws it onto an internal canvas element,
 * and positions it within the project using the `fit` property.
 */

import MediaLayer, { MediaLayerSettings, MediaLayerProperties } from './MediaLayer.js';

// ---------------------------------------------------------------------------
//  Types
// ---------------------------------------------------------------------------

export type ImageLayerSettings = MediaLayerSettings;
export type ImageLayerProperties = MediaLayerProperties;

// ---------------------------------------------------------------------------
//  Class
// ---------------------------------------------------------------------------

export default class ImageLayer extends MediaLayer {
	static type = 'image';
	declare settings: ImageLayerSettings;
	declare properties: ImageLayerProperties;

	constructor(parent: any, properties: ImageLayerProperties = {}, settings: ImageLayerSettings) {
		super(parent, properties, settings);
	}

	static get defaultSettings(): Partial<ImageLayerSettings> {
		return { ...super.defaultSettings };
	}

	static get defaultProperties(): Partial<ImageLayerProperties> {
		return { ...super.defaultProperties };
	}
}
