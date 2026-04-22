/**
 * Built-in transition presets.
 *
 * Every preset receives a *signed* progress `p ∈ [-1, +1]`:
 *
 * - `p = -1` — start of the `transitionIn` window
 * - `p =  0` — layer at rest (must be a no-op)
 * - `p = +1` — end of the `transitionOut` window
 *
 * Presets fall into two flavours:
 *
 * - **Symmetric** (`fade`, `blur`, `zoom`) — use `|p|` so the layer does the
 *   same thing on enter and exit. `opacity *= (1 - |p|)` fades in AND out.
 *
 * - **Asymmetric / continuous** (`rise`, `fall`, `driftLeft`, `driftRight`)
 *   — use the signed `p` so the layer moves continuously through rest. A
 *   `rise` layer starts *below* its resting position (`p = -1`), moves up
 *   through rest (`p = 0`), and keeps rising *above* rest during exit
 *   (`p = +1`). One pattern of motion, no direction reversal.
 *
 * All presets multiply / add onto incoming property values so they compose
 * with keyframed animation. `p` is pre-eased by the renderer (per-direction
 * easing), so preset bodies stay linear in their math.
 *
 * These are registered on first import of `../transitions.js` consumers.
 */

import { registerTransition } from '../transitions.js';

/** Extract numeric part of a value like `"4em"`, `4`, `"4"`. Returns the unit too. */
function splitValue(v: any): [number, string] {
	if (typeof v === 'number') return [v, ''];
	const m = String(v).match(/^(-?[0-9.]+)([a-z%]*)$/i);
	if (m) return [parseFloat(m[1]), m[2]];
	return [parseFloat(String(v)) || 0, ''];
}

function withUnit(n: number, unit: string): string | number {
	return unit ? `${n}${unit}` : n;
}

// ---------------------------------------------------------------------------
//  Symmetric visual presets — use |p|
// ---------------------------------------------------------------------------

// --- fade: opacity = 0 at |p| = 1, full at p = 0. -------------------------
registerTransition('fade', (p, properties) => {
	properties.opacity = Number(properties.opacity ?? 1) * (1 - Math.abs(p));
	return properties;
}, { defaultEasing: 'linear' });

// --- zoom: scales through rest. `from` is the scale factor at |p| = 1. ---
// params: { from?: number } — default 0.8 (pops in from small / out to small).
// Use `from > 1` to pop in from large / out to large.
registerTransition('zoom', (p, properties, params) => {
	const from = typeof params.from === 'number' ? params.from : 0.8;
	const factor = from + (1 - from) * (1 - Math.abs(p));
	const cur = properties.scale;
	if (Array.isArray(cur)) {
		properties.scale = cur.map((v: any) => {
			const n = Number(v);
			return Number.isFinite(n) ? n * factor : v;
		});
	} else {
		const n = Number(cur);
		properties.scale = (Number.isFinite(n) ? n : 1) * factor;
	}
	return properties;
}, { defaultEasing: 'easeOut' });

// --- blur: gaussian blur peaks at |p| = 1, zero at rest. -----------------
// params: { amount?: number } — peak blur in em units. Default 4.
registerTransition('blur', (p, properties, params) => {
	const amount = typeof params.amount === 'number' ? params.amount : 4;
	const extra = amount * Math.abs(p);
	const [n, u] = splitValue(properties.filterBlur ?? 0);
	const unit = u || 'em';
	properties.filterBlur = withUnit(n + extra, unit);
	return properties;
}, { defaultEasing: 'easeOut' });

// ---------------------------------------------------------------------------
//  Asymmetric / continuous motion presets — use signed p
// ---------------------------------------------------------------------------

/**
 * Build a continuous-motion preset that offsets `position` along one axis.
 *
 * The layer travels in a single direction throughout its lifetime:
 *   p = -1 → offset = +distance  (opposite side of the motion direction)
 *   p =  0 → offset = 0          (rest)
 *   p = +1 → offset = -distance  (motion-direction side)
 *
 * `(dx, dy)` is the unit direction of motion. `rise` uses `(0, -1)` (y
 * decreases = screen up). `distance` is a fraction of the project width
 * (x axis) / height (y axis).
 */
function makeDrift(dx: number, dy: number): (p: number, properties: Record<string, any>, params: Record<string, any>) => Record<string, any> {
	return (p, properties, params) => {
		const distance = typeof params.distance === 'number' ? params.distance : 0.15;
		const arr = Array.isArray(properties.position) ? [...properties.position] : [0.5, 0.5];
		while (arr.length < 2) arr.push(0.5);
		arr[0] = Number(arr[0]) + dx * distance * p;
		arr[1] = Number(arr[1]) + dy * distance * p;
		properties.position = arr;
		return properties;
	};
}

registerTransition('rise',       makeDrift(0, -1), { defaultEasing: 'easeOut' });
registerTransition('fall',       makeDrift(0, +1), { defaultEasing: 'easeOut' });
registerTransition('driftLeft',  makeDrift(-1, 0), { defaultEasing: 'easeOut' });
registerTransition('driftRight', makeDrift(+1, 0), { defaultEasing: 'easeOut' });

// ---------------------------------------------------------------------------
//  Symmetric slide presets — use |p| to always enter & exit from same side
// ---------------------------------------------------------------------------

/**
 * Build a symmetric slide preset that offsets `position` toward a fixed
 * side on BOTH enter and exit:
 *   p = -1 → offset = side * distance  (off-screen on `side`)
 *   p =  0 → offset = 0                (rest)
 *   p = +1 → offset = side * distance  (back off-screen on `side`)
 *
 * e.g. `slideFromBottom` has the layer start below rest, move to rest, then
 * fall back below on exit.
 */
function makeSlide(dx: number, dy: number): (p: number, properties: Record<string, any>, params: Record<string, any>) => Record<string, any> {
	return (p, properties, params) => {
		const distance = typeof params.distance === 'number' ? params.distance : 0.15;
		const arr = Array.isArray(properties.position) ? [...properties.position] : [0.5, 0.5];
		while (arr.length < 2) arr.push(0.5);
		const mag = Math.abs(p);
		arr[0] = Number(arr[0]) + dx * distance * mag;
		arr[1] = Number(arr[1]) + dy * distance * mag;
		properties.position = arr;
		return properties;
	};
}

registerTransition('slideFromTop',    makeSlide(0, -1), { defaultEasing: 'easeOut' });
registerTransition('slideFromBottom', makeSlide(0, +1), { defaultEasing: 'easeOut' });
registerTransition('slideFromLeft',   makeSlide(-1, 0), { defaultEasing: 'easeOut' });
registerTransition('slideFromRight',  makeSlide(+1, 0), { defaultEasing: 'easeOut' });

// ---------------------------------------------------------------------------
//  Composites
// ---------------------------------------------------------------------------

// --- riseFade: continuous upward motion + symmetric fade. ----------------
// Layer rises in from below (fading in), continues rising out above (fading out).
registerTransition('riseFade', (p, properties, params) => {
	properties.opacity = Number(properties.opacity ?? 1) * (1 - Math.abs(p));
	const distance = typeof params.distance === 'number' ? params.distance : 0.08;
	const arr = Array.isArray(properties.position) ? [...properties.position] : [0.5, 0.5];
	while (arr.length < 2) arr.push(0.5);
	arr[1] = Number(arr[1]) - distance * p;
	properties.position = arr;
	return properties;
}, { defaultEasing: 'easeOut' });
