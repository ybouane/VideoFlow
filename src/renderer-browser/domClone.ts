/**
 * DOM cloning helpers used when a layer is rasterized through an SVG
 * `<foreignObject>`.
 *
 * Serializing a live layer element into an SVG loses two things: `<canvas>`
 * contents (they serialize as empty boxes) and any compositing CSS that must
 * be applied by the *caller* rather than inside the SVG. These helpers fix
 * both, and are shared between {@link LayerRasterizer} and
 * `RuntimeBaseLayer.createRasterClone()` so an external layer type that
 * overrides the hook can still opt into the default behaviour.
 */

/**
 * Remove CSS that only has meaning *during compositing* — `mix-blend-mode` and
 * `isolation`. These are honoured by the final `drawImage` call (via
 * `globalCompositeOperation`); applying them inside the rasterized
 * `<foreignObject>` would either blend the layer against the SVG's transparent
 * backdrop (producing implementation-defined pixels for separable blends like
 * `difference`) or be applied a second time on top of the canvas composite,
 * giving visibly different results from DomRenderer's native CSS path.
 */
export function stripCompositingCss(el: HTMLElement): void {
	el.style.removeProperty('mix-blend-mode');
	el.style.removeProperty('isolation');
}

/** Replace a `<canvas>` with an `<img>` carrying the same attributes + pixels. */
function canvasToImg(src: HTMLCanvasElement): HTMLImageElement {
	const img = document.createElement('img');
	img.style.cssText = src.style.cssText;
	img.src = src.toDataURL();
	for (const attr of src.attributes) {
		img.setAttribute(attr.name, attr.value);
	}
	return img;
}

/**
 * Clone an element tree, replacing every `<canvas>` with an `<img>` whose
 * `src` is the canvas's data-URL. Without this, serialized canvases show
 * as empty boxes inside the foreignObject.
 *
 * The clone's root has `visibility` forced visible so callers (e.g.
 * DomRenderer's effect substitution) can keep the live element hidden
 * without producing a blank bitmap.
 */
export async function cloneWithInlineCanvases(src: HTMLElement): Promise<HTMLElement> {
	// If the root itself is a canvas, replace it outright.
	if (src.tagName === 'CANVAS') {
		const img = canvasToImg(src as HTMLCanvasElement);
		img.style.visibility = 'visible';
		stripCompositingCss(img);
		return img;
	}

	const clone = src.cloneNode(true) as HTMLElement;
	// The live element may be hidden via visibility:hidden (DomRenderer
	// hides effect layers so only their effected canvas shows). The clone
	// needs to be visible so rasterization produces actual pixels.
	clone.style.visibility = 'visible';
	stripCompositingCss(clone);
	const srcElements = Array.from(src.querySelectorAll('*'));
	const cloneElements = Array.from(clone.querySelectorAll('*'));

	await Promise.all(srcElements.map(async (srcElem, i) => {
		const cloneElem = cloneElements[i];
		if (!cloneElem) return;
		if ((srcElem as HTMLElement).style?.display === 'none') {
			cloneElem.remove();
			return;
		}
		if (cloneElem.tagName === 'CANVAS') {
			const img = canvasToImg(srcElem as HTMLCanvasElement);
			cloneElem.replaceWith(img);
		}
	}));

	return clone;
}
