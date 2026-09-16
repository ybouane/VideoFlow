/**
 * The transition table, importable on its own.
 *
 * The package index reaches for a bundled JSON asset, which Node refuses to
 * load without an import attribute — so a consumer that only wants the preset
 * table cannot get it from the index at all. The NLE exporters are exactly
 * that consumer: they evaluate a transition into ordinary keyframes and need
 * nothing else from the renderer.
 *
 * Importing this module registers the built-in presets as a side effect, so
 * `getTransitionDefinition` resolves without any further setup.
 */

import './presets.js';

export {
	getTransition,
	getTransitionDefinition,
	listTransitions,
	registerTransition,
	type TransitionDefinition,
} from '../transitions.js';
