/**
 * Example 09 — GLSL Effects
 *
 * Showcases a wide selection of the built-in effect presets layered onto image
 * and text layers. Each effect is declared via the layer's `effects: [...]`
 * property and may be animated through the dot-path
 * `effects.<name>.<param>` (use `effects.<name>[<idx>].<param>` to
 * disambiguate when the same effect appears more than once).
 *
 * Set `enabled: false` on any effect entry to keep the configuration in the
 * project but skip the pass at render time — useful when iterating in an
 * editor or A/B-ing looks.
 *
 * Run:
 *   npx tsx examples/09-effects.ts
 */

import VideoFlow from '@videoflow/core';

export function createProject() {
	const $ = new VideoFlow({
		name: 'Effects',
		width: 1920,
		height: 1080,
		fps: 30,
		backgroundColor: '#000000',
	});

	// ────────────────────────────────────────────────────────────────
	// Panel 1 (0–3s) — pixelate ramp + chromatic aberration + vignette.
	// Pixelate snaps to a coarse grid then refines down to 1×.
	// ────────────────────────────────────────────────────────────────
	const img1 = $.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'pixelate',            params: { pixelSize: 2.5 } },
				{ effect: 'chromaticAberration', params: { intensity: 0.004 } },
				{ effect: 'vignette',            params: { intensity: 0.7, radius: 0.75 } },
			],
		},
		{ source: 'sample.jpg', startTime: 0, sourceDuration: 3 },
	);
	img1.animate({}, { 'effects.pixelate.pixelSize': 0.05 }, { duration: '1.5s', wait: false });

	const t1 = $.addText(
		{
			text: 'GLSL Effects',
			fontSize: 5,
			fontFamily: 'Rubik Storm',
			fontWeight: 800,
			color: '#ffffff',
			effects: [{ effect: 'pixelate', params: { pixelSize: 0.8 } }],
		},
		{
			startTime: 0.5,
			sourceDuration: 2.5,
			transitionIn:  { transition: 'fade', duration: '400ms' },
			transitionOut: { transition: 'fade', duration: '400ms' },
		},
	);
	t1.animate(
		{ 'effects.pixelate.pixelSize': 0.8 },
		{ 'effects.pixelate.pixelSize': 0.05 },
		{ duration: '1s', wait: false, easing: 'ease-out' },
	);

	// ────────────────────────────────────────────────────────────────
	// Panel 2 (3–6s) — bloom + colour grade for a warm, glowing look.
	// ────────────────────────────────────────────────────────────────
	$.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'colorGrade', params: { exposure: 0.3, saturation: 0.4, temperature: 0.4, contrast: 0.15 } },
				{ effect: 'bloom',      params: { threshold: 0.6, intensity: 0.9, radius: 1.25 } },
			],
		},
		{ source: 'sample.jpg', startTime: 3, sourceDuration: 3 },
	);

	$.addText(
		{
			text: 'Bloom + Grade',
			fontSize: 4,
			fontWeight: 800,
			color: '#fff7d4',
			position: [0.5, 0.85],
			effects: [{ effect: 'glow', params: { intensity: 1.2, radius: 0.95, color: '#ffe9a8' } }],
		},
		{
			startTime: 3.2,
			sourceDuration: 2.6,
			transitionIn:  { transition: 'fade', duration: '300ms' },
			transitionOut: { transition: 'fade', duration: '300ms' },
		},
	);

	// ────────────────────────────────────────────────────────────────
	// Panel 3 (6–9s) — VHS / glitch with CRT mask layered on top.
	// ────────────────────────────────────────────────────────────────
	$.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'rgbSplit',      params: { amount: 0.005, bandSize: 0.04, randomness: 0.6 } },
				{ effect: 'sliceGlitch',   params: { sliceCount: 36, offsetAmount: 0.02, randomness: 0.7 } },
				{ effect: 'vhsDistortion', params: { trackingAmount: 0.8, tearAmount: 0.25, scanlineIntensity: 0.5 } },
				{ effect: 'crtScanlines',  params: { scanlineCount: 320, scanlineIntensity: 0.35, rgbMaskAmount: 0.25, curvature: 0.18, brightnessRollOff: 0.4, flicker: true } },
			],
		},
		{ source: 'sample.jpg', startTime: 6, sourceDuration: 3 },
	);

	$.addText(
		{
			text: 'GLITCH',
			fontSize: 6,
			fontWeight: 900,
			color: '#ff3aa8',
			position: [0.5, 0.5],
			effects: [{ effect: 'rgbSplit', params: { amount: 0.012 } }],
		},
		{
			startTime: 6.2,
			sourceDuration: 2.6,
			transitionIn:  { transition: 'fade', duration: '200ms' },
			transitionOut: { transition: 'fade', duration: '200ms' },
		},
	);

	// ────────────────────────────────────────────────────────────────
	// Panel 4 (9–12s) — light leak + halftone graphic-print finish.
	// ────────────────────────────────────────────────────────────────
	$.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'halftone',  params: { spacing: 0.5, dotSize: 1, angle: 30, colorMode: 'duotone' } },
				{ effect: 'lightLeak', params: { amount: 0.75, scale: 0.8, positionX: 0.85, positionY: 0.15, colorA: '#ff9b3d', colorB: '#ffe17a' } },
			],
		},
		{ source: 'sample.jpg', startTime: 9, sourceDuration: 3 },
	);

	$.addText(
		{
			text: 'Print',
			fontSize: 5,
			fontWeight: 800,
			color: '#1a1a3a',
			position: [0.5, 0.85],
		},
		{
			startTime: 9.3,
			sourceDuration: 2.5,
			transitionIn:  { transition: 'fade', duration: '300ms' },
			transitionOut: { transition: 'fade', duration: '300ms' },
		},
	);

	// ────────────────────────────────────────────────────────────────
	// Panel 5 (12–15s) — liquid ripple + volumetric light + light rays for a
	// dreamy underwater / sunlit look. The ripple's `phase` animates
	// to keep the wavefront moving.
	// ────────────────────────────────────────────────────────────────
	const img5 = $.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'liquidRipple',    params: { centerX: 0.5, centerY: 0.55, amplitude: 0.018, frequency: 9, decay: 2.5, radius: 1.0, phase: 0 } },
				{ effect: 'volumetricLight', params: { intensity: 1.4, decay: 0.94, density: 1.1, weight: 0.9, centerX: 0.7, centerY: 0.2, samples: 64 } },
				{ effect: 'lightRays',    params: { intensity: 0.6, length: 0.25, threshold: 0.7, centerX: 0.7, centerY: 0.2, samples: 32, color: '#ffe6a8' } },
			],
		},
		{ source: 'sample.jpg', startTime: 12, sourceDuration: 3 },
	);
	img5.animate(
		{ 'effects.liquidRipple.phase': 0 },
		{ 'effects.liquidRipple.phase': 6.2832 },
		{ duration: '3s', wait: false },
	);

	$.addText(
		{
			text: 'Liquid Light',
			fontSize: 4,
			fontWeight: 700,
			color: '#fff7d4',
			position: [0.5, 0.88],
			effects: [{ effect: 'glow', params: { intensity: 1.0, radius: 0.7, color: '#ffe9a8' } }],
		},
		{
			startTime: 12.3,
			sourceDuration: 2.5,
			transitionIn:  { transition: 'fade', duration: '300ms' },
			transitionOut: { transition: 'fade', duration: '300ms' },
		},
	);

	// ────────────────────────────────────────────────────────────────
	// Panel 6 (15–18s) — frosted glass + glass refraction + light
	// sweep. The light sweep's progress animates across so the panel
	// catches a streak of highlight midway.
	// ────────────────────────────────────────────────────────────────
	const img6 = $.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'frostedGlass',    params: { blurRadius: 0.5, distortion: 0.6, frostAmount: 0.25, tintAmount: 0.1, highlightAmount: 0.15, tintColor: '#cfe7ff' } },
				{ effect: 'glassRefraction', params: { refractionAmount: 1.4, roughness: 0.25, highlightAmount: 0.8, edgeStrength: 0.4, ior: 1.55 } },
				{ effect: 'lightSweep',      params: { progress: 0, angle: 25, width: 0.18, intensity: 0.9, softness: 0.06, color: '#ffffff' } },
			],
		},
		{ source: 'sample.jpg', startTime: 15, sourceDuration: 3 },
	);
	img6.animate(
		{ 'effects.lightSweep.progress': -0.2 },
		{ 'effects.lightSweep.progress': 1.2 },
		{ duration: '2.4s', wait: false, easing: 'ease-in-out' },
	);

	$.addText(
		{
			text: 'Glass',
			fontSize: 5,
			fontWeight: 800,
			color: '#ffffff',
			position: [0.5, 0.5],
			effects: [
				{ effect: 'glow', params: { intensity: 0.9, radius: 0.95, color: '#dff1ff' } },
			],
		},
		{
			startTime: 15.3,
			sourceDuration: 2.5,
			transitionIn:  { transition: 'fade', duration: '300ms' },
			transitionOut: { transition: 'fade', duration: '300ms' },
		},
	);

	// ────────────────────────────────────────────────────────────────
	// Panel 7 (18–21s) — shockwave + zoom blur + motion blur for an
	// impact moment. The shockwave's `progress` ramps from the centre
	// outward; the zoom blur exaggerates the radial pull.
	// ────────────────────────────────────────────────────────────────
	const img7 = $.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'shockwave', params: { progress: 0, centerX: 0.5, centerY: 0.5, strength: 0.12, width: 0.1, softness: 0.03 } },
				{ effect: 'zoomBlur',  params: { centerX: 0.5, centerY: 0.5, amount: 0.05, samples: 24, falloff: 0.5 } },
				{ effect: 'motionBlur', params: { amount: 0.6, angle: 0, samples: 16, centerBias: 0.3 } },
			],
		},
		{ source: 'sample.jpg', startTime: 18, sourceDuration: 3 },
	);
	img7.animate(
		{ 'effects.shockwave.progress': 0 },
		{ 'effects.shockwave.progress': 1.3 },
		{ duration: '2s', wait: false, easing: 'ease-out' },
	);
	img7.animate(
		{ 'effects.zoomBlur.amount': 0.18 },
		{ 'effects.zoomBlur.amount': 0.0 },
		{ duration: '1.6s', wait: false, easing: 'ease-out' },
	);

	$.addText(
		{
			text: 'IMPACT',
			fontSize: 7,
			fontWeight: 900,
			color: '#ffffff',
			position: [0.5, 0.5],
			effects: [
				{ effect: 'chromaticAberration', params: { intensity: 0.006 } },
				{ effect: 'glow',                params: { intensity: 1.4, radius: 1.15, color: '#ff8c5a' } },
			],
		},
		{
			startTime: 18.3,
			sourceDuration: 2.4,
			transitionIn:  { transition: 'fade', duration: '150ms' },
			transitionOut: { transition: 'fade', duration: '300ms' },
		},
	);

	// ────────────────────────────────────────────────────────────────
	// Panel 8 (21–24s) — cinematic finish: duotone + film grain + edge
	// glow + a subtle lens distortion. The edge glow entry is wired up
	// but disabled via `enabled: false` to demonstrate the flag — flip
	// it to `true` to bring crisp neon outlines back in.
	// ────────────────────────────────────────────────────────────────
	$.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'lensDistortion', params: { distortion: 0.15, zoom: 1.05, curve: 2 } },
				{ effect: 'duotone',        params: { shadowColor: '#0d1633', highlightColor: '#ffd45a', contrast: 0.25, midtoneBias: 0.1, mix: 0.95 } },
				{ effect: 'edgeGlow',       enabled: false, params: { strength: 1.2, threshold: 0.18, radius: 0.6, color: '#7fd4ff' } },
				{ effect: 'filmGrain',      params: { amount: 0.28, grainSize: 0.085, luminanceResponse: 0.5, blendMode: 'overlay', monochrome: true } },
				{ effect: 'vignette',       params: { intensity: 0.6, radius: 0.85, softness: 0.45 } },
			],
		},
		{ source: 'sample.jpg', startTime: 21, sourceDuration: 3 },
	);

	$.addText(
		{
			text: 'CINEMA',
			fontSize: 6,
			fontWeight: 800,
			color: '#ffd45a',
			position: [0.5, 0.85],
			effects: [
				{ effect: 'prismSplit', params: { amount: 0.006, angle: 90, spectrumWidth: 0.6, centerX: 0.5, centerY: 0.5 } },
			],
		},
		{
			startTime: 21.3,
			sourceDuration: 2.5,
			transitionIn:  { transition: 'fade', duration: '300ms' },
			transitionOut: { transition: 'fade', duration: '300ms' },
		},
	);

	$.wait('24s');

	return $;
}

if (typeof window === 'undefined') {
	await createProject().renderVideo({
		outputType: 'file',
		output: './09-effects.mp4',
		verbose: true,
	});
	console.log('Done → examples/09-effects.mp4');
}
