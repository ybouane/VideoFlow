/**
 * Example 08 — Transitions
 *
 * Demonstrates the bundled transition presets — `fade`, `zoom`, `slideUp`,
 * `blur`, `riseFade` — attached via the `transitionIn` / `transitionOut`
 * entries on each layer's settings.
 *
 * Run:
 *   npx tsx examples/08-transitions.ts
 */

import VideoFlow from '@videoflow/core';

export function createProject() {
	const $ = new VideoFlow({
		name: 'Transitions',
		width: 1920,
		height: 1080,
		fps: 30,
		backgroundColor: '#101018',
	});

	// Image background fades in and zooms out
	$.addImage(
		{ fit: 'cover', opacity: 0.45 },
		{
			source: 'sample.jpg',
			startTime: 0,
			sourceDuration: 6,
			transitionIn:  { transition: 'zoom', duration: '1s', params: { from: 0.9 } },
			transitionOut: { transition: 'fade', duration: '1s' },
		},
	);

	// Title rises in from below, fades out via blur
	$.addText(
		{
			text: 'Transitions',
			fontSize: 3,
			fontWeight: 800,
			color: '#ffffff',
		},
		{
			startTime: 0.5,
			sourceDuration: 4,
			transitionIn:  { transition: 'riseFade', duration: '700ms', params: { distance: 0.12 } },
			transitionOut: { transition: 'blur',     duration: '800ms', params: { amount: 10 } },
		},
	);

	// Subtitle slides in from the right
	$.addText(
		{
			text: 'Built-in presets, no manual keyframes',
			fontSize: 1.3,
			fontWeight: 500,
			color: '#b9c2d0',
			position: [0.5, 0.6],
		},
		{
			startTime: 1.0,
			sourceDuration: 3.5,
			transitionIn:  { transition: 'slideLeft',  duration: '600ms', params: { distance: 0.1 } },
			transitionOut: { transition: 'slideRight', duration: '600ms', params: { distance: 0.1 } },
		},
	);

	$.wait('6s');

	return $;
}

if (typeof window === 'undefined') {
	await createProject().renderVideo({
		outputType: 'file',
		output: './08-transitions.mp4',
		verbose: true,
	});
	console.log('Done → examples/08-transitions.mp4');
}
