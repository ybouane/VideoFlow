/**
 * Example 10 — Groups Showcase
 *
 * Three card groups stagger in (zoom + 500ms delay each), each with its own
 * slow 3D rotation, while the headline number counts up from 0. Cards exit
 * together at the end.
 *
 * Run:
 *   npx tsx examples/10-groups.ts
 */

import VideoFlow from '@videoflow/core';

export function createProject() {
	const $ = new VideoFlow({
		name: 'Groups',
		width: 1920,
		height: 1080,
		fps: 30,
		backgroundColor: '#0a0d18',
	});

	const CARDS = [
		{ x: 0.20, label: 'BOOKS READ',  value: '24',  color: '#ff5a1f', rotFrom: [5, -12, 0], rotTo: [-5,  12, 0] },
		{ x: 0.50, label: 'MOVIES SEEN', value: '87',  color: '#4ecdc4', rotFrom: [-10, 5, 0], rotTo: [10,  10, 0] },
		{ x: 0.80, label: 'SONGS LIKED', value: '342', color: '#a78bfa', rotFrom: [-8, 10, 0], rotTo: [8, -10, 0] },
	];

	const groups: any[] = [];

	for (const card of CARDS) {
		const g = $.group(
			{ position: [card.x, 0.5], perspective: 20 },
			{
				transitionIn:  { transition: 'zoom', duration: '600ms', params: { from: 0.6 } },
				transitionOut: { transition: 'zoom', duration: '500ms', params: { from: 0.6 } },
			},
			() => {
				// Rounded square card frame
				$.addShape(
					{
						width: 30, height: 30,
						fill: '#0e1524',
						strokeColor: card.color, strokeWidth: 0.2,
						cornerRadius: 3,
						position: [0.5, 0.5],
					},
					{ shapeType: 'rectangle' },
				);
				// Eyebrow label
				$.addText({
					text: card.label,
					fontSize: 1.8, fontWeight: 700,
					color: card.color, position: [0.5, 0.42],
					letterSpacing: 0.2,
				});
				// Big counting number
				$.addText(
					{
						text: card.value,
						fontSize: 8, fontWeight: 900,
						color: '#f1f5f9', position: [0.5, 0.55],
					},
					{ transitionIn: { transition: 'numberCountUp', duration: '1s' } },
				);
			},
			{ waitFor: 0 },
		);

		// Subtle, slow 3D drift — each card tilts on a different axis.
		g.animate(
			{ rotation: card.rotFrom },
			{ rotation: card.rotTo   },
			{ duration: '5s', easing: 'easeInOut', wait: false },
		);

		groups.push(g);
		$.wait('500ms');
	}

	// Hold so all three rotate visibly before the synchronised exit.
	$.wait('4s');

	// Synchronous exit — each card plays its own zoom-out transitionOut.
	$.parallel(groups.map((g) => () => g.remove()));
	$.wait('500ms');

	return $;
}

if (typeof window === 'undefined') {
	await createProject().renderVideo({
		outputType: 'file',
		output: './10-groups.mp4',
		verbose: true,
	});
	console.log('Done → examples/10-groups.mp4');
}
