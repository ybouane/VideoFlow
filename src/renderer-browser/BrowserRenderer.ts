/**
 * BrowserRenderer — client-side video rendering engine for VideoFlow.
 *
 * This renderer takes a compiled {@link VideoJSON} and produces video output
 * entirely in the browser, using:
 *
 * 1. **DOM-based frame rendering** — each layer is represented as a DOM
 *    element inside a container div.  Properties are applied as CSS custom
 *    properties or inline styles every frame.
 *
 * 2. **SVG foreignObject capture** — the rendered DOM is cloned, wrapped in
 *    an SVG `<foreignObject>`, converted to a data-URI, drawn onto an
 *    `OffscreenCanvas`, producing a pixel-perfect raster of each frame.
 *
 * 3. **Audio rendering** — an `OfflineAudioContext` mixes all audio/video
 *    layers into a single AudioBuffer, honouring volume/pan keyframes.
 *
 * 4. **Video encoding** — frames and audio are fed into MediaBunny to produce
 *    an MP4 blob (H.264 + AAC) entirely client-side.
 *
 * Layer-specific rendering behaviour is delegated to the runtime layer class
 * hierarchy in `./layers/`.
 */

import type { VideoJSON, RenderOptions, PropertyDefinition } from '@videoflow/core/types';
import { audioBufferToWav } from '@videoflow/core/utils';
import RENDERER_CSS from './renderer.css.js';
import {
	Output,
	Mp4OutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	QUALITY_HIGH,
} from 'mediabunny';

import { createRuntimeLayer, RuntimeBaseLayer, type ILayerRenderer } from './layers/index.js';

// ---------------------------------------------------------------------------
//  Property definition registry — built from core layer classes
// ---------------------------------------------------------------------------

import {
	TextLayer, CaptionsLayer, ImageLayer, VideoLayer, AudioLayer,
} from '@videoflow/core';

/**
 * Static registry mapping layer type → merged propertiesDefinition.
 * Avoids re-computing on every property lookup.
 */
const PROPERTIES_BY_TYPE: Record<string, Record<string, PropertyDefinition>> = {
	text: TextLayer.propertiesDefinition,
	captions: CaptionsLayer.propertiesDefinition,
	image: ImageLayer.propertiesDefinition,
	video: VideoLayer.propertiesDefinition,
	audio: AudioLayer.propertiesDefinition,
};

// ---------------------------------------------------------------------------
//  BrowserRenderer
// ---------------------------------------------------------------------------

export default class BrowserRenderer implements ILayerRenderer {
	/** The compiled video JSON being rendered. */
	private videoJSON: VideoJSON;
	/** Runtime layer wrappers. */
	layers: RuntimeBaseLayer[] = [];
	/** The container element for layer DOM elements. */
	private $canvas: HTMLDivElement;
	/** Track whether DOM elements have been set up. */
	private elementsSetup = false;
	/** Frame being rendered right now (for dedup / cancellation). */
	currentFrame = -1;
	/** Whether a frame render is in progress. */
	private rendering = false;
	/** If set, the current render should be interrupted for this frame. */
	private pendingFrame: number | false = false;

	/** Cache of loaded Google Fonts — maps font name → stylesheet URL. */
	loadedFonts: Record<string, string> = {};
	/** Cache of font CSS with embedded base64 data URIs. */
	private loadedFontsEmbedded: Record<string, Record<string, string>> = {};

	/** Off-screen canvas used for SVG → raster conversion. */
	private renderCanvas: OffscreenCanvas | null = null;

