/**
 * Transition registry — shared between BrowserRenderer and DomRenderer.
 *
 * A transition is a pure function that receives the *completeness* parameter
 * `p ∈ [0, 1]` and the layer's resolved property map, and returns a new map
 * with the transition's deltas applied. The same function is used for both
 * `transitionIn` and `transitionOut`:
 *
 * - `transitionIn`:  `p` rises from 0 (layer start) to 1 (transition end).
 * - `transitionOut`: `p` falls from 1 (transition start) to 0 (layer end).
 *
 * So an `opacity *= p` body produces a fade-in during the in-window and a
 * fade-out during the out-window with the same code.
 *
 * Presets are registered at module load via side-effect imports from
 * `./transitions/presets.js`, so built-ins are available out of the box.
 */

/**
 * A transition implementation.
 *
 * - `p`          — completeness, 0..1 as described above.
 * - `properties` — the layer's resolved, unit-ized properties at this frame.
 *                  Mutate in place or return a new object; either works.
 * - `params`     — free-form per-preset parameters from `LayerTransitionJSON.params`.
 */
export type TransitionFn = (
	p: number,
	properties: Record<string, any>,
	params: Record<string, any>,
) => Record<string, any>;

const registry: Map<string, TransitionFn> = new Map();

/** Register a transition preset under `name`. Last registration wins. */
export function registerTransition(name: string, fn: TransitionFn): void {
	registry.set(name, fn);
}

/** Look up a previously registered transition. */
export function getTransition(name: string): TransitionFn | undefined {
	return registry.get(name);
}

/** List registered transition names. */
export function listTransitions(): string[] {
	return [...registry.keys()];
}
