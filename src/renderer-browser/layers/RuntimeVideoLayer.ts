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

	async initialize(): Promise<void> {
		const source = this.json.settings.source;
		if (!source) return;

		const response = await fetch(source, { cache: 'no-cache' });
		if (!response.ok) throw new Error(`Failed to fetch video: ${response.statusText}`);
		this.dataBlob = await response.blob();
		this.dataUrl = URL.createObjectURL(this.dataBlob);

		this.internalMedia = document.createElement('video');
		const vid = this.internalMedia as HTMLVideoElement;
		vid.src = this.dataUrl;
		vid.controls = false;
		vid.autoplay = false;
		vid.loop = false;
		vid.muted = true;
		vid.defaultMuted = true;
		vid.playsInline = true;

		await new Promise<void>((resolve, reject) => {
			vid.oncanplay = () => {
				this.dimensions = [vid.videoWidth, vid.videoHeight];
				this.duration = vid.duration;
				resolve();
			};
			vid.onerror = () => reject(new Error(`Failed to load video: ${source}`));
		});
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
	 * Seek the video to the correct time and redraw onto the canvas.
	 * Mirrors Scrptly's VideoLayer.renderFrame — seeks first, then
	 * calls super.renderFrame() for property application.
	 */
	async renderFrame(frame: number): Promise<void> {
		if (this.$element && this.internalMedia &&
			frame >= this.actualStartFrame && frame < this.endFrame) {

			const vid = this.internalMedia as HTMLVideoElement;
			vid.pause();
			const targetTime = this.retimeFrame(frame) / this.fps;

			// Skip seek if already at target time
			if ((this.ctx as any)?.currentTargetTime === targetTime) {
				return super.renderFrame(frame);
			}

			await new Promise<void>((resolve) => {
				const timeout = setTimeout(() => resolve(), 2000);
				vid.requestVideoFrameCallback(() => {
					clearTimeout(timeout);
					resolve();
				});
				vid.currentTime = targetTime;
			});

			if (this.ctx) {
				this.ctx.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
				this.ctx.drawImage(vid, 0, 0, this.dimensions[0], this.dimensions[1]);
				(this.ctx as any).currentTargetTime = targetTime;
			}
		}

		return super.renderFrame(frame);
	}
}
