/**
 * Example 08 — Transitions
 *
 * Built-in transition presets entering and leaving on a single text layer.
 * Each slot uses a different preset for both transitionIn and transitionOut.
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
		backgroundColor: '#0c0e16',
	});

	const PRESETS = [
		'fade', 'slideUp', 'zoom', 'overshootPop',
		'blurResolve', 'glitchResolve', 'rotate3dY', 'lightSweepReveal',
		'typewriter',
	];

	const SLOT = 1.4;

	$.addText(
		{ text: 'TRANSITIONS', fontSize: 5, fontWeight: 700, color: '#ffffff90', position: [0.5, 0.14] },
		{
			startTime: 0,
			sourceDuration: SLOT * PRESETS.length,
			transitionIn:  { transition: 'fade', duration: '400ms' },
			transitionOut: { transition: 'fade', duration: '400ms' },
		},
	);

	for (let i = 0; i < PRESETS.length; i++) {
		const name = PRESETS[i];
		$.addText(
			{ text: name, fontSize: 8, fontWeight: 800, color: '#ffffff', position: [0.5, 0.5] },
			{
				startTime: i * SLOT,
				sourceDuration: SLOT,
				transitionIn:  { transition: name, duration: '500ms' },
				transitionOut: { transition: name, duration: '500ms' },
			},
		);
	}

	$.wait(`${SLOT * PRESETS.length}s`);

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
