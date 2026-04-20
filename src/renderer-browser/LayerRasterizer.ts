/**
 * LayerRasterizer — per-layer rasterization pipeline.
 *
 * For each visible layer, picks a raster *tier* based on the layer's final
 * (post-transition) properties and produces a project-sized bitmap:
 *
 * - **Tier 1 (direct)** — `ctx.drawImage(layerCanvas, ...)` with a 2D affine
 *   and `globalAlpha`. Used when a media layer's transform is simple enough
 *   (translate / scale / anchor / opacity) and no filter / border / shadow /
 *   radius / rotation / perspective is active. Skips SVG encode + decode
 *   entirely — this is the fast path for image / video layers.
 *
 * - **Tier 3 (`<foreignObject>`)** — a per-layer SVG wrapping a renderer-root
 *   `<div>` containing just that layer's DOM. Same CSS as the live renderer,
 *   so the output is pixel-identical to the current whole-project pipeline.
 *
 * The rasterizer owns one `OffscreenCanvas` per layer (keyed by
 * `layer.json.id`) which doubles as the cache. Cacheable layers re-use the
 * surface when `props` match the last render. Video layers (non-cacheable)
 * rasterize fresh every frame but still re-use the same surface for memory
 * efficiency.
 */

import type { VideoJSON } from '@videoflow/core/types';
import type RuntimeBaseLayer from './layers/RuntimeBaseLayer.js';

/** Builds the per-layer `@font-face` CSS block to embed in a tier-3 SVG. */
export type FontCssForLayerFn = (layer: RuntimeBaseLayer) => Promise<string>;

const MEDIA_TYPES = new Set(['image', 'video']);

function extractNumber(v: any): number | null {
	if (typeof v === 'number') return v;
	if (v == null) return null;
	const m = String(v).match(/^(-?[0-9.]+)/);
	return m ? parseFloat(m[1]) : null;
}

function isDefaultNumber(v: any, def: number): boolean {
	if (v == null) return true;
	const n = extractNumber(v);
	if (n === null) return false;
	return n === def;
}

function isDefaultNumberOrArray(v: any, def: number): boolean {
	if (Array.isArray(v)) return v.every(x => isDefaultNumber(x, def));
	return isDefaultNumber(v, def);
}

/**
 * Is the layer's final transform simple enough to draw directly via
 * `ctx.drawImage`? We require translate + scale only — no rotation, no Z,
 * no filters, borders, shadows or corner radii.
 */
function isSimpleTransform(props: Record<string, any>): boolean {
	if (!isDefaultNumberOrArray(props.rotation, 0)) return false;

	const pos = props.position;
	if (Array.isArray(pos) && pos.length > 2 && !isDefaultNumber(pos[2], 0)) return false;

	if (!isDefaultNumber(props.filterBlur, 0)) return false;
	if (!isDefaultNumber(props.filterBrightness, 1)) return false;
	if (!isDefaultNumber(props.filterContrast, 1)) return false;
	if (!isDefaultNumber(props.filterGrayscale, 0)) return false;
	if (!isDefaultNumber(props.filterSepia, 0)) return false;
	if (!isDefaultNumber(props.filterInvert, 0)) return false;
	if (!isDefaultNumber(props.filterHueRotate, 0)) return false;
	if (!isDefaultNumber(props.filterSaturate, 1)) return false;

	if (props.boxShadow) return false;
	if (!isDefaultNumberOrArray(props.borderWidth, 0)) return false;
	if (!isDefaultNumberOrArray(props.borderRadius, 0)) return false;
	if (!isDefaultNumber(props.outlineWidth, 0)) return false;

	if (props.backgroundColor && props.backgroundColor !== 'transparent') return false;

	if (props.visible === false) return false;

	const fit = props.fit;
	if (fit != null && fit !== 'contain' && fit !== 'cover') return false;

	return true;
}

function normalizeScale(v: any): [number, number] {
	if (Array.isArray(v)) {
		return [Number(v[0] ?? 1), Number(v[1] ?? v[0] ?? 1)];
	}
	const n = Number(v ?? 1);
	return [n, n];
}

