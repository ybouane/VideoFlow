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
