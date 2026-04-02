/**
 * @videoflow/renderer-browser — public entry point.
 *
 * Exports the {@link BrowserRenderer} as the default export, matching the
 * usage pattern described in the SETUP:
 *
 * ```ts
 * import VideoRenderer from '@videoflow/renderer-browser';
 *
 * const blob = await VideoRenderer.render(compiledJSON, { outputType: 'buffer' });
 * ```
 */

export { default } from './BrowserRenderer.js';
export { default as BrowserRenderer } from './BrowserRenderer.js';
