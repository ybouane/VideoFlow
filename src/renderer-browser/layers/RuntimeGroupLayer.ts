/**
 * RuntimeGroupLayer — runtime class for layer groups.
 *
 * A group is a project-sized `<canvas>` that has its children composited
 * onto it each frame. Once composited, the canvas is treated as a single
 * media-style layer for the rest of the pipeline — per-layer rasterization,
 * group-level transforms, transitions, and effects all run on the
 * already-composited surface.
 *
 * ## Mount model
 *
 * - The group's `$element` (a canvas) is mounted at the renderer's top level
 *   alongside non-group layers.
 * - The group's children are NOT mounted in the renderer's main canvas.
 *   Instead, each group owns a hidden `virtualRoot` (a `[data-renderer]` div
 *   parked off-screen inside the renderer-provided host) where the children's
 *   DOMs live. Hosting children there keeps `getComputedStyle` /
 *   Web-Animations interpolation working while leaving the visible / exported
 *   DOM clean of nested layer markup.
 *
 * ## Per-frame loop
 *
 * 1. Each child runs its own `renderFrame(frame)` against the virtualRoot,
 *    exactly like a top-level layer. This sets each child's `lastAppliedProps`.
 * 2. The renderer's `compositeLayerInto` rasterizes each child (running any
 *    per-child effects through the shared WebGL compositor) and `drawImage`s
 *    the result in order onto the group's canvas.
 * 3. The group then runs `super.renderFrame(...)` so its OWN transitions /
 *    properties / effects pipeline applies to the canvas as if it were a
 *    plain media layer.
 *
 * ## Caching
 *
 * Groups are non-cacheable: their bitmap depends on every child's bitmap,
 * each of which already has its own per-layer cache. The group's drawImage
 * step is cheap relative to re-rasterizing children, so we always
 * re-composite. (Tier-1 / tier-3 cache behaviour for the group itself is
 * irrelevant since each frame produces fresh canvas content anyway.)
 */

import RuntimeMediaLayer from './RuntimeMediaLayer.js';
import RuntimeBaseLayer, { type ILayerRenderer } from './RuntimeBaseLayer.js';
import type { LayerJSON } from '@videoflow/core/types';

/**
 * Renderers that support groups expose `compositeLayerInto` (rasterize a
 * single layer + apply effects + drawImage onto a target ctx) and
 * `getVirtualLayerHost` (where to park hidden child hosts). Both are
 * optional so legacy renderer implementations still type-check.
 */
export interface IGroupAwareRenderer extends ILayerRenderer {
	compositeLayerInto?(
		ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
		layer: RuntimeBaseLayer,
		frame?: number,
	): Promise<void>;
	getVirtualLayerHost?(): Node;
}

/**
 * Factory used to recursively instantiate children. Set by
 * `layers/index.ts` after the registry is fully populated — this side-step
 * avoids a top-of-file `import { createRuntimeLayer } from './index.js'`
 * which would form a cycle (the registry has to import this class to
 * register it, so this class can't import the registry back at module
 * load).
 */
type ChildFactory = (
	json: LayerJSON,
	fps: number,
	width: number,
	height: number,
	renderer: ILayerRenderer,
) => RuntimeBaseLayer;

export default class RuntimeGroupLayer extends RuntimeMediaLayer {
	/** Child runtime layers, in the same order as `json.children`. */
	children: RuntimeBaseLayer[] = [];

	/**
	 * Hidden host for children DOMs. Created on first use, attached to the
	 * renderer-provided virtual host (`document.body` for `BrowserRenderer`,
	 * the shadow root for `DomRenderer`) so renderer-CSS resolution still
	 * applies to descendants.
	 */
	virtualRoot: HTMLElement | null = null;

	/** Whether `mountVirtualChildren` has appended children DOMs to virtualRoot. */
	private childrenMounted = false;

	private static childFactory: ChildFactory | null = null;

	/**
	 * Register the runtime-layer factory used to build children. Called once
	 * by `layers/index.ts` after the registry is initialised.
	 */
	static setChildFactory(fn: ChildFactory): void {
		RuntimeGroupLayer.childFactory = fn;
	}

	constructor(
		json: LayerJSON,
		fps: number,
		width: number,
		height: number,
		renderer: ILayerRenderer,
	) {
		super(json, fps, width, height, renderer);

		// Group surface = project-sized; tier-1 fitDims with mw=pw / mh=ph
		// gives 1:1 — the children we composite are already positioned in
		// project-relative coordinates, so no resampling.
		this.dimensions = [width, height];

		// Build child runtime layers recursively. A child can itself be a
		// group, in which case the factory returns another
		// `RuntimeGroupLayer` and the recursion continues through its own
		// constructor.
		const children = json.children;
		const factory = RuntimeGroupLayer.childFactory;
		if (factory && Array.isArray(children) && children.length > 0) {
			for (const childJson of children) {
				this.children.push(factory(childJson, fps, width, height, renderer));
			}
		}
	}

	/** A group's bitmap depends on its children — never reuse a frame. */
	get cacheable(): boolean { return false; }

	/** Group has no source media. */
	get intrinsicDuration(): number | undefined { return undefined; }

	/**
	 * Initialise children recursively. The group itself has no media to load.
	 *
	 * Uses `allSettled` semantics so that a broken child (CORS / 404 / decode
	 * failure on its source) doesn't poison every other child in the group
	 * — the failed child gets flagged disabled and skipped on subsequent
	 * render passes, while the rest of the group keeps working.
	 */
	async initialize(): Promise<void> {
		const results = await Promise.all(
			this.children.map(async child => {
				try {
					await child.initialize();
					return null;
				} catch (err) {
					return { child, err };
				}
			}),
		);
		for (const r of results) {
			if (!r) continue;
			console.warn(
				`VideoFlow: child "${r.child.json.id}" (${r.child.json.type}) of group "${this.json.id}" failed to initialise — disabling it. ${(r.err as Error)?.message ?? r.err}`,
			);
			r.child.json.settings.enabled = false;
		}
	}

