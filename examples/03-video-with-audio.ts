/**
 * Example 03 — Video with Audio
 *
 * Video layer and a background music track playing simultaneously. The music
 * fades in (non-blocking) while the video starts.
 *
 * Run:
 *   npx tsx examples/03-video-with-audio.ts
 */

import VideoFlow from '@videoflow/core';

export function createProject() {
	const $ = new VideoFlow({
		name: 'Video with Audio',
		width: 1920,
		height: 1080,
		fps: 30,
	});

	$.addAudio(
		{ volume: 1 },
		{
			source: 'https://videoflow.dev/samples/sample.mp3',
			transitionIn: { transition: 'fade', duration: '1s' },
		},
	);

	$.addVideo(
		{ fit: 'cover', volume: 1 },
		{ source: 'https://videoflow.dev/samples/sample.mp4' },
		{ waitFor: 'finish' },
	);

	return $;
}

if (typeof window === 'undefined') {
	await createProject().renderVideo({
		outputType: 'file',
		output: './03-video-with-audio.mp4',
		verbose: true,
	});
	console.log('Done → examples/03-video-with-audio.mp4');
}
