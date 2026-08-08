/**
 * RuntimeVideoLayer — runtime class for video layers.
 *
 * Loads a video and exposes it as a per-frame-redrawn `<canvas>` plus an
 * audio source.
 *
 * ## Decode strategy
 *
 * The primary path is {@link VideoFrameSource} — a WebCodecs decoder that
 * adapts to the access pattern, decoding each packet at most once while the
 * layer plays forward. This replaced a `currentTime` seek per frame, which
 * re-decoded from the preceding keyframe every time and cost `O(frames × GOP)`
 * for what is an inherently sequential job. On a 1080p H.264 clip with a
 * 250-frame GOP, forward playback went from 207.7 ms/frame to 15.6 ms/frame.
 *
 * Two `<video>` elements remain as a **fallback** for sources WebCodecs cannot
 * decode on the current platform (exotic codecs, no `VideoDecoder`). They are
 * only created when the frame source declines the file, so the common path
 * allocates no media elements at all. The fallback keeps the original
 * ping-pong seek behaviour, including {@link enterSmoothPlayback} for live
 * preview.
 *
 * Smooth playback is a no-op when the frame source is active: sequential
 * WebCodecs decoding already matches native `<video>.play()` throughput
 * (17.4 vs 14.5 ms/frame measured) while staying frame-deterministic, so
 * there is nothing to trade accuracy for.
 */

import { loadedMedia } from '@videoflow/core';
import RuntimeMediaLayer from './RuntimeMediaLayer.js';
import VideoFrameSource from '../video/VideoFrameSource.js';

export default class RuntimeVideoLayer extends RuntimeMediaLayer {
	get hasAudio(): boolean { return true; }

	/** Video frames change every frame regardless of property equality. */
	get cacheable(): boolean { return false; }

	/**
	 * WebCodecs decoder for this layer's source. `null` when the codec has no
	 * decoder here, in which case the `<video>` fallback below is used.
	 */
	private frameSource: VideoFrameSource | null = null;

	/** Dual video elements for decode-ahead buffering. */
	private vidA: HTMLVideoElement | null = null;
	private vidB: HTMLVideoElement | null = null;

	/** Track which time each video element is targeted to. */
	private vidATargetTime: number = -Infinity;
	private vidBTargetTime: number = -Infinity;

	/** Decode completion promises for each video. */
	private vidAReady: Promise<void> = Promise.resolve();
	private vidBReady: Promise<void> = Promise.resolve();

	/**
	 * When true, `renderFrame` drives `vidA` via native `<video>.play()` and
	 * just samples whatever the decoder has presented, with periodic drift
	 * correction. When false (the default — used by export and by scrubbing /
	 * non-1x preview), each frame issues a `currentTime` seek for
	 * frame-deterministic decode.
	 */
	private smoothMode: boolean = false;

