/**
 * Built-in transition presets — a curated, high-quality library of entry
 * patterns that double as exits.
 *
 * **Signed-progress contract** (see `../transitions.ts`):
 *
 *   p = -1 → start of `transitionIn` window (layer "fully transformed", hidden)
 *   p =  0 → at rest (preset must be a no-op)
 *   p = +1 → end of `transitionOut` window (layer "fully transformed" again)
 *
 * Every preset reads `t = stage(p) = 1 - |p|` so the same body produces a
 * symmetric mirror exit on its own — no separate transitionOut plumbing.
 * Callers are still free to compose any in/out pair on a layer.
 *
 * Effect-using presets push synthetic entries onto `properties.__effects`
 * (a sentinel array consumed by `RuntimeBaseLayer.resolveEffectsForProps`).
 * Those presets register with `injectsEffects: true` so the renderer keeps
 * the per-layer effect overlay mounted across the layer's lifetime.
 */

import { registerTransition } from '../transitions.js';

// ===========================================================================
// Helpers
// ===========================================================================

function clamp01(x: number): number { return x < 0 ? 0 : x > 1 ? 1 : x; }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }

/**
 * Stage / user-facing `t`: 0 = hidden / fully transformed, 1 = at rest.
 * Same shape for both transition windows so a single body handles both.
 */
function stage(p: number): number { return 1 - Math.abs(p); }

/** easeOutBack(0..1) — overshoots past 1 then settles. Used by the pop preset. */
function easeOutBack(t: number, overshoot = 1.70158): number {
	const c1 = overshoot;
	const c3 = c1 + 1;
	const x = t - 1;
	return 1 + c3 * x * x * x + c1 * x * x;
}

/** Read a numeric component out of any `number | "<n><unit>"` value. */
function asNum(v: any): number {
	if (typeof v === 'number') return v;
	const m = String(v).match(/^(-?[0-9.]+)/);
	return m ? parseFloat(m[1]) : 0;
}

