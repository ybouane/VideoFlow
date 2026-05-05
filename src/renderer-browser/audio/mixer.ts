/**
 * Shared audio-mixing helpers used by both `BrowserRenderer` (export) and
 * `DomRenderer` (live preview).
 *
 * The two renderers used to duplicate `generateLayerAudio` and
 * `applyAudioKeyframes` almost verbatim. Consolidating here lets us:
 *
 * 1. Treat groups as audio sub-mixes (mirrors the visual pipeline): a group
 *    renders its children into its own `OfflineAudioContext` first, the
 *    resulting buffer is then placed onto the parent timeline as a single
 *    source so the group's own `volume` / `pan` / `pitch` / `mute` /
 *    transitions apply to the whole sub-mix.
 *
 * 2. Honour `mute` (early bail-out before scheduling).
 *
 * 3. Apply `pitch` independently from `speed` via an offline granular
 *    pitch-shifter (same pre-rendered buffer is then scheduled with
 *    `playbackRate = |speed|`).
 *
 * 4. Sample any property whose curve is altered by a transition (not just
 *    `volume`), letting future audio transitions on `pan` / `pitch` work.
 */

import { loadedMedia } from '@videoflow/core';
import RuntimeBaseLayer from '../layers/RuntimeBaseLayer.js';
import RuntimeGroupLayer from '../layers/RuntimeGroupLayer.js';

// ---------------------------------------------------------------------------
//  Public types
// ---------------------------------------------------------------------------

export interface MixerOptions {
	/** Project frames per second — keyframe → time mapping. */
	fps: number;
	/** Sample rate to use for sub-mix `OfflineAudioContext`s. */
	sampleRate: number;
	/** Whether a layer (and its track) is enabled — both renderers compute this. */
	isLayerEnabled: (l: RuntimeBaseLayer) => boolean;
	/**
	 * Whether to consult `layer.json.settings.audioSource` (pre-extracted WAV)
	 * before falling back to the original media `source`. The export-side
	 * `BrowserRenderer` enables this so headless Chromium can decode WAV when
	 * it can't handle the original container; live `DomRenderer` doesn't.
	 */
	preferAudioSource?: boolean;
}

// ---------------------------------------------------------------------------
//  Layer tree helpers
// ---------------------------------------------------------------------------

/** Recursively check if a layer (or any descendant) produces audio. */
export function layerOrDescendantsHaveAudio(layer: RuntimeBaseLayer): boolean {
	if (layer.hasAudio) return true;
	if (layer instanceof RuntimeGroupLayer) {
		for (const c of layer.children) {
			if (c.json.settings.enabled === false) continue;
			if (layerOrDescendantsHaveAudio(c)) return true;
		}
	}
	return false;
}

// ---------------------------------------------------------------------------
//  Decode
// ---------------------------------------------------------------------------

/**
 * Decode a layer's source audio into an `AudioBuffer` on the given context.
 * Returns null when the layer can't produce decodable audio (no source,
 * decode failure, etc.) — the caller skips scheduling for that layer.
 */
async function decodeLayerAudio(
	layer: RuntimeBaseLayer,
	audioCtx: BaseAudioContext,
	opts: MixerOptions,
): Promise<AudioBuffer | null> {
	const audioSourceUrl = opts.preferAudioSource ? layer.json.settings.audioSource : undefined;
	const sourceUrl = audioSourceUrl || layer.json.settings.source;
	if (!sourceUrl) return null;

	// Reuse a pre-decoded buffer if `RuntimeAudioLayer.initialize` already
	// produced one (deferred sourceEnd resolution path).
	if (!audioSourceUrl) {
		const cached = (layer as any).decodedBuffer as AudioBuffer | null | undefined;
		if (cached) return cached;
	}

	let arrayBuffer: ArrayBuffer;
	const blob = !audioSourceUrl ? ((layer as any).dataBlob as Blob | null) ?? null : null;
	let acquiredFromCache = false;
	if (blob) {
		arrayBuffer = await blob.arrayBuffer();
	} else if (!audioSourceUrl) {
		const entry = await loadedMedia.acquire(sourceUrl);
		acquiredFromCache = true;
		arrayBuffer = await entry.blob.arrayBuffer();
	} else {
		const res = await fetch(audioSourceUrl);
		arrayBuffer = await res.arrayBuffer();
	}

	try {
		return await audioCtx.decodeAudioData(arrayBuffer);
	} catch {
		return null;
	} finally {
		if (acquiredFromCache) loadedMedia.release(sourceUrl);
	}
}