	constructor(videoJSON: VideoJSON) {
		this.videoJSON = videoJSON;

		// Inject renderer CSS into the page if not already present
		if (!document.querySelector('style[data-videoflow-renderer]')) {
			const style = document.createElement('style');
			style.setAttribute('data-videoflow-renderer', '');
			style.textContent = RENDERER_CSS;
			document.head.appendChild(style);
		}

		// Create a hidden container element for rendering
		this.$canvas = document.createElement('div');
		this.$canvas.toggleAttribute('data-renderer', true);
		this.$canvas.style.setProperty('--project-width', String(videoJSON.width));
		this.$canvas.style.setProperty('--project-height', String(videoJSON.height));
		this.$canvas.style.width = videoJSON.width + 'px';
		this.$canvas.style.height = videoJSON.height + 'px';
		this.$canvas.style.position = 'absolute';
		this.$canvas.style.left = '-99999px';
		this.$canvas.style.top = '-99999px';
		this.$canvas.style.overflow = 'hidden';
		this.$canvas.style.backgroundColor = videoJSON.backgroundColor || '#000000';
		document.body.appendChild(this.$canvas);

		// Create runtime layers via the type registry
		for (const layerJSON of videoJSON.layers) {
			this.layers.push(createRuntimeLayer(layerJSON, videoJSON.fps, videoJSON.width, videoJSON.height, this));
		}
	}

	// -----------------------------------------------------------------------
	//  Property definition lookup
	// -----------------------------------------------------------------------

	/**
	 * Look up the full property definitions for a layer type, or a single property.
	 * Used by runtime layers to determine CSS mapping and defaults.
	 */
	getPropertyDefinition(layerType: string): Record<string, PropertyDefinition> | undefined;
	getPropertyDefinition(layerType: string, prop: string): PropertyDefinition | undefined;
	getPropertyDefinition(layerType: string, prop?: string): Record<string, PropertyDefinition> | PropertyDefinition | undefined {
		if (prop !== undefined) {
			return PROPERTIES_BY_TYPE[layerType]?.[prop];
		}
		return PROPERTIES_BY_TYPE[layerType];
	}

	// -----------------------------------------------------------------------
	//  Static render entry point
	// -----------------------------------------------------------------------

	/**
	 * Render a {@link VideoJSON} to a video Blob or ArrayBuffer.
	 *
	 * This is the primary public API.  It creates a BrowserRenderer instance,
	 * initialises all layers, renders every frame, encodes the result via
	 * MediaBunny, and returns the output.
	 *
	 * @param videoJSON - The compiled video JSON.
	 * @param options   - Rendering options (outputType, signal, etc.).
	 * @returns An MP4 Blob (default) or ArrayBuffer.
	 */
	static async render(videoJSON: VideoJSON, options: RenderOptions = {}): Promise<Blob | ArrayBuffer> {
		const renderer = new BrowserRenderer(videoJSON);
		try {
			return await renderer.exportVideo(options);
		} finally {
			renderer.destroy();
		}
	}

	// -----------------------------------------------------------------------
	//  Initialisation
	// -----------------------------------------------------------------------

	/** Initialise all layers — load media, create DOM elements. */
	private async initLayers(): Promise<void> {
		// Load default font
		const defaultFont = 'Noto Sans';
		await this.loadFont(defaultFont);
		this.$canvas.style.setProperty('font-family', `"${defaultFont}", sans-serif`);

		// Initialise each layer (fetch media, decode, extract metadata)
		await Promise.all(this.layers.map(layer => layer.initialize()));

		// Create DOM elements
		this.$canvas.innerHTML = '';
		for (const layer of this.layers) {
			if (!layer.json.settings.enabled) continue;
			const $el = await layer.generateElement();
			if ($el) {
				this.$canvas.appendChild($el);
			}
		}
		this.elementsSetup = true;
	}

	// -----------------------------------------------------------------------
	//  Frame rendering
	// -----------------------------------------------------------------------

