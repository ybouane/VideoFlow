/**
 * RuntimeVideoLayer — runtime class for video layers.
 *
 * Mirrors Scrptly's VideoLayer renderer class.
 * Loads a video, seeks to the correct time per frame, redraws the video
 * frame onto the canvas, and declares audio output.
 */

import RuntimeMediaLayer from './RuntimeMediaLayer.js';

export default class RuntimeVideoLayer extends RuntimeMediaLayer {
	get hasAudio(): boolean { return true; }

	/** Dual video elements for decode-ahead buffering. */
	private vidA: HTMLVideoElement | null = null;
	private vidB: HTMLVideoElement | null = null;

	/** Track which time each video element is targeted to. */
	private vidATargetTime: number = -Infinity;
	private vidBTargetTime: number = -Infinity;

	/** Decode completion promises for each video. */
	private vidAReady: Promise<void> = Promise.resolve();
	private vidBReady: Promise<void> = Promise.resolve();

	async initialize(): Promise<void> {
		const source = this.json.settings.source;
		if (!source) return;

		const response = await fetch(source, { cache: 'no-cache' });
		if (!response.ok) throw new Error(`Failed to fetch video: ${response.statusText}`);
		this.dataBlob = await response.blob();
		this.dataUrl = URL.createObjectURL(this.dataBlob);

		// Create both video elements for decode-ahead buffering
		const createVideoElement = (): HTMLVideoElement => {
			const vid = document.createElement('video');
			vid.src = this.dataUrl!;
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

		// Wait for both to be ready
		await Promise.all([
			new Promise<void>((resolve, reject) => {
				this.vidA!.oncanplay = () => {
					this.dimensions = [this.vidA!.videoWidth, this.vidA!.videoHeight];
					this.duration = this.vidA!.duration;
					resolve();
				};
				this.vidA!.onerror = () => reject(new Error(`Failed to load video: ${source}`));
			}),
			new Promise<void>((resolve, reject) => {
				this.vidB!.oncanplay = () => resolve();
				this.vidB!.onerror = () => reject(new Error(`Failed to load video: ${source}`));
			}),
		]);
	}

	/**
	 * Override generateElement to set canvas dimensions and context.
	 * Mirrors Scrptly's VideoLayer.generateElement.
	 */
	async generateElement(): Promise<HTMLElement | null> {
		const $ele = await super.generateElement();
		if ($ele) {
			($ele as HTMLCanvasElement).width = this.dimensions[0];
			($ele as HTMLCanvasElement).height = this.dimensions[1];
			if (!this.ctx) {
				this.ctx = ($ele as HTMLCanvasElement).getContext('2d')!;
				this.ctx.imageSmoothingEnabled = true;
				this.ctx.imageSmoothingQuality = 'high';
			}
		}
		return $ele;
	}

	/**
	 * Override resetCSSProperties to set object dimensions for fit calculations.
	 * Mirrors Scrptly's VideoLayer.resetCSSProperties.
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
	 * Decode-ahead buffering: maintain two video elements that ping-pong.
	 * While rendering frame N, frame N+1 is being decoded on the other element.
	 *
	 * Mirrors Scrptly's VideoLayer.renderFrame — seeks first, then
	 * calls super.renderFrame() for property application.
	 */
	async renderFrame(frame: number): Promise<void> {
		if (this.$element && this.vidA && this.vidB &&
			frame >= this.actualStartFrame && frame < this.endFrame) {

			const targetTime = this.retimeFrame(frame) / this.fps;
			const nextFrame = Math.min(frame + 1, this.endFrame - 1);
			const nextTargetTime = this.retimeFrame(nextFrame) / this.fps;

			let drawFromVid: HTMLVideoElement;

			// Step 1: Determine which video to draw from
			// If vidA is already targeted at this time, use it
			if (this.vidATargetTime === targetTime) {
				console.log(`Frame ${frame}: Using vidA (already targeted)`);
				await this.vidAReady;
				drawFromVid = this.vidA;
			}
			// Else if vidB is already targeted at this time, use it
			else if (this.vidBTargetTime === targetTime) {
				console.log(`Frame ${frame}: Using vidB (already targeted)`);
				await this.vidBReady;
				drawFromVid = this.vidB;
			}
			// Neither is primed — pick the closer one and seek it
			else {
				console.log(`Frame ${frame}: Seeking video (not already targeted)`);
				const diffA = Math.abs(this.vidATargetTime - targetTime);
				const diffB = Math.abs(this.vidBTargetTime - targetTime);

				if (diffA <= diffB) {
					// Seek vidA and wait for decode
					this.vidATargetTime = targetTime;
					this.vidAReady = this.seekVideo(this.vidA, targetTime);
					await this.vidAReady;
					drawFromVid = this.vidA;
				} else {
					// Seek vidB and wait for decode
					this.vidBTargetTime = targetTime;
					this.vidBReady = this.seekVideo(this.vidB, targetTime);
					await this.vidBReady;
					drawFromVid = this.vidB;
				}
			}

			// Step 2: Draw current frame
			if (this.ctx) {
				this.ctx.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
				this.ctx.drawImage(drawFromVid, 0, 0, this.dimensions[0], this.dimensions[1]);
			}

			// Step 3: Prefetch next frame on the OTHER video (fire and forget)
			const other = drawFromVid === this.vidA ? this.vidB : this.vidA;
			const isOtherA = other === this.vidA;

			if (isOtherA) {
				this.vidATargetTime = nextTargetTime;
				this.vidAReady = this.seekVideo(this.vidA, nextTargetTime);
			} else {
				this.vidBTargetTime = nextTargetTime;
				this.vidBReady = this.seekVideo(this.vidB, nextTargetTime);
			}
			// Intentionally not awaited — decode happens in background
		}

		return super.renderFrame(frame);
	}

	/**
	 * Clean up both video elements and parent resources.
	 */
	destroy(): void {
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
