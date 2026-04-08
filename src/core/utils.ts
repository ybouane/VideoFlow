/**
 * Utility functions for VideoFlow.
 *
 * Centralises time conversion, WAV encoding, and small helpers used across the
 * core and renderer packages.
 */

import type { Time } from './types.js';

// ---------------------------------------------------------------------------
//  Time helpers
// ---------------------------------------------------------------------------

/**
 * Parse a flexible {@link Time} value into seconds.
 *
 * Accepted formats:
 * - `number` — seconds directly
 * - `"5"` — seconds (unitless string)
 * - `"5s"` / `"2m"` / `"1h"` / `"500ms"` — seconds / minutes / hours / ms
 * - `"120f"` — frames, requires `fps` parameter
 * - `"mm:ss"` / `"hh:mm:ss"` / `"hh:mm:ss:ff"` — colon-separated
 *
 * @param time - The value to parse.
 * @param fps  - Frames per second (needed when the value ends with `"f"` or
 *               contains a frames component in `hh:mm:ss:ff`).
 * @returns The equivalent time in seconds.
 */
export function parseTime(time: Time, fps: number = 30): number {
	if (typeof time === 'number') return time;
	const t = String(time).trim();

	// Colon-separated: mm:ss, hh:mm:ss, hh:mm:ss:ff
	if (/^[\d:]+$/.test(t) && t.includes(':')) {
		const parts = t.split(':').map(Number);
		let hours = 0, minutes = 0, seconds = 0, frames = 0;
		if (parts.length === 2) {
			[minutes, seconds] = parts;
		} else if (parts.length === 3) {
			[hours, minutes, seconds] = parts;
		} else if (parts.length === 4) {
			[hours, minutes, seconds, frames] = parts;
		}
		return hours * 3600 + minutes * 60 + seconds + frames / fps;
	}

	// Frames: "120f"
	if (t.endsWith('f')) {
		return parseFloat(t.slice(0, -1)) / fps;
	}
	// Milliseconds: "500ms"
	if (t.endsWith('ms')) {
		return parseFloat(t.slice(0, -2)) / 1000;
	}
	// Hours: "1h"
	if (t.endsWith('h')) {
		return parseFloat(t.slice(0, -1)) * 3600;
	}
	// Minutes: "2m"
	if (t.endsWith('m')) {
		return parseFloat(t.slice(0, -1)) * 60;
	}
	// Seconds: "5s"
	if (t.endsWith('s')) {
		return parseFloat(t.slice(0, -1));
	}
	// Plain number string
	if (/^[\d.]+$/.test(t)) {
		return parseFloat(t);
	}
	throw new Error(`Invalid time format: "${time}"`);
}

/**
 * Convert a {@link Time} value to a frame number.
 *
 * @param time - Flexible time value.
 * @param fps  - Frames per second.
 * @returns The nearest integer frame number.
 */
export function timeToFrames(time: Time, fps: number): number {
	return Math.round(parseTime(time, fps) * fps);
}

/**
 * Convert a frame number back to seconds.
 *
 * @param frames - Frame number.
 * @param fps    - Frames per second.
 */
export function framesToTime(frames: number, fps: number): number {
	return frames / fps;
}

/**
 * Format a duration in seconds as a human-readable `mm:ss` or `hh:mm:ss` string.
 */
export function formatTime(seconds: number): string {
	const h = Math.floor(seconds / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
	return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
//  WAV encoder
// ---------------------------------------------------------------------------

/**
 * Encode an AudioBuffer into a WAV ArrayBuffer.
 *
 * Supports mono and stereo buffers.  Output is 16-bit PCM by default; pass
 * `{ float32: true }` for 32-bit IEEE float.
 *
 * @param buffer - The Web Audio API AudioBuffer to encode.
 * @param opt    - Optional encoding settings.
 * @returns A WAV file as an ArrayBuffer.
 */
export function audioBufferToWav(buffer: AudioBuffer, opt?: { float32?: boolean }): ArrayBuffer {
	opt = opt || {};
	const numChannels = buffer.numberOfChannels;
	const sampleRate = buffer.sampleRate;
	const format = opt.float32 ? 3 : 1;
	const bitDepth = format === 3 ? 32 : 16;

	let result: Float32Array;
	if (numChannels === 2) {
		result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
	} else {
		result = buffer.getChannelData(0);
	}
	return encodeWAV(result, format, sampleRate, numChannels, bitDepth);
}

/** Interleave two mono channel arrays into a stereo array. */
function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
	const length = inputL.length + inputR.length;
	const result = new Float32Array(length);
	let index = 0, inputIndex = 0;
	while (index < length) {
		result[index++] = inputL[inputIndex];
		result[index++] = inputR[inputIndex];
		inputIndex++;
	}
	return result;
}

/** Low-level WAV encoding. */
function encodeWAV(samples: Float32Array, format: number, sampleRate: number, numChannels: number, bitDepth: number): ArrayBuffer {
	const bytesPerSample = bitDepth / 8;
	const blockAlign = numChannels * bytesPerSample;
	const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
	const view = new DataView(buffer);

	writeString(view, 0, 'RIFF');
	view.setUint32(4, 36 + samples.length * bytesPerSample, true);
	writeString(view, 8, 'WAVE');
	writeString(view, 12, 'fmt ');
	view.setUint32(16, 16, true);
	view.setUint16(20, format, true);
	view.setUint16(22, numChannels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * blockAlign, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitDepth, true);
	writeString(view, 36, 'data');
	view.setUint32(40, samples.length * bytesPerSample, true);

	if (format === 1) {
		floatTo16BitPCM(view, 44, samples);
	} else {
		writeFloat32(view, 44, samples);
	}
	return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}

function writeFloat32(output: DataView, offset: number, input: Float32Array): void {
	for (let i = 0; i < input.length; i++, offset += 4) {
		output.setFloat32(offset, input[i], true);
	}
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array): void {
	for (let i = 0; i < input.length; i++, offset += 2) {
		const s = Math.max(-1, Math.min(1, input[i]));
		output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
	}
}

// ---------------------------------------------------------------------------
//  Misc
// ---------------------------------------------------------------------------

/**
 * Create a deferred promise — a Promise whose `resolve` / `reject` methods
 * are exposed on the returned object.
 */
export function createDeferred<T = void>(): Promise<T> & { resolve: (value: T) => void; reject: (reason?: any) => void } {
	let resolve!: (value: T) => void;
	let reject!: (reason?: any) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	}) as any;
	promise.resolve = resolve;
	promise.reject = reject;
	return promise;
}