	/** Propagate trim → duration resolution to every descendant. */
	resolveMediaTimings(): void {
		for (const c of this.children) c.resolveMediaTimings();
	}

	/**
	 * Create the project-sized `<canvas>` element. Mirrors
	 * `RuntimeMediaLayer.generateElement` but stamps `data-element="group"`
	 * so the renderer CSS can target it independently if needed.
	 */
	async generateElement(): Promise<HTMLElement | null> {
		if (this.$element) return this.$element;
		const canvas = document.createElement('canvas');
		canvas.width = this.projectWidth;
		canvas.height = this.projectHeight;
		canvas.setAttribute('data-element', 'group');
		canvas.setAttribute('data-id', this.json.id);
		(canvas as any).layerObject = this;
		this.$element = canvas;
		this.ctx = canvas.getContext('2d');
		return canvas;
	}

	/**
	 * Lazily build the hidden host for children DOMs and append it under the
	 * renderer-provided virtual layer host (so renderer-scoped CSS still
	 * applies to children). Idempotent — safe to call after every
	 * `generateElement` or after a renderer reload.
	 */
	ensureVirtualRoot(): HTMLElement {
		if (this.virtualRoot) return this.virtualRoot;
		const host = document.createElement('div');
		host.toggleAttribute('data-renderer', true);
		host.setAttribute('data-virtual-group', this.json.id);
		host.style.setProperty('--project-width', String(this.projectWidth));
		host.style.setProperty('--project-height', String(this.projectHeight));
		host.style.position = 'absolute';
		host.style.left = '-99999px';
		host.style.top = '-99999px';
		host.style.width = `${this.projectWidth}px`;
		host.style.height = `${this.projectHeight}px`;
		host.style.overflow = 'hidden';
		host.style.visibility = 'hidden';
		host.style.pointerEvents = 'none';

		const r = this.renderer as IGroupAwareRenderer;
		const parent = r.getVirtualLayerHost?.() ?? document.body;
		parent.appendChild(host);

		this.virtualRoot = host;
		return host;
	}

	/**
	 * Generate every child's DOM (recursively for nested groups) and mount it
	 * into this group's `virtualRoot`. Skipped children with
	 * `settings.enabled === false` get their element created but kept hidden,
	 * mirroring how the top-level pipeline behaves with disabled layers.
	 */
	async mountVirtualChildren(): Promise<void> {
		if (this.childrenMounted) return;
		const host = this.ensureVirtualRoot();
		for (const child of this.children) {
			if (child.json.settings.enabled === false) continue;
			let $el: HTMLElement | null = null;
			try {
				$el = await child.generateElement();
			} catch (err) {
				console.warn(
					`VideoFlow: child "${child.json.id}" (${child.json.type}) of group "${this.json.id}" failed to mount — disabling it. ${(err as Error)?.message ?? err}`,
				);
				child.json.settings.enabled = false;
				continue;
			}
			if ($el && !$el.parentNode) host.appendChild($el);
			if (child instanceof RuntimeGroupLayer) {
				await child.mountVirtualChildren();
			}
		}
		this.childrenMounted = true;
	}

	destroy(): void {
		for (const c of this.children) c.destroy();
		this.children = [];
		if (this.virtualRoot && this.virtualRoot.parentNode) {
			this.virtualRoot.parentNode.removeChild(this.virtualRoot);
		}
		this.virtualRoot = null;
		this.childrenMounted = false;
		super.destroy();
	}

	/**
	 * Composite children onto the group's surface, then apply the group's own
	 * properties / transitions to the resulting canvas.
	 */
	async renderFrame(frame: number): Promise<void> {
		if (!this.$element) return;

		// Out-of-range or disabled — hide and clear the cache marker.
		if (frame < this.startFrame || frame >= this.endFrame || !this.json.settings.enabled) {
			this.$element.style.display = 'none';
			this.lastAppliedProps = null;
			return;
		}

		// A group is a sub-timeline: its children live in group-local frames
		// where 0 == the group's own beginning. Translate the incoming absolute
		// project frame into that local space using the same `sourceTimeAtFrame`
		// helper that media layers use to retime themselves — it folds in
		// `startTime`, `sourceStart`, and `speed` in one place. For the default
		// `sourceStart: 0`, `speed: 1` this simply equals `frame − startFrame`.
		const localFrame = Math.round(this.sourceTimeAtFrame(frame) * this.fps);

		// 1. Tick every child so its DOM reflects this frame.
		await Promise.all(
			this.children.map(async child => {
				if (child.json.settings.enabled === false) return;
				await child.renderFrame(localFrame);
			}),
		);

		// 2. Composite each child's bitmap (post-effects) onto our surface.
		const ctx = this.ctx;
		const r = this.renderer as IGroupAwareRenderer;
		if (ctx) {
			ctx.setTransform(1, 0, 0, 1, 0, 0);
			ctx.globalAlpha = 1;
			ctx.clearRect(0, 0, this.projectWidth, this.projectHeight);
			if (typeof r.compositeLayerInto === 'function') {
				for (const child of this.children) {
					if (!child.lastAppliedProps) continue;
					if (child.json.settings.enabled === false) continue;
					await r.compositeLayerInto(ctx, child, localFrame);
				}
			}
		}

		// 3. Apply group-level props (transform, opacity, transitions, …).
		const props = this.applyTransitions(frame, this.getPropertiesAtFrame(frame));
		await this.applyProperties(props);
		this.lastAppliedProps = props;
		this.$element.style.display = '';
	}
}