function normalizePair(v: any, def: number): [number, number] {
	if (Array.isArray(v)) {
		return [Number(v[0] ?? def), Number(v[1] ?? def)];
	}
	const n = Number(v ?? def);
	return [n, n];
}

function fitDims(pw: number, ph: number, mw: number, mh: number, fit: string): [number, number] {
	if (fit === 'cover') {
		return [Math.max(pw, ph * mw / mh), Math.max(ph, pw * mh / mw)];
	}
	// 'contain' (default for tier-1)
	return [Math.min(pw, ph * mw / mh), Math.min(ph, pw * mh / mw)];
}

export default class LayerRasterizer {
	/** One OffscreenCanvas per layer, keyed by layer id. */
	private surfaces: Map<string, OffscreenCanvas> = new Map();
	/** Last cache-key per layer — identical key = surface already shows that props state. */
	private keys: Map<string, string> = new Map();

	constructor(
		private videoJSON: VideoJSON,
		private $canvas: HTMLDivElement,
		private rendererCss: string,
		private fontCssForLayer: FontCssForLayerFn,
	) {}

	/** Forget the cache key for one layer so the next `rasterize` re-renders it. */
	invalidate(layerId: string): void {
		this.keys.delete(layerId);
	}

	/** Forget all cached keys (surfaces remain for re-use). */
	clearCache(): void {
		this.keys.clear();
	}

	/** Release all per-layer surfaces and keys. */
	destroy(): void {
		this.surfaces.clear();
		this.keys.clear();
	}

	/** Classify the layer for this frame: 1 = direct draw, 3 = foreignObject. */
	pickRasterTier(layer: RuntimeBaseLayer, props: Record<string, any>): 1 | 3 {
		if (layer.hasEffects) return 3;
		if (!MEDIA_TYPES.has(layer.json.type)) return 3;
		const dims = (layer as any).dimensions as [number, number] | undefined;
		if (!dims || !dims[0] || !dims[1]) return 3;
		const el = layer.$element;
		if (!el) return 3;
		if (!isSimpleTransform(props)) return 3;
		return 1;
	}

	/**
	 * Rasterize the layer into its private surface using the best tier and
	 * return it. On cache hit the surface is returned unchanged.
	 */
	async rasterize(layer: RuntimeBaseLayer, props: Record<string, any>): Promise<OffscreenCanvas> {
		const id = layer.json.id;
		const surface = this.getSurface(id);

		if (layer.cacheable) {
			// Effect-param dot-paths are consumed by the WebGL compositor, not
			// by CSS, so they don't affect the rasterized bitmap — excluding
			// them from the cache key lets an animated effect param reuse the
			// same bitmap across frames.
			const key = JSON.stringify(props, (k, v) => k.startsWith('effects.') ? undefined : v);
			if (this.keys.get(id) === key) return surface;
			this.keys.set(id, key);
		}

		const tier = this.pickRasterTier(layer, props);
		if (tier === 1) {
			this.rasterizeDirect(layer, props, surface);
		} else {
			await this.rasterizeForeignObject(layer, surface);
		}
		return surface;
	}

	private getSurface(id: string): OffscreenCanvas {
		let s = this.surfaces.get(id);
		if (!s) {
			s = new OffscreenCanvas(this.videoJSON.width, this.videoJSON.height);
			this.surfaces.set(id, s);
		}
		return s;
	}

	// -----------------------------------------------------------------------
	//  Tier 1 — direct canvas drawImage with a 2D affine
	// -----------------------------------------------------------------------

	private rasterizeDirect(
		layer: RuntimeBaseLayer,
		props: Record<string, any>,
		surface: OffscreenCanvas,
	): void {
		const pw = this.videoJSON.width;
		const ph = this.videoJSON.height;
		const ctx = surface.getContext('2d')!;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, pw, ph);