// ----- cyrb53 — 53-bit string hash with strong avalanche ------------------
// FNV-1a was previously used here, but its weak diffusion on small near-
// identical inputs (e.g. sequential layer ids `layer_0`, `layer_1`, …)
// produced visibly clustered output — single-bit picks like spin direction
// alternated or stuck in long runs across layer indices. cyrb53 mixes both
// halves of state into 53 bits so even one-byte input changes scramble the
// full output, removing those patterns.
function cyrb53(str: string): number {
	let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
	h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
	h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * Deterministic [0, 1) value derived from a layer seed plus a salt label
 * (e.g. `'spinDirection'`). Use this to give per-layer randomized parameters
 * (angle, direction, dissolve seed, etc.) that stay stable across frames.
 */
function seededRandom(seed: string, salt: string): number {
	// 2^53 — full mantissa range so the result uses every available bit.
	return cyrb53(`${seed}|${salt}`) / 9007199254740992;
}

/** Multiply scale (number or array) by `factor`. */
function scaleMul(cur: any, factor: number): any {
	if (factor === 1) return cur;
	if (Array.isArray(cur)) return cur.map((v: any) => asNum(v) * factor);
	return asNum(cur) * factor;
}

/**
 * Add (dx, dy) (normalized fractions) onto `position`. Position arrays may
 * carry a third Z component — left untouched.
 */
function addPosition(cur: any, dx: number, dy: number): any {
	if (dx === 0 && dy === 0) return cur;
	const arr = Array.isArray(cur) ? [...cur] : [0.5, 0.5];
	while (arr.length < 2) arr.push(0.5);
	arr[0] = asNum(arr[0]) + dx;
	arr[1] = asNum(arr[1]) + dy;
	return arr;
}

/**
 * Add per-axis rotation deltas (in degrees) onto `cur`. Honors the renderer's
 * CSS array convention (`array[0]=Z`, `array[1]=X`, `array[2]=Y`). Args are
 * named in the natural (rx, ry, rz) order so callers don't have to remember
 * the storage layout.
 */
function addRotationDelta(cur: any, drx: number, dry: number, drz: number): any {
	if (drx === 0 && dry === 0 && drz === 0) return cur;
	if (Array.isArray(cur)) {
		const z = asNum(cur[0]) + drz;
		const x = asNum(cur[1]) + drx;
		const y = asNum(cur[2]) + dry;
		return [`${z}deg`, `${x}deg`, `${y}deg`];
	}
	const curZ = asNum(cur);
	if (drx !== 0 || dry !== 0) {
		return [`${curZ + drz}deg`, `${drx}deg`, `${dry}deg`];
	}
	return `${curZ + drz}deg`;
}

/** Push a synthetic effect entry onto `properties.__effects` for the renderer to merge in. */
function injectEffect(properties: Record<string, any>, effect: string, params: Record<string, any>): void {
	if (!Array.isArray(properties.__effects)) properties.__effects = [];
	properties.__effects.push({ effect, params });
}

/** Multiply existing opacity by `factor` (clamped to [0, 1]). */
function multOpacity(properties: Record<string, any>, factor: number): void {
	properties.opacity = clamp01(Number(properties.opacity ?? 1) * factor);
}

// ===========================================================================
// 1. fade — universal fade. Multiplies opacity (visual layers) and volume
// (audio layers) by `t`, so it works on any layer kind. Volume defaults to 1
// when not explicitly set (auditory layers always have an effective volume).
// ===========================================================================
registerTransition('fade', (p, properties) => {
	const t = stage(p);
	multOpacity(properties, t);
	// Auditory layers carry an implicit `volume = 1` even when the property
	// hasn't been set on the layer, so we always apply the multiplication.
	// On purely-visual layers this just sets an unused `volume` field, which
	// is harmless.
	properties.volume = Math.max(0, Number(properties.volume ?? 1) * t);
	return properties;
}, { defaultEasing: 'linear', layerCategory: 'all', fieldsConfig: {} });

// ===========================================================================
// 2. slideUp — enters from below, slides up to rest.
// params: { distance?: 0.10, fade?: true }
// ===========================================================================
registerTransition('slideUp', (p, properties, params) => {
	const t = stage(p);
	const distance = typeof params.distance === 'number' ? params.distance : 0.10;
	properties.position = addPosition(properties.position, 0, distance * (1 - t));
	if (params.fade !== false) multOpacity(properties, clamp01(t * 2));
	return properties;
}, {
	defaultEasing: 'easeOut',
	fieldsConfig: {
		distance: { name: 'Distance', type: 'number', default: 0.10, min: 0, max: 1, step: 0.01 },
		fade:     { name: 'Fade',     type: 'toggle', default: true },
	},
});

// ===========================================================================
// 3. slideDown — enters from above, slides down to rest.
// params: { distance?: 0.10, fade?: true }
// ===========================================================================
registerTransition('slideDown', (p, properties, params) => {
	const t = stage(p);
	const distance = typeof params.distance === 'number' ? params.distance : 0.10;
	properties.position = addPosition(properties.position, 0, -distance * (1 - t));
	if (params.fade !== false) multOpacity(properties, clamp01(t * 2));
	return properties;
}, {
	defaultEasing: 'easeOut',
	fieldsConfig: {
		distance: { name: 'Distance', type: 'number', default: 0.10, min: 0, max: 1, step: 0.01 },
		fade:     { name: 'Fade',     type: 'toggle', default: true },
	},
});

// ===========================================================================
// 4. slideLeft — enters from the right, slides left to rest.
// params: { distance?: 0.12, fade?: true }
// ===========================================================================
registerTransition('slideLeft', (p, properties, params) => {
	const t = stage(p);
	const distance = typeof params.distance === 'number' ? params.distance : 0.12;
	properties.position = addPosition(properties.position, distance * (1 - t), 0);
	if (params.fade !== false) multOpacity(properties, clamp01(t * 2));
	return properties;
}, {
	defaultEasing: 'easeOut',
	fieldsConfig: {
		distance: { name: 'Distance', type: 'number', default: 0.12, min: 0, max: 1, step: 0.01 },
		fade:     { name: 'Fade',     type: 'toggle', default: true },
	},
});

// ===========================================================================
// 5. slideRight — enters from the left, slides right to rest.
// params: { distance?: 0.12, fade?: true }
// ===========================================================================
registerTransition('slideRight', (p, properties, params) => {
	const t = stage(p);
	const distance = typeof params.distance === 'number' ? params.distance : 0.12;
	properties.position = addPosition(properties.position, -distance * (1 - t), 0);
	if (params.fade !== false) multOpacity(properties, clamp01(t * 2));
	return properties;
}, {
	defaultEasing: 'easeOut',
	fieldsConfig: {
		distance: { name: 'Distance', type: 'number', default: 0.12, min: 0, max: 1, step: 0.01 },
		fade:     { name: 'Fade',     type: 'toggle', default: true },
	},
});

// ===========================================================================
// 6. zoom — scale from `from` to rest. Symmetric: scales up on enter, scales
// back down on exit (so a `from < 1` produces a "pop in / fall away" pair).
// params: { from?: 0.85, fade?: true }
// ===========================================================================
registerTransition('zoom', (p, properties, params) => {
	const t = stage(p);
	const from = typeof params.from === 'number' ? params.from : 0.85;
	const factor = lerp(from, 1, t);
	properties.scale = scaleMul(properties.scale, factor);
	if (params.fade !== false) multOpacity(properties, clamp01(t * 2));
	return properties;
}, {
	defaultEasing: 'easeOut',
	fieldsConfig: {
		from: { name: 'Start scale', type: 'number', default: 0.85, min: 0, max: 2, step: 0.01 },
		fade: { name: 'Fade',        type: 'toggle', default: true },
	},
});

// ===========================================================================
// 7. overshootPop — springy scale-in past 1, settles to 1. Tiny tilt that
// resolves to 0. Best on emoji / sticker / badge layers.
// params: { from?: 0.4, overshoot?: 1.7, tilt?: 6, fade?: true }
// ===========================================================================
registerTransition('overshootPop', (p, properties, params, ctx) => {
	const t = stage(p);
	const from = typeof params.from === 'number' ? params.from : 0.4;
	const overshoot = typeof params.overshoot === 'number' ? params.overshoot : 1.70158;
	const tiltDeg = typeof params.tilt === 'number' ? params.tilt : 6;

	// Springy curve: settles to factor = 1 at t = 1, springs past mid-way.
	const factor = lerp(from, 1, easeOutBack(t, overshoot));
	properties.scale = scaleMul(properties.scale, factor);

	// Random per-layer tilt direction (±) that fades to 0 by t = 1.
	const dir = seededRandom(ctx.seed, 'overshootPop:tiltDir') < 0.5 ? -1 : 1;
	properties.rotation = addRotationDelta(properties.rotation, 0, 0, dir * tiltDeg * (1 - t));
	if (params.fade !== false) multOpacity(properties, clamp01(t * 1.5));
	return properties;
}, {
	defaultEasing: 'linear',
	fieldsConfig: {
		from:      { name: 'Start scale', type: 'number', default: 0.4,     min: 0, max: 2,  step: 0.01 },
		overshoot: { name: 'Overshoot',   type: 'number', default: 1.70158, min: 0, max: 5,  step: 0.05 },
		tilt:      { name: 'Tilt',        type: 'number', default: 6,       min: -45, max: 45, step: 1, unit: 'deg' },
		fade:      { name: 'Fade',        type: 'toggle', default: true },
	},
});

// ===========================================================================
// 8. blurResolve — heavy gaussian blur that resolves to sharp.
// Uses the WebGL `gaussianBlur` effect (multi-pass, alpha-aware by default).
// params: { amount?: 1.5, fade?: true }
// ===========================================================================
registerTransition('blurResolve', (p, properties, params) => {
	const t = stage(p);
	// `amount` is in em (matches gaussianBlur.radius unit). 1.5em ≈ 29px on a 1920px-wide project.
	const amount = typeof params.amount === 'number' ? params.amount : 1.5;
	const radius = amount * (1 - t);
	if (radius > 0.02) {
		injectEffect(properties, 'gaussianBlur', {
			radius,
			direction: 'both',
			edgeMode: 'transparent',
			alphaAware: true,
		});
	}
	// Fade from fully transparent at the start of the window to opaque before rest.
	if (params.fade !== false) multOpacity(properties, clamp01(t * 1.5));
	return properties;
}, {
	defaultEasing: 'easeOut',
	injectsEffects: true,
	fieldsConfig: {
		amount: { name: 'Amount', type: 'number', default: 1.5, min: 0, max: 10, step: 0.1, unit: 'em' },
		fade:   { name: 'Fade',   type: 'toggle', default: true },
	},
});

// ===========================================================================
// 9. motionBlurSlide — directional slide-in with motion blur matching velocity.
// `angle` is visual/pixel-space (0 = enter from right, 90 = from below).
// params: { distance?: 0.18, blur?: 4.5, angle?: 0, fade?: true }
// ===========================================================================
registerTransition('motionBlurSlide', (p, properties, params, ctx) => {
	const t = stage(p);
	const distance = typeof params.distance === 'number' ? params.distance : 0.18;
	// `blur` is in em (matches motionBlur.amount unit). 4.5em ≈ 86px on 1920.
	const blur = typeof params.blur === 'number' ? params.blur : 4.5;
	const angle = typeof params.angle === 'number' ? params.angle : 0;

	// `angle` is in pixel space. The `position` property uses separate 0..1 ranges
	// for x (fraction of width) and y (fraction of height). To make the on-screen
	// slide direction match `angle`, scale the x component by H/W so both axes
	// produce the same pixel displacement magnitude.
	const rad = angle * Math.PI / 180;
	const W = ctx.projectWidth || 1920;
	const H = ctx.projectHeight || 1080;
	const dx = Math.cos(rad) * distance * (H / W) * (1 - t);
	const dy = Math.sin(rad) * distance * (1 - t);
	properties.position = addPosition(properties.position, dx, dy);

	// Velocity-shaped blur — peaks mid-transition, fades to 0 at rest.
	// shape(t) = 4t(1-t) (parabolic, max=1 at t=0.5, 0 at endpoints) — but we
	// also want plenty of blur at the start, so blend with linear (1-t).
	const shape = Math.max(1 - t, 4 * t * (1 - t));
	const amt = blur * shape;
	if (amt > 0.02) {
		injectEffect(properties, 'motionBlur', {
			amount: amt,
			angle,
			centerBias: 0,
			edgeMode: 'transparent',
		});
	}
	if (params.fade !== false) multOpacity(properties, clamp01(t * 1.5));
	return properties;
}, {
	defaultEasing: 'easeOut',
	injectsEffects: true,
	fieldsConfig: {
		distance: { name: 'Distance', type: 'number', default: 0.18, min: 0, max: 1,   step: 0.01 },
		blur:     { name: 'Blur',     type: 'number', default: 4.5,  min: 0, max: 30,  step: 0.1, unit: 'em' },
		angle:    { name: 'Angle',    type: 'number', default: 0,    min: -360, max: 360, step: 1, unit: 'deg' },
		fade:     { name: 'Fade',     type: 'toggle', default: true },
	},
});

// ===========================================================================
// 10. radialZoom — radial zoom blur from a center, resolves outward to sharp.
// params: { amount?: 0.4, centerX?: 0.5, centerY?: 0.5, mode?: 'out', fade?: true }
// ===========================================================================
registerTransition('radialZoom', (p, properties, params) => {
	const t = stage(p);
	if (t >= 1) return properties;
	const amount = typeof params.amount === 'number' ? params.amount : 0.4;
	const centerX = typeof params.centerX === 'number' ? params.centerX : 0.5;
	const centerY = typeof params.centerY === 'number' ? params.centerY : 0.5;
	const mode = (params.mode === 'in') ? 'in' : 'out';
	const amt = amount * (1 - t);
	if (amt > 0.001) {
		injectEffect(properties, 'zoomBlur', {
			amount: amt,
			centerX,
			centerY,
			falloff: 1,
			mode,
		});
	}
	if (params.fade !== false) multOpacity(properties, clamp01(t * 1.5));
	const startScale = mode === 'in' ? 1.1 : 0.88;
	properties.scale = scaleMul(properties.scale, lerp(startScale, 1, t));
	return properties;
}, {
	defaultEasing: 'easeOut',
	injectsEffects: true,
	fieldsConfig: {
		amount:  { name: 'Amount',   type: 'number', default: 0.4,  min: 0, max: 2, step: 0.05 },
		centerX: { name: 'Center X', type: 'number', default: 0.5,  min: 0, max: 1, step: 0.01 },
		centerY: { name: 'Center Y', type: 'number', default: 0.5,  min: 0, max: 1, step: 0.01 },
		mode:    { name: 'Mode',     type: 'option', default: 'out', options: { in: 'Zoom In', out: 'Zoom Out' } },
		fade:    { name: 'Fade',     type: 'toggle', default: true },
	},
});

// ===========================================================================
// 11. rotate3dY — rotate around the Y axis (door-style swing) into rest.
// params: { angle?: 75, fade?: true }
// ===========================================================================
registerTransition('rotate3dY', (p, properties, params) => {
	const t = stage(p);
	const angle = typeof params.angle === 'number' ? params.angle : 75;
	properties.rotation = addRotationDelta(properties.rotation, 0, angle * (1 - t), 0);
	if (params.fade !== false) multOpacity(properties, clamp01(t * 1.4));
	return properties;
}, {
	defaultEasing: 'easeOut',
	fieldsConfig: {
		angle: { name: 'Angle', type: 'number', default: 75, min: -180, max: 180, step: 1, unit: 'deg' },
		fade:  { name: 'Fade',  type: 'toggle', default: true },
	},
});

// ===========================================================================
// 12. tilt3d — tilt around X axis (top edge moves toward camera).
// params: { angle?: 60, lift?: 0.04, fade?: true }
// ===========================================================================
registerTransition('tilt3d', (p, properties, params) => {
	const t = stage(p);
	const angle = typeof params.angle === 'number' ? params.angle : 60;
	const lift = typeof params.lift === 'number' ? params.lift : 0.04;
	properties.rotation = addRotationDelta(properties.rotation, -angle * (1 - t), 0, 0);
	properties.position = addPosition(properties.position, 0, lift * (1 - t));
	if (params.fade !== false) multOpacity(properties, clamp01(t * 1.4));
	return properties;
}, {
	defaultEasing: 'easeOut',
	fieldsConfig: {
		angle: { name: 'Angle', type: 'number', default: 60,   min: -180, max: 180, step: 1, unit: 'deg' },
		lift:  { name: 'Lift',  type: 'number', default: 0.04, min: 0, max: 0.5, step: 0.01 },
		fade:  { name: 'Fade',  type: 'toggle', default: true },
	},
});

// ===========================================================================
// 13. spin — spin around Z while scaling. Symmetric: spins in on enter and
// back out on exit.
// params: { angle?: 360, from?: 0.2, fade?: true }
// ===========================================================================
registerTransition('spin', (p, properties, params) => {
	const t = stage(p);
	const angle = typeof params.angle === 'number' ? params.angle : 360;
	const from = typeof params.from === 'number' ? params.from : 0.2;
	properties.rotation = addRotationDelta(properties.rotation, 0, 0, angle * (1 - t));
	properties.scale = scaleMul(properties.scale, lerp(from, 1, t));
	if (params.fade !== false) multOpacity(properties, clamp01(t * 1.5));
	return properties;
}, {
	defaultEasing: 'easeOut',
	fieldsConfig: {
		angle: { name: 'Angle',       type: 'number', default: 60, min: -1080, max: 1080, step: 1, unit: 'deg' },
		from:  { name: 'Start scale', type: 'number', default: 0.2, min: 0,     max: 2,    step: 0.01 },
		fade:  { name: 'Fade',        type: 'toggle', default: true },
	},
});

// ===========================================================================
// 14. glitchResolve — heavy digital block + RGB split glitch resolves to clean.
// Combines `digitalBlocks` + `rgbSplit`, both fading to 0 as t → 1.
// params: { intensity?: 1, blockSize?: 1.25, fade?: true }
// ===========================================================================
registerTransition('glitchResolve', (p, properties, params, ctx) => {
	const t = stage(p);
	if (t >= 1) return properties;
	const intensity = typeof params.intensity === 'number' ? params.intensity : 1;
	// `blockSize` is in em (matches digitalBlocks.blockSize unit). 1.25em ≈ 24px on 1920.
	const blockSize = typeof params.blockSize === 'number' ? params.blockSize : 1.25;
	const k = (1 - t) * intensity;

	// Per-layer band offset so multiple glitching layers don't sync their bands.
	const bandSize = lerp(0.04, 0.10, seededRandom(ctx.seed, 'glitchResolve:bandSize'));

	injectEffect(properties, 'digitalBlocks', {
		blockSize,
		blockAmount: 0.5 * k,
		offsetAmount: 0.05 * k,
		colorShift: 0.012 * k,
		randomness: 1,
		hideBlocks: false,
	});
	injectEffect(properties, 'rgbSplit', {
		amount: 0.012 * k,
		bandSize,
		bandOffset: 0.012 * k,
		randomness: 1,
		axis: 'horizontal',
		preserveLuminance: false,
	});
	if (params.fade !== false) multOpacity(properties, lerp(0.6, 1, t));
	return properties;
}, {
	defaultEasing: 'easeOut',
	injectsEffects: true,
	fieldsConfig: {
		intensity: { name: 'Intensity',  type: 'number', default: 1,    min: 0, max: 2,  step: 0.05 },
		blockSize: { name: 'Block size', type: 'number', default: 1.25, min: 0, max: 10, step: 0.05, unit: 'em' },
		fade:      { name: 'Fade',       type: 'toggle', default: true },
	},
});

// ===========================================================================
// 15. rgbSplitSnap — strong horizontal RGB split that snaps to clean. A small
// scale overshoot adds the "snap-into-place" pop.
// params: { amount?: 0.04, axis?: 'horizontal'|'vertical'|'both', fade?: true }
// ===========================================================================
registerTransition('rgbSplitSnap', (p, properties, params) => {
	const t = stage(p);
	if (t >= 1) return properties;
	const amount = typeof params.amount === 'number' ? params.amount : 0.04;
	const axis = (params.axis === 'vertical' || params.axis === 'both') ? params.axis : 'horizontal';
	const k = 1 - t;
	injectEffect(properties, 'rgbSplit', {
		amount: amount * k,
		bandSize: 0.05,
		bandOffset: amount * 0.5 * k,
		randomness: 0.7,
		axis,
		preserveLuminance: false,
	});
	// Subtle scale snap: starts slightly larger, settles. easeOutBack flavour
	// without re-easing the whole transition.
	const scaleFactor = lerp(1.06, 1, easeOutBack(t, 1.2));
	properties.scale = scaleMul(properties.scale, scaleFactor);
	if (params.fade !== false) multOpacity(properties, clamp01(t * 1.4));
	return properties;
}, {
	defaultEasing: 'easeOut',
	injectsEffects: true,
	fieldsConfig: {
		amount: { name: 'Amount', type: 'number', default: 0.04,         min: 0, max: 0.5, step: 0.005 },
		axis:   { name: 'Axis',   type: 'option', default: 'horizontal', options: { horizontal: 'Horizontal', vertical: 'Vertical', both: 'Both' } },
		fade:   { name: 'Fade',   type: 'toggle', default: true },
	},
});

// ===========================================================================
// 16. sliceAssemble — layer assembles from offset slices snapping into place.
// params: { sliceCount?: 30, offset?: 0.18, axis?: 'horizontal'|'vertical', fade?: true }
// ===========================================================================
registerTransition('sliceAssemble', (p, properties, params) => {
	const t = stage(p);
	if (t >= 1) return properties;
	const sliceCount = typeof params.sliceCount === 'number' ? params.sliceCount : 30;
	const offset = typeof params.offset === 'number' ? params.offset : 0.18;
	const axis = (params.axis === 'vertical') ? 'vertical' : 'horizontal';
	injectEffect(properties, 'sliceGlitch', {
		sliceCount,
		offsetAmount: offset * (1 - t),
		gap: 0,
		randomness: 1,
		axis,
		edgeMode: 'transparent',
	});
	if (params.fade !== false) multOpacity(properties, clamp01(t * 1.3));
	return properties;
}, {
	defaultEasing: 'easeOut',
	injectsEffects: true,
	fieldsConfig: {
		sliceCount: { name: 'Slice count', type: 'number', default: 30,           min: 2, max: 200, step: 1, integer: true },
		offset:     { name: 'Offset',      type: 'number', default: 0.18,         min: 0, max: 1,   step: 0.01 },
		axis:       { name: 'Axis',        type: 'option', default: 'horizontal', options: { horizontal: 'Horizontal', vertical: 'Vertical' } },
		fade:       { name: 'Fade',        type: 'toggle', default: true },
	},
});

// ===========================================================================
// 17. noiseDissolve — fbm-noise dissolve reveal, with a glowing edge band.
// params: { noiseScale?: 8, edgeWidth?: 0.04, edgeColor?: '#ffffff', softness?: 0.04 }
// ===========================================================================
registerTransition('noiseDissolve', (p, properties, params) => {
	const t = stage(p);
	if (t >= 1) return properties;
	const noiseScale = typeof params.noiseScale === 'number' ? params.noiseScale : 8;
	const edgeWidth = typeof params.edgeWidth === 'number' ? params.edgeWidth : 0.04;
	const softness = typeof params.softness === 'number' ? params.softness : 0.04;
	const edgeColor = typeof params.edgeColor === 'string' ? params.edgeColor : '#ffffff';
	injectEffect(properties, 'noiseDissolve', {
		progress: t,
		noiseScale,
		softness,
		edgeWidth,
		edgeColor,
		invert: false,
	});
	return properties;
}, {
	defaultEasing: 'linear',
	injectsEffects: true,
	fieldsConfig: {
		noiseScale: { name: 'Noise scale', type: 'number', default: 8,         min: 1, max: 64,  step: 0.5 },
		edgeWidth:  { name: 'Edge width',  type: 'number', default: 0.04,      min: 0, max: 0.3, step: 0.005 },
		softness:   { name: 'Softness',    type: 'number', default: 0.04,      min: 0, max: 0.3, step: 0.005 },
		edgeColor:  { name: 'Edge color',  type: 'color',  default: '#ffffff' },
	},
});

// ===========================================================================
// 18. burnDissolve — fiery dissolve with hot embers and ash residue.
// params: { noiseScale?: 6, edgeWidth?: 0.06, ashAmount?: 0.4,
//           burnColor?: '#3a0a00', hotColor?: '#ffb347', softness?: 0.02 }
// ===========================================================================
registerTransition('burnDissolve', (p, properties, params) => {
	const t = stage(p);
	if (t >= 1) return properties;
	const noiseScale = typeof params.noiseScale === 'number' ? params.noiseScale : 6;
	const edgeWidth = typeof params.edgeWidth === 'number' ? params.edgeWidth : 0.06;
	const softness = typeof params.softness === 'number' ? params.softness : 0.02;
	const ashAmount = typeof params.ashAmount === 'number' ? params.ashAmount : 0.4;
	const burnColor = typeof params.burnColor === 'string' ? params.burnColor : '#3a0a00';
	const hotColor = typeof params.hotColor === 'string' ? params.hotColor : '#ffb347';
	injectEffect(properties, 'burnDissolve', {
		progress: t,
		noiseScale,
		edgeWidth,
		softness,
		ashAmount,
		burnColor,
		hotColor,
	});
	return properties;
}, {
	defaultEasing: 'linear',
	injectsEffects: true,
	fieldsConfig: {
		noiseScale: { name: 'Noise scale', type: 'number', default: 6,         min: 1, max: 64,  step: 0.5 },
		edgeWidth:  { name: 'Edge width',  type: 'number', default: 0.06,      min: 0, max: 0.3, step: 0.005 },
		ashAmount:  { name: 'Ash amount',  type: 'number', default: 0.4,       min: 0, max: 1,   step: 0.05 },
		burnColor:  { name: 'Burn color',  type: 'color',  default: '#3a0a00' },
		hotColor:   { name: 'Hot color',   type: 'color',  default: '#ffb347' },
		softness:   { name: 'Softness',    type: 'number', default: 0.02,      min: 0, max: 0.3, step: 0.005 },
	},
});

// ===========================================================================
// 19. wipeReveal — linear wipe along an angle.
// params: { angle?: 0, softness?: 0.03, edgeWidth?: 0.02, edgeColor?: '#ffffff' }
// ===========================================================================
registerTransition('wipeReveal', (p, properties, params) => {
	const t = stage(p);
	if (t >= 1) return properties;
	const angle = typeof params.angle === 'number' ? params.angle : 0;
	const softness = typeof params.softness === 'number' ? params.softness : 0.03;
	const edgeWidth = typeof params.edgeWidth === 'number' ? params.edgeWidth : 0.02;
	const edgeColor = typeof params.edgeColor === 'string' ? params.edgeColor : '#ffffff';
	injectEffect(properties, 'wipeMask', {
		progress: t,
		angle,
		softness,
		edgeWidth,
		edgeColor,
		invert: false,
	});
	return properties;
}, {
	defaultEasing: 'linear',
	injectsEffects: true,
	fieldsConfig: {
		angle:     { name: 'Angle',      type: 'number', default: 0,         min: -360, max: 360, step: 1, unit: 'deg' },
		softness:  { name: 'Softness',   type: 'number', default: 0.03,      min: 0, max: 0.3, step: 0.005 },
		edgeWidth: { name: 'Edge width', type: 'number', default: 0.02,      min: 0, max: 0.3, step: 0.005 },
		edgeColor: { name: 'Edge color', type: 'color',  default: '#ffffff' },
	},
});

// ===========================================================================
// 20. scanReveal — directional scanner reveal with edge glow + jitter.
// params: { angle?: 0, bandWidth?: 0.05, softness?: 0.015,
//           edgeGlow?: 1.2, edgeDistortion?: 0.006 }
// ===========================================================================
registerTransition('scanReveal', (p, properties, params) => {
	const t = stage(p);
	if (t >= 1) return properties;
	const angle = typeof params.angle === 'number' ? params.angle : 0;
	const bandWidth = typeof params.bandWidth === 'number' ? params.bandWidth : 0.05;
	const softness = typeof params.softness === 'number' ? params.softness : 0.015;
	const edgeGlow = typeof params.edgeGlow === 'number' ? params.edgeGlow : 1.2;
	const edgeDistortion = typeof params.edgeDistortion === 'number' ? params.edgeDistortion : 0.006;
	injectEffect(properties, 'scanReveal', {
		progress: t,
		angle,
		bandWidth,
		softness,
		edgeGlow,
		edgeDistortion,
		invert: false,
	});
	return properties;
}, {
	defaultEasing: 'linear',
	injectsEffects: true,
	fieldsConfig: {
		angle:          { name: 'Angle',           type: 'number', default: 0,     min: -360, max: 360, step: 1, unit: 'deg' },
		bandWidth:      { name: 'Band width',      type: 'number', default: 0.05,  min: 0, max: 0.5, step: 0.005 },
		softness:       { name: 'Softness',        type: 'number', default: 0.015, min: 0, max: 0.3, step: 0.005 },
		edgeGlow:       { name: 'Edge glow',       type: 'number', default: 1.2,   min: 0, max: 4,   step: 0.1 },
		edgeDistortion: { name: 'Edge distortion', type: 'number', default: 0.006, min: 0, max: 0.1, step: 0.001 },
	},
});

// ===========================================================================
// 21. lightSweepReveal — wipe reveal with a glossy light band sweeping ahead.
// Combines `wipeMask` (the actual reveal) and `lightSweep` (the gloss band).
// params: { angle?: 30, bandWidth?: 0.18, sweepColor?: '#ffffff', intensity?: 1.4 }
// ===========================================================================
registerTransition('lightSweepReveal', (p, properties, params) => {
	const t = stage(p);
	if (t >= 1) return properties;
	const angle = typeof params.angle === 'number' ? params.angle : 30;
	const bandWidth = typeof params.bandWidth === 'number' ? params.bandWidth : 0.18;
	const sweepColor = typeof params.sweepColor === 'string' ? params.sweepColor : '#ffffff';
	const intensity = typeof params.intensity === 'number' ? params.intensity : 1.4;

	injectEffect(properties, 'wipeMask', {
		progress: t,
		angle,
		softness: 0.06,
		edgeWidth: 0,
		edgeColor: '#ffffff',
		invert: false,
	});
	injectEffect(properties, 'lightSweep', {
		progress: t,
		angle,
		width: bandWidth,
		softness: 0.08,
		intensity,
		color: sweepColor,
		blendMode: 'screen',
	});
	return properties;
}, {
	defaultEasing: 'linear',
	injectsEffects: true,
	fieldsConfig: {
		angle:      { name: 'Angle',       type: 'number', default: 30,        min: -360, max: 360, step: 1, unit: 'deg' },
		bandWidth:  { name: 'Band width',  type: 'number', default: 0.18,      min: 0, max: 1,   step: 0.01 },
		sweepColor: { name: 'Sweep color', type: 'color',  default: '#ffffff' },
		intensity:  { name: 'Intensity',   type: 'number', default: 1.4,       min: 0, max: 4,   step: 0.1 },
	},
});

// ===========================================================================
// 22. lensSnap — strong fisheye bulge that settles to flat. Pairs nicely with
// a tiny zoom snap so the layer "pops" into focus.
// params: { strength?: 0.9, radius?: 0.5, zoom?: 1, fade?: true }
// ===========================================================================
registerTransition('lensSnap', (p, properties, params) => {
	const t = stage(p);
	if (t >= 1) return properties;
	const strength = typeof params.strength === 'number' ? params.strength : 0.9;
	const radius = typeof params.radius === 'number' ? params.radius : 0.5;
	const zoom = typeof params.zoom === 'number' ? params.zoom : 1;

	injectEffect(properties, 'fisheye', {
		strength: strength * (1 - t),
		centerX: 0.5,
		centerY: 0.5,
		radius,
		zoom: lerp(0.85, zoom, t),
		edgeMode: 'transparent',
	});
	properties.scale = scaleMul(properties.scale, lerp(1.08, 1, t));
	if (params.fade !== false) multOpacity(properties, clamp01(t * 1.4));
	return properties;
}, {
	defaultEasing: 'easeOut',
	injectsEffects: true,
	fieldsConfig: {
		strength: { name: 'Strength', type: 'number', default: 0.9, min: -2, max: 2, step: 0.05 },
		radius:   { name: 'Radius',   type: 'number', default: 0.5, min: 0,  max: 2, step: 0.05 },
		zoom:     { name: 'Zoom',     type: 'number', default: 1,   min: 0,  max: 4, step: 0.05 },
		fade:     { name: 'Fade',     type: 'toggle', default: true },
	},
});

// ===========================================================================
// Text-specific transitions (23–27)
//
// These presets modify the `text` string and/or typographic CSS properties
// (letterSpacing, filterBlur, opacity) and are meaningful only on text layers.
// They degrade gracefully on non-text layers: missing `text` / `letterSpacing`
// are treated as empty-string / 0 respectively.
// ===========================================================================

// ---- charset table used by scrambleDecode ---------------------------------
const SCRAMBLE_CHARSETS: Record<string, string> = {
	letters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
	numbers: '0123456789',
	symbols: '!@#$%^&*_+-=[]{}|;:,.<>?',
	mixed: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*_+-=',
};

// ===========================================================================
// 23. typewriter — reveals text one character at a time.
// params: { cursorStyle?: 'none' | 'bar' | 'block' | 'underscore' }
// ===========================================================================
registerTransition('typewriter', (p, properties, params) => {
	const t = stage(p);
	if (typeof properties.text !== 'string') return properties;
	const chars = Array.from(properties.text);
	if (!chars.length) return properties;

	const visible = chars.slice(0, Math.round(t * chars.length)).join('');
	const cursorStyle = params.cursorStyle ?? 'bar';
	const cursorChars: Record<string, string> = { bar: '|', block: '█', underscore: '_' };

	properties.text = (t < 1 && cursorStyle !== 'none')
		? visible + (cursorChars[cursorStyle] ?? '|')
		: visible;

	return properties;
}, {
	defaultEasing: 'linear',
	layerCategory: 'textual',
	fieldsConfig: {
		cursorStyle: {
			name: 'Cursor style',
			type: 'option',
			default: 'bar',
			options: { none: 'None', bar: 'Bar ( | )', block: 'Block ( █ )', underscore: 'Underscore ( _ )' },
		},
	},
});

// ---- shared helper for tracking expand / contract -------------------------
function applyTracking(
	t: number,
	properties: Record<string, any>,
	startTracking: number,
	finalTracking: number,
	startOpacity: number,
	blur: number,
): void {
	// Add tracking delta (em) on top of whatever keyframed value the layer has.
	const delta = lerp(startTracking, finalTracking, t);
	if (delta !== 0) {
		const raw = String(properties.letterSpacing ?? '0em');
		const m = raw.match(/^(-?[0-9.]+)([a-z%]*)$/i);
		const base = m ? parseFloat(m[1]) : 0;
		const unit = m?.[2] || 'em';
		properties.letterSpacing = `${base + delta}${unit}`;
	}
	multOpacity(properties, lerp(startOpacity, 1, t));
	const blurAmt = blur * (1 - t);
	if (blurAmt > 0.001) {
		const raw = String(properties.filterBlur ?? '0em');
		const m = raw.match(/^(-?[0-9.]+)([a-z%]*)$/i);
		const base = m ? parseFloat(m[1]) : 0;
		const unit = m?.[2] || 'em';
		properties.filterBlur = `${base + blurAmt}${unit}`;
	}
}

const TRACKING_FIELDS_BASE = {
	finalTracking: { name: 'Final tracking', type: 'number' as const, default: 0,   min: -5, max: 5, step: 0.01, unit: 'em' as const },
	startOpacity:  { name: 'Start opacity',  type: 'number' as const, default: 0,   min: 0,  max: 1, step: 0.05 },
	blur:          { name: 'Blur',           type: 'number' as const, default: 0.3, min: 0,  max: 4, step: 0.05, unit: 'em' as const },
};

// ===========================================================================
// 24. trackingExpand — text starts compressed and expands into its final spacing.
// params: { startTracking?: -0.12, finalTracking?: 0, startOpacity?: 0, blur?: 0.3 }
// ===========================================================================
registerTransition('trackingExpand', (p, properties, params) => {
	applyTracking(
		stage(p), properties,
		typeof params.startTracking === 'number' ? params.startTracking : -0.12,
		typeof params.finalTracking === 'number' ? params.finalTracking : 0,
		typeof params.startOpacity  === 'number' ? params.startOpacity  : 0,
		typeof params.blur          === 'number' ? params.blur          : 0.3,
	);
	return properties;
}, {
	defaultEasing: 'easeOut',
	layerCategory: 'textual',
	fieldsConfig: {
		startTracking: { name: 'Start tracking', type: 'number', default: -0.12, min: -5, max: 5, step: 0.01, unit: 'em' as const },
		...TRACKING_FIELDS_BASE,
	},
});

// ===========================================================================
// 25. trackingContract — text starts wide and contracts into its final spacing.
// params: { startTracking?: 0.3, finalTracking?: 0, startOpacity?: 0, blur?: 0.3 }
// ===========================================================================
registerTransition('trackingContract', (p, properties, params) => {
	applyTracking(
		stage(p), properties,
		typeof params.startTracking === 'number' ? params.startTracking : 0.3,
		typeof params.finalTracking === 'number' ? params.finalTracking : 0,
		typeof params.startOpacity  === 'number' ? params.startOpacity  : 0,
		typeof params.blur          === 'number' ? params.blur          : 0.3,
	);
	return properties;
}, {
	defaultEasing: 'easeOut',
	layerCategory: 'textual',
	fieldsConfig: {
		startTracking: { name: 'Start tracking', type: 'number', default: 0.3, min: -5, max: 5, step: 0.01, unit: 'em' as const },
		...TRACKING_FIELDS_BASE,
	},
});

// ===========================================================================
// 26. scrambleDecode — random characters resolve into the final text.
// params: { refreshRate?: 15, order?: 'leftToRight'|'rightToLeft'|'random',
//           charset?: 'letters'|'numbers'|'symbols'|'mixed',
//           refreshCharacters?: true, preserveSpaces?: true }
// ===========================================================================
registerTransition('scrambleDecode', (p, properties, params, ctx) => {
	const t = stage(p);
	if (typeof properties.text !== 'string') return properties;
	const chars = Array.from(properties.text);
	const n = chars.length;
	if (!n) return properties;

	const refreshRate   = typeof params.refreshRate === 'number' ? params.refreshRate : 15;
	const order         = params.order ?? 'leftToRight';
	const cs            = SCRAMBLE_CHARSETS[params.charset ?? 'letters'] ?? SCRAMBLE_CHARSETS.letters;
	const refreshCharacters = params.refreshCharacters !== false;
	const preserveSpaces = params.preserveSpaces !== false;

	// Quantise to `refreshRate` visual updates per second.
	const tick = Math.floor(ctx.frame * refreshRate / ctx.fps);

	// Build the set of locked (already-revealed) positions.
	const lockedCount = Math.round(t * n);
	const lockedSet = new Set<number>();

	if (order === 'rightToLeft') {
		for (let i = 0; i < lockedCount; i++) lockedSet.add(n - 1 - i);
	} else if (order === 'random') {
		// Deterministic shuffle for a stable reveal order across frames.
		const positions = Array.from({ length: n }, (_, i) => i);
		for (let i = n - 1; i > 0; i--) {
			const j = cyrb53(`${ctx.seed}|sd:${i}`) % (i + 1);
			[positions[i], positions[j]] = [positions[j], positions[i]];
		}
		for (let i = 0; i < lockedCount; i++) lockedSet.add(positions[i]);
	} else {
		// leftToRight (default)
		for (let i = 0; i < lockedCount; i++) lockedSet.add(i);
	}

	let result = '';
	for (let i = 0; i < n; i++) {
		const ch = chars[i];
		if (preserveSpaces && ch === ' ') {
			result += ' ';
		} else if (lockedSet.has(i)) {
			result += ch;
		} else {
			const salt = refreshCharacters ? `${i}|${tick}` : `${i}|stable`;
			result += cs[cyrb53(`${ctx.seed}|${salt}`) % cs.length];
		}
	}

	properties.text = result;
	return properties;
}, {
	defaultEasing: 'linear',
	layerCategory: 'textual',
	fieldsConfig: {
		refreshRate:    { name: 'Refresh rate',    type: 'number', default: 15,           min: 1,  max: 60,  step: 1 },
		order:          { name: 'Reveal order',    type: 'option', default: 'leftToRight', options: { leftToRight: 'Left to right', rightToLeft: 'Right to left', random: 'Random' } },
		charset:        { name: 'Charset',         type: 'option', default: 'letters',    options: { letters: 'Letters', numbers: 'Numbers', symbols: 'Symbols', mixed: 'Mixed' } },
		refreshCharacters: { name: 'Refresh characters', type: 'toggle', default: true },
		preserveSpaces: { name: 'Preserve spaces', type: 'toggle', default: true },
	},
});

// ===========================================================================
// 27. numberCountUp — detects numbers in the text and counts them from zero
// (or `startValue`) to their final values.
//
// Supports: currency ($, €, £), signs (+/-), decimals, grouped thousands
// (comma or space), compact suffixes (K / M / B), percentages.
//
// params: { startValue?: 0, mode?: 'allNumbers'|'firstNumber',
//           formatMode?: 'natural'|'fixedWidth', rounding?: 'auto'|'integer'|'decimal',
//           locale?: 'auto'|'en-US'|'fr-FR' }
// ===========================================================================

// Regex: (sign1)(currency)(sign2)(integer with optional grouping)(decimal)(suffix)(percent)
const NUM_RE = /([+\-]?)([$€£]?)([+\-]?)(\d(?:[\d,  ]*\d)?)(\.\d+)?([KMBkmb]?)(%?)/g;

function parseNumToken(m: RegExpExecArray): number {
	const sign = (m[1] === '-' || m[3] === '-') ? -1 : 1;
	const rawInt = m[4].replace(/[,\s ]/g, '');
	const rawDec = m[5] ?? '';
	const su = m[6].toUpperCase();
	let val = parseFloat(rawInt + rawDec);
	if (isNaN(val)) return 0;
	if (su === 'K') val *= 1e3;
	else if (su === 'M') val *= 1e6;
	else if (su === 'B') val *= 1e9;
	return sign * val;
}

function formatNumToken(
	current: number,
	m: RegExpExecArray,
	formatMode: string,
	rounding: string,
): string {
	const origSign = m[1] || m[3]; // '+', '-', or ''
	const currency = m[2];
	const origInt  = m[4]; // original integer string (may have grouping)
	const origDec  = m[5] ?? '';
	const suffix   = m[6]; // original case
	const percent  = m[7];

	const decPlaces = rounding === 'integer' ? 0 : (origDec.length > 1 ? origDec.length - 1 : 0);

	// Scale value back through suffix before formatting.
	const su = suffix.toUpperCase();
	let scaledAbs = Math.abs(current);
	if (su === 'K') scaledAbs /= 1e3;
	else if (su === 'M') scaledAbs /= 1e6;
	else if (su === 'B') scaledAbs /= 1e9;

	// Split into integer and decimal strings.
	const roundedStr = scaledAbs.toFixed(decPlaces);
	const dotIdx     = roundedStr.indexOf('.');
	let intPart      = dotIdx >= 0 ? roundedStr.slice(0, dotIdx) : roundedStr;
	const decPart    = dotIdx >= 0 ? roundedStr.slice(dotIdx + 1) : '';

	// For fixedWidth, pad the integer part to match the original digit count.
	if (formatMode === 'fixedWidth') {
		const origNoSep = origInt.replace(/[,\s ]/g, '');
		intPart = intPart.padStart(origNoSep.length, '0');
	}

	// Detect and re-apply original grouping separator.
	const groupSep = /\d,\d/.test(origInt) ? ',' : /\d[  ]\d/.test(origInt) ? ' ' : '';
	if (groupSep && intPart.length > 3) {
		const parts: string[] = [];
		let s = intPart;
		while (s.length > 3) { parts.unshift(s.slice(-3)); s = s.slice(0, -3); }
		parts.unshift(s);
		intPart = parts.join(groupSep);
	}

	const decStr  = decPart ? `.${decPart}` : '';
	const showSign = current < 0 ? '-' : origSign === '+' ? '+' : '';
	return showSign + currency + intPart + decStr + suffix + percent;
}

registerTransition('numberCountUp', (p, properties, params) => {
	const t = stage(p);
	if (typeof properties.text !== 'string') return properties;
	const text = properties.text;

	const startValue  = typeof params.startValue === 'number' ? params.startValue : 0;
	const mode        = params.mode       ?? 'allNumbers';
	const formatMode  = params.formatMode ?? 'natural';
	const rounding    = params.rounding   ?? 'auto';

	// Collect all number tokens in the string.
	NUM_RE.lastIndex = 0;
	type Token = { start: number; end: number; finalVal: number; match: RegExpExecArray };
	const tokens: Token[] = [];
	let m: RegExpExecArray | null;
	while ((m = NUM_RE.exec(text)) !== null) {
		if (m[0].length === 0) { NUM_RE.lastIndex++; continue; }
		tokens.push({ start: m.index, end: m.index + m[0].length, finalVal: parseNumToken(m), match: m });
	}

	if (!tokens.length) return properties;

	const toProcess = mode === 'firstNumber' ? new Set([tokens[0].start]) : new Set(tokens.map(tk => tk.start));

	let result = '';
	let pos = 0;
	for (const token of tokens) {
		result += text.slice(pos, token.start);
		if (toProcess.has(token.start)) {
			result += formatNumToken(lerp(startValue, token.finalVal, t), token.match, formatMode, rounding);
		} else {
			result += token.match[0];
		}
		pos = token.end;
	}
	result += text.slice(pos);

	properties.text = result;
	return properties;
}, {
	defaultEasing: 'linear',
	layerCategory: 'textual',
	fieldsConfig: {
		startValue:  { name: 'Start value',   type: 'number', default: 0,            min: -1e9, max: 1e9, step: 1 },
		mode:        { name: 'Mode',          type: 'option', default: 'allNumbers',  options: { allNumbers: 'All numbers', firstNumber: 'First number only' } },
		formatMode:  { name: 'Format mode',   type: 'option', default: 'natural',    options: { natural: 'Natural', fixedWidth: 'Fixed width' } },
		rounding:    { name: 'Rounding',      type: 'option', default: 'auto',       options: { auto: 'Auto', integer: 'Integer', decimal: 'Decimal' } },
		locale:      { name: 'Locale',        type: 'option', default: 'auto',       options: { auto: 'Auto', 'en-US': 'English (US)', 'fr-FR': 'French (FR)' } },
	},
});
