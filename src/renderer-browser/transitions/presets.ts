/**
 * Built-in transition presets.
 *
 * Each transition receives `p` (completeness: 0 = fully transitioned/invisible,
 * 1 = at rest), the layer's resolved unit-ized properties, and preset-specific
 * params. The same function drives both `transitionIn` (p rising 0→1) and
 * `transitionOut` (p falling 1→0), so a body like `opacity *= p` yields a
 * fade-in or fade-out with no branching.
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

// --- fade: multiplies opacity. `opacity *= p`. -----------------------------
registerTransition('fade', (p, properties) => {
	properties.opacity = (properties.opacity ?? 1) * p;
	return properties;
});

// --- zoom: scales in/out around the layer's anchor. -----------------------
// params: { from?: number } — scale factor at p=0. Default 0.8.
registerTransition('zoom', (p, properties, params) => {
	const from = typeof params.from === 'number' ? params.from : 0.8;
	const factor = from + (1 - from) * p;
	const cur = properties.scale;
	if (Array.isArray(cur)) {
		properties.scale = cur.map((v: number) => (typeof v === 'number' ? v * factor : v));
	} else {
		properties.scale = (typeof cur === 'number' ? cur : 1) * factor;
	}
	return properties;
});

// --- blur: adds gaussian blur that fades out as p→1. ---------------------
// params: { amount?: number } — peak blur at p=0, in em units. Default 4.
registerTransition('blur', (p, properties, params) => {
	const amount = typeof params.amount === 'number' ? params.amount : 4;
	const extra = amount * (1 - p);
	const cur = properties.filterBlur ?? 0;
	const [n, u] = splitValue(cur);
	const unit = u || 'em';
	properties.filterBlur = withUnit(n + extra, unit);
	return properties;
});

// --- slide: shifts `position` from an offset in at p=0 to the resting -----
//   position at p=1. `direction` picks the axis + sign.
// params: { distance?: number } — fraction of project width/height. Default 0.25.
function makeSlide(dx: number, dy: number): (p: number, properties: Record<string, any>, params: Record<string, any>) => Record<string, any> {
	return (p, properties, params) => {
		const distance = typeof params.distance === 'number' ? params.distance : 0.25;
		const cur = properties.position;
		const arr = Array.isArray(cur) ? [...cur] : [0.5, 0.5];
		while (arr.length < 2) arr.push(0.5);
		arr[0] = arr[0] + dx * distance * (1 - p);
		arr[1] = arr[1] + dy * distance * (1 - p);
		properties.position = arr;
		return properties;
	};
}

registerTransition('slideLeft',  makeSlide(+1, 0));
registerTransition('slideRight', makeSlide(-1, 0));
registerTransition('slideUp',    makeSlide(0, +1));
registerTransition('slideDown',  makeSlide(0, -1));

// --- riseFade: convenience preset combining slideUp + fade. ---------------
registerTransition('riseFade', (p, properties, params) => {
	properties.opacity = (properties.opacity ?? 1) * p;
	const distance = typeof params.distance === 'number' ? params.distance : 0.08;
	const cur = properties.position;
	const arr = Array.isArray(cur) ? [...cur] : [0.5, 0.5];
	while (arr.length < 2) arr.push(0.5);
	arr[1] = arr[1] + distance * (1 - p);
	properties.position = arr;
	return properties;
});
