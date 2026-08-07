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
 * Two ways to consume the rasterizer:
 *
 * - {@link rasterize} — produces a per-layer `OffscreenCanvas` surface.
 *   Required when the layer has effects (the WebGL compositor needs a
 *   sampleable bitmap) or for tier-3 layers (text, shapes, anything CSS-
 *   only).
 *
 * - {@link canDrawDirect} + {@link drawDirectInto} — fast path for tier-1
 *   layers with no effects. Skips the per-layer surface entirely and
 *   paints the layer's `$element` straight onto the caller's final canvas,
 *   saving one full-frame blit per layer per frame. Used by
 *   `BrowserRenderer.captureFrame` and both renderers' `compositeLayerInto`.
 *
 * The rasterizer owns one `OffscreenCanvas` per layer (keyed by
 * `layer.json.id`) which doubles as the cache. Cacheable layers re-use the
 * surface when `props` match the last render. Video layers (non-cacheable)
 * rasterize fresh every frame but still re-use the same surface for memory
 * efficiency.
 *
 * Two aspects are delegated to the layer so external layer types can
 * participate without this file knowing about them:
 * `RuntimeBaseLayer.getRasterCacheKey(props)` decides cache validity, and
 * `RuntimeBaseLayer.createRasterClone()` produces the DOM that goes into the
 * tier-3 `<foreignObject>`.
 */

import type { VideoJSON } from '@videoflow/core/types';
import type RuntimeBaseLayer from './layers/RuntimeBaseLayer.js';

/** Builds the per-layer `@font-face` CSS block to embed in a tier-3 SVG. */
export type FontCssForLayerFn = (layer: RuntimeBaseLayer) => Promise<string>;

/**
 * Layer types whose `$element` is a canvas (or canvas-like) at its exact
 * display size — these are eligible for the tier-1 direct-draw path.
 *
 * - `image` / `video`: their `$element` is a canvas with `dimensions` = media
 *   pixel size, sized onto the project via `fit`.
 * - `group`: their `$element` is a project-sized canvas onto which children
 *   have already been composited; tier-1 draws the canvas with the group's
 *   own translate/scale/opacity transform.
 *
 * Shape layers render via inline SVG and always take the tier-3 path.
 */
const DIRECT_DRAWABLE_TYPES = new Set(['image', 'video', 'group']);

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

/**
 * How far a tier-3 layer's scale may drift from its latched raster scale before
 * the DOM is rasterized again (see `LayerRasterizer.stableScaleFor`).
 *
 * The window is a trade: too wide and the residual blurs the raster (an 8%
 * upscale of 132px type is invisible; 25% is not), too narrow and every frame
 * re-encodes an SVG and the raster's own glyph snapping leaks back into the
 * tween. 8% covers every "life push" (1 → 1.03, 0.94 → 0.98) with a SINGLE
 * raster for the whole run, and lets fast pops re-latch a handful of times —
 * which is harmless, because fast motion is far above the pixel grid anyway.
 */
const LATCH_WINDOW = 1.08;

