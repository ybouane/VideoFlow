/**
 * Transition registry — shared between BrowserRenderer and DomRenderer.
 *
 * A transition is a pure function that receives a *signed* parameter
 * `p ∈ [-1, +1]` describing where the layer is in its lifecycle:
 *
 * - `p = -1` — start of the `transitionIn` window (layer fully "transitioned in")
 * - `p =  0` — layer at rest, original properties (no transition applied)
 * - `p = +1` — end of the `transitionOut` window (layer fully "transitioned out")
 *
 * `p` is continuous across the layer's lifetime, so a preset like `rise`
 * can produce **asymmetric, continuous motion** by reading the sign of `p`:
 * start below rest (`p = -1`), move through rest (`p = 0`), then continue
 * above rest (`p = +1`) during exit — no branching required.
 *
 * Symmetric presets (fade, blur, zoom) use `|p|` so they behave identically
 * on enter and exit: e.g. `opacity *= (1 - |p|)` gives a fade-in during the
 * in-window and a fade-out during the out-window with the same body.
 *
 * Presets must multiply / add onto the incoming property values so they
 * compose with the rest of the animation pipeline. At `p = 0` a preset
 * must be an identity (the layer is at rest).
 *
 * The renderer splits the signed axis across the two windows and calls the
 * registered `transitionIn` preset with `p ∈ [-1, 0]` and the registered
 * `transitionOut` preset with `p ∈ [0, +1]`, each with its own easing.
 * Outside the windows no preset is called.
 *
 * Presets are registered at module load via side-effect imports from
 * `./transitions/presets.js`, so built-ins are available out of the box.
 */

import type { Easing } from '@videoflow/core/types';
import type { EffectParamUnit } from './effects.js';

/**
 * Per-call context handed to a transition function. Allows presets to derive
 * deterministic per-layer randomness without colliding across layers.
 */
export type TransitionContext = {
	/** Stable seed string for deterministic randomness. Currently the layer's id. */
	seed: string;
	/** Absolute frame number within the composition timeline. Use this for
	 *  per-frame effects (e.g. scramble decode). Quantise to a lower rate
	 *  to avoid flicker: `Math.floor(ctx.frame * rate / ctx.fps)`. */
	frame: number;
	/** Composition frames-per-second. Use alongside `frame` for rate calculations. */
	fps: number;
};

/**
 * A transition implementation.
 *
 * - `p`          — signed progress, `-1..+1` as described above (already eased).
 * - `properties` — the layer's resolved, unit-ized properties at this frame.
 *                  Mutate in place or return a new object; either works.
 * - `params`     — free-form per-preset parameters from `LayerTransitionJSON.params`.
 * - `context`    — per-call context (e.g. seed for deterministic randomness).
 */
export type TransitionFn = (
	p: number,
	properties: Record<string, any>,
	params: Record<string, any>,
	context: TransitionContext,
) => Record<string, any>;

/**
 * UI control kinds for a transition param. Transitions are pure JS (no GLSL
 * types), so this is the only `type` an editor needs.
 */
export type TransitionParamFieldType = 'number' | 'toggle' | 'option' | 'color' | 'text';

/**
 * UI-visible spec for a single key in a transition's `params` map.
 *
 * Editors read this to render the right input control. Mirrors
 * `EffectParamDefinition` but flat: every UI hint lives at the top level
 * (no nested `fieldConfig`), and `name` carries the editor-visible label.
 *
 * `type` selects the control kind; `step` / `integer` / `options` / `unit`
 * refine it. `unit: 'em'` is documentation only here — transitions don't
 * resolve em → px (the effects they inject do that themselves).
 */
export type TransitionParamDefinition = {
	/** Human-readable label shown in the editor. */
	name: string;
	/** UI control kind — drives the input widget the editor renders. */
	type: TransitionParamFieldType;
	/** Default value when the layer's transition spec omits the param. */
	default: number | boolean | string;
	/** Inclusive minimum (numeric params). */
	min?: number;
	/** Inclusive maximum (numeric params). */
	max?: number;
	/** Numeric step (e.g. `0.01` for fractions, `1` for integer counts). */
	step?: number;
	/** Force integer numeric input (rounds in the editor). */
	integer?: boolean;
	/**
	 * For `option`-typed params: ordered map of value → display label. Insertion
	 * order is the canonical order shown in the editor.
	 */
	options?: Record<string, string>;
	/** Unit suffix shown next to the input (`'em'`, `'%'`, `'deg'`, `'rad'`). */
	unit?: EffectParamUnit;
};

/** Full transition entry as stored in the registry. */
export type TransitionDefinition = {
	fn: TransitionFn;
	/** Easing applied to `p` when the layer does not specify one. */
	defaultEasing: Easing;
	/**
	 * Whether this transition pushes synthetic effect entries onto
	 * `properties.__effects` so the renderer composites the layer through the
	 * WebGL effect pipeline during the transition window. The renderer reads
	 * this flag to keep the per-layer effect overlay mounted for the layer's
	 * entire lifetime, not just the moments when an effect is actually active.
	 */
	injectsEffects: boolean;
	/** UI metadata for the editor's transition param fields. Keyed by param name. */
	fieldsConfig: Record<string, TransitionParamDefinition>;
};

/** Options accepted by {@link registerTransition}. */
export type RegisterTransitionOptions = {
	/** Default easing applied to `p` when the layer does not specify one. Defaults to `'linear'`. */
	defaultEasing?: Easing;
	/**
	 * Set to `true` if this preset injects WebGL effect entries into
	 * `properties.__effects`. Used by the renderer to mount the effect
	 * overlay for the layer's whole lifetime even when the layer has no
	 * declared effects.
	 */
	injectsEffects?: boolean;
	/**
	 * Editor UI metadata for each entry in the layer's `params` map. Keyed by
	 * param name. The renderer doesn't read it — only editors do.
	 */
	fieldsConfig?: Record<string, TransitionParamDefinition>;
};

const registry: Map<string, TransitionDefinition> = new Map();

/**
 * Register a transition preset under `name`. Last registration wins.
 *
 * `options.defaultEasing` sets the easing applied to `p` when the layer's
 * `transitionIn` / `transitionOut` spec does not specify one. Layers can
 * always override it via the `easing` field of their transition spec.
 */
export function registerTransition(
	name: string,
	fn: TransitionFn,
	options: RegisterTransitionOptions = {},
): void {
	registry.set(name, {
		fn,
		defaultEasing: options.defaultEasing ?? 'linear',
		injectsEffects: options.injectsEffects ?? false,
		fieldsConfig: options.fieldsConfig ?? {},
	});
}

/** Look up a previously registered transition's function. */
export function getTransition(name: string): TransitionFn | undefined {
	return registry.get(name)?.fn;
}

/** Look up a previously registered transition's full definition. */
export function getTransitionDefinition(name: string): TransitionDefinition | undefined {
	return registry.get(name);
}

/** List registered transition names. */
export function listTransitions(): string[] {
	return [...registry.keys()];
}