/** Small async delay helper. */
export function delay(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
//  Media metadata probing
// ---------------------------------------------------------------------------

/**
 * Probe the intrinsic duration of a media source (in seconds).
 *
 * Environment-aware:
 * - **Browser**: spins up a transient `<video>` or `<audio>` element, waits
 *   for `loadedmetadata`, reads `.duration`, then disposes of the element.
 * - **Node**: dynamically imports `child_process` and spawns `ffprobe -v error
 *   -of json -show_format <source>`, parsing `format.duration` from the JSON.
 *   Requires `ffprobe` to be installed and available on PATH (the same binary
 *   `@videoflow/renderer-server` already depends on).
 *
 * Throws on any failure (missing binary, network error, decode failure).
 * Callers should catch and decide whether to fall back to "unknown duration".
 *
 * @param source - URL or filesystem path to the media file.
 * @param kind   - `'video'` or `'audio'` (only matters for the browser path).
 */
export async function probeMediaDuration(
	source: string,
	kind: 'video' | 'audio'
): Promise<number> {
	const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

	if (isBrowser) {
		// Fetch the bytes ourselves and seed the global media cache so the
		// renderer (and any other consumer) can reuse them without a second
		// network round-trip. We then read .duration from a transient
		// HTMLMediaElement pointed at the entry's shared object URL.
		const { loadedMedia } = await import('./MediaCache.js');
		const response = await fetch(source, { cache: 'default' });
		if (!response.ok) {
			throw new Error(`probeMediaDuration: failed to fetch "${source}": ${response.status} ${response.statusText}`);
		}
		const blob = await response.blob();
		const entry = await loadedMedia.populate(source, blob);

		const duration = await new Promise<number>((resolve, reject) => {
			const el = document.createElement(kind) as HTMLMediaElement;
			el.preload = 'metadata';
			el.muted = true;
			(el as HTMLVideoElement).playsInline = true;
			const cleanup = () => {
				el.removeAttribute('src');
				try { el.load(); } catch {}
			};
			el.onloadedmetadata = () => {
				const d = el.duration;
				cleanup();
				if (Number.isFinite(d) && d > 0) resolve(d);
				else reject(new Error(`probeMediaDuration: invalid duration for "${source}"`));
			};
			el.onerror = () => {
				cleanup();
				reject(new Error(`probeMediaDuration: failed to load "${source}"`));
			};
			el.src = entry.objectUrl;
		});

		// Write the duration back into the cache entry so future consumers
		// see it without having to re-decode metadata.
		await loadedMedia.populate(source, blob, duration);
		return duration;
	}

	// Node path — ffprobe via child_process. Built at runtime so bundlers
	// (Vite, webpack) cannot statically analyse the dynamic import.
	const cpName = ['child', 'process'].join('_');
	const { spawn } = await import(/* @vite-ignore */ /* webpackIgnore: true */ cpName);

	return await new Promise<number>((resolve, reject) => {
		let stdout = '';
		let stderr = '';
		let proc;
		try {
			proc = spawn('ffprobe', [
				'-v', 'error',
				'-of', 'json',
				'-show_format',
				source,
			]);
		} catch (e: any) {
			reject(new Error(`probeMediaDuration: failed to spawn ffprobe (${e?.message ?? e})`));
			return;
		}
		proc.stdout.on('data', (chunk: any) => { stdout += chunk.toString(); });
		proc.stderr.on('data', (chunk: any) => { stderr += chunk.toString(); });
		proc.on('error', (err: any) => {
			reject(new Error(`probeMediaDuration: ffprobe error for "${source}": ${err?.message ?? err}`));
		});
		proc.on('close', (code: number) => {
			if (code !== 0) {
				reject(new Error(`probeMediaDuration: ffprobe exited ${code} for "${source}": ${stderr.trim()}`));
				return;
			}
			try {
				const parsed = JSON.parse(stdout);
				const d = parseFloat(parsed?.format?.duration);
				if (Number.isFinite(d) && d > 0) resolve(d);
				else reject(new Error(`probeMediaDuration: no duration in ffprobe output for "${source}"`));
			} catch (e: any) {
				reject(new Error(`probeMediaDuration: failed to parse ffprobe JSON for "${source}": ${e?.message ?? e}`));
			}
		});
	});
}