function outsideLatch(scale: number, base: number): boolean {
	return scale > base * LATCH_WINDOW || scale * LATCH_WINDOW < base;
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

/** A tier-3 layer's latched raster scale and the residual applied on top. */
type StableScale = {
	/** Scale the DOM is rasterized at (what goes into the raster cache key). */
	base: [number, number];
	/** Residual factors — `props.scale / base` — applied by the composite blit. */
	kx: number;
	ky: number;
	/** Fixed point of the residual scale, in project pixels. */
	px: number;
	py: number;
};

export default class LayerRasterizer {
	/** One OffscreenCanvas per layer, keyed by layer id. */
	private surfaces: Map<string, OffscreenCanvas> = new Map();
	/** Last cache-key per layer — identical key = surface already shows that props state. */
	private keys: Map<string, string> = new Map();
	/**
	 * Tier-3 stable-scale state (see {@link stableScaleFor}): the DOM raster at
	 * the latched scale, and the latched scale itself, per layer.
	 */
	private baseSurfaces: Map<string, OffscreenCanvas> = new Map();
	private baseScales: Map<string, [number, number]> = new Map();
	/**
	 * Resampling quality applied during the tier-1 `drawImage`. `'high'`
	 * runs Lanczos / bicubic in Chrome (slow but pixel-accurate — used by
	 * `BrowserRenderer` for export); `'low'` runs bilinear (fast — used by
	 * `DomRenderer` for live preview, where draft-grade resampling is
	 * imperceptible against the moving image).
	 */
	private quality: ImageSmoothingQuality;

	/**
	 * @param videoJSON       - The compiled VideoJSON whose `width` / `height`
	 *                          define the per-layer surface size.
	 * @param $canvas         - The renderer's live `<div data-renderer>` element;
	 *                          used as the tier-3 SVG wrapper's parent context
	 *                          so embedded `--vw` / `--project-*` resolve.
	 * @param rendererCss     - The renderer stylesheet inlined into every
	 *                          tier-3 SVG so the foreignObject paints
	 *                          identically to the live DOM.
	 * @param fontCssForLayer - Callback that returns the `@font-face` CSS
	 *                          block needed by `layer` (text/captions only)
	 *                          for tier-3 SVG rasterization.
	 * @param options.quality - Tier-1 resampling quality. Defaults to
	 *                          `'low'`. Pass `'high'` from export-grade
	 *                          renderers.
	 */
	constructor(
		private videoJSON: VideoJSON,
		private $canvas: HTMLDivElement,
		private rendererCss: string,
		private fontCssForLayer: FontCssForLayerFn,
		options: { quality?: ImageSmoothingQuality } = {},
	) {
		this.quality = options.quality ?? 'low';
	}

	/** Forget the cache key for one layer so the next `rasterize` re-renders it. */
	invalidate(layerId: string): void {
		this.keys.delete(layerId);
		this.baseScales.delete(layerId);
	}

	/** Forget all cached keys (surfaces remain for re-use). */
	clearCache(): void {
		this.keys.clear();
		this.baseScales.clear();
	}

	/** Release all per-layer surfaces and keys. */
	destroy(): void {
		this.surfaces.clear();
		this.keys.clear();
		this.baseSurfaces.clear();
		this.baseScales.clear();
	}

	/**
	 * Classify the layer for this frame: 1 = direct draw, 3 = foreignObject.
	 *
	 * Effect-bearing layers are NOT forced to tier 3 — `rasterizeDirect`
	 * produces a project-sized surface that the WebGL effect compositor can
	 * sample directly, so a fast-drawable layer with effects still gets to
	 * skip the SVG encode/decode while having its effects applied downstream.
	 * The composite step (in `BrowserRenderer.captureFrame` /
	 * `compositeLayerInto`) is responsible for piping the surface through the
	 * effect pipeline whenever `resolveEffectsForProps` returns a non-empty
	 * list (catches both declared effects and transition-injected ones).
	 */
	pickRasterTier(layer: RuntimeBaseLayer, props: Record<string, any>): 1 | 3 {
		if (!DIRECT_DRAWABLE_TYPES.has(layer.json.type)) return 3;
		const dims = (layer as any).dimensions as [number, number] | undefined;
		if (!dims || !dims[0] || !dims[1]) return 3;
		const el = layer.$element;
		if (!el) return 3;
		if (!isSimpleTransform(props)) return 3;
		return 1;
	}

	/**
	 * Rasterize the layer into its private surface using the best tier and
	 * return the surface. On cache hit (cacheable layers only) the surface
	 * is returned unchanged without touching the canvas.
	 *
	 * Use this when the caller needs a sampleable bitmap (the WebGL effect
	 * compositor) or when the layer is tier-3 (text, shapes, anything that
	 * goes through the foreignObject path). For tier-1 layers with no
	 * effects, prefer {@link drawDirectInto} to skip this surface copy.
	 */
	async rasterize(layer: RuntimeBaseLayer, props: Record<string, any>): Promise<OffscreenCanvas> {
		const id = layer.json.id;
		const surface = this.getSurface(id);
		const tier = this.pickRasterTier(layer, props);

		// Tier 3 under a plain scale: rasterize the DOM at a STABLE scale and
		// let a canvas transform carry the tween. See `stableScaleFor`.
		const stable = tier === 3 ? this.stableScaleFor(id, props) : null;
		const cacheProps = stable ? { ...props, scale: stable.base } : props;

		if (layer.cacheable) {
			// The key comes from the layer itself (`getRasterCacheKey`) so a
			// layer type whose content isn't fully described by `props` — e.g.
			// an external layer driven by its own mutable document — can fold
			// a content revision into it. See the hook's docs for what the
			// default excludes and why.
			//
			// Under stable-scale the key describes the BASE raster rather than
			// this frame's scale, which is what lets a slow push reuse one
			// raster for its whole run instead of re-encoding an SVG per frame.
			const key = layer.getRasterCacheKey(cacheProps);
			// The base surface can be missing on a key hit if the previous frame
			// took a different path for this layer (tier 1, or a scale of 0 that
			// stable-scale declines) — re-rasterize rather than blit nothing.
			if (this.keys.get(id) === key && (!stable || this.baseSurfaces.has(id))) {
				if (!stable) return surface;
				// Base raster unchanged — only the residual transform moved.
				this.drawStableScale(id, stable, surface);
				return surface;
			}
			this.keys.set(id, key);
		}

		if (tier === 1) {
			const ctx = surface.getContext('2d')!;
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.clearRect(0, 0, this.videoJSON.width, this.videoJSON.height);
			this.drawTier1(layer, props, ctx);
		} else if (stable) {
			// Paint the DOM with its scale pinned to the latched base, then put
			// the frame's real scale back so nothing downstream sees the swap.
			// Skipped entirely when the residual is identity (a static scale, or
			// the frame the latch was taken on) — which is most layers, most
			// frames, so the common case costs only the extra blit.
			const swap = stable.kx !== 1 || stable.ky !== 1;
			if (swap) await layer.applyProperties(cacheProps);
			await this.rasterizeForeignObject(layer, this.getBaseSurface(id));
			if (swap) await layer.applyProperties(props);
			this.drawStableScale(id, stable, surface);
		} else {
			await this.rasterizeForeignObject(layer, surface);
		}
		return surface;
	}

	/**
	 * Pick the scale a tier-3 layer's DOM is rasterized at this frame, plus the
	 * residual factor the composite applies on top.
	 *
	 * WHY THIS EXISTS. A tier-3 layer is DOM, and DOM text is re-shaped every
	 * time it is rasterized: Chrome snaps each glyph origin to the device pixel
	 * grid — a quarter pixel horizontally, a WHOLE pixel vertically. Bake an
	 * animated `scale` into that DOM and the glyphs can only move in grid
	 * steps, so a tween slower than the grid stutters instead of gliding. This
	 * is NOT the `fontSize`-vs-`scale` problem: animating `scale` alone hits it.
	 * Measured on a 132px headline under `scale: 1 -> 1.03` over 3s (its edges
	 * move ~0.15px/frame), as sub-pixel ink edges over 55 frames:
	 *
	 *                            edge jerk   frames with zero motion
	 *   scale baked into the DOM   0.20px      22 / 54
	 *   scale as a canvas affine   0.04px       0 / 54
	 *
	 * The second row is what an image layer already gets for free on tier 1,
	 * because its bitmap is transformed rather than redrawn. This gives tier 3
	 * the same deal: rasterize the DOM once at a latched scale, then let
	 * `ctx.setTransform` carry the animation continuously.
	 *
	 * The latch is deliberately sticky: it moves only once the residual leaves
	 * ±{@link LATCH_WINDOW}. A life push therefore rasterizes ONCE for its whole
	 * run, which is also a large speedup — no SVG encode/decode per frame.
	 *
	 * Returns null — keep the previous behaviour — when the transform is not a
	 * plain scale about the layer's position.
	 */
	private stableScaleFor(id: string, props: Record<string, any>): StableScale | null {
		if (!isDefaultNumberOrArray(props.rotation, 0)) return null;
		const pos = props.position;
		if (Array.isArray(pos) && pos.length > 2 && !isDefaultNumber(pos[2], 0)) return null;

		const [sx, sy] = normalizeScale(props.scale);
		if (!(sx > 0) || !(sy > 0)) return null;

		let base = this.baseScales.get(id);
		if (!base || outsideLatch(sx, base[0]) || outsideLatch(sy, base[1])) {
			base = [sx, sy];
			this.baseScales.set(id, base);
		}

		const posArr = Array.isArray(pos) ? pos : [0.5, 0.5];
		return {
			base,
			kx: sx / base[0],
			ky: sy / base[1],
			px: (extractNumber(posArr[0]) ?? 0.5) * this.videoJSON.width,
			py: (extractNumber(posArr[1]) ?? 0.5) * this.videoJSON.height,
		};
	}

	/**
	 * Blit a layer's base raster onto its surface with the residual scale.
	 *
	 * The fixed point is the layer's `position` in project pixels: the renderer
	 * CSS translates the element so its anchor lands there and then scales about
	 * that anchor, so scaling the raster about the same point reproduces the CSS
	 * transform exactly — the identity `drawTier1` already relies on.
	 */
	private drawStableScale(id: string, s: StableScale, surface: OffscreenCanvas): void {
		const ctx = surface.getContext('2d')!;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.videoJSON.width, this.videoJSON.height);
		const base = this.baseSurfaces.get(id);
		if (!base) return;
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = this.quality;
		ctx.setTransform(s.kx, 0, 0, s.ky, s.px * (1 - s.kx), s.py * (1 - s.ky));
		ctx.drawImage(base, 0, 0);
		ctx.restore();
	}

	private getBaseSurface(id: string): OffscreenCanvas {
		let s = this.baseSurfaces.get(id);
		if (!s) {
			s = new OffscreenCanvas(this.videoJSON.width, this.videoJSON.height);
			this.baseSurfaces.set(id, s);
		}
		return s;
	}

	/**
	 * Whether the layer can be drawn directly onto a caller-owned final canvas
	 * without an intermediate per-layer surface. Returns true only for tier-1
	 * layers; the caller is responsible for checking that no effects are
	 * declared (effects need a sampleable surface for the WebGL compositor).
	 */
	canDrawDirect(layer: RuntimeBaseLayer, props: Record<string, any>): boolean {
		return this.pickRasterTier(layer, props) === 1;
	}

	/**
	 * Draw the layer directly onto `ctx` using its tier-1 transform. Skips the
	 * per-layer `OffscreenCanvas` copy entirely. Caller must have verified via
	 * `canDrawDirect` and ensured `ctx` is sized to the project canvas.
	 */
	drawDirectInto(
		layer: RuntimeBaseLayer,
		props: Record<string, any>,
		ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
	): void {
		this.drawTier1(layer, props, ctx);
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

	/**
	 * Core tier-1 draw: paints the layer's `$element` onto `ctx` using the
	 * layer's resolved transform / opacity. The caller is responsible for
	 * setting up `ctx` (clearing if needed, identity transform). Used both by
	 * `rasterize` (target = per-layer surface) and `drawDirectInto`
	 * (target = final composite canvas).
	 */
	private drawTier1(
		layer: RuntimeBaseLayer,
		props: Record<string, any>,
		ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
	): void {
		const pw = this.videoJSON.width;
		const ph = this.videoJSON.height;

		const el = layer.$element as HTMLCanvasElement;
		const [mw, mh] = (layer as any).dimensions as [number, number];
		const [ow, oh] = fitDims(pw, ph, mw, mh, props.fit ?? 'cover');

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
		ctx.imageSmoothingQuality = this.quality;
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

		// Ask the layer for the DOM it wants rasterized. The default hook
		// clones `$element` with inline canvases; external layer types can
		// override it to materialize specialised DOM for the raster pass.
		const layerNode = await layer.createRasterClone();
		if (!layerNode) return;

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

		// A `data:` URL is load-bearing here — do NOT switch this to
		// `URL.createObjectURL(new Blob([svg], …))`.
		//
		// Blob transport would avoid percent-encoding a string that runs to
		// megabytes once a text layer's fonts are embedded, but in Chrome an
		// SVG image loaded from a `blob:` URL **taints the canvas it is drawn
		// into**, with or without `crossOrigin = 'anonymous'`. A `data:` URL
		// does not. Verified directly in headless Chrome:
		//
		//   data + crossOrigin  → clean       blob + crossOrigin  → SecurityError
		//   data, no crossOrigin→ clean       blob, no crossOrigin→ SecurityError
		//
		// A tainted surface breaks everything downstream of rasterization:
		// `transferToImageBitmap()` (worker export), `getImageData`, and the
		// WebGL effect compositor's texture upload all throw. The failure is
		// not local to this function, so the cheaper transport is not
		// available on the platform the renderer actually targets.
		const img = new Image();
		img.width = pw;
		img.height = ph;
		img.crossOrigin = 'anonymous';
		img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
		await img.decode();

		ctx.drawImage(img, 0, 0, pw, ph);
	}
}
