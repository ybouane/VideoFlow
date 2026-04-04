/**
 * Web Player Example — demonstrates @videoflow/renderer-dom.
 *
 * Loads example projects via a dropdown, compiles them to VideoJSON,
 * and plays them back with a DomRenderer.
 */

import DomRenderer from '@videoflow/renderer-dom';

import { createProject as basicText } from '../01-basic-text.js';
import { createProject as imageBackground } from '../02-image-background.js';
import { createProject as videoWithAudio } from '../03-video-with-audio.js';
import { createProject as captions } from '../04-captions.js';
import { createProject as parallelAnimations } from '../05-parallel-animations.js';

const EXAMPLES: Record<string, () => any> = {
	'01 — Basic Text': basicText,
	'02 — Image Background': imageBackground,
	'03 — Video with Audio': videoWithAudio,
	'04 — Captions': captions,
	'05 — Parallel Animations': parallelAnimations,
};

const $status = document.getElementById('status')!;
const $player = document.getElementById('player-inner')!;
const $btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const $btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const $seek = document.getElementById('seek') as HTMLInputElement;
const $time = document.getElementById('time')!;
const $fps = document.getElementById('fps-display')!;
const $select = document.getElementById('example-select') as HTMLSelectElement;

let renderer: DomRenderer | null = null;

// -----------------------------------------------------------------------
//  Load a project into the renderer
// -----------------------------------------------------------------------

async function loadExample(name: string) {
	const factory = EXAMPLES[name];
	if (!factory) return;

	// Stop any current playback
	if (renderer) {
		renderer.stop();
		renderer.destroy();
	}

	$btnPlay.textContent = 'Play';
	$btnPlay.classList.remove('active');
	$fps.textContent = '';

	try {
		$status.textContent = 'Compiling...';
		const $ = factory();
		const videoJSON = await $.compile();

		$status.textContent = 'Loading...';
		renderer = new DomRenderer($player);
		await renderer.loadVideo(videoJSON);

		$seek.max = String(renderer.totalFrames - 1);
		$seek.value = '0';
		updateTimeDisplay();
		$status.textContent = 'Ready';
	} catch (e) {
		console.error(e);
		$status.textContent = `Error: ${e}`;
	}
}

// -----------------------------------------------------------------------
//  Controls
// -----------------------------------------------------------------------

let seeking = false;

$btnPlay.addEventListener('click', togglePlayback);

async function togglePlayback() {
	if (!renderer) return;
	if (renderer.playing) {
		renderer.stop();
		$btnPlay.textContent = 'Play';
		$btnPlay.classList.remove('active');
	} else {
		$btnPlay.textContent = 'Pause';
		$btnPlay.classList.add('active');
		await renderer.play((_event, data) => {
			$fps.textContent = `${Math.min(60, Math.round(data))} fps`;
			if (!seeking) {
				$seek.value = String(renderer!.currentFrame);
				updateTimeDisplay();
			}
		});
		$btnPlay.textContent = 'Play';
		$btnPlay.classList.remove('active');
	}
}

$btnStop.addEventListener('click', () => {
	if (!renderer) return;
	renderer.stop();
	$btnPlay.textContent = 'Play';
	$btnPlay.classList.remove('active');
	// Reset time to frame 0
	renderer.renderFrame(0);
	$seek.value = '0';
	updateTimeDisplay();
	$fps.textContent = '';
});

document.addEventListener('keydown', (e) => {
	if (e.code === 'Space') {
		e.preventDefault();
		togglePlayback();
	}
});

$seek.addEventListener('input', () => {
	if (!renderer) return;
	seeking = true;
	renderer.renderFrame(parseInt($seek.value, 10));
	updateTimeDisplay();
});

$seek.addEventListener('change', () => { seeking = false; });

$select.addEventListener('change', () => { loadExample($select.value); });

// -----------------------------------------------------------------------
//  Helpers
// -----------------------------------------------------------------------

function updateTimeDisplay() {
	if (!renderer) return;
	const current = formatTime(renderer.currentTime);
	const total = formatTime(renderer.duration);
	$time.textContent = `${current} / ${total}`;
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

// -----------------------------------------------------------------------
//  Init
// -----------------------------------------------------------------------

// Populate dropdown
for (const name of Object.keys(EXAMPLES)) {
	const opt = document.createElement('option');
	opt.value = name;
	opt.textContent = name;
	$select.appendChild(opt);
}

// Load the first example
loadExample(Object.keys(EXAMPLES)[0]);
