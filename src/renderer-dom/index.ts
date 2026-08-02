/**
 * @videoflow/renderer-dom — public entry point.
 *
 * Exports the {@link DomRenderer} for rendering VideoJSON directly
 * into a DOM element using Shadow DOM for style isolation.
 *
 * ```ts
 * import DomRenderer from '@videoflow/renderer-dom';
 *
 * const renderer = new DomRenderer(document.getElementById('player'));
 * await renderer.loadVideo(compiledJSON);
 * await renderer.play();
 * ```
 */

export { default } from './DomRenderer.js';
export { default as DomRenderer } from './DomRenderer.js';
export type { DomRendererCallback } from './DomRenderer.js';

/**
 * Re-exported from `@videoflow/renderer-browser` so an app can build an
 * external layer type against `@videoflow/renderer-dom` alone:
 *
 * ```ts
 * import DomRenderer, { RuntimeVisualLayer, type LayerTypeDescriptor } from '@videoflow/renderer-dom';
 *
 * class RuntimeCustomLayer extends RuntimeVisualLayer { ... }
 *
 * const renderer = new DomRenderer(host);
 * renderer.registerLayerType('custom', {
 *   runtime: RuntimeCustomLayer,
 *   propertiesDefinition: CustomLayer.propertiesDefinition,
 * });
 * await renderer.loadVideo(videoJSON);
 * ```
 */
export {
	RuntimeBaseLayer,
	RuntimeVisualLayer,
	RuntimeTextualLayer,
	RuntimeMediaLayer,
	LayerTypeRegistry,
	createBuiltinLayerTypeRegistry,
	type ILayerRenderer,
	type LayerTypeDescriptor,
	type RuntimeLayerConstructor,
} from '@videoflow/renderer-browser';
