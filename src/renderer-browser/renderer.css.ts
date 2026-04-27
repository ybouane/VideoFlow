/**
 * Renderer CSS — inlined as a string so it can be embedded into SVG
 * foreignObject frames without external stylesheet loading.
 *
 * This CSS drives the visual positioning system:
 * - `[data-renderer]` sets up the project canvas dimensions and base font size
 * - `[data-element]` handles 3D transforms (position, rotation, scale, anchor)
 * - Media-specific selectors handle `fit` (contain/cover) sizing
 * - `textual-layer` is a custom element tag for text-bearing layers
 *
 * Scale-independent units:
 * - `--vw`, `--vh`, `--vmin` each resolve to 1% of the corresponding project
 *   dimension in CSS pixels. The root `font-size` is set to `--vw`, so `1em`
 *   inside a layer is also 1% of the project width. Layer properties marked
 *   with `scaleWith` in their definition are rewritten at apply-time to
 *   `calc(value * var(--vw | --vh | --vmin))`, giving resolution-independent
 *   rendering out of the box.
 *
 * The transform uses CSS custom properties so the renderer only needs to set
 * variable values (e.g. `--position-0: 0.3`) rather than rewrite the full
 * transform string every frame.
 */

const RENDERER_CSS = `
[data-element] {
	--scale: 1;
	--position-0: 0.5;
	--position-1: 0.5;
	--position-2: 0;
	--rotation: 0deg;
	--rotation-1: 0deg;
	--rotation-2: 0deg;
	--anchor-0: 0.5;
	--anchor-1: 0.5;
	--anchor-2: 0;

	--box-shadow-color: #000000;
	--box-shadow-offset-0: 0px;
	--box-shadow-offset-1: 0px;
	--box-shadow-blur: 0px;
	--box-shadow-spread: 0px;

	--filter-blur: 0px;
	--filter-brightness: 1;
	--filter-contrast: 1;
	--filter-grayscale: 0;
	--filter-hue-rotate: 0deg;
	--filter-invert: 0;
	--filter-opacity: 1;
	--filter-saturate: 1;
	--filter-sepia: 0;

	--text-shadow-offset-0:0px;
	--text-shadow-offset-1:0px;
	--text-shadow-blur:0px;
	--text-shadow-color:#000000;
}
[data-renderer] {
	--vw: calc(var(--project-width) * 0.01 * 1px);
	--vh: calc(var(--project-height) * 0.01 * 1px);
	--vmin: min(var(--vw), var(--vh));
	position:relative;
	overflow:hidden;
	display:flex;
	align-items: center;
	justify-content: center;
	font-size: var(--vw);
	font-weight:600;
	width:calc(var(--project-width) * 1px);
	height:calc(var(--project-height) * 1px);
	perspective: calc(100 * var(--vw));
}
[data-element] {
	position:absolute;
	transform:
		translate3d(
			calc((var(--anchor-0) - 0.5) * -100% + (var(--position-0) - 0.5) * var(--project-width) * 1px),
			calc((var(--anchor-1) - 0.5) * -100% + (var(--position-1) - 0.5) * var(--project-height) * 1px),
			calc(var(--position-2) * var(--vw))
		)
		perspective(var(--perspective, calc(100 * var(--vw))))
		rotateX(var(--rotation-1)) rotateY(var(--rotation-2)) rotateZ(var(--rotation-0, var(--rotation)))
		scale3d(var(--scale-0, var(--scale)), var(--scale-1, var(--scale)), var(--scale-2, var(--scale)))
	;
	transform-origin: calc(var(--anchor-0) * 100%) calc(var(--anchor-1) * 100%) calc(var(--anchor-2) * var(--vw));
	will-change: transform;
	border-style:solid;
	border-color:#000000;
	border-width:0px;
	color:#FFFFFF;
}
[data-element="image"], [data-element="video"], [data-element="group"] {
	--object-actual-width:var(--project-width);
	--object-actual-height:var(--project-height);
	width:calc(1px * var(--object-actual-width));
	height:calc(1px * var(--object-actual-height));
}
[data-element="image"][data-fit="contain"],
[data-element="video"][data-fit="contain"] {
	--object-actual-width:min(var(--project-width), var(--project-height) * var(--object-width) / var(--object-height));
	--object-actual-height:min(var(--project-height), var(--project-width) * var(--object-height) / var(--object-width));
}
[data-element="image"][data-fit="cover"],
[data-element="video"][data-fit="cover"] {
	--object-actual-width:max(var(--project-width), var(--project-height) * var(--object-width) / var(--object-height));
	--object-actual-height:max(var(--project-height), var(--project-width) * var(--object-height) / var(--object-width));
}
textual-layer {
	display:flex;
	align-items: center;
	justify-content: center;
	white-space: pre;
	paint-order: stroke;
	line-height: 1;
}
[data-element="shape"] {
	/* Wrapper div is sized in JS to match the shape's display box; the
	   inline svg inside fills it and uses a matching viewBox for crisp
	   vector drawing at any scale. */
	display: block;
	box-sizing: border-box;
	line-height: 0;
}
`;

export default RENDERER_CSS;
