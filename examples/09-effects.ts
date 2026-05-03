/**
 * Example 09 — GLSL Effects Showcase
 *
 * Three panels demonstrating distinct effect-stack looks: bloom + warm grade,
 * VHS glitch, and frosted glass with an animated light sweep.
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
		backgroundColor: '#000',
	});

	// Panel 1 — bloom + warm color correction.
	$.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'colorCorrection', params: { exposure: 0.3, saturation: 0.4, temperature: 0.4, contrast: 0.15 } },
				{ effect: 'bloom',           params: { threshold: 0.6, intensity: 0.9, radius: 1.25 } },
			],
		},
		{ source: 'https://videoflow.dev/samples/sample.jpg', startTime: 0, sourceDuration: 3 },
	);
	$.addText(
		{
			text: 'Bloom',
			fontSize: 5, fontWeight: 800, color: '#fff7d4', position: [0.5, 0.85],
			effects: [{ effect: 'glow', params: { intensity: 1.2, radius: 0.95, color: '#ffe9a8' } }],
		},
		{
			startTime: 0.3, sourceDuration: 2.4,
			transitionIn:  { transition: 'overshootPop', duration: '400ms' },
			transitionOut: { transition: 'fade',         duration: '300ms' },
		},
	);

	// Panel 2 — VHS glitch.
	$.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'rgbSplit',      params: { amount: 0.005, bandSize: 0.04, randomness: 0.6 } },
				{ effect: 'sliceGlitch',   params: { sliceCount: 36, offsetAmount: 0.02, randomness: 0.7 } },
				{ effect: 'vhsDistortion', params: { trackingAmount: 0.8, tearAmount: 0.25, scanlineIntensity: 0.5 } },
			],
		},
		{ source: 'https://videoflow.dev/samples/sample2.jpg', startTime: 3, sourceDuration: 3 },
	);
	$.addText(
		{
			text: 'GLITCH',
			fontSize: 6, fontWeight: 900, color: '#ff3aa8', position: [0.5, 0.5],
			effects: [{ effect: 'rgbSplit', params: { amount: 0.012 } }],
		},
		{
			startTime: 3.2, sourceDuration: 2.6,
			transitionIn:  { transition: 'glitchResolve', duration: '300ms' },
			transitionOut: { transition: 'fade',          duration: '200ms' },
		},
	);

	// Panel 3 — frosted glass + light sweep with animated progress.
	const img = $.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'frostedGlass', params: { blurRadius: 0.5, distortion: 0.6, frostAmount: 0.25 } },
				{ effect: 'lightSweep',   params: { progress: 0, angle: 25, width: 0.18, intensity: 0.9, color: '#ffffff' } },
			],
		},
		{ source: 'https://videoflow.dev/samples/sample3.jpg', startTime: 6, sourceDuration: 3 },
	);
	img.animate(
		{ 'effects.lightSweep.progress': -0.2 },
		{ 'effects.lightSweep.progress': 1.2 },
		{ duration: '2.4s', wait: false, easing: 'easeInOut' },
	);
	$.addText(
		{
			text: 'Glass',
			fontSize: 5, fontWeight: 800, color: '#ffffff', position: [0.5, 0.5],
			effects: [{ effect: 'glow', params: { intensity: 0.9, radius: 0.95, color: '#dff1ff' } }],
		},
		{
			startTime: 6.3, sourceDuration: 2.5,
			transitionIn:  { transition: 'blurResolve', duration: '500ms' },
			transitionOut: { transition: 'fade',        duration: '300ms' },
		},
	);

	$.wait('9s');

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