// ---------------------------------------------------------------------------
//  Granular pitch shift (pre-process)
// ---------------------------------------------------------------------------

/**
 * Pitch-shift an `AudioBuffer` by a constant factor while preserving its
 * duration — i.e. pitch becomes independent from `speed`.
 *
 * Implementation: granular synthesis with a Hann-windowed overlap-add.
 * For each output grain at hop `outHop` we read the input at rate `pitch`
 * with linear interpolation, window with a Hann curve, and add into the
 * output. The 75 %-overlap layout (`hopOut = grain/4`) satisfies the COLA
 * condition for Hann, so the overlap-sum forms a flat envelope that we
 * normalise out per-sample (also handles the head/tail edges cleanly).
 *
 * Quality is acceptable for moderate shifts (~0.5×–2×). For larger shifts
 * the granular method introduces audible warble — a phase-vocoder upgrade
 * can replace this without changing the call site.
 */
function pitchShiftBuffer(
	buffer: AudioBuffer,
	ctx: BaseAudioContext,
	pitch: number,
): AudioBuffer {
	if (!Number.isFinite(pitch) || Math.abs(pitch - 1) < 1e-3) return buffer;
	const safePitch = Math.max(0.05, Math.min(8, pitch));

	const n = buffer.length;
	const channels = buffer.numberOfChannels;
	const out = ctx.createBuffer(channels, n, buffer.sampleRate);

	const grain = 2048;
	const hopOut = 512; // 75 % overlap → COLA-valid for Hann
	const window = new Float32Array(grain);
	for (let i = 0; i < grain; i++) {
		window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grain - 1)));
	}

	// Per-sample sum of overlapping Hann weights — used to normalise the
	// overlap-add gain (and naturally tapers the first/last grains).
	const weight = new Float32Array(n);
	for (let s = 0; s < n; s += hopOut) {
		const lim = Math.min(grain, n - s);
		for (let j = 0; j < lim; j++) weight[s + j] += window[j];
	}

	for (let ch = 0; ch < channels; ch++) {
		const inData = buffer.getChannelData(ch);
		const outData = out.getChannelData(ch);

		for (let s = 0; s < n; s += hopOut) {
			const lim = Math.min(grain, n - s);
			for (let j = 0; j < lim; j++) {
				const inIdx = s + j * safePitch;
				if (inIdx < 0) continue;
				const i0 = Math.floor(inIdx);
				if (i0 >= n - 1) break;
				const frac = inIdx - i0;
				const sample = inData[i0] * (1 - frac) + inData[i0 + 1] * frac;
				outData[s + j] += sample * window[j];
			}
		}

		for (let i = 0; i < n; i++) {
			if (weight[i] > 1e-6) outData[i] /= weight[i];
		}
	}

	return out;
}

// ---------------------------------------------------------------------------
//  Speed reversal helper
// ---------------------------------------------------------------------------

/** Build a reversed copy of the buffer (used when `speed < 0`). */
function reverseBuffer(buffer: AudioBuffer, ctx: BaseAudioContext): AudioBuffer {
	const out = ctx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
	for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
		const data = buffer.getChannelData(ch);
		out.copyToChannel(new Float32Array(data).reverse(), ch);
	}
	return out;
}

// ---------------------------------------------------------------------------
//  Keyframe automation
// ---------------------------------------------------------------------------

/**
 * Apply keyframe automation to an `AudioParam`. When the layer carries a
 * `transitionIn` / `transitionOut` we sample the combined keyframe +
 * transition curve at every project frame and emit `setValueAtTime` on
 * change — matching the value the visual `applyTransitions` would produce.
 *
 * Sampling runs for any property (was previously gated to `volume` alone),
 * so future transitions that animate `pan` or other audio params pick up
 * automatically.
 */
