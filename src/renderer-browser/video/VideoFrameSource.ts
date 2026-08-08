/**
 * VideoFrameSource — frame-accurate video decoding that adapts to the access
 * pattern instead of seeking blindly.
 *
 * ## Why this exists
 *
 * The obvious way to render frame N of a video layer is
 * `video.currentTime = t` plus `requestVideoFrameCallback`. Every one of those
 * is a *seek*, and a seek re-decodes from the preceding keyframe — so
 * rendering a clip forward one frame at a time costs `O(frames × GOP)` instead
 * of `O(frames)`. Measured on a 1080p H.264 clip with a 250-frame GOP (what a
 * stock x264 encode produces):
 *
 * ```
 *   seek per frame, forward 30fps    207.7 ms/frame
 *   sequential decode, same frames    15.6 ms/frame     13x
 * ```
 *
 * The decoder was never the bottleneck — the access pattern was. Point-access
 * decoding through WebCodecs measures 206 ms/frame, i.e. exactly as slow as
 * the `<video>` seek it would replace. What matters is decoding each packet at
 * most once, which is only possible when consecutive requests move forward.
 *
 * ## How it adapts
 *
 * Callers don't declare a schedule (that would have to be threaded through
 * group nesting, speed ramps and trims). This class watches the timestamps it
 * is asked for and switches strategy:
 *
 * - **Forward** — the common case, and every export. Holds an open
 *   presentation-order iterator and advances it, decoding each packet once.
 *   Samples stepped over are closed immediately; only the one being displayed
 *   is retained. A request landing inside the frame already in hand is free.
 * - **Reverse** — after {@link REVERSE_DETECT_STEPS} consecutive backward
 *   steps (a layer with negative `speed`), decodes a *forward* window into
 *   retained copies and serves it backwards: ~53 ms/frame versus ~276 ms/frame
 *   for naive per-frame reverse access.
 *
 * Scrubbing needs no special case: a backward jump simply restarts the
 * iterator, which costs the same keyframe seek the old `<video>` path paid
 * for every frame. (A decoded-frame LRU would make dragging back and forth
 * over one region cheaper still — worth adding once something drives it.)
 *
 * Restarting the forward iterator costs a keyframe seek, so a long forward
 * jump prefers a restart over decoding through the gap
 * (see {@link MAX_FORWARD_SKIP_FRAMES}).
 *
 * ## Why samples rather than canvases
 *
 * Mediabunny's `CanvasSink` converts *every* decoded frame to a canvas. When
 * the project samples a 60 fps source at 30 fps that doubles the conversion
 * work for frames which are then thrown away — measured at 37.5 ms/frame
 * versus 15.6. Decoding through `VideoSampleSink` and calling
 * {@link VideoSample.draw} straight into the layer's canvas converts only the
 * frames actually displayed.
 */

import {
	ALL_FORMATS,
	BlobSource,
	Input,
	VideoSampleSink,
	type InputVideoTrack,
	type VideoSample,
} from 'mediabunny';

/**
 * Consecutive backward requests before we conclude the layer is playing in
 * reverse. Two distinguishes a genuine reverse ramp from a one-off scrub, and
 * is cheap to be wrong about.
 */
const REVERSE_DETECT_STEPS = 2;

/**
 * How many frames the forward iterator will decode through to reach a request
 * before re-seeking instead. Decoding a frame beats a keyframe seek, but only
 * up to a point.
 */
const MAX_FORWARD_SKIP_FRAMES = 60;

/** Frames decoded per window when serving reverse playback. */
const REVERSE_WINDOW_FRAMES = 12;

/** Assumed frame duration when a sample reports none, used for skip budgeting. */
const FALLBACK_FRAME_DURATION = 1 / 30;

