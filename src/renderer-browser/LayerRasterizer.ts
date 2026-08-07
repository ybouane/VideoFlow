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

/**
 * How far a tier-3 layer's POSITION may drift from its latched raster position
 * before the DOM is rasterized again, as a fraction of the project's shorter
 * side (3% = 32px at 1080p).
 *
 * Unlike the scale latch this is not about image quality — a residual translate
 * resamples the raster once no matter how far it goes. It is the safety half of
 * {@link LayerRasterizer.inkIsContained}: the latch is only taken when a band
 * this wide around the frame edge is blank, so bounding the travel by the same
 * number means the raster can never be asked for content it does not have.
 *
 * The bound costs nothing on the motion this fixes. A slow drift moves ~0.1px
 * per frame, so it re-rasterizes roughly once every 300 frames; a move fast
 * enough to hit the bound often is already far above the pixel grid, where a
 * re-snap is invisible.
 */
const POSITION_LATCH_SPAN = 0.03;

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

/**
 * A tier-3 layer's latched raster geometry (the scale AND position the DOM is
 * painted at) plus the residual transform the composite blit applies on top.
 */
type StableTransform = {
	/** Scale the DOM is rasterized at (what goes into the raster cache key). */
	base: [number, number];
	/** Position the DOM is rasterized at, as project fractions. */
	basePos: [number, number];
	/** Residual scale factors — `props.scale / base`. */
	kx: number;
	ky: number;
	/** The latched position in project pixels — where the raster's anchor sits. */
	bpx: number;
	bpy: number;
	/** This frame's real position in project pixels — where it should sit. */
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
	/** Latched raster position per layer, as project fractions. */
	private basePositions: Map<string, [number, number]> = new Map();
	/**
	 * Whether the layer's last base raster kept its ink clear of the frame edge.
	 * Only then may the position be latched: the raster is clipped to the
	 * project rect (`[data-renderer]` is `overflow:hidden`) and a translated
	 * raster cannot reveal what was cut off. See {@link inkIsContained}.
	 */
	private posLatchable: Map<string, boolean> = new Map();
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
		this.basePositions.delete(layerId);
		this.posLatchable.delete(layerId);
	}

	/** Forget all cached keys (surfaces remain for re-use). */
	clearCache(): void {
		this.keys.clear();
		this.baseScales.clear();
		this.basePositions.clear();
		this.posLatchable.clear();
	}

	/** Release all per-layer surfaces and keys. */
	destroy(): void {
		this.surfaces.clear();
		this.keys.clear();
		this.baseSurfaces.clear();
		this.strips.clear();
		this.baseScales.clear();
		this.basePositions.clear();
		this.posLatchable.clear();
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

		// Tier 3 under a plain scale/translate: rasterize the DOM at a STABLE
		// scale AND position, and let a canvas transform carry the tween. See
		// `stableTransformFor`.
		const stable = tier === 3 ? this.stableTransformFor(id, props) : null;
		const cacheProps = stable
			? { ...props, scale: stable.base, position: stable.basePos }
			: props;

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
				this.drawStable(id, stable, surface);
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
			// Paint the DOM with its scale and position pinned to the latched
			// base, then put the frame's real values back so nothing downstream
			// sees the swap. Skipped entirely when the residual is identity (a
			// static layer, or the frame the latch was taken on) — which is most
			// layers, most frames, so the common case costs only the extra blit.
			const swap = stable.kx !== 1 || stable.ky !== 1
				|| stable.bpx !== stable.px || stable.bpy !== stable.py;
			const base = this.getBaseSurface(id);
			if (swap) await layer.applyProperties(cacheProps);
			await this.rasterizeForeignObject(layer, base);
			if (swap) await layer.applyProperties(props);
			// Re-test containment on every fresh base raster: the layer's ink can
			// grow (tracking expansion, a counting number widening) and reach the
			// frame edge long after the latch was taken.
			this.posLatchable.set(id, this.inkIsContained(base));
			this.drawStable(id, stable, surface);
		} else {
			await this.rasterizeForeignObject(layer, surface);
		}
		return surface;
	}

	/**
	 * Pick the scale AND position a tier-3 layer's DOM is rasterized at this
	 * frame, plus the residual transform the composite applies on top.
	 *
	 * WHY THIS EXISTS. A tier-3 layer is DOM, and DOM text is re-shaped every
	 * time it is rasterized: Chrome snaps each glyph origin to the device pixel
	 * grid — a quarter pixel horizontally, a WHOLE pixel vertically. Bake an
	 * animated transform into that DOM and the glyphs can only move in grid
	 * steps, so a tween slower than the grid stutters instead of gliding.
	 *
	 * This bites BOTH animated properties that move a layer:
	 *
	 * - `scale`. Measured on a 132px headline under `scale: 1 -> 1.03` over 3s
	 *   (its edges move ~0.15px/frame), as sub-pixel ink edges over 55 frames:
	 *   0.20px edge jerk and 22/54 frames frozen when baked into the DOM,
	 *   0.04px and 0/54 when applied as a canvas affine.
	 *
	 * - `position`. Exactly the same mechanism — a slow drift is a translate of
	 *   a few tenths of a pixel per frame, and `translate3d` in the layer CSS
	 *   re-snaps every glyph. The vertical axis is the ugly one, because the
	 *   snap there is a WHOLE pixel: a drift of 0.09px/frame holds still for
	 *   ~11 frames and then jumps a pixel.
	 *
	 * An image layer never sees any of this, because tier 1 transforms a bitmap
	 * rather than redrawing it. This gives tier 3 the same deal: rasterize the
	 * DOM once at latched geometry, then let `ctx.setTransform` carry the
	 * animation continuously.
	 *
	 * ## The two latches behave differently, on purpose
	 *
	 * The SCALE latch is sticky but bounded: it moves once the residual leaves
	 * ±{@link LATCH_WINDOW}, because a residual scale resamples the raster and
	 * a large one would visibly soften it.
	 *
	 * The POSITION latch is bounded by CONTAINMENT rather than by quality — a
	 * residual translate costs nothing extra as it grows, but the raster is
	 * clipped to the project rect (`[data-renderer]` is `overflow:hidden`), so
	 * translating it is only faithful while the raster holds all the ink that
	 * needs to appear. {@link inkIsContained} requires a blank band of
	 * {@link POSITION_LATCH_SPAN} around the frame edge on every fresh base
	 * raster, and the latch is remade once the residual travels that same
	 * distance. When containment fails — a full-bleed shape, a headline sliding
	 * in from off-screen — the position latch is dropped for that layer and it
	 * goes back to being rasterized at its live position every frame, which is
	 * the pre-existing behaviour: correct, just grid-snapped. Slides like that
	 * move far faster than the grid anyway, so there is nothing to fix.
	 *
	 * Note that a latch does NOT mean "rasterize once". A layer whose content or
	 * opacity changes still re-rasterizes every frame — but now it does so at
	 * FIXED geometry, so the glyph snapping is constant frame to frame and the
	 * motion is carried entirely by the blit. That is the property that removes
	 * the judder; skipping rasterization is a bonus, not the mechanism.
	 *
	 * Returns null — keep the previous behaviour — when the transform is not a
	 * plain scale/translate about the layer's position.
	 */
	private stableTransformFor(id: string, props: Record<string, any>): StableTransform | null {
		if (!isDefaultNumberOrArray(props.rotation, 0)) return null;
		const pos = props.position;
		if (Array.isArray(pos) && pos.length > 2 && !isDefaultNumber(pos[2], 0)) return null;

		const [sx, sy] = normalizeScale(props.scale);
		if (!(sx > 0) || !(sy > 0)) return null;

		const posArr = Array.isArray(pos) ? pos : [0.5, 0.5];
		const fx = extractNumber(posArr[0]) ?? 0.5;
		const fy = extractNumber(posArr[1]) ?? 0.5;

		const pw = this.videoJSON.width;
		const ph = this.videoJSON.height;
		const span = this.borderMargin();

		let base = this.baseScales.get(id);
		let basePos = this.basePositions.get(id);
		const travelled = !!basePos
			&& (Math.abs((fx - basePos[0]) * pw) > span || Math.abs((fy - basePos[1]) * ph) > span);
		if (!base || !basePos || travelled || outsideLatch(sx, base[0]) || outsideLatch(sy, base[1])) {
			// Re-latching the scale re-latches the position too: the raster is
			// being remade anyway, so this is the free moment to re-anchor it and
			// re-test containment.
			base = [sx, sy];
			basePos = [fx, fy];
			this.baseScales.set(id, base);
			this.basePositions.set(id, basePos);
			this.posLatchable.delete(id);
		}

		// Ink within the frame-edge band may have been clipped, so a translated
		// raster could show a cut edge. Pin the raster to the live position
		// instead — residual translate zero, i.e. exactly the old per-frame path.
		if (this.posLatchable.get(id) === false && (basePos[0] !== fx || basePos[1] !== fy)) {
			basePos = [fx, fy];
			this.basePositions.set(id, basePos);
		}

		return {
			base,
			basePos,
			kx: sx / base[0],
			ky: sy / base[1],
			bpx: basePos[0] * pw,
			bpy: basePos[1] * ph,
			px: fx * pw,
			py: fy * ph,
		};
	}

	/**
	 * Blit a layer's base raster onto its surface with the residual transform.
	 *
	 * The raster was painted with the layer's anchor at `(bpx, bpy)` and scaled
	 * by `base`; this frame wants the anchor at `(px, py)` scaled by
	 * `base * k`. Since the renderer CSS translates the element so its anchor
	 * lands on `position` and scales about that same anchor, a raster pixel at
	 * `r` corresponds to an anchor-relative offset of `(r - b) / base`, and the
	 * wanted output is `p + k * (r - b)`. That is a scale of `k` with a
	 * translation of `p - k*b` — which collapses to the previous
	 * scale-only form `p * (1 - k)` whenever `b === p`.
	 */
	private drawStable(id: string, s: StableTransform, surface: OffscreenCanvas): void {
		const ctx = surface.getContext('2d')!;
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, this.videoJSON.width, this.videoJSON.height);
		const base = this.baseSurfaces.get(id);
		if (!base) return;
		ctx.save();
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = this.quality;
		ctx.setTransform(s.kx, 0, 0, s.ky, s.px - s.kx * s.bpx, s.py - s.ky * s.bpy);
		ctx.drawImage(base, 0, 0);
		ctx.restore();
	}

	/**
	 * Is the base raster clear of the frame edge — i.e. can it be translated
	 * without dragging a clipped edge into view?
	 *
	 * The raster is clipped to the project rect (`[data-renderer]` is
	 * `overflow:hidden`), so a translated raster is only faithful if the layer's
	 * ink stops short of the border. This checks a BAND of
	 * {@link borderMargin} pixels on each side rather than the outermost row of
	 * pixels: a one-pixel ring is not enough, because a headline running off the
	 * left edge can happen to be cut in the gap BETWEEN two glyphs, leaving that
	 * ring empty while the layer is very much being clipped. Measured — a
	 * 77px-tall headline anchored at x=0 read as "contained" on the third frame
	 * of its drift, and the raster then slid its cut edge 17px into frame.
	 *
	 * Pairing the band with {@link POSITION_LATCH_SPAN}, which caps how far the
	 * residual translate may travel before the raster is remade, is what makes
	 * this safe: content can only be missing from a strip the raster was already
	 * known to be blank across.
	 *
	 * The alpha floor ignores the near-invisible tail of an antialiasing ramp,
	 * which would otherwise disable the latch for layers well inside the frame.
	 */
	private inkIsContained(base: OffscreenCanvas): boolean {
		const w = this.videoJSON.width;
		const h = this.videoJSON.height;
		const m = this.borderMargin();
		// Read the bands through small scratch canvases rather than calling
		// getImageData on the base surface: a canvas that is read back directly
		// gets pulled onto the CPU by Chrome, and the base surface is one we want
		// to stay a fast blit target.
		const rows = this.scratch('h', w, 2 * m);
		const cols = this.scratch('v', 2 * m, h);
		const rc = rows.getContext('2d', { willReadFrequently: true })!;
		const cc = cols.getContext('2d', { willReadFrequently: true })!;
		rc.clearRect(0, 0, w, 2 * m);
		cc.clearRect(0, 0, 2 * m, h);
		rc.drawImage(base, 0, 0, w, m, 0, 0, w, m);
		rc.drawImage(base, 0, h - m, w, m, 0, m, w, m);
		cc.drawImage(base, 0, 0, m, h, 0, 0, m, h);
		cc.drawImage(base, w - m, 0, m, h, m, 0, m, h);

		const ALPHA_FLOOR = 6;
		const anyInk = (data: Uint8ClampedArray) => {
			for (let i = 3; i < data.length; i += 4) if (data[i] >= ALPHA_FLOOR) return true;
			return false;
		};
		try {
			if (anyInk(rc.getImageData(0, 0, w, 2 * m).data)) return false;
			if (anyInk(cc.getImageData(0, 0, 2 * m, h).data)) return false;
		} catch {
			// A tainted or zero-sized surface — be conservative.
			return false;
		}
		return true;
	}

	/**
	 * Width of the edge band {@link inkIsContained} requires to be blank, and
	 * the distance the residual translate may cover — the two are the same
	 * number on purpose (see {@link POSITION_LATCH_SPAN}).
	 */
	private borderMargin(): number {
		return Math.max(16, Math.round(Math.min(this.videoJSON.width, this.videoJSON.height) * POSITION_LATCH_SPAN));
	}

	/** Lazily-created scratch canvases for {@link inkIsContained}'s band reads. */
	private strips: Map<string, OffscreenCanvas> = new Map();
	private scratch(key: string, w: number, h: number): OffscreenCanvas {
		let c = this.strips.get(key);
		if (!c || c.width !== w || c.height !== h) { c = new OffscreenCanvas(w, h); this.strips.set(key, c); }
		return c;
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
