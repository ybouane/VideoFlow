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
 * The architecture closely follows Scrptly's renderer but adapts the data
 * model to VideoFlow's JSON schema.
 */

import type { VideoJSON, LayerJSON, RenderOptions, PropertyDefinition, Easing } from '@videoflow/core/types';
import { audioBufferToWav, timeToFrames, parseTime } from '@videoflow/core/utils';
import RENDERER_CSS from './renderer.css.js';
import {
	Output,
	Mp4OutputFormat,
	BufferTarget,
	CanvasSource,
	AudioBufferSource,
	QUALITY_HIGH,
} from 'mediabunny';

// ---------------------------------------------------------------------------
//  Filter name mapping (camelCase property → CSS filter function)
// ---------------------------------------------------------------------------

const FILTER_MAP: Record<string, string> = {
	blur: 'blur',
	brightness: 'brightness',
	contrast: 'contrast',
	grayscale: 'grayscale',
	hueRotate: 'hue-rotate',
	invert: 'invert',
	opacity: 'opacity',
	saturate: 'saturate',
	sepia: 'sepia',
};

// ---------------------------------------------------------------------------
//  Runtime layer — wraps a LayerJSON with DOM state and metadata
// ---------------------------------------------------------------------------

/**
 * Internal representation of a layer during rendering.
 *
 * Holds the DOM element, resolved media assets, dimension metadata,
 * and provides methods for property interpolation and frame rendering.
 */
class RuntimeLayer {
	json: LayerJSON;
	fps: number;
	projectWidth: number;
	projectHeight: number;
	$element: HTMLElement | null = null;
	ctx: CanvasRenderingContext2D | null = null;
	internalMedia: HTMLImageElement | HTMLVideoElement | null = null;
	dimensions: [number, number] = [0, 0];
	duration: number = 0; // media duration in seconds
	dataUrl: string | null = null;
	dataBlob: Blob | null = null;
	audioBuffer: AudioBuffer | null = null;
	/** Reference to the parent renderer for font loading etc. */
	renderer: BrowserRenderer;

	constructor(json: LayerJSON, fps: number, width: number, height: number, renderer: BrowserRenderer) {
		this.json = json;
		this.fps = fps;
		this.projectWidth = width;
		this.projectHeight = height;
		this.renderer = renderer;
	}

	// -- Timing helpers (convert time-based settings to frame numbers) ------

	get startFrame(): number {
		return Math.round((this.json.settings.startTime ?? 0) * this.fps);
	}

	get endFrame(): number {
		return Math.round(((this.json.settings.startTime ?? 0) + (this.json.settings.duration ?? 0)) * this.fps);
	}

	get trimStartFrames(): number {
		return Math.round((this.json.settings.trimStart ?? 0) * this.fps);
	}

	get actualStartFrame(): number {
		return this.startFrame + this.trimStartFrames;
	}

	get speed(): number {
		return this.json.settings.speed ?? 1;
	}

	/** Whether this layer type has audio output. */
	get hasAudio(): boolean {
		return ['audio', 'video'].includes(this.json.type);
	}

	/** Whether this layer type has visual output. */
	get hasVisual(): boolean {
		return ['text', 'image', 'video', 'captions'].includes(this.json.type);
	}

	// -- Retiming (speed adjustment) ----------------------------------------

	/**
	 * Convert an absolute frame number to the layer-local retimed frame,
	 * accounting for speed and playback direction.
	 */
	retimeFrame(frame: number): number {
		if (this.speed === 0) return 0;
		if (this.speed < 0) return Math.abs(this.speed) * (this.endFrame - frame);
		return this.speed * (frame - this.startFrame);
	}

	// -- Property interpolation at a given frame ----------------------------

	/**
	 * Get all animated property values for this layer at the given frame.
	 *
	 * Walks each animation's keyframes and interpolates between the surrounding
	 * pair using the specified easing function.
	 */
	getPropertiesAtFrame(frame: number): Record<string, any> {
		const retimedFrame = this.retimeFrame(frame);
		const retimedTime = retimedFrame / this.fps;
		const props: Record<string, any> = {};

		for (const anim of this.json.animations) {
			const kfs = anim.keyframes;
			if (kfs.length === 0) continue;

			// Find surrounding keyframes
			let before = kfs[0];
			let after: typeof before | null = null;
			for (let i = 0; i < kfs.length; i++) {
				if (kfs[i].time <= retimedTime) {
					before = kfs[i];
					after = kfs[i + 1] ?? null;
				}
			}

			if (!after || before.time === retimedTime) {
				props[anim.property] = before.value;
			} else if (retimedTime < kfs[0].time) {
				props[anim.property] = kfs[0].value;
			} else {
				// Interpolate
				const t = (retimedTime - before.time) / (after.time - before.time);
				const easing = before.easing ?? anim.easing ?? 'step';
				props[anim.property] = this.interpolate(before.value, after.value, t, easing);
			}
		}

		// Merge static properties
		for (const [key, value] of Object.entries(this.json.properties)) {
			if (!(key in props)) {
				props[key] = value;
			}
		}

		// For captions layers, overlay the active caption text
		if (this.json.type === 'captions' && this.json.settings.captions) {
			const timeSec = frame / this.fps;
			const caption = (this.json.settings.captions as any[]).find(
				(c: any) => c.startTime <= timeSec && c.endTime >= timeSec
			);
			props['text'] = caption?.caption ?? '';
		}

		return props;
	}

