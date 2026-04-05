/**
 * Example 08 — Render a Single Frame & Audio
 *
 * Demonstrates the VideoFlow convenience methods renderFrame() and
 * renderAudio() which auto-detect the environment and create a
 * renderer under the hood.
 *
 * Run:
 *   npx tsx examples/08-render-frame-and-audio.ts
 */

import { promises as fs } from 'fs';
import VideoFlow from '@videoflow/core';

const $ = new VideoFlow({
	name: 'Frame & Audio',
	width: 1920,
	height: 1080,
	fps: 30,
});

const title = $.addText({
	text: 'Snapshot!',
	fontSize: 3,
	fontWeight: 800,
	color: '#ffffff',
});

title.animate(
	{ opacity: 0, scale: 0.5 },
	{ opacity: 1, scale: 1 },
	{ duration: '2s' },
);

$.wait('3s');

// Render just frame 45 (1.5 seconds in — mid-animation)
const frame = await $.renderFrame(45);
await fs.writeFile('./06-frame-45.jpg', frame);
console.log('Frame 45 → ./06-frame-45.jpg');

// Render the full audio track (null if no audio layers)
const audio = await $.renderAudio();
if (audio) {
	await fs.writeFile('./06-audio.wav', audio);
	console.log('Audio → ./06-audio.wav');
} else {
	console.log('No audio layers — nothing to render.');
}
