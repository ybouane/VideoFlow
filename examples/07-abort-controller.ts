/**
 * Example 07 — AbortController
 *
 * Shows how to cancel a rendering operation mid-flight using an
 * AbortController.  Useful for UIs where a user may cancel a render.
 *
 * Run:
 *   npx tsx examples/07-abort-controller.ts
 */

import VideoFlow from '@videoflow/core';

const $ = new VideoFlow({
	name: 'Abort Demo',
	width: 1280,
	height: 720,
	fps: 30,
});

const text = $.addText({
	text: 'This render will be cancelled…',
	fontSize: 2,
	fontWeight: 600,
	color: '#ff6b6b',
});

text.fadeIn('1s');
$.wait('10s'); // Long video to give us time to abort
text.fadeOut('1s');
$.wait('500ms');

// Create an AbortController and cancel after 2 seconds
const controller = new AbortController();

setTimeout(() => {
	console.log('Aborting render…');
	controller.abort();
}, 2000);

try {
	await $.renderVideo({
		outputType: 'file',
		output: './07-abort-controller.mp4',
		signal: controller.signal,
		verbose: true,
	});
} catch (err: any) {
	if (err.name === 'AbortError' || controller.signal.aborted) {
		console.log('Render was successfully cancelled.');
	} else {
		throw err;
	}
}
