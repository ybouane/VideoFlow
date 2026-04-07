/**
 * Example 03 — Video Layer with Separate Audio
 *
 * Plays a video with its own audio track, plus a background music layer
 * that fades in and ducks when the video plays.
 *
 * Note: Uses remote files so it works in both CLI and browser contexts.
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

	// Background music — remote file (Creative Commons licensed)
	const music = $.addAudio(
		{ volume: 0 },
		{ source: 'sample.mp3' },
	);

	// Fade music in over 2 seconds
	music.animate(
		{ volume: 0 },
		{ volume: 0.6 },
		{ duration: '2s' },
	);

	$.wait('1s');

	// Duck the music when the video starts
	music.animate(
		{ volume: 0.6 },
		{ volume: 0.2 },
		{ duration: '500ms' },
	);

	// Add a video layer (covers the canvas) — remote file
	const video = $.addVideo(
		{ fit: 'cover', volume: 1 },
		{
			source: 'sample.mp4'
		},
		{ waitFor: 'finish' },
	);

	// Bring the music back up
	music.animate(
		{ volume: 0.2 },
		{ volume: 0.6 },
		{ duration: '1s' },
	);

	$.wait('2s');

	// Fade music out
	music.animate(
		{ volume: 0.6 },
		{ volume: 0 },
		{ duration: '2s' },
	);

	$.wait('500ms');

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
