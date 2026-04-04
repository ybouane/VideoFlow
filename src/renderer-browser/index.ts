/**
 * @videoflow/renderer-browser — public entry point.
 *
 * Exports the {@link BrowserRenderer} as the default export and also
 * exposes the runtime layer class hierarchy and factory so that other
 * packages (e.g. @videoflow/renderer-dom) can reuse them.
 */

export { default } from './BrowserRenderer.js';
export { default as BrowserRenderer } from './BrowserRenderer.js';

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