	async initialize(): Promise<void> {
		if (this.cacheEntry) return; // Idempotent — already initialised.
		const source = this.json.settings.source;
		if (!source) return;

		this.cacheEntry = await loadedMedia.acquire(source);
		// If a previous layer already wrote dimensions/duration into the
		// shared entry, we can read them back without waiting for oncanplay.
		if (this.cacheEntry.dimensions) {
			this.dimensions = [...this.cacheEntry.dimensions];
		}
		if (this.cacheEntry.duration > 0) {
			this.duration = this.cacheEntry.duration;
		}

		// Preferred path: WebCodecs. Metadata comes straight off the demuxed
		// track, so there is no `oncanplay` round-trip and no media element.
		this.frameSource = await VideoFrameSource.create(this.cacheEntry.blob);
		if (this.frameSource) {
			this.dimensions = [...this.frameSource.dimensions];
			if (this.frameSource.duration > 0) this.duration = this.frameSource.duration;
			if (this.cacheEntry) {
				if (!this.cacheEntry.dimensions) {
					this.cacheEntry.dimensions = [this.dimensions[0], this.dimensions[1]];
				}
				if (!(this.cacheEntry.duration > 0)) {
					this.cacheEntry.duration = this.duration;
				}
			}
			return;
		}

		// Fallback: create both video elements for decode-ahead buffering. We attach
		// `oncanplay` / `onerror` BEFORE assigning `src`, otherwise a fast
		// blob: load can fire the event before the listener is in place and
		// the awaiting promise hangs forever.
		const createVideoElement = (): HTMLVideoElement => {
			const vid = document.createElement('video');
			vid.controls = false;
			vid.autoplay = false;
			vid.loop = false;
			vid.muted = true;
			vid.defaultMuted = true;
			vid.playsInline = true;
			return vid;
		};

		this.vidA = createVideoElement();
		this.vidB = createVideoElement();
		this.internalMedia = this.vidA; // For backward compatibility

		// Wire up the readiness promises FIRST, then trigger the loads.
		const readyA = new Promise<void>((resolve, reject) => {
			this.vidA!.oncanplay = () => {
				this.dimensions = [this.vidA!.videoWidth, this.vidA!.videoHeight];
				this.duration = this.vidA!.duration;
				// Write back into the shared cache entry so other layers
				// using the same source can skip the metadata wait.
				if (this.cacheEntry) {
					if (!this.cacheEntry.dimensions) {
						this.cacheEntry.dimensions = [this.dimensions[0], this.dimensions[1]];
					}
					if (!(this.cacheEntry.duration > 0)) {
						this.cacheEntry.duration = this.duration;
					}
				}
				resolve();
			};
			this.vidA!.onerror = () => reject(new Error(`Failed to load video: ${source}`));
		});
		const readyB = new Promise<void>((resolve, reject) => {
			this.vidB!.oncanplay = () => resolve();
			this.vidB!.onerror = () => reject(new Error(`Failed to load video: ${source}`));
		});

		this.vidA.src = this.cacheEntry!.objectUrl;
		this.vidB.src = this.cacheEntry!.objectUrl;

		await Promise.all([readyA, readyB]);
	}

	/**
	 * Create the canvas, size it to the source video, and create the 2D
	 * context. Idempotent: subsequent calls return the already-prepared
	 * element without touching `width` / `height`, which would clear the
	 * canvas bitmap.
	 */
	async generateElement(): Promise<HTMLElement | null> {
		if (this.$element && this.ctx) return this.$element;
		const $ele = await super.generateElement();
		if (!$ele) return $ele;
		const canvas = $ele as HTMLCanvasElement;
		canvas.width = this.dimensions[0];
		canvas.height = this.dimensions[1];
		this.ctx = canvas.getContext('2d')!;
		this.ctx.imageSmoothingEnabled = true;
		// Layer canvas is sized to the source video's intrinsic dims so the
		// per-frame draw is a 1:1 copy — smoothing quality is effectively
		// irrelevant. `'low'` is cheaper to set up across browsers and avoids
		// any path that would Lanczos-resample.
		this.ctx.imageSmoothingQuality = 'low';
		return $ele;
	}

	/**
	 * Override resetCSSProperties to set object dimensions for fit calculations.
	 */
	resetCSSProperties(): void {
		super.resetCSSProperties();
		if (this.$element) {
			this.$element.style.setProperty('--object-width', String(this.dimensions[0]));
			this.$element.style.setProperty('--object-height', String(this.dimensions[1]));
		}
	}

	/**
	 * Seek a video to a target time and return a promise that resolves
	 * when the frame is decoded and ready to display.
	 */
	private seekVideo(vid: HTMLVideoElement, targetTime: number): Promise<void> {
		vid.pause();
		return new Promise<void>((resolve) => {
			const timeout = setTimeout(() => resolve(), 2000);
			vid.requestVideoFrameCallback(() => {
				clearTimeout(timeout);
				resolve();
			});
			vid.currentTime = targetTime;
		});
	}

