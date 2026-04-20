/**
 * Example 09 — GLSL Effects
 *
 * Demonstrates declaring GLSL effects on a layer via the first-arg
 * `effects` property, and animating individual effect params by the
 * dot-path `effects.<name>.<param>` (idx defaults to the first
 * occurrence; use `effects.<name>[<idx>].<param>` to disambiguate when
 * the same effect appears more than once).
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

	const img = $.addImage(
		{
			fit: 'cover',
			effects: [
				{ effect: 'pixelate',            params: { size: 48 } },
				{ effect: 'chromaticAberration', params: { amount: 0.004 } },
				{ effect: 'vignette',            params: { strength: 0.7, radius: 0.75 } },
			],
		},
		{ source: 'sample.jpg', startTime: 0, sourceDuration: 4 },
	);

	// Ramp the pixelate `size` from 48 → 1 over the first 1.5s.
	img.animate(
		{  },
		{ 'effects.pixelate.size': 1 },
		{ duration: '1.5s', wait: false },
	);

	const text = $.addText(
		{
			text: 'GLSL Effects',
			fontSize: 5,
			fontFamily: 'Rubik Storm',
			fontWeight: 800,
			color: '#ffffff',
			effects: [
				{ effect: 'pixelate',            params: { size: 15 } },
			],
		},
		{
			startTime: 0.5,
			sourceDuration: 3,
			transitionIn:  { transition: 'fade', duration: '400ms' },
			transitionOut: { transition: 'fade', duration: '400ms' },
		},
	);
	text.animate(
		{ 'effects.pixelate.size': 15 },
		{ 'effects.pixelate.size': 1 },
		{ duration: '1s', wait: false, easing: 'ease-out' },
	);


	$.wait('4s');

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
