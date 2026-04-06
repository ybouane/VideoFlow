/**
 * Renderer CSS for DomRenderer — identical to renderer-browser's CSS.
 *
 * Injected into the Shadow DOM for style isolation.
 * Inlined as a string so it can be used directly without external files.
 */
import { RENDERER_CSS as RENDERER_CSS_BROWSER } from '@videoflow/renderer-browser';

const RENDERER_CSS = `
${RENDERER_CSS_BROWSER}
:host {
	container-type: inline-size;
	display: flex;
    align-items: center;
    justify-content: center;
}
[data-renderer] {
	--project-width: calc(var(--project-width-target) * min(100cqw / (var(--project-width-target) * 1px), 100cqh / (var(--project-height-target) * 1px)));
	--project-height: calc(var(--project-height-target) * min(100cqw / (var(--project-width-target) * 1px), 100cqh / (var(--project-height-target) * 1px)));
}
`;

export default RENDERER_CSS;
