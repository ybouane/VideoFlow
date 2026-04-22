/**
 * @videoflow/renderer-browser — public entry point.
 *
 * Exports the {@link BrowserRenderer} as the default export and also
 * exposes the runtime layer class hierarchy and factory so that other
 * packages (e.g. @videoflow/renderer-dom) can reuse them.
 */

export { default } from './BrowserRenderer.js';
export { default as BrowserRenderer, RENDERER_CSS } from './BrowserRenderer.js';

export {
	createRuntimeLayer,
	RuntimeBaseLayer,
	RuntimeVisualLayer,
	RuntimeTextualLayer,
	RuntimeTextLayer,
	RuntimeCaptionsLayer,
	RuntimeMediaLayer,
	RuntimeImageLayer,
	RuntimeVideoLayer,
	RuntimeAudioLayer,
	type ILayerRenderer,
} from './layers/index.js';

export {
	registerTransition,
	getTransition,
	getTransitionDefinition,
	listTransitions,
	type TransitionFn,
	type TransitionDefinition,
	type RegisterTransitionOptions,
} from './transitions.js';

export {
	registerEffect,
	getEffect,
	listEffects,
	type EffectDefinition,
	type EffectParamDefinition,
	type EffectParamType,
} from './effects.js';

export { default as LayerRasterizer } from './LayerRasterizer.js';
export { default as WebGLEffectCompositor } from './WebGLEffectCompositor.js';
export type { FontCssForLayerFn } from './LayerRasterizer.js';
export { buildFontUrl } from './googleFontLoader.js';
export { default as FontEmbedder } from './FontEmbedder.js';