export function applyAudioKeyframes(
	layer: RuntimeBaseLayer,
	property: string,
	param: AudioParam,
	fps: number,
): void {
	const hasTransitions = !!(layer.json.transitionIn || layer.json.transitionOut);

	if (hasTransitions) {
		const startFrame = layer.startFrame;
		const endFrame = layer.endFrame;
		if (!(endFrame > startFrame)) return;
		let lastEmitted: number | null = null;
		for (let f = startFrame; f < endFrame; f++) {
			const baseProps = layer.getPropertiesAtFrame(f);
			const finalProps = layer.applyTransitions(f, baseProps);
			const v = Number(finalProps[property] ?? 1);
			if (!Number.isFinite(v)) continue;
			if (lastEmitted !== null && Math.abs(v - lastEmitted) < 1e-4) continue;
			param.setValueAtTime(v, f / fps);
			lastEmitted = v;
		}
		return;
	}

	const anim = layer.json.animations.find(a => a.property === property);
	if (!anim || anim.keyframes.length === 0) return;

	const startTimeSec = layer.startTime;
	const sourceStartSec = layer.sourceStart;
	const sourceDurationSec = layer.sourceDuration;
	const speed = layer.speed;
	const speedAbs = Math.abs(speed) || 1;

	for (const kf of anim.keyframes) {
		const sourceOffsetSec = kf.time - sourceStartSec;
		let timelineSec: number;
		if (speed < 0) {
			timelineSec = startTimeSec + (sourceDurationSec - sourceOffsetSec) / speedAbs;
		} else {
			timelineSec = startTimeSec + sourceOffsetSec / speedAbs;
		}
		if (!Number.isFinite(timelineSec) || timelineSec < 0) continue;
		param.setValueAtTime(Number(kf.value), timelineSec);
	}
}

// ---------------------------------------------------------------------------
//  Property snapshot
// ---------------------------------------------------------------------------

function readMute(layer: RuntimeBaseLayer): boolean {
	const props = layer.json.properties as Record<string, any> | undefined;
	return props?.mute === true;
}

/** Read the layer's pitch (static — animation isn't supported by the granular
 *  shifter; the value at the layer's startFrame is used for the whole clip). */
function readPitch(layer: RuntimeBaseLayer): number {
	const props = layer.getPropertiesAtFrame(layer.startFrame);
	const p = Number(props.pitch);
	return Number.isFinite(p) && p > 0 ? p : 1;
}

// ---------------------------------------------------------------------------
//  Buffer scheduling — applies layer audio properties to a pre-decoded buffer
// ---------------------------------------------------------------------------

/**
 * Schedule an already-decoded buffer onto `audioCtx` with the layer's audio
 * properties applied — `mute`, `speed` (incl. reverse), `pitch`, `volume`
 * (with transition / keyframe automation), and `pan`.
 *
 * Used both when a non-group audio layer's source has just been decoded,
 * and when a group's children have been mixed into a single buffer that the
 * parent now schedules.
 */
function scheduleBufferOnContext(
	layer: RuntimeBaseLayer,
	rawBuffer: AudioBuffer,
	audioCtx: BaseAudioContext,
	opts: MixerOptions,
): void {
	if (readMute(layer)) return;

	const speed = layer.speed;
	if (speed === 0) return;

	let buffer = rawBuffer;
	if (speed < 0) buffer = reverseBuffer(buffer, audioCtx);

	const pitch = readPitch(layer);
	if (pitch !== 1) buffer = pitchShiftBuffer(buffer, audioCtx, pitch);

	const bufferSource = audioCtx.createBufferSource();
	bufferSource.buffer = buffer;
	bufferSource.playbackRate.value = Math.abs(speed);

	const gainNode = audioCtx.createGain();
	gainNode.gain.value = 1;
	applyAudioKeyframes(layer, 'volume', gainNode.gain, opts.fps);

	const panNode = audioCtx.createStereoPanner();
	panNode.pan.value = 0;
	applyAudioKeyframes(layer, 'pan', panNode.pan, opts.fps);

	bufferSource.connect(gainNode).connect(panNode).connect(audioCtx.destination);

	const whenSec = layer.startTime;
	const sourceStartSec = layer.sourceStart;
	const sourceDurationSec = layer.sourceDuration;
	let offsetSec: number;
	if (speed < 0) {
		const totalLen = buffer.duration;
		offsetSec = Math.max(0, totalLen - (sourceStartSec + sourceDurationSec));
	} else {
		offsetSec = sourceStartSec;
	}
	bufferSource.start(whenSec, offsetSec, sourceDurationSec);
}

