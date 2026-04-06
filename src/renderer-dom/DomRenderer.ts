/**
 * DomRenderer — live DOM-based video renderer for VideoFlow.
 *
 * Renders video frames directly into a host DOM element using Shadow DOM
 * for style isolation. Unlike BrowserRenderer (which renders off-screen
 * and captures frames to video), DomRenderer renders on-screen for
 * live preview and scrubbing.
 *
 * API:
 * ```ts
 * const renderer = new DomRenderer(document.getElementById('player'));
 * await renderer.loadVideo(compiledJSON);
 * await renderer.renderFrame(42);
 * await renderer.play();
 * ```
 *
 * The renderer creates a Shadow DOM root inside the host element and
 * injects the renderer CSS there for style isolation. Layer DOM elements
 * are appended inside the shadow root — no global CSS or DOM pollution.
 *
 * Audio sync during playback: render audio to WAV, play via an HTML Audio
 * element, and adjust playback rate to keep video and audio in sync.
 */

import type { VideoJSON, PropertyDefinition } from '@videoflow/core/types';
import { audioBufferToWav } from '@videoflow/core/utils';
import {
	createRuntimeLayer,
	RuntimeBaseLayer,
	type ILayerRenderer,
} from '@videoflow/renderer-browser';
import {
	TextLayer, CaptionsLayer, ImageLayer, VideoLayer, AudioLayer,
} from '@videoflow/core';
import RENDERER_CSS from './renderer.css.js';

// ---------------------------------------------------------------------------
//  Property definition registry (same as BrowserRenderer)
// ---------------------------------------------------------------------------

const PROPERTIES_BY_TYPE: Record<string, Record<string, PropertyDefinition>> = {
	text: TextLayer.propertiesDefinition,
	captions: CaptionsLayer.propertiesDefinition,
	image: ImageLayer.propertiesDefinition,
	video: VideoLayer.propertiesDefinition,
	audio: AudioLayer.propertiesDefinition,
};

// ---------------------------------------------------------------------------
//  DomRenderer
// ---------------------------------------------------------------------------

export type DomRendererCallback = (event: string, data: any) => void;

export default class DomRenderer implements ILayerRenderer {
	/** The host element that contains the shadow root. */
	private host: HTMLElement;
	/** The shadow root for style isolation. */
	private shadow: ShadowRoot;
	/** Container div inside the shadow (mirrors BrowserRenderer.$canvas). */
	private $canvas: HTMLDivElement | null = null;
	/** The loaded VideoJSON. */
	private videoJSON: VideoJSON | null = null;

	/** Runtime layer instances. */
	layers: RuntimeBaseLayer[] = [];
	/** Track whether DOM elements have been set up. */
	private elementsSetup = false;
	/** Current frame rendered. */
	currentFrame = -1;
	private rendering = false;
	private pendingFrame: number | false = false;

	/** Google Fonts already loaded into the shadow DOM. */
	private loadedFonts: Record<string, string> = {};

	/** Whether playback is active. */
	playing = false;

	/** Audio element for playback sync. */
	private audio: HTMLAudioElement | null = null;
	/** Object URL for the audio blob (for cleanup). */
	private audioUrl: string | null = null;

	constructor(host: HTMLElement) {
		this.host = host;

		// If the host already has a shadow root (e.g., from a previous renderer),
		// reuse it by clearing its contents. Otherwise, create a new one.
		if (host.shadowRoot) {
			this.shadow = host.shadowRoot;
			this.shadow.innerHTML = '';
		} else {
			this.shadow = host.attachShadow({ mode: 'open' });
		}
	}

	// -----------------------------------------------------------------------
	//  ILayerRenderer implementation
	// -----------------------------------------------------------------------

	/** Return the full propertiesDefinition for a layer type. */
	getPropertyDefinition(layerType: string): Record<string, PropertyDefinition> | undefined {
		return PROPERTIES_BY_TYPE[layerType];
	}