	/**
	 * Switch to smooth-playback mode. `vidB` is parked; `vidA` becomes the
	 * sole source and is driven by native `<video>.play()` so the decoder
	 * advances in step with wall clock, not via a seek per frame. Subsequent
	 * `renderFrame` calls take the smooth branch until {@link exitSmoothPlayback}
	 * is called — typically by `DomRenderer.stop()` / `seek()` / mode change.
	 */
	enterSmoothPlayback(): void {
		// No-op on the WebCodecs path — it is already at native-playback
		// throughput while staying frame-accurate, so trading determinism for
		// speed would be a pure loss.
		if (this.frameSource) return;
		this.smoothMode = true;
		// Park vidB; only vidA participates in smooth playback.
		if (this.vidB) this.vidB.pause();
	}

	/** Pause vidA and return to the deterministic seek-per-frame path. */
	exitSmoothPlayback(): void {
		if (this.frameSource) return;
		this.smoothMode = false;
		if (this.vidA) this.vidA.pause();
	}

	/**
	 * Smooth-playback render: let `vidA` play natively and sample whatever
	 * frame the decoder has presented. A `currentTime` correction is issued
	 * only when drift exceeds a few project frames.
	 *
	 * Falls back to the seek path when the layer's `speed` is non-positive
	 * (reverse / frozen) — `playbackRate` can't represent those.
	 */
	private async renderFrameSmooth(frame: number): Promise<void> {
		const vid = this.vidA!;
		const targetTime = this.sourceTimeAtFrame(frame);
		const speed = this.speed;
		if (speed <= 0) {
			// playbackRate must be positive — drop to the seek path for this
			// frame. The smoothMode flag stays on so layers further forward
			// in playback resume smooth as soon as conditions allow.
			await this.renderFrameSeek(frame);
			return;
		}

		// First frame in range, or vidA was paused (e.g. layer just entered
		// its window): seed playback at the right source time.
		if (vid.paused) {
			vid.playbackRate = speed;
			this.vidATargetTime = targetTime;
			this.vidAReady = this.seekVideo(vid, targetTime);
			await this.vidAReady;
			if (!this.smoothMode) return; // bailed mid-await
			// `play()` returns a promise that rejects if the user-gesture
			// requirement isn't met. Caller (DomRenderer.play) should always
			// be invoked from a user gesture, so this normally resolves; we
			// swallow the rejection to keep the render loop alive.
			vid.play().catch(() => {});
		} else {
			// Drift correction: if the decoder has fallen behind / leapt
			// ahead by more than 4 project frames, snap. Quantization
			// between continuous mediaTime and discrete frame ticks is at
			// most 1/fps, so 4/fps is comfortably outside normal jitter.
			const drift = Math.abs(vid.currentTime - targetTime);
			if (drift > 4 / this.fps) {
				vid.playbackRate = speed;
				this.vidATargetTime = targetTime;
				this.vidAReady = this.seekVideo(vid, targetTime);
				await this.vidAReady;
				if (!this.smoothMode) return;
				vid.play().catch(() => {});
			}
		}

		if (this.ctx) {
			this.ctx.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
			this.ctx.drawImage(vid, 0, 0, this.dimensions[0], this.dimensions[1]);
		}
	}

