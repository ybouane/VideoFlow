/**
 * Runtime layer barrel.
 *
 * Layer types are resolved through a **per-renderer** {@link LayerTypeRegistry}
 * rather than a module-level table, so consumers can register external layer
 * types on one renderer instance without affecting any other. Use
 * `renderer.createRuntimeLayer(layerJSON)` (or
 * `registry.createRuntimeLayer(...)`) to instantiate a layer — there is no
 * global factory.
 */

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
import RuntimeGroupLayer from './RuntimeGroupLayer.js';

export type { ILayerRenderer };

export {
	LayerTypeRegistry,
	type LayerTypeDescriptor,
	type RuntimeLayerConstructor,
} from './registry.js';

export {
	BUILTIN_LAYER_TYPES,
	createBuiltinLayerTypeRegistry,
} from './builtins.js';

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
	RuntimeGroupLayer,
};