	/**
	 * Render a single frame to the DOM.
	 *
	 * Each enabled layer computes its interpolated properties at the given
	 * frame and applies them to its DOM element.
	 */
	async renderFrame(frame: number, force = false): Promise<void> {
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

	// -----------------------------------------------------------------------
	//  SVG foreignObject frame capture
	// -----------------------------------------------------------------------

	/**
	 * Clone the DOM tree with inlined styles, converting `<canvas>` elements
	 * to `<img>` with data-URI sources so they survive serialisation.
	 */
	private async cloneWithInlineStyles(): Promise<HTMLElement> {
		const clone = this.$canvas.cloneNode(true) as HTMLElement;
		const sourceElements = Array.from(this.$canvas.querySelectorAll('*'));
		const cloneElements = Array.from(clone.querySelectorAll('*'));

		await Promise.all(sourceElements.map(async (srcElem, i) => {
			const cloneElem = cloneElements[i];
			if (!cloneElem) return;

			if ((srcElem as HTMLElement).style.display === 'none') {
				cloneElem.remove();
				return;
			}
			if (cloneElem.tagName === 'CANVAS') {
				const img = document.createElement('img');
				img.style.cssText = (srcElem as HTMLElement).style.cssText;
				img.src = (srcElem as HTMLCanvasElement).toDataURL();
				for (const attr of (srcElem as Element).attributes) {
					img.setAttribute(attr.name, attr.value);
				}
				cloneElem.replaceWith(img);
			}
		}));
		return clone;
	}

	/**
	 * Capture the current frame as a raster image on an OffscreenCanvas.
	 *
	 * This is the core of the rendering pipeline:
	 * 1. Render the frame to DOM
	 * 2. Build embedded font CSS with base64-encoded font files
	 * 3. Clone the DOM tree with inlined styles
	 * 4. Wrap in SVG foreignObject
	 * 5. Encode as data-URI, draw onto Image, then blit to OffscreenCanvas
	 */
	async captureFrame(frame: number): Promise<OffscreenCanvas> {
		await this.renderFrame(frame);

		// Build font CSS with embedded fonts
		const usedFontUrls = performance.getEntriesByType('resource')
			.filter(f => f.name.startsWith('https://fonts.gstatic.com/'))
			.map(f => f.name);

		let fontCss = '';
		for (const fontName of Object.keys(this.loadedFonts)) {
			if (!this.loadedFontsEmbedded[fontName]) {
				const fontSheet = await (await fetch(this.loadedFonts[fontName], { cache: 'force-cache' })).text();
				this.loadedFontsEmbedded[fontName] = {};
				const styleSheet = new CSSStyleSheet();
				await styleSheet.replace(fontSheet);

				await Promise.all([...styleSheet.cssRules].map(async (rule) => {
					if (rule.type === CSSRule.FONT_FACE_RULE) {
						const url = rule.cssText.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, '');
						if (!url) return;
						if (usedFontUrls.includes(url)) {
							const embedded = await this.embedFontUrl(rule.cssText);
							if (embedded) this.loadedFontsEmbedded[fontName][url] = embedded;
						} else {
							this.loadedFontsEmbedded[fontName][url] = rule.cssText;
						}
					}
				}));
			}

			for (const [url, cssText] of Object.entries(this.loadedFontsEmbedded[fontName])) {
				if (usedFontUrls.includes(url)) {
					if (cssText.includes(url)) {
						// Not yet embedded — do it now
						const embedded = await this.embedFontUrl(cssText);
						if (embedded) {
							this.loadedFontsEmbedded[fontName][url] = embedded;
							fontCss += embedded;
						}
					} else {
						fontCss += cssText;
					}
				}
			}
		}

		// Clone DOM and generate SVG
		const node = await this.cloneWithInlineStyles();
		node.id = '';
		const width = this.videoJSON.width;
		const height = this.videoJSON.height;

		const styleEl = document.createElement('style');
		styleEl.textContent = RENDERER_CSS + fontCss;

		const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
			${styleEl.outerHTML}
			<foreignObject width="${width}px" height="${height}px">
				${new XMLSerializer().serializeToString(node)}
			</foreignObject>
		</svg>`;

		// Render SVG to OffscreenCanvas via Image
		const img = new Image();
		img.width = width;
		img.height = height;
		img.crossOrigin = 'anonymous';
		img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
		await img.decode();

		if (!this.renderCanvas) {
			this.renderCanvas = new OffscreenCanvas(width, height);
		}
		const ctx = this.renderCanvas.getContext('2d')!;
		ctx.clearRect(0, 0, width, height);
		// Fill with project background color before drawing the frame
		ctx.fillStyle = this.videoJSON.backgroundColor || '#000000';
		ctx.fillRect(0, 0, width, height);
		ctx.drawImage(img, 0, 0, width, height);

		return this.renderCanvas;
	}

	/**
	 * Replace a remote font URL inside a CSS rule with a base64 data URI.
	 * This is required because SVG foreignObject cannot load external fonts.
	 */
	private async embedFontUrl(cssText: string): Promise<string | null> {
		const url = cssText.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, '');
		if (!url) return null;
		try {
			const blob = await (await fetch(url)).blob();
			const base64 = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
				reader.onerror = reject;
				reader.readAsDataURL(blob);
			});
			return cssText.replace(url, `data:${blob.type};base64,${base64}`);
		} catch {
			return cssText;
		}
	}

	// -----------------------------------------------------------------------
	//  Audio rendering
	// -----------------------------------------------------------------------

	/**
	 * Render all audio layers into a single AudioBuffer using OfflineAudioContext.
	 *
	 * Each audio/video layer creates a buffer source node with volume and pan
	 * keyframe automation, connected to the context's destination.
	 */
	async renderAudio(): Promise<AudioBuffer | null> {
		const audioLayers = this.layers.filter(l => l.hasAudio && l.json.settings.enabled);
		if (audioLayers.length === 0) return null;

		const durationSec = this.videoJSON.duration;
		if (durationSec <= 0) return null;

		const sampleRate = 44100;
		const channels = 2;
		const audioCtx = new OfflineAudioContext(channels, Math.ceil(durationSec * sampleRate), sampleRate);

		for (const layer of audioLayers) {
			try {
				await this.generateLayerAudio(layer, audioCtx);
			} catch (e) {
				console.error(`Error generating audio for layer ${layer.json.id}:`, e);
			}
		}

		return await audioCtx.startRendering();
	}

	/**
	 * Generate audio for a single layer and connect it to the audio context.
	 *
	 * Creates a buffer source from the layer's audio data, applies volume
	 * and pan keyframes, and schedules playback.
	 */
	private async generateLayerAudio(layer: RuntimeBaseLayer, audioCtx: OfflineAudioContext): Promise<void> {
		// Prefer audioSource (pre-extracted WAV from server renderer) over
		// source (original container) — headless Chromium's decodeAudioData
		// may not support all container formats (e.g. MP4 video).
		const audioSource = layer.json.settings.audioSource;
		const source = audioSource || layer.json.settings.source;
		if (!source) return;

		// Decode audio data — try the layer's cached blob first, then fetch.
		// Skip the cached blob if an explicit audioSource was provided (it
		// points to a pre-extracted WAV which is more reliable to decode).
		let arrayBuffer: ArrayBuffer;
		const blob = !audioSource ? (layer as any).dataBlob as Blob | null : null;
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
			// Reverse the audio
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

		// Volume automation
		const gainNode = audioCtx.createGain();
		gainNode.gain.value = 1;
		this.applyAudioKeyframes(layer, 'volume', gainNode.gain, audioCtx);

		// Pan automation
		const panNode = audioCtx.createStereoPanner();
		panNode.pan.value = 0;
		this.applyAudioKeyframes(layer, 'pan', panNode.pan, audioCtx);

		// Connect chain: source → gain → pan → destination
		bufferSource.connect(gainNode).connect(panNode).connect(audioCtx.destination);

		const startTimeSec = layer.actualStartFrame / layer.fps;
		const trimStartSec = layer.trimStartFrames / layer.fps;
		const durationSec = (layer.endFrame - layer.actualStartFrame) / layer.fps;
		bufferSource.start(startTimeSec, trimStartSec, durationSec);
	}

	/**
	 * Apply keyframe automation to an AudioParam from the layer's animations.
	 */
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
			const t = startTimeSec + kf.time;
			param.setValueAtTime(Number(kf.value), t);
		}
	}

	// -----------------------------------------------------------------------
	//  Video export (MediaBunny)
	// -----------------------------------------------------------------------

	/**
	 * Export the full video as an MP4 blob using MediaBunny.
	 *
	 * Renders every frame sequentially, captures it via SVG→Canvas, and feeds
	 * it to the MediaBunny encoder along with the mixed audio.
	 *
	 * @param options - Rendering options including abort signal.
	 * @returns A Blob containing the MP4 video.
	 */
	async exportVideo(options: RenderOptions = {}): Promise<Blob> {
		const width = this.videoJSON.width;
		const height = this.videoJSON.height;
		const fps = this.videoJSON.fps;
		const nFrames = Math.round(this.videoJSON.duration * fps);
		const signal = options.signal;

		// Initialise layers
		await this.initLayers();

		// Set up the render canvas
		this.renderCanvas = new OffscreenCanvas(width, height);

		// Create MediaBunny output
		const output = new Output({
			format: new Mp4OutputFormat(),
			target: new BufferTarget(),
		});

		const videoSource = new CanvasSource(this.renderCanvas, {
			codec: 'avc',
			bitrate: QUALITY_HIGH,
		});
		output.addVideoTrack(videoSource, { frameRate: fps });

		// Audio track
		const audioSource = new AudioBufferSource({
			codec: 'aac',
			bitrate: 192_000,
		});
		output.addAudioTrack(audioSource);

		await output.start();

		// Render and feed audio
		if (signal?.aborted) throw new DOMException('Render aborted', 'AbortError');
		const audioBuffer = await this.renderAudio();
		if (audioBuffer) {
			await audioSource.add(audioBuffer);
		}
		audioSource.close();

		// Render and feed video frames
		for (let frame = 0; frame < nFrames; frame++) {
			if (signal?.aborted) throw new DOMException('Render aborted', 'AbortError');

			await this.captureFrame(frame);
			await videoSource.add(frame / fps, 1 / fps);
		}
		videoSource.close();

		// Finalise
		if (signal?.aborted) throw new DOMException('Render aborted', 'AbortError');
		await output.finalize();
		return new Blob([(output.target as BufferTarget).buffer!], { type: 'video/mp4' });
	}

	// -----------------------------------------------------------------------
	//  Font loading
	// -----------------------------------------------------------------------

	/**
	 * Load a Google Font by name.
	 *
	 * Constructs the appropriate Google Fonts CSS2 URL, injects a `<style>`
	 * tag, and waits for the font to be available for rendering.
	 */
	async loadFont(fontName: string): Promise<void> {
		if (fontName in this.loadedFonts) return;

		const encoded = fontName.replace(/ /g, '+');
		// Use a broad request that covers variable and static fonts
		const href = `https://fonts.googleapis.com/css2?family=${encoded}:ital,wght@0,100..900;1,100..900&display=swap`;

		this.loadedFonts[fontName] = href;

		const sheet = document.createElement('style');
		try {
			const fontSheet = await (await fetch(href, { cache: 'force-cache' })).text();
			sheet.textContent = fontSheet;
		} catch {
			// Fallback: try without variable axis range
			const fallbackHref = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
			this.loadedFonts[fontName] = fallbackHref;
			try {
				const fontSheet = await (await fetch(fallbackHref, { cache: 'force-cache' })).text();
				sheet.textContent = fontSheet;
			} catch {
				console.error(`Failed to load font "${fontName}"`);
				return;
			}
		}

		document.head.appendChild(sheet);
		try {
			await document.fonts.load(`1em "${fontName}"`);
		} catch {
			console.error(`Failed to load font "${fontName}"`);
		}
	}

	// -----------------------------------------------------------------------
	//  Cleanup
	// -----------------------------------------------------------------------

	/** Remove the hidden container and release all resources. */
	destroy(): void {
		for (const layer of this.layers) layer.destroy();
		this.$canvas.remove();
		this.renderCanvas = null;
	}
}