	/** Load a Google Font and inject it into the shadow DOM. */
	async loadFont(fontName: string): Promise<void> {
		if (fontName in this.loadedFonts) return;

		const encoded = fontName.replace(/ /g, '+');
		const href = `https://fonts.googleapis.com/css2?family=${encoded}:ital,wght@0,100..900;1,100..900&display=swap`;

		this.loadedFonts[fontName] = href;

		const sheet = document.createElement('style');
		try {
			const fontSheet = await (await fetch(href, { cache: 'force-cache' })).text();
			sheet.textContent = fontSheet;
		} catch {
			const fallbackHref = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
			this.loadedFonts[fontName] = fallbackHref;
			try {
				const fontSheet = await (await fetch(fallbackHref, { cache: 'force-cache' })).text();
				sheet.textContent = fontSheet;
			} catch {
				console.error(`DomRenderer: Failed to load font "${fontName}"`);
				return;
			}
		}

		// Inject into shadow DOM (not document.head) for style isolation
		this.shadow.insertBefore(sheet, this.shadow.firstChild);
		try {
			await document.fonts.load(`1em "${fontName}"`);
		} catch {
			// Non-fatal
		}
	}

	// -----------------------------------------------------------------------
	//  Public API
	// -----------------------------------------------------------------------

	/**
	 * Load a compiled VideoJSON into the renderer.
	 *
	 * Sets up the shadow DOM, creates runtime layers, initialises media, and
	 * renders frame 0.
	 *
	 * @param videoJSON - Compiled VideoJSON from VideoFlow.compile().
	 */
	async loadVideo(videoJSON: VideoJSON): Promise<void> {
		// Tear down previous state
		this.stop();
		this.destroy(false);

		this.videoJSON = videoJSON;
		this.currentFrame = -1;
		this.elementsSetup = false;

		// Rebuild shadow DOM
		this.shadow.innerHTML = '';

		// Inject renderer CSS into shadow root for style isolation
		const style = document.createElement('style');
		style.textContent = RENDERER_CSS;
		this.shadow.appendChild(style);

		// Create the canvas container
		this.$canvas = document.createElement('div');
		this.$canvas.toggleAttribute('data-renderer', true);
		this.$canvas.style.setProperty('--project-width-target', String(videoJSON.width));
		this.$canvas.style.setProperty('--project-height-target', String(videoJSON.height));
		this.$canvas.style.backgroundColor = videoJSON.backgroundColor || '#000000';
		this.shadow.appendChild(this.$canvas);

		// Create runtime layers
		this.layers = videoJSON.layers.map(layerJSON =>
			createRuntimeLayer(layerJSON, videoJSON.fps, videoJSON.width, videoJSON.height, this)
		);

		// Render frame 0 to initialise everything
		await this.renderFrame(0, true);
	}

	/**
	 * Render a specific frame to the DOM.
	 *
	 * Skips if already at that frame (unless forced), queues if a render is
	 * already in progress.
	 *
	 * @param frame - Frame number to render.
	 * @param force - Render even if already at this frame.
	 */
	async renderFrame(frame: number, force = false): Promise<void> {
		if (!this.videoJSON || !this.$canvas) return;
		if (frame < 0) return;
		if (!force && frame === this.currentFrame && this.pendingFrame === false) return;
		if (this.rendering) {
			this.pendingFrame = frame;
			return;
		}

		try {
			this.rendering = true;

			if (!this.elementsSetup) await this.initLayers();

			await Promise.all(
				this.layers.map(async layer => {
					if (layer.json.settings.enabled) {
						await layer.renderFrame(frame);
					}
				})
			);

			this.currentFrame = frame;
			await document.fonts.ready;
		} catch (e) {
			if (e !== 'STOP_RENDERING') throw e;
		} finally {
			this.rendering = false;
			if (this.pendingFrame !== false) {
				const next = this.pendingFrame;
				this.pendingFrame = false;
				await this.renderFrame(next);
			}
		}
	}

	/**
	 * Render the full audio track as an AudioBuffer.
	 *
	 * @returns AudioBuffer, or null if there are no audio layers.
	 */
	async renderAudio(): Promise<AudioBuffer | null> {
		if (!this.videoJSON) return null;
		const audioLayers = this.layers.filter(l => l.hasAudio && l.json.settings.enabled);
		if (audioLayers.length === 0) return null;

		const durationSec = this.videoJSON.duration;
		if (durationSec <= 0) return null;

		const sampleRate = 44100;
		const audioCtx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);

