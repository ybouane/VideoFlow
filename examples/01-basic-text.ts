/**
 * Example 01 — Basic Text Video
 *
 * 5-second card with a title that fades in (with a subtle scale up), holds,
 * and fades out (scaling slightly past 1). Demonstrates `addText` + `animate`.
 *
 * Run:
 *   npx tsx examples/01-basic-text.ts
 */

import VideoFlow from '@videoflow/core';

export function createProject() {
	const $ = new VideoFlow({
		name: 'Basic Text',
		width: 1920,
		height: 1080,
		fps: 30,
	});

	const title = $.addText({
		text: 'Hello, VideoFlow!',
		fontSize: 9,
		fontWeight: 800,
		color: '#ffffff',
	});

	title.animate(
		{ opacity: 0, scale: 0.8 },
		{ opacity: 1, scale: 1 },
		{ duration: '0.8s' },
	);

	$.wait('1.5s');
	title.animate(
		{ opacity: 1, scale: 1 },
		{ opacity: 0, scale: 1.2 },
		{ duration: '0.8s' },
	);

	return $;
}

if (typeof window === 'undefined') {
	await createProject().renderVideo({
		outputType: 'file',
		output: './01-basic-text.mp4',
		verbose: true,
	});
	console.log('Done → examples/01-basic-text.mp4');
}