	/**
	 * Decode-ahead buffering: maintain two video elements that ping-pong.
	 * While rendering frame N, frame N+1 is being decoded on the other element.
	 * Used by export and by scrubbing / non-1x preview where smooth playback
	 * isn't applicable.
	 */
	private async renderFrameSeek(frame: number): Promise<void> {
		// `sourceTimeAtFrame` returns the absolute source-time (seconds)
		// — exactly what `<video>.currentTime` expects.
		const targetTime = this.sourceTimeAtFrame(frame);
		const nextFrame = Math.min(frame + 1, this.endFrame - 1);
		const nextTargetTime = this.sourceTimeAtFrame(nextFrame);

		let drawFromVid: HTMLVideoElement;

		// Step 1: Determine which video to draw from
		// If vidA is already targeted at this time, use it
		if (this.vidATargetTime === targetTime) {
			await this.vidAReady;
			drawFromVid = this.vidA!;
		}
		// Else if vidB is already targeted at this time, use it
		else if (this.vidBTargetTime === targetTime) {
			await this.vidBReady;
			drawFromVid = this.vidB!;
		}
		// Neither is primed — pick the closer one and seek it
		else {
			const diffA = Math.abs(this.vidATargetTime - targetTime);
			const diffB = Math.abs(this.vidBTargetTime - targetTime);

			if (diffA <= diffB) {
				// Seek vidA and wait for decode
				this.vidATargetTime = targetTime;
				this.vidAReady = this.seekVideo(this.vidA!, targetTime);
				await this.vidAReady;
				drawFromVid = this.vidA!;
			} else {
				// Seek vidB and wait for decode
				this.vidBTargetTime = targetTime;
				this.vidBReady = this.seekVideo(this.vidB!, targetTime);
				await this.vidBReady;
				drawFromVid = this.vidB!;
			}
		}

		// Step 2: Draw current frame
		if (this.ctx) {
			this.ctx.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
			this.ctx.drawImage(drawFromVid, 0, 0, this.dimensions[0], this.dimensions[1]);
		}

		// Step 3: Prefetch next frame on the OTHER video (fire and forget)
		const other = drawFromVid === this.vidA ? this.vidB! : this.vidA!;
		const isOtherA = other === this.vidA;

		if (isOtherA) {
			this.vidATargetTime = nextTargetTime;
			this.vidAReady = this.seekVideo(this.vidA!, nextTargetTime);
		} else {
			this.vidBTargetTime = nextTargetTime;
			this.vidBReady = this.seekVideo(this.vidB!, nextTargetTime);
		}
		// Intentionally not awaited — decode happens in background
	}

	/**
	 * Draw one decoded frame through {@link VideoFrameSource}.
	 *
	 * Deliberately does not clear first: when the decoder has nothing for this
	 * timestamp (a gap in the track, or a transient decode error) the previous
	 * frame stays on screen, which reads as a dropped frame rather than a
	 * black flash.
	 */
	private async renderFrameDecoded(frame: number): Promise<void> {
		if (!this.ctx) return;
		// The decoder draws straight into this layer's canvas — no
		// intermediate surface, and only frames actually displayed get
		// converted out of the decoder's native format.
		await this.frameSource!.drawInto(
			this.ctx,
			this.sourceTimeAtFrame(frame),
			this.dimensions[0],
			this.dimensions[1],
		);
	}

	async renderFrame(frame: number): Promise<void> {
		const hasDecoder = !!this.frameSource || (!!this.vidA && !!this.vidB);
		const inRange = this.$element && hasDecoder
			&& frame >= this.startFrame && frame < this.endFrame;

		if (inRange) {
			if (this.frameSource) {
				// Sequential decoding is already both fast and deterministic,
				// so smooth mode has nothing to offer here.
				await this.renderFrameDecoded(frame);
			} else if (this.smoothMode) {
				await this.renderFrameSmooth(frame);
			} else {
				await this.renderFrameSeek(frame);
			}
		} else if (this.smoothMode && this.vidA && !this.vidA.paused) {
			// Out of range during smooth playback — pause vidA so the next
			// time the layer enters range, smoothMode reseeds at the right
			// source time instead of drifting from a stale running clock.
			this.vidA.pause();
			this.vidATargetTime = -Infinity;
		}

		return super.renderFrame(frame);
	}

	/**
	 * Clean up both video elements and parent resources.
	 */
	destroy(): void {
		if (this.frameSource) {
			this.frameSource.destroy();
			this.frameSource = null;
		}
		if (this.vidA) {
			this.vidA.pause();
			this.vidA = null;
		}
		if (this.vidB) {
			this.vidB.pause();
			this.vidB = null;
		}
		this.internalMedia = null;
		super.destroy();
	}
}