		const el = layer.$element as HTMLCanvasElement;
		const [mw, mh] = (layer as any).dimensions as [number, number];
		const fit = props.fit ?? 'cover';
		const [ow, oh] = fitDims(pw, ph, mw, mh, fit);

		const [sx, sy] = normalizeScale(props.scale);
		const [ax, ay] = normalizePair(props.anchor, 0.5);
		const pos = Array.isArray(props.position) ? props.position : [0.5, 0.5];
		const posX = Number(pos[0] ?? 0.5);
		const posY = Number(pos[1] ?? 0.5);

		// Matches the CSS transform math in renderer.css.ts:
		//   element centered via flex → translate(anchor/position) → scale
		// For pixel p in [0..ow] × [0..oh] the output is:
		//   (sx*p.x + posX*pw - ax*ow*sx, sy*p.y + posY*ph - ay*oh*sy)
		const tx = posX * pw - ax * ow * sx;
		const ty = posY * ph - ay * oh * sy;

		ctx.save();
		ctx.globalAlpha = Math.max(0, Math.min(1, Number(props.opacity ?? 1)));
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.setTransform(sx, 0, 0, sy, tx, ty);
		ctx.drawImage(el, 0, 0, ow, oh);
		ctx.restore();
	}

	// -----------------------------------------------------------------------
	//  Tier 3 — per-layer SVG `<foreignObject>`
	// -----------------------------------------------------------------------

	private async rasterizeForeignObject(layer: RuntimeBaseLayer, surface: OffscreenCanvas): Promise<void> {
		const pw = this.videoJSON.width;
		const ph = this.videoJSON.height;
		const ctx = surface.getContext('2d')!;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, pw, ph);

		const el = layer.$element;
		if (!el) return;

		const layerNode = await this.cloneWithInlineCanvases(el);

		// Build a renderer-root wrapper around this single layer so the
		// CSS custom properties (`--vw`, `--project-width`, etc.) resolve
		// against the project size, not whatever foreignObject defaults to.
		const wrapper = document.createElement('div');
		wrapper.toggleAttribute('data-renderer', true);
		wrapper.style.setProperty('--project-width', String(pw));
		wrapper.style.setProperty('--project-height', String(ph));
		const mainFontFamily = this.$canvas.style.getPropertyValue('font-family');
		if (mainFontFamily) wrapper.style.setProperty('font-family', mainFontFamily);
		wrapper.appendChild(layerNode);

		const fontCss = await this.fontCssForLayer(layer);

		const styleEl = document.createElement('style');
		styleEl.textContent = this.rendererCss + fontCss;

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${pw}" height="${ph}">
			${styleEl.outerHTML}
			<foreignObject width="${pw}px" height="${ph}px">
				${new XMLSerializer().serializeToString(wrapper)}
			</foreignObject>
		</svg>`;

		const img = new Image();
		img.width = pw;
		img.height = ph;
		img.crossOrigin = 'anonymous';
		img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
		await img.decode();

		ctx.drawImage(img, 0, 0, pw, ph);
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
	private async cloneWithInlineCanvases(src: HTMLElement): Promise<HTMLElement> {
		// If the root itself is a canvas, replace it outright.
		if (src.tagName === 'CANVAS') {
			const img = this.canvasToImg(src as HTMLCanvasElement);
			img.style.visibility = 'visible';
			return img;
		}

		const clone = src.cloneNode(true) as HTMLElement;
		// The live element may be hidden via visibility:hidden (DomRenderer
		// hides effect layers so only their effected canvas shows). The clone
		// needs to be visible so rasterization produces actual pixels.
		clone.style.visibility = 'visible';
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
				const img = this.canvasToImg(srcElem as HTMLCanvasElement);
				cloneElem.replaceWith(img);
			}
		}));

		return clone;
	}

	private canvasToImg(src: HTMLCanvasElement): HTMLImageElement {
		const img = document.createElement('img');
		img.style.cssText = src.style.cssText;
		img.src = src.toDataURL();
		for (const attr of src.attributes) {
			img.setAttribute(attr.name, attr.value);
		}
		return img;
	}
}