// ---------------------------------------------------------------------------
//  Group sub-mix
// ---------------------------------------------------------------------------

/**
 * Render a group's audio content into a fresh `AudioBuffer` sized to the
 * group's local source duration. Children are scheduled at their own
 * `startTime` (already group-local). Returns `null` when the group has no
 * audible descendants — the caller skips creating a parent-level source.
 *
 * This mirrors the visual model: a group is a self-contained sub-timeline.
 * Group-level `volume` / `pan` / `pitch` / `mute` / transitions are then
 * applied at the parent level by `mixLayers` via `scheduleBufferOnContext`,
 * exactly as if the group were a regular audio layer.
 */
async function renderGroupAudio(
	group: RuntimeGroupLayer,
	opts: MixerOptions,
): Promise<AudioBuffer | null> {
	const durationSec = group.sourceDuration;
	if (!(durationSec > 0)) return null;

	// Skip the OfflineAudioContext setup when the subtree has no audio at all
	// — `decodeAudioData` is expensive enough to be worth this short-circuit.
	let hasAny = false;
	for (const child of group.children) {
		if (child.json.settings.enabled === false) continue;
		if (layerOrDescendantsHaveAudio(child)) { hasAny = true; break; }
	}
	if (!hasAny) return null;

	const audioCtx = new OfflineAudioContext(
		2,
		Math.ceil(durationSec * opts.sampleRate),
		opts.sampleRate,
	);

	for (const child of group.children) {
		if (child.json.settings.enabled === false) continue;
		try {
			await scheduleLayerOnContext(child, audioCtx, opts);
		} catch (e) {
			console.error(`Error mixing audio for group child ${child.json.id}:`, e);
		}
	}

	return await audioCtx.startRendering();
}

/**
 * Schedule a single layer onto a context — dispatching on layer type. For
 * groups this triggers a recursive sub-mix; for other audio-bearing layers
 * it decodes + schedules in one step.
 */
async function scheduleLayerOnContext(
	layer: RuntimeBaseLayer,
	audioCtx: BaseAudioContext,
	opts: MixerOptions,
): Promise<void> {
	if (layer instanceof RuntimeGroupLayer) {
		const subMix = await renderGroupAudio(layer, opts);
		if (!subMix) return;
		scheduleBufferOnContext(layer, subMix, audioCtx, opts);
		return;
	}
	if (!layer.hasAudio) return;
	const buffer = await decodeLayerAudio(layer, audioCtx, opts);
	if (!buffer) return;
	scheduleBufferOnContext(layer, buffer, audioCtx, opts);
}

// ---------------------------------------------------------------------------
//  Public entry point — render the full top-level mix
// ---------------------------------------------------------------------------

/**
 * Render the mixed audio for an entire top-level layer list. Returns null
 * when nothing audible is present (the renderer then encodes a silent
 * track or omits the audio stream entirely, depending on context).
 */
export async function renderMixedAudio(
	layers: RuntimeBaseLayer[],
	durationSec: number,
	opts: MixerOptions,
): Promise<AudioBuffer | null> {
	if (durationSec <= 0) return null;

	const enabled = layers.filter(opts.isLayerEnabled);
	if (!enabled.some(layerOrDescendantsHaveAudio)) return null;

	const audioCtx = new OfflineAudioContext(
		2,
		Math.ceil(durationSec * opts.sampleRate),
		opts.sampleRate,
	);

	for (const layer of enabled) {
		try {
			await scheduleLayerOnContext(layer, audioCtx, opts);
		} catch (e) {
			console.error(`Error generating audio for layer ${layer.json.id}:`, e);
		}
	}

	return await audioCtx.startRendering();
}
