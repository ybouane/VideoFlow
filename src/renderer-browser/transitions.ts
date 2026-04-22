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

/**
 * A transition implementation.
 *
 * - `p`          — signed progress, `-1..+1` as described above (already eased).
 * - `properties` — the layer's resolved, unit-ized properties at this frame.
 *                  Mutate in place or return a new object; either works.
 * - `params`     — free-form per-preset parameters from `LayerTransitionJSON.params`.
 */
export type TransitionFn = (
	p: number,
	properties: Record<string, any>,
	params: Record<string, any>,
) => Record<string, any>;

/** Full transition entry as stored in the registry. */
export type TransitionDefinition = {
	fn: TransitionFn;
	/** Easing applied to `p` when the layer does not specify one. */
	defaultEasing: Easing;
};

/** Options accepted by {@link registerTransition}. */
export type RegisterTransitionOptions = {
	/** Default easing applied to `p` when the layer does not specify one. Defaults to `'linear'`. */
	defaultEasing?: Easing;
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