		for (const layer of audioLayers) {
			await this.generateLayerAudio(layer, audioCtx);
		}

		return await audioCtx.startRendering();
	}

	/**
	 * Start real-time playback from the current frame with audio sync.
	 *
	 * Render audio to WAV, create an Audio element, and use
	 * requestAnimationFrame to advance frames while adjusting playback rate
	 * for A/V sync.
	 *
	 * @param callback - Optional event callback (e.g. for FPS display).
	 */
	async play(callback?: DomRendererCallback): Promise<void> {
		if (!this.videoJSON) throw new Error('No video loaded. Call loadVideo() first.');
		if (this.playing) return;
		this.playing = true;

		const fps = this.videoJSON.fps;
		const durationSec = this.videoJSON.duration;

		try {
			const startTime = Date.now();
			const startFrame = this.currentFrame < 0 ? 0 : this.currentFrame;
			const startTimeSec = startFrame / fps;

			// Render audio
			const audioBuffer = await this.renderAudio();
			if (audioBuffer) {
				const wav = audioBufferToWav(audioBuffer);
				const blob = new Blob([wav], { type: 'audio/wav' });
				this.audioUrl = URL.createObjectURL(blob);
				this.audio = new Audio(this.audioUrl);
				this.audio.loop = false;
				this.audio.currentTime = startTimeSec;
				this.audio.play();
			}

			// Playback loop
			while (this.playing) {
				const renderStart = performance.now();
				const elapsed = (Date.now() - startTime) / 1000;
				const currentTimeSec = (startTimeSec + elapsed) % durationSec;
				const frame = Math.round(currentTimeSec * fps);

				if (frame !== this.currentFrame) {
					if (this.audio) {
						const audioTime = this.audio.currentTime;
						const syncDiff = currentTimeSec - audioTime;
						if (Math.abs(syncDiff) > 15 / fps) {
							this.audio.currentTime = currentTimeSec;
						} else if (Math.abs(syncDiff) > 4 / fps) {
							this.audio.playbackRate = (1 / (1 - syncDiff)) ** 2;
						} else {
							this.audio.playbackRate = 1;
						}
					}

					await this.renderFrame(frame, true);
				}

				const frameFps = 1000 / (performance.now() - renderStart);
				callback?.('fps', frameFps);

				await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
			}
		} catch (e) {
			this.playing = false;
			console.error('DomRenderer playback error:', e);
		}

		this.cleanupAudio();
	}

	/** Stop playback. */
	stop(): void {
		this.playing = false;
		this.cleanupAudio();
	}

	/**
	 * Seek to a frame. Stops playback if active, renders the frame, then
	 * restarts playback if it was active.
	 */
	async seek(frame: number): Promise<void> {
		const wasPlaying = this.playing;
		if (wasPlaying) this.stop();
		await this.renderFrame(frame, true);
		if (wasPlaying) await this.play();
	}

	// -----------------------------------------------------------------------
	//  Convenience getters/setters
	// -----------------------------------------------------------------------

	get currentTime(): number {
		if (!this.videoJSON) return 0;
		return Math.max(0, this.currentFrame) / this.videoJSON.fps;
	}

	set currentTime(time: number) {
		if (!this.videoJSON) return;
		const frame = Math.round(time * this.videoJSON.fps);
		this.renderFrame(frame, true);
	}

	get totalFrames(): number {
		if (!this.videoJSON) return 0;
		return Math.round(this.videoJSON.duration * this.videoJSON.fps);
	}

	get duration(): number {
		return this.videoJSON?.duration ?? 0;
	}

	get fps(): number {
		return this.videoJSON?.fps ?? 0;
	}

	// -----------------------------------------------------------------------
	//  Destroy
	// -----------------------------------------------------------------------

	/**
	 * Destroy the renderer and release all resources.
	 *
	 * @param clearShadow - Whether to clear the shadow DOM (default true).
	 */
	destroy(clearShadow = true): void {
		this.stop();
		for (const layer of this.layers) layer.destroy();
		this.layers = [];
		this.$canvas = null;
		this.videoJSON = null;
		this.elementsSetup = false;
		this.currentFrame = -1;
		if (clearShadow) this.shadow.innerHTML = '';
	}

	// -----------------------------------------------------------------------
	//  Internal helpers
	// -----------------------------------------------------------------------

	/** Initialise layers and create DOM elements inside the shadow container. */
	private async initLayers(): Promise<void> {
		if (!this.$canvas) return;

		// Load default font
		const defaultFont = 'Noto Sans';
		await this.loadFont(defaultFont);
		this.$canvas.style.setProperty('font-family', `"${defaultFont}", sans-serif`);

		// Initialise media (fetch, decode, extract metadata)
		await Promise.all(this.layers.map(layer => layer.initialize()));

		// Create DOM elements
		this.$canvas.innerHTML = '';
		for (const layer of this.layers) {
			if (!layer.json.settings.enabled) continue;
			const $el = await layer.generateElement();
			if ($el) this.$canvas.appendChild($el);
		}

		this.elementsSetup = true;
	}

	/** Generate audio for a single layer in the OfflineAudioContext. */
	private async generateLayerAudio(layer: RuntimeBaseLayer, audioCtx: OfflineAudioContext): Promise<void> {
		const source = layer.json.settings.source;
		if (!source) return;

		let arrayBuffer: ArrayBuffer;
		const blob = (layer as any).dataBlob as Blob | null;
		if (blob) {
			arrayBuffer = await blob.arrayBuffer();
		} else {
			const res = await fetch(source);
			arrayBuffer = await res.arrayBuffer();
		}

		let audioBuffer: AudioBuffer;
		try {
			audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
		} catch (e) {
			// Audio decoding failed — this layer has no decodable audio
			// (e.g., video with no audio track, or unsupported format)
			return;
		}

		const bufferSource = audioCtx.createBufferSource();
		const speed = layer.speed;
		if (speed === 0) return;

		if (speed < 0) {
			const reversed = audioCtx.createBuffer(
				audioBuffer.numberOfChannels, audioBuffer.length, audioBuffer.sampleRate
			);
			for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
				const data = audioBuffer.getChannelData(ch);
				reversed.copyToChannel(new Float32Array(data).reverse(), ch);
			}
			bufferSource.buffer = reversed;
		} else {
			bufferSource.buffer = audioBuffer;
		}
		bufferSource.playbackRate.value = Math.abs(speed);

		const gainNode = audioCtx.createGain();
		gainNode.gain.value = 1;
		this.applyAudioKeyframes(layer, 'volume', gainNode.gain, audioCtx);

		const panNode = audioCtx.createStereoPanner();
		panNode.pan.value = 0;
		this.applyAudioKeyframes(layer, 'pan', panNode.pan, audioCtx);

		bufferSource.connect(gainNode).connect(panNode).connect(audioCtx.destination);

		const startTimeSec = layer.actualStartFrame / layer.fps;
		const trimStartSec = layer.trimStartFrames / layer.fps;
		const durationSec = (layer.endFrame - layer.actualStartFrame) / layer.fps;
		bufferSource.start(startTimeSec, trimStartSec, durationSec);
	}

	private applyAudioKeyframes(
		layer: RuntimeBaseLayer,
		property: string,
		param: AudioParam,
		audioCtx: OfflineAudioContext
	): void {
		const anim = layer.json.animations.find(a => a.property === property);
		if (!anim || anim.keyframes.length === 0) return;
		const startTimeSec = layer.startFrame / layer.fps;
		for (const kf of anim.keyframes) {
			param.setValueAtTime(Number(kf.value), startTimeSec + kf.time);
		}
	}

	private cleanupAudio(): void {
		this.audio?.pause();
		this.audio = null;
		if (this.audioUrl) {
			URL.revokeObjectURL(this.audioUrl);
			this.audioUrl = null;
		}
	}
}
