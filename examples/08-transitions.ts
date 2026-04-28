/**
 * Example 08 — Transitions
 *
 * Showcases the bundled transition presets in sequence. Each transition gets
 * a short slot where the layer enters with the named preset and exits with
 * the same preset, so you can see both sides of every transition back-to-back.
 *
 * The 20 built-in presets fall into three families:
 *
 *   - Position / opacity / scale (CSS-only):  fadeIn, slideUpFade, slideLeftFade,
 *     zoomInFade, overshootPop.
 *   - 3D transforms (CSS-only):  rotate3dY, tilt3dUp, spinIn.
 *   - WebGL-effect-injecting:  blurResolve, motionBlurSlide, radialZoom,
 *     glitchResolve, rgbSplitSnap, sliceAssemble, noiseDissolve, burnDissolve,
 *     wipeReveal, scanReveal, lightSweepReveal, lensSnap.
 *
 * Run:
 *   npx tsx examples/08-transitions.ts
 */

import VideoFlow from '@videoflow/core';

const PRESETS: Array<{ name: string; params?: Record<string, any> }> = [
	{ name: 'fadeIn' },
	{ name: 'slideUpFade' },
	{ name: 'slideLeftFade' },
	{ name: 'zoomInFade' },
	{ name: 'overshootPop' },
	{ name: 'rotate3dY' },
	{ name: 'tilt3dUp' },
	{ name: 'spinIn' },
	{ name: 'blurResolve' },
	{ name: 'motionBlurSlide' },
	{ name: 'radialZoom' },
	{ name: 'glitchResolve' },
	{ name: 'rgbSplitSnap' },
	{ name: 'sliceAssemble' },
	{ name: 'noiseDissolve' },
	{ name: 'burnDissolve' },
	{ name: 'wipeReveal',          params: { angle: 0 } },
	{ name: 'scanReveal',          params: { angle: 0 } },
	{ name: 'lightSweepReveal',    params: { angle: 30 } },
	{ name: 'lensSnap' },
];

const SLOT_DURATION = 1.4;     // total seconds per transition card
const TRANSITION_DURATION = '500ms';

export function createProject() {
	const $ = new VideoFlow({
		name: 'Transitions',
		width: 1920,
		height: 1080,
		fps: 30,
		backgroundColor: '#0c0e16',
	});

	// Soft moving background — gradient with a slow zoom for visual interest.
	const bg = $.addImage(
		{ fit: 'cover', opacity: 0.35 },
		{ source: 'sample.jpg', startTime: 0, sourceDuration: SLOT_DURATION * PRESETS.length },
	);
	bg.animate({ scale: 1.05 }, { scale: 1.15 }, { duration: `${SLOT_DURATION * PRESETS.length}s`, wait: false });

	// Persistent header.
	$.addText(
		{
			text: 'TRANSITIONS',
			fontSize: 0.9,
			fontWeight: 700,
			color: '#ffffff60',
			position: [0.5, 0.12],
		},
		{
			startTime: 0,
			sourceDuration: SLOT_DURATION * PRESETS.length,
			transitionIn:  { transition: 'fadeIn', duration: '400ms' },
			transitionOut: { transition: 'fadeIn', duration: '400ms' },
		},
	);

	// One slot per preset: a big label with the preset's name, animating in
	// AND out with that same preset. Layers run back-to-back with no gap so
	// the screen always has the current preset visible.
	for (let i = 0; i < PRESETS.length; i++) {
		const preset = PRESETS[i];
		const startTime = i * SLOT_DURATION;
		const params = preset.params;

		// Big preset name in the centre.
		$.addText(
			{
				text: preset.name,
				fontSize: 4.5,
				fontWeight: 800,
				color: '#ffffff',
				position: [0.5, 0.5],
			},
			{
				startTime,
				sourceDuration: SLOT_DURATION,
				transitionIn:  { transition: preset.name, duration: TRANSITION_DURATION, params },
				transitionOut: { transition: preset.name, duration: TRANSITION_DURATION, params },
			},
		);

		// Index counter at the bottom — also animates with the same preset.
		$.addText(
			{
				text: `${String(i + 1).padStart(2, '0')} / ${PRESETS.length}`,
				fontSize: 1.0,
				fontWeight: 600,
				color: '#9aa3b6',
				position: [0.5, 0.88],
			},
			{
				startTime,
				sourceDuration: SLOT_DURATION,
				transitionIn:  { transition: 'fadeIn', duration: '300ms' },
				transitionOut: { transition: 'fadeIn', duration: '300ms' },
			},
		);
	}

	$.wait(`${SLOT_DURATION * PRESETS.length}s`);

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