type Mode = 'forward' | 'reverse';
type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export default class VideoFrameSource {
	private input: Input;
	private sink: VideoSampleSink;

	/** Intrinsic display size in pixels. */
	readonly dimensions: [number, number];
	/** Track duration in seconds. */
	readonly duration: number;

	/** Open presentation-order iterator for the forward path. */
	private iterator: AsyncGenerator<VideoSample, void, unknown> | null = null;
	/** The sample currently in hand. Owned by us — closed when superseded. */
	private current: VideoSample | null = null;
	/** True once the iterator has run past the end of the track. */
	private exhausted = false;

	private mode: Mode = 'forward';
	/** Timestamp of the previous request, for direction detection. */
	private lastRequest = -Infinity;
	/** Consecutive backward steps seen so far. */
	private backwardRun = 0;

	/** Buffered window for reverse playback, ascending by timestamp. */
	private reverseWindow: { times: number[]; frames: (OffscreenCanvas | null)[] } | null = null;
	/** Scratch canvases backing the reverse window, reused across windows. */
	private reversePool: OffscreenCanvas[] = [];

	private destroyed = false;

	private constructor(input: Input, track: InputVideoTrack, dimensions: [number, number], duration: number) {
		this.input = input;
		this.sink = new VideoSampleSink(track);
		this.dimensions = dimensions;
		this.duration = duration;
	}

	/**
	 * Build a frame source over already-fetched bytes.
	 *
	 * Resolves `null` — never throws — when the file cannot be demuxed or the
	 * codec has no WebCodecs decoder on this platform. Callers treat that as
	 * "fall back to a `<video>` element".
	 */
	static async create(blob: Blob): Promise<VideoFrameSource | null> {
		if (typeof VideoDecoder === 'undefined') return null;
		let input: Input | null = null;
		try {
			input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
			const track = await input.getPrimaryVideoTrack();
			if (!track) throw new Error('no video track');
			if (!(await track.canDecode())) throw new Error('codec not decodable here');
			const dimensions: [number, number] = [track.displayWidth, track.displayHeight];
			if (!dimensions[0] || !dimensions[1]) throw new Error('track has no display size');
			const duration = await track.computeDuration();
			return new VideoFrameSource(input, track, dimensions, duration);
		} catch {
			try { input?.dispose?.(); } catch { /* ignore */ }
			return null;
		}
	}

	/**
	 * Draw the frame covering source-time `time` (seconds) into `ctx`.
	 *
	 * Returns `false` when nothing could be decoded there, in which case the
	 * caller should leave whatever it had on screen rather than clearing —
	 * a dropped frame is far less visible than a black flash.
	 */
	async drawInto(ctx: Ctx2D, time: number, dWidth: number, dHeight: number): Promise<boolean> {
		if (this.destroyed) return false;
		const t = Math.max(0, time);

		// Direction tracking drives mode selection. A request landing inside
		// the frame already in hand is neither forward nor backward.
		if (this.lastRequest !== -Infinity && t < this.lastRequest && !this.holds(t)) {
			this.backwardRun++;
		} else if (t > this.lastRequest) {
			this.backwardRun = 0;
		}
		this.lastRequest = t;

		if (this.backwardRun >= REVERSE_DETECT_STEPS && this.mode !== 'reverse') {
			this.mode = 'reverse';
			this.closeIterator();
		} else if (this.backwardRun === 0 && this.mode === 'reverse') {
			this.mode = 'forward';
			this.reverseWindow = null;
		}

		try {
			if (this.mode === 'reverse') return await this.drawReverse(ctx, t, dWidth, dHeight);
			return await this.drawForward(ctx, t, dWidth, dHeight);
		} catch {
			// A decode error must never take the render down.
			return false;
		}
	}

	/** Whether the sample currently in hand already covers `t`. */
	private holds(t: number): boolean {
		const s = this.current;
		if (!s) return false;
		const dur = s.duration > 0 ? s.duration : FALLBACK_FRAME_DURATION;
		return t >= s.timestamp && t < s.timestamp + dur;
	}

	/**
	 * Forward path: advance the open iterator to `t`, decoding each packet
	 * once and closing everything stepped over.
	 */
	private async drawForward(ctx: Ctx2D, t: number, dw: number, dh: number): Promise<boolean> {
		if (this.holds(t)) return this.paint(ctx, dw, dh);

		const needsRestart =
			!this.iterator ||
			this.exhausted ||
			!this.current ||
			t < this.current.timestamp ||
			this.skipBudgetExceeded(t);

		if (needsRestart) await this.restartIterator(t);

		while (this.iterator && !this.exhausted) {
			if (this.current) {
				if (this.holds(t)) break;
				// A sample starting after `t` means `t` falls in a gap before
				// it — use it rather than trying to decode backwards.
				if (this.current.timestamp > t) break;
			}
			const next = await this.iterator.next();
			if (next.done) { this.exhausted = true; break; }
			this.setCurrent(next.value);
		}
		return this.paint(ctx, dw, dh);
	}

	/** Draw the sample in hand, if any. */
	private paint(ctx: Ctx2D, dw: number, dh: number): boolean {
		if (!this.current) return false;
		this.current.draw(ctx, 0, 0, dw, dh);
		return true;
	}

	/** Adopt `sample` as the current frame, closing the one it replaces. */
	private setCurrent(sample: VideoSample | null): void {
		if (this.current && this.current !== sample) {
			try { this.current.close(); } catch { /* ignore */ }
		}
		this.current = sample;
	}

	/** Would reaching `t` from the current position decode too many frames? */
	private skipBudgetExceeded(t: number): boolean {
		if (!this.current) return true;
		const dur = this.current.duration > 0 ? this.current.duration : FALLBACK_FRAME_DURATION;
		return (t - this.current.timestamp) / dur > MAX_FORWARD_SKIP_FRAMES;
	}

	/** Close any open iterator and open a fresh one starting at `t`. */
	private async restartIterator(t: number): Promise<void> {
		this.closeIterator();
		this.iterator = this.sink.samples(t);
		this.exhausted = false;
		const first = await this.iterator.next();
		if (first.done) { this.exhausted = true; return; }
		this.setCurrent(first.value);
	}

	private closeIterator(): void {
		const it = this.iterator;
		this.iterator = null;
		this.setCurrent(null);
		this.exhausted = false;
		// `return()` lets the generator release the decoder's in-flight frames.
		// Fire and forget — awaiting a teardown would stall the render.
		if (it) { try { void it.return(undefined as never); } catch { /* ignore */ } }
	}

	/**
	 * Reverse path: decode a forward window into retained copies once, then
	 * serve it backwards. Copies are required because samples must be closed
	 * promptly — holding a dozen open `VideoFrame`s would exhaust the
	 * decoder's pool.
	 */
	private async drawReverse(ctx: Ctx2D, t: number, dw: number, dh: number): Promise<boolean> {
		let w = this.reverseWindow;
		if (!w || t < w.times[0] || t > w.times[w.times.length - 1]) {
			await this.fillReverseWindow(t);
			w = this.reverseWindow;
		}
		if (!w) return false;
		const idx = nearestIndex(w.times, t);
		const frame = idx >= 0 ? w.frames[idx] : null;
		if (!frame) return false;
		ctx.drawImage(frame, 0, 0, dw, dh);
		return true;
	}

	/** Decode `[t - window, t]` forward into retained copies. */
	private async fillReverseWindow(t: number): Promise<void> {
		const step = this.frameDurationHint();
		const start = Math.max(0, t - step * (REVERSE_WINDOW_FRAMES - 1));
		const times: number[] = [];
		for (let i = 0; i < REVERSE_WINDOW_FRAMES; i++) {
			const ts = start + i * step;
			if (ts > t + step * 0.5) break;
			times.push(+ts.toFixed(6));
		}
		if (times.length === 0) { this.reverseWindow = null; return; }

		const frames: (OffscreenCanvas | null)[] = [];
		let i = 0;
		for await (const sample of this.sink.samplesAtTimestamps(times)) {
			if (sample) {
				frames.push(this.retain(sample, i));
				try { sample.close(); } catch { /* ignore */ }
			} else {
				frames.push(null);
			}
			if (++i >= times.length) break;
		}
		while (frames.length < times.length) frames.push(null);
		this.reverseWindow = { times, frames };
	}

	/** Best-effort intrinsic frame duration. */
	private frameDurationHint(): number {
		const d = this.current?.duration;
		return d && d > 0 ? d : FALLBACK_FRAME_DURATION;
	}

	/** Copy a sample into a pooled scratch canvas we own. */
	private retain(sample: VideoSample, slot: number): OffscreenCanvas {
		const [w, h] = this.dimensions;
		let c = this.reversePool[slot];
		if (!c || c.width !== w || c.height !== h) {
			c = new OffscreenCanvas(w, h);
			this.reversePool[slot] = c;
		}
		const cctx = c.getContext('2d')!;
		cctx.clearRect(0, 0, w, h);
		sample.draw(cctx, 0, 0, w, h);
		return c;
	}

	/** Release the demuxer, decoder and every retained frame. */
	destroy(): void {
		if (this.destroyed) return;
		this.destroyed = true;
		this.closeIterator();
		this.reverseWindow = null;
		this.reversePool = [];
		try { this.input.dispose?.(); } catch { /* ignore */ }
	}
}

/** Index of the entry in ascending `times` closest to `t`. */
function nearestIndex(times: number[], t: number): number {
	let best = -1, bestD = Infinity;
	for (let i = 0; i < times.length; i++) {
		const d = Math.abs(times[i] - t);
		if (d < bestD) { bestD = d; best = i; }
	}
	return best;
}