	/**
	 * Interpolate between two values using the given easing.
	 *
	 * Handles numbers, arrays (component-wise), and falls back to `step`
	 * for non-numeric values (colours, strings).
	 */
	interpolate(v1: any, v2: any, t: number, easing: string): any {
		// Arrays: interpolate component-wise
		if (Array.isArray(v1) || Array.isArray(v2)) {
			const a1 = Array.isArray(v1) ? v1 : [v1];
			const a2 = Array.isArray(v2) ? v2 : [v2];
			const len = Math.max(a1.length, a2.length);
			const result = [];
			for (let i = 0; i < len; i++) {
				result.push(this.interpolate(a1[i] ?? 0, a2[i] ?? 0, t, easing));
			}
			return result;
		}

		const n1 = typeof v1 === 'number' ? v1 : parseFloat(String(v1));
		const n2 = typeof v2 === 'number' ? v2 : parseFloat(String(v2));

		if (isNaN(n1) || isNaN(n2)) {
			return v1; // Non-numeric → step
		}

		const easedT = this.applyEasing(t, easing);
		const result = n1 + (n2 - n1) * easedT;

		// Preserve unit suffix if present
		if (typeof v1 === 'string') {
			const unit = v1.replace(/^[\d.-]+/, '');
			return result + unit;
		}
		return result;
	}

	/** Apply an easing curve to a normalised t ∈ [0, 1]. */
	applyEasing(t: number, easing: string): number {
		switch (easing) {
			case 'step': return 0;
			case 'linear': return t;
			case 'easeIn': return t * t;
			case 'easeOut': return t * (2 - t);
			case 'easeInOut': return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
			default: return t;
		}
	}

	// -- DOM element lifecycle ----------------------------------------------

	/**
	 * Create the DOM element for this layer.
	 *
	 * - Text / Captions → `<textual-layer>` custom element
	 * - Image / Video   → `<canvas>` (media is drawn via 2D context)
	 * - Audio           → no visual element (returns null)
	 */
	async generateElement(): Promise<HTMLElement | null> {
		if (this.$element) return this.$element;

		switch (this.json.type) {
			case 'text':
			case 'captions': {
				this.$element = document.createElement('textual-layer');
				break;
			}
			case 'image': {
				this.$element = document.createElement('canvas');
				break;
			}
			case 'video': {
				this.$element = document.createElement('canvas');
				break;
			}
			case 'audio':
			default:
				return null;
		}

		this.$element.setAttribute('data-element', this.json.type);
		this.$element.setAttribute('data-id', this.json.id);
		(this.$element as any).layerObject = this;
		return this.$element;
	}

	/**
	 * Initialise the layer's media assets.
	 *
	 * For images and videos this fetches the source, decodes it, and extracts
	 * dimension / duration metadata.  For audio layers the audio file is
	 * fetched.
	 */
	async initialize(): Promise<void> {
		const source = this.json.settings.source;
		if (!source) return;

		switch (this.json.type) {
			case 'image': {
				await this.loadImage(source);
				break;
			}
			case 'video': {
				await this.loadVideo(source);
				break;
			}
			case 'audio': {
				// Audio is loaded lazily during audio rendering
				break;
			}
		}
	}

	/** Fetch and decode an image, extracting its dimensions. */
	private async loadImage(url: string): Promise<void> {
		const response = await fetch(url, { cache: 'no-cache' });
		if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
		this.dataBlob = await response.blob();
		this.dataUrl = URL.createObjectURL(this.dataBlob);

		this.internalMedia = document.createElement('img');
		(this.internalMedia as HTMLImageElement).src = this.dataUrl;

		await new Promise<void>((resolve, reject) => {
			(this.internalMedia as HTMLImageElement).onload = () => {
				this.dimensions = [
					(this.internalMedia as HTMLImageElement).naturalWidth,
					(this.internalMedia as HTMLImageElement).naturalHeight,
				];
				resolve();
			};
			(this.internalMedia as HTMLImageElement).onerror = () =>
				reject(new Error(`Failed to load image: ${url}`));
		});
	}

