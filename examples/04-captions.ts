/**
 * Example 04 — Captions Layer
 *
 * Time-synced captions burned over a dark gradient background. The captions
 * array is provided directly — no AI or TTS involved.
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
		backgroundColor: '#0d0d1a',
	});

	$.addCaptions(
		{
			fontSize: 3.5,
			fontWeight: 700,
			color: '#ffffff',
			position: [0.5, 0.82],
			textAlign: 'center',
		},
		{
			captions: [
				{ caption: 'Welcome to VideoFlow.',   startTime: 0,   endTime: 1.5 },
				{ caption: 'Build videos from code.', startTime: 1.5, endTime: 3   },
				{ caption: 'No editor required.',     startTime: 3,   endTime: 5   },
				{ caption: 'Just write JavaScript.',  startTime: 5,   endTime: 7.5 },
			],
			maxCharsPerLine: 35,
			maxLines: 2,
		},
	);

	$.wait('7.5s');

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
