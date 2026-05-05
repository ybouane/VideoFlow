/**
 * Stable in-place sort by `LayerJSON.track` so canvas paint order matches CSS
 * `z-index` stacking. Layers without a `track` sort below any tracked layer
 * and preserve their original array order among themselves — this mirrors
 * how the default `z-index: auto` renders below an explicit `z-index: N`
 * sibling in CSS.
 *
 * Recurses into groups so nested children also paint in track order.
 */

import RuntimeBaseLayer from './RuntimeBaseLayer.js';
import RuntimeGroupLayer from './RuntimeGroupLayer.js';

export function sortByTrackRecursive(layers: RuntimeBaseLayer[]): void {
	const idx = new Map<RuntimeBaseLayer, number>();
	for (let i = 0; i < layers.length; i++) idx.set(layers[i], i);
	layers.sort((a, b) => {
		const aT = a.json.track;
		const bT = b.json.track;
		if (aT == null && bT == null) return idx.get(a)! - idx.get(b)!;
		if (aT == null) return -1;
		if (bT == null) return 1;
		if (aT !== bT) return aT - bT;
		return idx.get(a)! - idx.get(b)!;
	});
	for (const layer of layers) {
		if (layer instanceof RuntimeGroupLayer) {
			sortByTrackRecursive(layer.children);
		}
	}
}
