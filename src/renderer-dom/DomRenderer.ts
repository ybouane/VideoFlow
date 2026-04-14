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

import type { VideoJSON, LayerJSON, LayerSettingsJSON, Animation, PropertyDefinition } from '@videoflow/core/types';
import { audioBufferToWav } from '@videoflow/core/utils';
import { loadedMedia } from '@videoflow/core';
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
	/** Fast id → runtime layer lookup, kept in sync with `layers`. */
	layerById: Map<string, RuntimeBaseLayer> = new Map();
	/** Track whether DOM elements have been set up. */
	private elementsSetup = false;
	/**
	 * Serializes structural/property mutations so they don't interleave with
	 * each other. Each mutation awaits the previous one before running.
	 */
	private mutationQueue: Promise<void> = Promise.resolve();
	/** Current frame rendered. */
	currentFrame = -1;
	private rendering = false;
	private pendingFrame: number | false = false;

	/** Google Fonts already loaded into the shadow DOM. */
	private loadedFonts: Record<string, string> = {};

	/** Whether playback is active. */
	playing = false;

	/**
	 * Optional callback fired whenever a new frame is rendered. Set this
	 * externally to keep a UI (seek bar, time label, …) in sync with playback.
	 */
	onFrame: ((frame: number) => void) | null = null;

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
		// Serialize through the mutation queue so concurrent loadVideo() calls,
		// or a loadVideo() racing with an addLayer/updateLayer/... mutation,
		// can't interleave and leave stale state (e.g., multiple [data-renderer]
		// canvases in the shadow, orphaned layer refs, etc.).
		return this.enqueueMutation(async () => {
			// Stop playback / pending audio, but DO NOT destroy old layers yet —
			// we want to keep their cache references alive while the new layers
			// acquire theirs, so any source present in both old and new JSONs
			// stays in the cache without bouncing through refCount === 0.
			this.stop();

			// Wait for any in-flight renderFrame() kicked off from outside the
			// mutation queue (seek, play, currentTime setter, public renderFrame)
			// to drain before we start swapping state — otherwise that render
			// could finish mid-swap and paint into the wrong canvas.
			while (this.rendering) {
				await new Promise<void>(r => queueMicrotask(r));
			}

			const oldLayers = this.layers;
			const oldCanvas = this.$canvas;

			// 1. Construct new runtime layers (no fetches yet).
			const newLayers = videoJSON.layers.map(layerJSON =>
				createRuntimeLayer(layerJSON, videoJSON.fps, videoJSON.width, videoJSON.height, this)
			);

			// 2. Initialise them in parallel — this is where each layer acquires
			//    its source from the global media cache. Sources shared with the
			//    outgoing layers are reused, not re-fetched.
			await Promise.all(newLayers.map(layer => layer.initialize()));

			// 3. Resolve any deferred sourceEnd → sourceDuration now that intrinsic
			//    durations are known.
			for (const layer of newLayers) layer.resolveMediaTimings();

			// 4. Make sure the renderer stylesheet is present. Reuse the existing
			//    one if the shadow already has it so we don't thrash styles during
			//    reload.
			if (!this.shadow.querySelector('style[data-renderer-css]')) {
				const style = document.createElement('style');
				style.setAttribute('data-renderer-css', '');
				style.textContent = RENDERER_CSS;
				this.shadow.appendChild(style);
			}

			// 5. Build the new $canvas but keep the old one mounted and visible
			//    so the user keeps seeing the previous frame until the new canvas
			//    has had its layers generated and the first frame painted. The
			//    new canvas is taken out of flow (position: absolute) and hidden
			//    so it doesn't disturb the old canvas's layout.
			const newCanvas = document.createElement('div');
			newCanvas.toggleAttribute('data-renderer', true);
			newCanvas.style.setProperty('--project-width-target', String(videoJSON.width));
			newCanvas.style.setProperty('--project-height-target', String(videoJSON.height));
			newCanvas.style.backgroundColor = videoJSON.backgroundColor || '#000000';
			// Hide the new canvas off-flow whenever there's anything else visible
			// in the shadow with [data-renderer] (normally the old canvas, but
			// this also covers leaked canvases from an earlier interrupted run).
			const hasExistingCanvas = this.shadow.querySelector('[data-renderer]') !== null;
			if (hasExistingCanvas) {
				newCanvas.style.position = 'absolute';
				newCanvas.style.visibility = 'hidden';
			}
			this.shadow.appendChild(newCanvas);

			// 6. Swap runtime state so renderFrame targets the new canvas/layers.
			this.videoJSON = videoJSON;
			this.layers = newLayers;
			this.layerById = new Map(newLayers.map(l => [l.json.id, l]));
			this.$canvas = newCanvas;
			this.currentFrame = -1;
			this.elementsSetup = false;

			try {
				// 7. Generate layer DOM inside the new canvas and render frame 0
				//    into it. The old canvas is still on screen during this step.
				await this.renderFrame(0, true);
			} finally {
				// 8. Atomic swap: remove every [data-renderer] except the new one.
				//    Using querySelectorAll (instead of just oldCanvas) makes this
				//    self-healing — if a previous loadVideo was interrupted and
				//    left a stray canvas behind, it gets cleaned up here too.
				const canvases = this.shadow.querySelectorAll('[data-renderer]');
				for (const el of Array.from(canvases)) {
					if (el !== newCanvas) el.remove();
				}
				newCanvas.style.removeProperty('position');
				newCanvas.style.removeProperty('visibility');

				// 9. Release the old layers AFTER the new ones are holding their
				//    refs AND the handoff is visually complete. Sources unique to
				//    the old set drop to refCount === 0 and enter the cache's 5 s
				//    eviction grace window — if the user quickly reloads a project
				//    that needs them again, the timer is canceled and there is no
				//    re-fetch. Done in `finally` so refs are released even when
				//    renderFrame(0) throws, and ignored if oldLayers === newLayers
				//    (shouldn't happen, but cheap to guard).
				if (oldLayers !== newLayers) {
					for (const layer of oldLayers) layer.destroy();
				}
			}
		});
	}

	// -----------------------------------------------------------------------
	//  Incremental mutation API
	//
	//  These methods allow editors to mutate the loaded video without tearing
	//  down and rebuilding the entire Shadow DOM as `loadVideo()` would. Each
	//  mutation is serialized through `mutationQueue` so callers can fire them
	//  without worrying about interleaving, and each one concludes by
	//  re-rendering the current frame so the preview stays in sync.
	//
	//  Property/settings/animation edits are fully in-place: the existing
	//  `$element` is kept and its inline styles / CSS variables are updated.
	//  Structural edits (add/remove/reorder) touch `this.layers` and the
	//  `$canvas` child list but don't rebuild unrelated layers.
	// -----------------------------------------------------------------------

	/**
	 * Queue a mutation so it runs after any in-flight mutation completes.
	 * The returned promise resolves with the mutation's result (or rejects
	 * with its error) but the queue itself is never left in a rejected state.
	 */
	private enqueueMutation<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.mutationQueue.then(fn, fn);
		this.mutationQueue = run.then(() => {}, () => {});
		return run;
	}

	/**
	 * Apply a property / settings / animations patch to a single layer.
	 *
	 * - `settings` and `properties` are shallow-merged into `layer.json`.
	 * - `animations` replaces the array wholesale (callers hold the diffing
	 *   logic because per-keyframe reconciliation is cheap to do in editor
	 *   state).
	 *
	 * If `settings.source` changed, the layer's media is re-initialized via
	 * `layer.initialize()` — callers should debounce rapid source swaps.
	 *
	 * If a text layer's `fontFamily` is among the patched properties, the font
	 * is loaded into the shadow DOM before the frame is re-rendered.
	 *
	 * @param id - The layer id to patch.
	 * @param patch - A partial patch. Any subset of settings/properties/animations.
	 * @returns Resolves once the patch has been applied and the current frame re-rendered.
	 */
	async updateLayer(id: string, patch: {
		settings?: Partial<LayerSettingsJSON>;
		properties?: Record<string, any>;
		animations?: Animation[];
	}): Promise<void> {
		return this.enqueueMutation(async () => {
			const layer = this.layerById.get(id);
			if (!layer) return;

			const prevSource = layer.json.settings.source;

			if (patch.settings) {
				layer.json.settings = { ...layer.json.settings, ...patch.settings };
			}
			if (patch.properties) {
				layer.json.properties = { ...layer.json.properties, ...patch.properties };
			}
			if (patch.animations) {
				layer.json.animations = patch.animations;
			}

			// If the source changed, re-initialize media. The global media cache
			// makes this cheap when swapping between already-loaded sources.
			if (patch.settings && 'source' in patch.settings && patch.settings.source !== prevSource) {
				await layer.initialize();
				layer.resolveMediaTimings();
			}

			// If a text-bearing layer changed its font, load it before rendering.
			const newFont = patch.properties?.fontFamily;
			if (typeof newFont === 'string' && newFont.length > 0) {
				await this.loadFont(newFont);
			}

			await this.renderFrame(this.currentFrame < 0 ? 0 : this.currentFrame, true);
		});
	}

	/**
	 * Insert a new layer into the video at the given index (defaults to end).
	 *
	 * The new layer is constructed, initialized, and mounted into the existing
	 * `$canvas` — other layers' DOM elements are left untouched.
	 *
	 * @param layerJSON - The layer JSON to add. Must include a unique `id`.
	 * @param index - The insertion index in `this.layers`. Defaults to appending.
	 */
	async addLayer(layerJSON: LayerJSON, index?: number): Promise<void> {
		return this.enqueueMutation(async () => {
			if (!this.videoJSON || !this.$canvas) {
				throw new Error('DomRenderer.addLayer: no video loaded. Call loadVideo() first.');
			}
			if (this.layerById.has(layerJSON.id)) {
				throw new Error(`DomRenderer.addLayer: layer id "${layerJSON.id}" already exists.`);
			}

			const insertAt = index === undefined ? this.layers.length : Math.max(0, Math.min(index, this.layers.length));

			const layer = createRuntimeLayer(
				layerJSON,
				this.videoJSON.fps,
				this.videoJSON.width,
				this.videoJSON.height,
				this
			);
			await layer.initialize();
			layer.resolveMediaTimings();

			// Splice into the layers array and the id lookup.
			this.layers.splice(insertAt, 0, layer);
			this.layerById.set(layerJSON.id, layer);
			this.videoJSON.layers.splice(insertAt, 0, layerJSON);

			// Mount the layer's DOM element inside $canvas at the matching
			// position so z-ordering (via DOM order) matches the layers array.
			if (this.elementsSetup && layer.json.settings.enabled) {
				const $el = await layer.generateElement();
				if ($el) {
					const nextSiblingIndex = insertAt + 1;
					const nextEl = nextSiblingIndex < this.layers.length
						? this.layers[nextSiblingIndex].$element
						: null;
					if (nextEl && nextEl.parentNode === this.$canvas) {
						this.$canvas.insertBefore($el, nextEl);
					} else {
						this.$canvas.appendChild($el);
					}
				}
			}

			await this.renderFrame(this.currentFrame < 0 ? 0 : this.currentFrame, true);
		});
	}

	/**
	 * Remove a layer from the video.
	 *
	 * Destroys the layer (releasing its media ref) and detaches its DOM
	 * element. Other layers are untouched.
	 */
	async removeLayer(id: string): Promise<void> {
		return this.enqueueMutation(async () => {
			const layer = this.layerById.get(id);
			if (!layer) return;

			const idx = this.layers.indexOf(layer);
			if (idx === -1) return;

			// Detach DOM first so a late renderFrame can't touch it.
			if (layer.$element && layer.$element.parentNode) {
				layer.$element.parentNode.removeChild(layer.$element);
			}

			this.layers.splice(idx, 1);
			this.layerById.delete(id);
			if (this.videoJSON) {
				const jsonIdx = this.videoJSON.layers.findIndex(l => l.id === id);
				if (jsonIdx !== -1) this.videoJSON.layers.splice(jsonIdx, 1);
			}

			layer.destroy();

			await this.renderFrame(this.currentFrame < 0 ? 0 : this.currentFrame, true);
		});
	}

	/**
	 * Reorder layers to match the given id sequence.
	 *
	 * The runtime layers and the backing `videoJSON.layers` array are reordered,
	 * and the layers' `$element`s are re-appended to `$canvas` in the new order
	 * (DOM order drives z-index via the `z-index` style written in
	 * `applyProperties`). No media is touched.
	 *
	 * @param orderedIds - The new layer order. Must contain exactly the set of
	 *   currently-loaded layer ids, in any order. Extra/missing ids throw.
	 */
	async reorderLayers(orderedIds: string[]): Promise<void> {
		return this.enqueueMutation(async () => {
			if (orderedIds.length !== this.layers.length) {
				throw new Error(
					`DomRenderer.reorderLayers: expected ${this.layers.length} ids, got ${orderedIds.length}.`
				);
			}

			const next: RuntimeBaseLayer[] = [];
			for (const id of orderedIds) {
				const layer = this.layerById.get(id);
				if (!layer) {
					throw new Error(`DomRenderer.reorderLayers: unknown layer id "${id}".`);
				}
				next.push(layer);
			}

			this.layers = next;
			if (this.videoJSON) {
				this.videoJSON.layers = next.map(l => l.json);
			}

			// Re-append in new order. appendChild moves existing nodes, so this
			// is a reorder rather than a re-mount.
			if (this.elementsSetup && this.$canvas) {
				for (const layer of next) {
					if (layer.$element && layer.$element.parentNode === this.$canvas) {
						this.$canvas.appendChild(layer.$element);
					}
				}
			}

			await this.renderFrame(this.currentFrame < 0 ? 0 : this.currentFrame, true);
		});
	}

	/**
	 * Patch top-level video properties (width, height, backgroundColor).
	 *
	 * `fps` and `duration` changes are not supported here — they invalidate
	 * frame numbers across the pipeline and require a full `loadVideo()`.
	 */
	async updateVideo(patch: {
		width?: number;
		height?: number;
		backgroundColor?: string;
		name?: string;
	}): Promise<void> {
		return this.enqueueMutation(async () => {
			if (!this.videoJSON || !this.$canvas) return;

			if (patch.width !== undefined) {
				this.videoJSON.width = patch.width;
				this.$canvas.style.setProperty('--project-width-target', String(patch.width));
			}
			if (patch.height !== undefined) {
				this.videoJSON.height = patch.height;
				this.$canvas.style.setProperty('--project-height-target', String(patch.height));
			}
			if (patch.backgroundColor !== undefined) {
				this.videoJSON.backgroundColor = patch.backgroundColor;
				this.$canvas.style.backgroundColor = patch.backgroundColor;
			}
			if (patch.name !== undefined) {
				this.videoJSON.name = patch.name;
			}

			await this.renderFrame(this.currentFrame < 0 ? 0 : this.currentFrame, true);
		});
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
			this.onFrame?.(frame);
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
	 * @param options - Optional callbacks:
	 *   - `fpsCallback(fps)` — fired every animation frame with the current
	 *     measured render FPS, useful for a HUD/diagnostic display.
	 *
	 * To track frame changes, set the public {@link onFrame} property.
	 */
	async play(options: {
		fpsCallback?: (fps: number) => void;
	} = {}): Promise<void> {
		const { fpsCallback } = options;
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
				fpsCallback?.(frameFps);

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
		this.layerById.clear();
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

		// Reuse the layer's pre-decoded AudioBuffer if it has one.
		let audioBuffer: AudioBuffer | null = ((layer as any).decodedBuffer as AudioBuffer | null) ?? null;

		if (!audioBuffer) {
			let arrayBuffer: ArrayBuffer;
			const blob = (layer as any).dataBlob as Blob | null;
			let acquiredFromCache = false;
			if (blob) {
				arrayBuffer = await blob.arrayBuffer();
			} else {
				const entry = await loadedMedia.acquire(source);
				acquiredFromCache = true;
				arrayBuffer = await entry.blob.arrayBuffer();
			}

			try {
				audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
			} catch (e) {
				// Audio decoding failed — this layer has no decodable audio
				// (e.g., video with no audio track, or unsupported format)
				if (acquiredFromCache) loadedMedia.release(source);
				return;
			}
			if (acquiredFromCache) loadedMedia.release(source);
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

		const whenSec = layer.startTime;
		const sourceStartSec = layer.sourceStart;
		const sourceDurationSec = layer.sourceDuration;
		let offsetSec: number;
		if (speed < 0) {
			const totalLen = audioBuffer.duration;
			offsetSec = Math.max(0, totalLen - (sourceStartSec + sourceDurationSec));
		} else {
			offsetSec = sourceStartSec;
		}
		bufferSource.start(whenSec, offsetSec, sourceDurationSec);
	}

	private applyAudioKeyframes(
		layer: RuntimeBaseLayer,
		property: string,
		param: AudioParam,
		audioCtx: OfflineAudioContext
	): void {
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

	private cleanupAudio(): void {
		this.audio?.pause();
		this.audio = null;
		if (this.audioUrl) {
			URL.revokeObjectURL(this.audioUrl);
			this.audioUrl = null;
		}
	}
}
