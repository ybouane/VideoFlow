/**
 * Runtime layer registry — maps layer type strings to their runtime classes.
 *
 * The renderer uses {@link createRuntimeLayer} to instantiate the correct
 * runtime class for each layer in the compiled VideoJSON.
 */

import type { LayerJSON } from '@videoflow/core/types';
import RuntimeBaseLayer, { type ILayerRenderer } from './RuntimeBaseLayer.js';
import RuntimeVisualLayer from './RuntimeVisualLayer.js';
import RuntimeTextualLayer from './RuntimeTextualLayer.js';
import RuntimeTextLayer from './RuntimeTextLayer.js';
import RuntimeCaptionsLayer from './RuntimeCaptionsLayer.js';
import RuntimeMediaLayer from './RuntimeMediaLayer.js';
import RuntimeImageLayer from './RuntimeImageLayer.js';
import RuntimeVideoLayer from './RuntimeVideoLayer.js';
import RuntimeAudioLayer from './RuntimeAudioLayer.js';
import RuntimeShapeLayer from './RuntimeShapeLayer.js';

/** Registry mapping layer type strings to runtime classes. */
const RUNTIME_LAYER_CLASSES: Record<string, typeof RuntimeBaseLayer> = {
	text: RuntimeTextLayer,
	captions: RuntimeCaptionsLayer,
	image: RuntimeImageLayer,
	video: RuntimeVideoLayer,
	audio: RuntimeAudioLayer,
	shape: RuntimeShapeLayer,
};

/**
 * Create the appropriate runtime layer instance for a given LayerJSON.
 *
 * Falls back to the base class for unknown layer types.
 */
export type { ILayerRenderer };

export function createRuntimeLayer(
	json: LayerJSON, fps: number, width: number, height: number, renderer: ILayerRenderer
): RuntimeBaseLayer {
	const Cls = RUNTIME_LAYER_CLASSES[json.type] ?? RuntimeBaseLayer;
	return new Cls(json, fps, width, height, renderer);
}

export {
	RuntimeBaseLayer,
	RuntimeVisualLayer,
	RuntimeTextualLayer,
	RuntimeTextLayer,
	RuntimeCaptionsLayer,
	RuntimeMediaLayer,
	RuntimeImageLayer,
	RuntimeVideoLayer,
	RuntimeAudioLayer,
	RuntimeShapeLayer,
};
