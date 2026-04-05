/**
 * Example 01 — Basic Text Video
 *
 * Creates a simple 5-second video with a title that fades in and scales up.
 * Demonstrates the core flow: create a project, add a text layer, animate it,
 * and render to MP4.
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

	// Add a white title centred on screen
	const title = $.addText({
		text: 'Hello, VideoFlow!',
		fontSize: 2.5,
		fontWeight: 800,
		color: '#ffffff',
	});

	// Fade in + scale up over 1.5 seconds
	title.animate(
		{ opacity: 0, scale: 0.8 },
		{ opacity: 1, scale: 1 },
		{ duration: '1.5s' },
	);

	// Hold for 2 seconds
	$.wait('2s');

	// Fade out
	title.animate(
		{ opacity: 1 },
		{ opacity: 0 },
		{ duration: '1s' },
	);

	$.wait('500ms');

	return $;
}

if (typeof window === 'undefined') {
	await createProject().renderVideo({
		outputType: 'file',
		output: './01-basic-text.mp4',
		verbose: true,
	});
	console.log('Done → 01-basic-text.mp4');
}
