/**
 * Example 04 — Captions Layer
 *
 * Adds time-coded captions over a solid background.  The captions array
 * is provided directly — no AI or TTS involved.
 *
 * Run:
 *   npx tsx examples/04-captions.ts
 */

import VideoFlow from '@videoflow/core';

export function createProject() {
	const $ = new VideoFlow({
		name: 'Captions Demo',
		width: 1920,
		height: 1080,
		fps: 30,
		backgroundColor: '#1a1a2e',
	});

	// Timed captions
	const captions = $.addCaptions(
		{
			fontSize: 2,
			fontWeight: 600,
			color: '#ffffff',
			position: [0.5, 0.85],
			textAlign: 'center',
		},
		{
			captions: [
				{ caption: 'Welcome to VideoFlow.',      startTime: 0,   endTime: 2.5 },
				{ caption: 'Build videos from code.',     startTime: 2.5, endTime: 5   },
				{ caption: 'No editor required.',         startTime: 5,   endTime: 7.5 },
				{ caption: 'Just write TypeScript.',      startTime: 7.5, endTime: 10  },
			],
			maxCharsPerLine: 40,
			maxLines: 2,
			sourceDuration: '10s',
		},
	);

	$.wait('10s');

	return $;
}

if (typeof window === 'undefined') {
	await createProject().renderVideo({
		outputType: 'file',
		output: './04-captions.mp4',
		verbose: true,
	});
	console.log('Done → examples/04-captions.mp4');
}
