/**
 * Example 11 — Keyframe Animations
 *
 * Property animations: scale, position, blur, and rotation — all driven by
 * `animate()` with different easings to show the full animation API.
 *
 * Run:
 *   npx tsx examples/11-keyframe-animations.ts
 */

import VideoFlow from '@videoflow/core';

export function createProject() {
	const $ = new VideoFlow({
		name: 'Keyframe Animations',
		width: 1920,
		height: 1080,
		fps: 30,
		backgroundColor: '#040411',
	});

	// Wide rectangle that flips into view (non-blocking)
	const ring = $.addShape(
		{
			width: 80, height: 25,
			fill: '#ff5a1f20', strokeColor: '#ff5a1f', strokeWidth: 0.35,
			cornerRadius: 1,
			position: [0.5, 0.40], opacity: 0,
		},
		{ shapeType: 'rectangle' },
	);
	ring.animate(
		{ opacity: 0, scale: 0.3, rotation: 0 },
		{ opacity: 1, scale: 1.0, rotation: 180 },
		{ duration: '900ms', easing: 'easeOut', wait: false },
	);

	// Main title pops in
	const title = $.addText(
		{
			text: 'Animate',
			fontSize: 7.5, fontWeight: 800, color: '#ffffff',
			position: [0.5, 0.40], letterSpacing: -0.04,
		},
		{ transitionIn: { transition: 'zoom', duration: '600ms', params: { from: 0.85 } } },
	);
	$.wait('600ms');

	// Subtitle slides up from below
	const sub = $.addText(
		{
			text: 'Scale  ·  Position  ·  Rotation  ·  Blur  ·  etc.',
			fontSize: 4.0, fontWeight: 400, color: '#6b7280', position: [0.5, 0.72],
		},
		{
			transitionIn:  { transition: 'slideUp', duration: '500ms', params: { distance: 0.05 } },
			transitionOut: { transition: 'fade',    duration: '400ms' },
		},
	);
	$.wait('2s');

	// Exit: title and ring animate out, subtitle uses its transitionOut
	title.animate(
		{ scale: 1.0, opacity: 1 },
		{ scale: 2.2, opacity: 0 },
		{ duration: '600ms', easing: 'easeIn', wait: false },
	);
	ring.animate(
		{ scale: 1.0, opacity: 1 },
		{ scale: 0.0, opacity: 0 },
		{ duration: '500ms', easing: 'easeIn', wait: false },
	);
	sub.remove();
	$.wait('600ms');
	title.remove();
	ring.remove();

	// ── Second beat: three properties animated independently ─────────────────────

	const blurWord = $.addText(
		{
			text: 'filterBlur', fontSize: 4.5, fontWeight: 700,
			color: '#4ecdc4', position: [0.5, 0.3], filterBlur: 1.5, opacity: 0,
		},
		{ transitionOut: { transition: 'fade', duration: '500ms' } },
	);
	blurWord.animate(
		{ filterBlur: 1.5, opacity: 0 },
		{ filterBlur: 0,   opacity: 1 },
		{ duration: '700ms', easing: 'easeOut' },
	);
	$.wait('300ms');

	const posWord = $.addText(
		{
			text: 'position', fontSize: 4.5, fontWeight: 700,
			color: '#ffd166', position: [0.15, 0.52], opacity: 0,
		},
		{ transitionOut: { transition: 'fade', duration: '500ms' } },
	);
	posWord.animate(
		{ opacity: 0, position: [0.15, 0.52] },
		{ opacity: 1, position: [0.50, 0.52] },
		{ duration: '700ms', easing: 'easeOut' },
	);
	$.wait('300ms');

	const scaleWord = $.addText(
		{
			text: 'scale', fontSize: 4.5, fontWeight: 700,
			color: '#ff5a1f', position: [0.5, 0.73], opacity: 0, scale: 0.2, rotation: -30,
		},
		{ transitionOut: { transition: 'fade', duration: '500ms' } },
	);
	scaleWord.animate(
		{ opacity: 0, scale: 0.2, rotation: -30 },
		{ opacity: 1, scale: 1.0, rotation:   0 },
		{ duration: '700ms', easing: 'easeOut' },
	);
	$.wait('2s');

	blurWord.remove();
	posWord.remove();
	scaleWord.remove();
	$.wait('500ms');

	return $;
}

if (typeof window === 'undefined') {
	await createProject().renderVideo({
		outputType: 'file',
		output: './11-keyframe-animations.mp4',
		verbose: true,
	});
	console.log('Done → examples/11-keyframe-animations.mp4');
}
