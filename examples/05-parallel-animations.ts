/**
 * Example 05 — Parallel Animations
 *
 * Three lines animate in on staggered timelines inside a single `$.parallel`
 * block, then exit together.
 *
 * Run:
 *   npx tsx examples/05-parallel-animations.ts
 */

import VideoFlow from '@videoflow/core';

export function createProject() {
	const $ = new VideoFlow({
		name: 'Parallel Animations',
		width: 1920,
		height: 1080,
		fps: 30,
		backgroundColor: '#0f0f23',
	});

	const line1 = $.addText({ text: 'Design.',  fontSize: 7, fontWeight: 800, color: '#ff6b6b', position: [0.5, 0.25], opacity: 0 });
	const line2 = $.addText({ text: 'Animate.', fontSize: 7, fontWeight: 800, color: '#4ecdc4', position: [0.5, 0.5],  opacity: 0 });
	const line3 = $.addText({ text: 'Render.',  fontSize: 7, fontWeight: 800, color: '#45b7d1', position: [0.5, 0.75], opacity: 0 });

	$.parallel([
		() => {
			line1.animate(
				{ opacity: 0, position: [0.3, 0.25] },
				{ opacity: 1, position: [0.5, 0.25] },
				{ duration: '800ms', easing: 'easeOut' },
			);
		},
		() => {
			$.wait('200ms');
			line2.animate(
				{ opacity: 0, position: [0.3, 0.5] },
				{ opacity: 1, position: [0.5, 0.5] },
				{ duration: '800ms', easing: 'easeOut' },
			);
		},
		() => {
			$.wait('400ms');
			line3.animate(
				{ opacity: 0, position: [0.3, 0.75] },
				{ opacity: 1, position: [0.5, 0.75] },
				{ duration: '800ms', easing: 'easeOut' },
			);
		},
	]);

	$.wait('2s');

	$.parallel([
		() => { line1.fadeOut('500ms'); },
		() => { line2.fadeOut('500ms'); },
		() => { line3.fadeOut('500ms'); },
	]);

	$.wait('500ms');

	return $;
}

if (typeof window === 'undefined') {
	await createProject().renderVideo({
		outputType: 'file',
		output: './05-parallel-animations.mp4',
		verbose: true,
	});
	console.log('Done → examples/05-parallel-animations.mp4');
}
