/**
 * Example 02 — Image Background with Blur Animation
 *
 * Image as a full-cover background; blurs slowly while a title fades in on top.
 *
 * Run:
 *   npx tsx examples/02-image-background.ts
 */

import VideoFlow from '@videoflow/core';

export function createProject() {
	const $ = new VideoFlow({
		name: 'Image Background',
		width: 1920,
		height: 1080,
		fps: 30,
	});

	const bg = $.addImage(
		{ fit: 'cover' },
		{ source: 'https://videoflow.dev/samples/sample.jpg' },
	);

	// Slowly blur the background over 4 seconds (non-blocking).
	bg.animate(
		{ filterBlur: 0 },
		{ filterBlur: 0.5 },
		{ duration: '4s', wait: false },
	);

	$.wait('500ms');

	const title = $.addText({
		text: 'Beautiful Scenery',
		fontSize: 5,
		fontWeight: 700,
		color: '#ffffff',
		textShadowColor: 'rgba(0,0,0,0.5)',
		textShadowBlur: 0.5,
	});

	title.fadeIn('1s');
	$.wait('3s');
	title.fadeOut('1s');
	$.wait('500ms');

	return $;
}

if (typeof window === 'undefined') {
	await createProject().renderVideo({
		outputType: 'file',
		output: './02-image-background.mp4',
		verbose: true,
	});
	console.log('Done → examples/02-image-background.mp4');
}
