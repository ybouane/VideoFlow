/**
 * Example 10 — Groups
 *
 * Demonstrates layer groups: a container that nests several layers, treats
 * them as a single visual unit, and applies its own transform / transitions /
 * effects to the composited sub-tree.
 *
 * What this example shows:
 *
 * - **Auto timing.** A group's `startTime` is the current flow time when
 *   `$.group(...)` is called, and its `sourceDuration` is auto-derived from
 *   the latest child's end. You don't pass either — just like top-level
 *   layers, the flow takes care of it.
 *
 * - **Relative timing inside a group.** Children authored inside `$.group(...)`
 *   start at `0` relative to the group's own start. Card 1 here begins at
 *   project time `0`, Card 2 begins right after Card 1 ends, but each
 *   group's children address the timeline as if it were a fresh `0`.
 *
 * - **Group-level transitions.** The `transitionIn`/`transitionOut` on the
 *   group's settings apply to the whole composited card (background +
 *   shape + text), not to each child individually.
 *
 * - **Group-level animation.** The builder callback receives the group layer
 *   itself (`card`), so animating it inside the callback transforms the
 *   composite — the whole card scales / rotates as one. (Use `wait: false` so
 *   the animation does not advance the group's local flow pointer.)
 *
 * - **Nested groups.** Card 2 contains a small "badge" sub-group, which
 *   composites and then fades along with the rest of its parent.
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

	// ────────────────────────────────────────────────────────────────
	// Card 1 — title card with image background + heading + caption.
	// The whole card slides in from the right, holds, and zooms out.
	// The group's duration auto-derives from its children's end times,
	// so we don't pass `sourceDuration` here.
	// ────────────────────────────────────────────────────────────────
	$.group(
		{ position: [0.5, 0.5], scale: 1 },
		{
			transitionIn:  { transition: 'slideLeft', duration: '600ms', params: { distance: 0.4 } },
			transitionOut: { transition: 'zoomIn',    duration: '600ms', params: { from: 1.2 } },
		},
		(card) => {
			// Subtle breathing scale across the card's full lifetime.
			card.animate({ scale: 1 }, { scale: 1.04 }, { duration: '2.5s', wait: false });

			// Image background, scoped to the card.
			$.addImage(
				{ fit: 'cover', opacity: 0.55, filterBlur: 0.6 },
				{ source: 'sample.jpg', sourceDuration: '2.5s' },
			);

			// Heading.
			$.addText(
				{
					text: 'Groups',
					fontSize: 4,
					fontWeight: 800,
					color: '#ffffff',
					position: [0.5, 0.42],
				},
				{ sourceDuration: '2.5s' },
			);

			// Caption — children's timings are relative to the group, so this
			// `wait('400ms')` lands the caption at 400ms into the card, not
			// at 400ms of project time.
			$.wait('400ms');
			$.addText(
				{
					text: 'Composite layers as one',
					fontSize: 1.4,
					fontWeight: 500,
					color: '#cdd5e1',
					position: [0.5, 0.58],
				},
				{ sourceDuration: '2.1s' },
			);
		},
	);

	// `$.group()` advances the flow pointer to the group's end (just like
	// `$.parallel()` advances to the longest branch), so Card 2 begins
	// right after Card 1 ends — no explicit `$.wait()` is needed.

	// ────────────────────────────────────────────────────────────────
	// Card 2 — a stats card composed of a shape + text + nested badge.
	// Demonstrates nested groups: the badge is a group inside the card.
	// ────────────────────────────────────────────────────────────────
	$.group(
		{ position: [0.5, 0.5] },
		{
			transitionIn:  { transition: 'slideUp', duration: '500ms', params: { distance: 0.08 } },
			transitionOut: { transition: 'fadeIn',  duration: '500ms' },
		},
		(card) => {
			// Rotate the whole card slightly across its lifetime — children
			// composited inside come along for the ride.
			card.animate({ rotation: -3 }, { rotation: 3 }, { duration: '3s', wait: false });

			// Card backplate.
			$.addShape(
				{
					width: 50,
					height: 30,
					fill: '#1c2233',
					strokeColor: '#3a4257',
					strokeWidth: 0.2,
					cornerRadius: 1.5,
				},
				{ shapeType: 'rectangle', sourceDuration: '3s' },
			);

			// Big stat number.
			$.addText(
				{
					text: '128k',
					fontSize: 5,
					fontWeight: 800,
					color: '#ffffff',
					position: [0.5, 0.45],
				},
				{ sourceDuration: '3s' },
			);

			// Stat label.
			$.addText(
				{
					text: 'frames rendered',
					fontSize: 1.2,
					fontWeight: 500,
					color: '#9aa3b8',
					position: [0.5, 0.6],
				},
				{ sourceDuration: '3s' },
			);

			// Nested badge group — a tiny pill in the upper-right of the card.
			// Its duration auto-derives from its children too.
			$.group(
				{ position: [0.7, 0.32], scale: 0.9 },
				{
					transitionIn: { transition: 'zoomIn', duration: '350ms', params: { from: 0.5 } },
				},
				() => {
					$.addShape(
						{
							width: 8,
							height: 3,
							fill: '#4ecdc4',
							cornerRadius: 1.5,
						},
						{ shapeType: 'rectangle', sourceDuration: '3s' },
					);
					$.addText(
						{ text: 'NEW', fontSize: 0.9, fontWeight: 800, color: '#0a0d18' },
						{ sourceDuration: '3s' },
					);
				},
			);
		},
	);

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