	/** Fetch and decode a video, extracting its dimensions and duration. */
	private async loadVideo(url: string): Promise<void> {
		const response = await fetch(url, { cache: 'no-cache' });
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
			vid.onerror = () => reject(new Error(`Failed to load video: ${url}`));
		});
	}

	/**
	 * Set up the canvas element after the layer's media has been loaded.
	 * Draws the initial frame for images, sets up the 2D context for videos.
	 */
	setupCanvasElement(): void {
		if (!this.$element || this.$element.tagName !== 'CANVAS') return;
		const canvas = this.$element as HTMLCanvasElement;
		canvas.width = this.dimensions[0] || this.projectWidth;
		canvas.height = this.dimensions[1] || this.projectHeight;
		if (!this.ctx) {
			this.ctx = canvas.getContext('2d')!;
			this.ctx.imageSmoothingEnabled = true;
			this.ctx.imageSmoothingQuality = 'high';

			if (this.json.type === 'image' && this.internalMedia) {
				this.ctx.drawImage(
					this.internalMedia as HTMLImageElement,
					0, 0, this.dimensions[0], this.dimensions[1]
				);
			}
		}
	}

	// -- Frame rendering (apply properties as CSS) --------------------------

	/**
	 * Render this layer's visual state at the given frame.
	 *
	 * Hides the element if the frame is outside the layer's time range,
	 * otherwise computes interpolated property values and applies them.
	 */
	async renderFrame(frame: number): Promise<void> {
		if (!this.$element) return;

		// Visibility check
		if (frame < this.actualStartFrame || frame >= this.endFrame || !this.json.settings.enabled) {
			this.$element.style.display = 'none';
			return;
		}

		const props = this.getPropertiesAtFrame(frame);
		await this.applyProperties(props);
		this.$element.style.display = '';

		// For video layers, seek to the correct time and redraw
		if (this.json.type === 'video' && this.internalMedia && this.ctx) {
			const vid = this.internalMedia as HTMLVideoElement;
			const targetTime = this.retimeFrame(frame) / this.fps;
			vid.pause();

			await new Promise<void>((resolve) => {
				const timeout = setTimeout(() => resolve(), 2000);
				vid.requestVideoFrameCallback(() => {
					clearTimeout(timeout);
					resolve();
				});
				vid.currentTime = targetTime;
			});

			this.ctx.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
			this.ctx.drawImage(vid, 0, 0, this.dimensions[0], this.dimensions[1]);
		}
	}

	/**
	 * Apply a set of interpolated property values to the DOM element.
	 *
	 * Most properties are mapped to CSS custom properties or standard CSS
	 * properties.  Special cases (text content, fit attribute, filters,
	 * box-shadow) are handled individually.
	 */
	async applyProperties(props: Record<string, any>): Promise<void> {
		if (!this.$element) return;

		// Reset styles but keep display state
		const wasHidden = this.$element.style.display === 'none';
		this.$element.style.cssText = wasHidden ? 'display:none;' : '';

		// z-index (layer ordering)
		this.$element.style.setProperty('z-index', String(this.getLayerIndex() + 1));

		// Image/video dimensions
		if (this.json.type === 'image' || this.json.type === 'video') {
			this.$element.style.setProperty('--object-width', String(this.dimensions[0]));
			this.$element.style.setProperty('--object-height', String(this.dimensions[1]));
		}

		// Collect active filters
		const activeFilters: string[] = [];

		for (const [prop, value] of Object.entries(props)) {
			// Handle special properties
			if (prop === 'text') {
				this.$element.textContent = value ?? '';
				continue;
			}
			if (prop === 'visible') {
				if (!value) this.$element.style.visibility = 'hidden';
				continue;
			}
			if (prop === 'fit') {
				this.$element.setAttribute('data-fit', value);
				continue;
			}
			if (prop === 'boxShadow') {
				if (value) {
					this.$element.style.setProperty('box-shadow',
						'var(--box-shadow-offset-0) var(--box-shadow-offset-1) var(--box-shadow-blur) var(--box-shadow-spread) var(--box-shadow-color)');
				}
				continue;
			}
			if (prop === 'textShadow') {
				if (value) {
					this.$element.style.setProperty('text-shadow',
						'var(--text-shadow-offset-0) var(--text-shadow-offset-1) var(--text-shadow-blur) var(--text-shadow-color)');
				}
				continue;
			}
			if (prop === 'textStroke' || prop === 'mute' || prop === 'pitch') continue;
			if (prop === 'outerBorder') {
				if (value) this.$element.style.setProperty('box-sizing', 'content-box');
				continue;
			}
			if (prop === 'fontFamily') {
				await this.renderer.loadFont(value);
				this.$element.style.setProperty('font-family', `"${value}", "Noto Sans", sans-serif`);
				continue;
			}

			// Track active filters
			if (prop.startsWith('filter')) {
				const filterKey = prop.charAt(6).toLowerCase() + prop.slice(7);
				if (filterKey in FILTER_MAP) {
					activeFilters.push(filterKey);
				}
			}

			// Map property name to CSS
			const cssName = this.propToCss(prop);
			if (cssName) {
				if (Array.isArray(value) && cssName.startsWith('--')) {
					for (let i = 0; i < value.length; i++) {
						this.$element.style.setProperty(`${cssName}-${i}`, String(value[i]));
					}
				} else {
					this.$element.style.setProperty(cssName, Array.isArray(value) ? value.join(' ') : String(value));
				}
			}
		}

		// Apply compound filter property
		if (activeFilters.length > 0) {
			this.$element.style.setProperty('filter',
				activeFilters.map(f => `${FILTER_MAP[f]}(var(--filter-${FILTER_MAP[f]}))`).join(' '));
		}
	}

	/** Convert a camelCase property name to its CSS equivalent. */
	private propToCss(prop: string): string | null {
		const map: Record<string, string> = {
			opacity: 'opacity',
			position: '--position',
			scale: '--scale',
			rotation: '--rotation',
			anchor: '--anchor',
			backgroundColor: 'background-color',
			borderWidth: 'border-width',
			borderStyle: 'border-style',
			borderColor: 'border-color',
			borderRadius: 'border-radius',
			boxShadowBlur: '--box-shadow-blur',
			boxShadowOffset: '--box-shadow-offset',
			boxShadowSpread: '--box-shadow-spread',
			boxShadowColor: '--box-shadow-color',
			outlineWidth: 'outline-width',
			outlineStyle: 'outline-style',
			outlineColor: 'outline-color',
			outlineOffset: 'outline-offset',
			filterBlur: '--filter-blur',
			filterBrightness: '--filter-brightness',
			filterContrast: '--filter-contrast',
			filterGrayscale: '--filter-grayscale',
			filterSepia: '--filter-sepia',
			filterInvert: '--filter-invert',
			filterHueRotate: '--filter-hue-rotate',
			filterSaturate: '--filter-saturate',
			blendMode: 'mix-blend-mode',
			perspective: '--perspective',
			fontSize: 'font-size',
			fontWeight: 'font-weight',
			fontStyle: 'font-style',
			fontStretch: 'font-stretch',
			color: 'color',
			textAlign: 'text-align',
			verticalAlign: 'vertical-align',
			padding: 'padding',
			textStrokeWidth: '-webkit-text-stroke-width',
			textStrokeColor: '-webkit-text-stroke-color',
			textShadowColor: '--text-shadow-color',
			textShadowOffset: '--text-shadow-offset',
			textShadowBlur: '--text-shadow-blur',
			letterSpacing: 'letter-spacing',
			lineHeight: 'line-height',
			textTransform: 'text-transform',
			textDecoration: 'text-decoration',
			wordSpacing: 'word-spacing',
			textIndent: 'text-indent',
			direction: 'direction',
			// Audio properties don't have CSS equivalents
			volume: null as any,
			pan: null as any,
		};
		return map[prop] ?? null;
	}

	/** Get this layer's index in the parent layers array (for z-ordering). */
	private getLayerIndex(): number {
		return this.renderer.layers.indexOf(this);
	}

	// -- Cleanup ------------------------------------------------------------

	/** Release object URLs and other resources. */
	destroy(): void {
		if (this.dataUrl) {
			URL.revokeObjectURL(this.dataUrl);
			this.dataUrl = null;
		}
	}
}

// ---------------------------------------------------------------------------
//  BrowserRenderer
// ---------------------------------------------------------------------------

export default class BrowserRenderer {
	/** The compiled video JSON being rendered. */
	private videoJSON: VideoJSON;
	/** Runtime layer wrappers. */
	layers: RuntimeLayer[] = [];
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

		// Create runtime layers
		for (const layerJSON of videoJSON.layers) {
			this.layers.push(new RuntimeLayer(layerJSON, videoJSON.fps, videoJSON.width, videoJSON.height, this));
		}
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
				layer.setupCanvasElement();
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
					if (layer.json.settings.enabled && layer.hasVisual) {
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
	private async generateLayerAudio(layer: RuntimeLayer, audioCtx: OfflineAudioContext): Promise<void> {
		const source = layer.json.settings.source;
		if (!source) return;

		// Decode audio data
		let arrayBuffer: ArrayBuffer;
		if (layer.dataBlob) {
			arrayBuffer = await layer.dataBlob.arrayBuffer();
		} else {
			const res = await fetch(source);
			arrayBuffer = await res.arrayBuffer();
		}
		const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

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
		layer: RuntimeLayer,
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
