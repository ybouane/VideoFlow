/**
 * @videoflow/renderer-server — public entry point.
 *
 * Exports the {@link ServerRenderer} as the default export:
 *
 * ```ts
 * import VideoRenderer from '@videoflow/renderer-server';
 *
 * const buffer = await VideoRenderer.render(compiledJSON, {
 *   outputType: 'file',
 *   output: './output.mp4',
 * });
 * ```
 */

export { default } from './ServerRenderer.js';
export { default as ServerRenderer, closeSharedBrowser } from './ServerRenderer.js';
