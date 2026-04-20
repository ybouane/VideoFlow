/**
 * Web Player Example — demonstrates @videoflow/renderer-dom.
 *
 * Loads example projects via a dropdown, compiles them to VideoJSON,
 * and plays them back with a DomRenderer.
 */

import DomRenderer from '@videoflow/renderer-dom';
import BrowserRenderer from '@videoflow/renderer-browser';

import { createProject as basicText } from '../01-basic-text.js';
import { createProject as imageBackground } from '../02-image-background.js';
import { createProject as videoWithAudio } from '../03-video-with-audio.js';
import { createProject as captions } from '../04-captions.js';
import { createProject as parallelAnimations } from '../05-parallel-animations.js';
import { createProject as transitions } from '../08-transitions.js';
import { createProject as effects } from '../09-effects.js';

const EXAMPLES: Record<string, () => any> = {
	'01 — Basic Text': basicText,
	'02 — Image Background': imageBackground,
	'03 — Video with Audio': videoWithAudio,
	'04 — Captions': captions,
	'05 — Parallel Animations': parallelAnimations,
	'08 — Transitions': transitions,
	'09 — Effects': effects,
};

const $status = document.getElementById('status')!;
const $player = document.getElementById('player')!;
const $btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
const $btnStop = document.getElementById('btn-stop') as HTMLButtonElement;
const $seek = document.getElementById('seek') as HTMLInputElement;
const $time = document.getElementById('time')!;
const $fps = document.getElementById('fps-display')!;
const $select = document.getElementById('example-select') as HTMLSelectElement;
const $btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
const $exportModal = document.getElementById('export-modal')!;
const $exportTitle = document.getElementById('export-title')!;
const $exportProgressBar = document.getElementById('export-progress-bar')!;
const $exportProgressText = document.getElementById('export-progress-text')!;
const $exportCancel = document.getElementById('export-cancel')!;

let renderer: DomRenderer | null = null;
let currentVideoJSON: any = null;

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
		console.log('Compiled VideoJSON:', videoJSON);
		currentVideoJSON = videoJSON;

		$status.textContent = 'Loading...';
		renderer = new DomRenderer($player);
		renderer.onFrame = () => {
			if (!seeking) {
				$seek.value = String(renderer!.currentFrame);
				updateTimeDisplay();
			}
		};
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
		await renderer.play({
			fpsCallback: (fps) => {
				$fps.textContent = `${Math.min(60, Math.round(fps))} fps`;
			},
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
	} else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
		if (!renderer) return;
		e.preventDefault();
		if (renderer.playing) {
			renderer.stop();
			$btnPlay.textContent = 'Play';
			$btnPlay.classList.remove('active');
		}
		const total = renderer.totalFrames;
		if (total === 0) return;
		const delta = e.code === 'ArrowRight' ? 1 : -1;
		const next = ((renderer.currentFrame + delta) % total + total) % total;
		renderer.renderFrame(next);
		$seek.value = String(next);
		updateTimeDisplay();
	}
});

let wasPlayingBeforeSeek = false;

$seek.addEventListener('pointerdown', () => {
	if (!renderer) return;
	seeking = true;
	wasPlayingBeforeSeek = renderer.playing;
	if (wasPlayingBeforeSeek) renderer.stop();
});

$seek.addEventListener('input', () => {
	if (!renderer) return;
	seeking = true;
	renderer.renderFrame(parseInt($seek.value, 10));
	updateTimeDisplay();
});

$seek.addEventListener('change', () => {
	seeking = false;
	if (wasPlayingBeforeSeek && renderer && !renderer.playing) {
		wasPlayingBeforeSeek = false;
		renderer.play({
			fpsCallback: (fps) => {
				$fps.textContent = `${Math.min(60, Math.round(fps))} fps`;
			},
		});
	}
});

$select.addEventListener('change', () => { loadExample($select.value); });

// -----------------------------------------------------------------------
//  Export / Download
// -----------------------------------------------------------------------

let exportAbortController: AbortController | null = null;

$btnDownload.addEventListener('click', startExport);
$exportCancel.addEventListener('click', cancelExport);

// Close modal on overlay click (outside the modal box)
$exportModal.addEventListener('click', (e) => {
	if (e.target === $exportModal) cancelExport();
});

async function startExport() {
	if (!currentVideoJSON) return;

	// Pause playback if running
	if (renderer?.playing) {
		renderer.stop();
		$btnPlay.textContent = 'Play';
		$btnPlay.classList.remove('active');
	}

	// Show modal
	exportAbortController = new AbortController();
	$exportModal.hidden = false;
	$exportTitle.textContent = 'Exporting video\u2026';
	$exportProgressBar.style.width = '0%';
	$exportProgressText.textContent = '0%';
	$exportCancel.textContent = 'Cancel';

	try {
		const blob = await BrowserRenderer.render(currentVideoJSON, {
			signal: exportAbortController.signal,
			onProgress: (progress: number) => {
				const pct = Math.round(progress * 100);
				$exportProgressBar.style.width = `${pct}%`;
				$exportProgressText.textContent = `${pct}%`;
			},
		});

		// Download the file
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${$select.value.replace(/[^a-zA-Z0-9-_ ]/g, '')}.mp4`;
		a.click();
		URL.revokeObjectURL(url);

		// Show success briefly
		$exportTitle.textContent = 'Export complete!';
		$exportProgressBar.style.width = '100%';
		$exportProgressText.textContent = '100%';
		$exportCancel.textContent = 'Close';
	} catch (err: any) {
		if (err.name === 'AbortError' || exportAbortController.signal.aborted) {
			// User cancelled — modal already closing
			return;
		}
		$exportTitle.textContent = 'Export failed';
		$exportProgressText.textContent = String(err.message || err);
		$exportCancel.textContent = 'Close';
		console.error('Export error:', err);
	}
}

function cancelExport() {
	if (exportAbortController) {
		exportAbortController.abort();
		exportAbortController = null;
	}
	$exportModal.hidden = true;
}

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
