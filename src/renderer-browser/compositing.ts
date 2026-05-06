/**
 * Shared compositing helpers used by both `BrowserRenderer` (canvas export)
 * and `DomRenderer` (live preview, when groups composite children onto the
 * group's surface).
 *
 * CSS `mix-blend-mode` names match Canvas 2D `globalCompositeOperation`
 * names exactly — except CSS `'normal'` maps to Canvas `'source-over'`.
 */

export function blendModeToCompositeOp(mode: string | undefined): GlobalCompositeOperation {
	return (!mode || mode === 'normal') ? 'source-over' : (mode as GlobalCompositeOperation);
}
