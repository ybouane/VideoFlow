/**
 * Built-in layer types — the descriptors every renderer's registry starts
 * with.
 *
 * Each entry pairs a runtime class from `./` with the matching core layer
 * class's static `propertiesDefinition`, so a renderer resolves both from a
 * single lookup and an override always replaces both halves together.
 */

import {
	TextLayer, CaptionsLayer, ImageLayer, VideoLayer, AudioLayer, ShapeLayer, GroupLayer,
} from '@videoflow/core';

import RuntimeTextLayer from './RuntimeTextLayer.js';
import RuntimeCaptionsLayer from './RuntimeCaptionsLayer.js';
import RuntimeImageLayer from './RuntimeImageLayer.js';
import RuntimeVideoLayer from './RuntimeVideoLayer.js';
import RuntimeAudioLayer from './RuntimeAudioLayer.js';
import RuntimeShapeLayer from './RuntimeShapeLayer.js';
import RuntimeGroupLayer from './RuntimeGroupLayer.js';
import { LayerTypeRegistry, type LayerTypeDescriptor } from './registry.js';

/**
 * The seven layer types VideoFlow ships with.
 *
 * `propertiesDefinition` is a static *getter* on the core layer classes that
 * rebuilds its object on every access, so we snapshot each one once here
 * instead of paying for the walk on every per-frame property lookup.
 */
export const BUILTIN_LAYER_TYPES: Readonly<Record<string, LayerTypeDescriptor>> = Object.freeze({
	text: { runtime: RuntimeTextLayer, propertiesDefinition: TextLayer.propertiesDefinition },
	captions: { runtime: RuntimeCaptionsLayer, propertiesDefinition: CaptionsLayer.propertiesDefinition },
	image: { runtime: RuntimeImageLayer, propertiesDefinition: ImageLayer.propertiesDefinition },
	video: { runtime: RuntimeVideoLayer, propertiesDefinition: VideoLayer.propertiesDefinition },
	audio: { runtime: RuntimeAudioLayer, propertiesDefinition: AudioLayer.propertiesDefinition },
	shape: { runtime: RuntimeShapeLayer, propertiesDefinition: ShapeLayer.propertiesDefinition },
	group: { runtime: RuntimeGroupLayer, propertiesDefinition: GroupLayer.propertiesDefinition },
});

/**
 * Create a fresh registry seeded with {@link BUILTIN_LAYER_TYPES}.
 *
 * @param owner - Name of the owning renderer, used in error messages.
 */
export function createBuiltinLayerTypeRegistry(owner: string): LayerTypeRegistry {
	const registry = new LayerTypeRegistry(owner);
	for (const [type, descriptor] of Object.entries(BUILTIN_LAYER_TYPES)) {
		registry.register(type, descriptor);
	}
	return registry;
}
