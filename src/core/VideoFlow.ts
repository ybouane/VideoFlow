/**
 * VideoFlow — the main builder class for creating videos programmatically.
 *
 * The flow API lets you add layers, set properties, create animations, and
 * control timing using a fluent, sequential interface.  When you are done
 * building, call {@link compile} to resolve media metadata and produce the
 * final {@link VideoJSON} that can be fed to a renderer.
 *
 * Usage:
 * ```ts
 * import VideoFlow from '@videoflow/core';
 *
 * const $ = new VideoFlow({ name: 'Demo', width: 1920, height: 1080, fps: 30 });
 *
 * const bg = $.addImage({ fit: 'cover' }, { source: 'https://example.com/bg.jpg' });
 * bg.animate({ filterBlur: 0 }, { filterBlur: 10 }, { duration: '5s', wait: false });
 *
 * const text = $.addText({ text: 'Hello!', fontSize: 1.5, color: '#fff' });
 * text.animate({ opacity: 0 }, { opacity: 1, scale: 1.2 }, { duration: '3s', wait: false });
 *
 * $.wait('1s');
 *
 * const json = await $.compile();
 * ```
 */

import type {
	Time, Action, Easing, AddLayerOptions,
	VideoJSON, ProjectSettings,
} from './types.js';
import { parseTime, timeToFrames, probeMediaDuration } from './utils.js';
import { loadedMedia, type MediaCache } from './MediaCache.js';

import BaseLayer from './layers/BaseLayer.js';
import TextLayer from './layers/TextLayer.js';
import type { TextLayerProperties, TextLayerSettings } from './layers/TextLayer.js';
import ImageLayer from './layers/ImageLayer.js';
import type { ImageLayerProperties, ImageLayerSettings } from './layers/ImageLayer.js';
import VideoLayerClass from './layers/VideoLayer.js';
import type { VideoLayerProperties, VideoLayerSettings } from './layers/VideoLayer.js';
import AudioLayer from './layers/AudioLayer.js';
import type { AudioLayerProperties, AudioLayerSettings } from './layers/AudioLayer.js';
import CaptionsLayer from './layers/CaptionsLayer.js';
import type { CaptionsLayerProperties, CaptionsLayerSettings } from './layers/CaptionsLayer.js';

// ---------------------------------------------------------------------------
//  Default project settings
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS: Required<ProjectSettings> = {
	name: 'Untitled Video',
	width: 1920,
	height: 1080,
	fps: 30,
	backgroundColor: '#000000',
	verbose: false,
	autoDetectDurations: true,
	defaults: {
		easing: 'easeInOut',
		fontFamily: 'Noto Sans',
	},
};

// ---------------------------------------------------------------------------
//  VideoFlow class
// ---------------------------------------------------------------------------

export default class VideoFlow {
	/** Project settings (dimensions, fps, defaults). */
	settings: Required<ProjectSettings>;

	/**
	 * Global, refcounted, time-evicted media cache shared by every VideoFlow
	 * instance and every renderer. Use this to look up an already-fetched
	 * source, instrument cache behavior in tests, or release entries early.
	 *
	 * Entries are kept alive for a short grace period (default 5 s) after
	 * their refCount drops to zero, which is what makes the compile→render
	 * handoff and back-to-back `loadVideo()` reloads avoid re-fetching.
	 */
	static get loadedMedia(): MediaCache {
		return loadedMedia;
	}

	/**
	 * All layers created through the flow API.
	 * Used during compilation to look up layer metadata.
	 */
	layers: BaseLayer[] = [];

	/**
	 * The sequential list of flow actions.
	 * This is the "program" that gets compiled into the video JSON.
	 */
	flow: Action[] = [];

	/** Internal pointer into the flow — changes during `parallel()`. */
	private _flowPointer: Action[] = this.flow;

	constructor(settings: ProjectSettings = {}) {
		this.settings = {
			...DEFAULT_SETTINGS,
			...settings,
			defaults: {
				...DEFAULT_SETTINGS.defaults,
				...(settings.defaults || {}),
			},
		};
	}

	// -----------------------------------------------------------------------
	//  Flow control
	// -----------------------------------------------------------------------

	/**
	 * Push a raw action onto the current flow pointer.
	 * @internal Used by layers to record their actions.
	 */
	pushAction(action: Action): void {
		this._flowPointer.push(action);
	}

	/**
	 * Pause the timeline for the given duration before the next action.
	 *
	 * @param time - How long to wait (accepts any {@link Time} format).
	 */
	wait(time: Time): this {
		this.pushAction({ statement: 'wait', duration: time });
		return this;
	}

	/**
	 * Execute multiple sequences of actions in parallel.
	 *
	 * Each function receives its own timeline; the overall flow pointer
	 * advances to the end of the longest parallel branch.
	 *
	 * ```ts
	 * $.parallel([
	 *   () => { text.animate({opacity:0},{opacity:1},{duration:'1s'}); },
	 *   () => { bg.animate({filterBlur:0},{filterBlur:5},{duration:'2s'}); },
	 * ]);
	 * ```
	 */
	parallel(funcs: Array<() => void>): this {
		const initialPointer = this._flowPointer;
		const actions: Action[][] = [];
		for (const fn of funcs) {
			this._flowPointer = [];
			actions.push(this._flowPointer);
			fn();
		}
		this._flowPointer = initialPointer;
		this.pushAction({ statement: 'parallel', actions });
		return this;
	}

	// -----------------------------------------------------------------------
	//  Generic addLayer
	// -----------------------------------------------------------------------

	/**
	 * Add a layer of the given class to the flow.
	 *
	 * @typeParam T - The layer class type.
	 * @param LayerClass  - Constructor for the layer.
	 * @param properties  - Initial property values.
	 * @param settings    - Layer settings (timing, source, etc.).
	 * @param options     - Flow options (waitFor, index).
	 * @returns The created layer instance (can be used for chaining animate/set/remove).
	 */
	addLayer<T extends BaseLayer>(
		LayerClass: new (parent: VideoFlow, properties?: any, settings?: any) => T,
		properties: Record<string, any> = {},
		settings: Record<string, any> = {},
		options: AddLayerOptions = {}
	): T {
		const layer = new LayerClass(this, properties, settings);
		this.layers.push(layer);
		this.pushAction({
			statement: 'addLayer',
			id: layer.id,
			type: (LayerClass as any).type,
			settings,
			properties,
			options,
		});
		return layer;
	}

	// -----------------------------------------------------------------------
	//  Typed convenience methods for each layer type
	// -----------------------------------------------------------------------

	/** Add a text layer. */
	addText(properties?: TextLayerProperties, settings?: TextLayerSettings, options?: AddLayerOptions): TextLayer {
		return this.addLayer(TextLayer, properties, settings, options);
	}

	/** Add an image layer from a URL or file path. */
	addImage(properties?: ImageLayerProperties, settings?: ImageLayerSettings, options?: AddLayerOptions): ImageLayer {
		return this.addLayer(ImageLayer, properties, settings, options);
	}

	/** Add a video layer from a URL or file path. */
	addVideo(properties?: VideoLayerProperties, settings?: VideoLayerSettings, options?: AddLayerOptions): VideoLayerClass {
		return this.addLayer(VideoLayerClass, properties, settings, options);
	}

	/** Add an audio layer from a URL or file path. */
	addAudio(properties?: AudioLayerProperties, settings?: AudioLayerSettings, options?: AddLayerOptions): AudioLayer {
		return this.addLayer(AudioLayer, properties, settings, options);
	}

	/** Add a captions layer with pre-defined timed captions. */
	addCaptions(properties?: CaptionsLayerProperties, settings?: CaptionsLayerSettings, options?: AddLayerOptions): CaptionsLayer {
		return this.addLayer(CaptionsLayer, properties, settings, options);
	}

	// -----------------------------------------------------------------------
	//  Compilation
	// -----------------------------------------------------------------------

	/**
	 * Compile the flow into a {@link VideoJSON} object.
	 *
	 * This method:
	 * 1. Walks the flow actions sequentially, maintaining a time pointer.
	 * 2. Converts all time values to frame numbers.
	 * 3. Builds keyframe arrays from `set` / `animate` actions.
	 * 4. Calculates the total project duration.
	 * 5. Returns the complete JSON ready for rendering.
	 *
	 * Media metadata (image dimensions, video/audio duration) is resolved
	 * during compilation so that `waitFor: 'finish'` and auto-duration work
	 * correctly.
	 */
	async compile(): Promise<VideoJSON> {
		const fps = this.settings.fps;

		/**
		 * Internal representation of a compiled layer.
		 *
		 * `startTimeFrames` / `endTimeFrames` are timeline-time frames; the
		 * delta between them is `timelineDuration * fps`. Source-time fields
		 * (`sourceStartSec`) live in source-seconds. Keyframes are stored on
		 * `properties[prop][i].time` in **source seconds** (absolute position
		 * inside the source media).
		 */
		type CompiledLayer = {
			id: string;
			type: string;
			startTimeFrames: number;        // timeline frames
			endTimeFrames: number | false;  // timeline frames, false = unbounded
			speed: number;
			sourceStartSec: number;         // source seconds
			name?: string;
			enabled: boolean;
			settings: Record<string, any>; // raw settings passed by user
			properties: Record<string, any[]>; // property → keyframe array (kf.time in source sec)
			index: number;
			layerObj: BaseLayer;
			/** Intrinsic source duration in seconds, when known. */
			mediaDurationSec?: number;
			/** Unresolved sourceEnd in seconds (only when probe failed / disabled). */
			sourceEndUnresolvedSec?: number;
		};

		const compiled: Map<string, CompiledLayer> = new Map();
		const indexes: Record<string, number> = {};

		// ------------------------------------------------------------------
		//  Pre-pass: kick off duration probes for media layers in parallel.
		//  Probes populate the global media cache (VideoFlow.loadedMedia) so
		//  the renderer can reuse the bytes without a second fetch.
		// ------------------------------------------------------------------
		const probePromises = new Map<string, Promise<number>>();
		const collectMediaActions = (actions: Action[]): void => {
			for (const action of actions) {
				if (action.statement === 'parallel') {
					for (const branch of action.actions) collectMediaActions(branch);
				} else if (action.statement === 'addLayer') {
					if (action.type !== 'video' && action.type !== 'audio') continue;
					const s = action.settings || {};
					if (s.sourceDuration != null) continue;
					if (s.mediaDuration != null) continue;
					if (!this.settings.autoDetectDurations) continue;
					const source = s.source;
					if (!source || typeof source !== 'string') continue;
					if (probePromises.has(source)) continue;
					// If the cache already has an entry from a prior compile,
					// skip the network probe entirely — the renderer will read
					// duration off the cache entry directly.
					if (loadedMedia.has(source)) {
						probePromises.set(source, Promise.resolve(NaN));
						continue;
					}
					const kind = action.type === 'audio' ? 'audio' : 'video';
					probePromises.set(
						source,
						probeMediaDuration(source, kind).catch((err) => {
							if (this.settings.verbose) {
								console.warn(`[VideoFlow] probeMediaDuration failed for "${source}":`, err?.message ?? err);
							}
							return NaN;
						})
					);
				}
			}
		};
		collectMediaActions(this.flow);

		/**
		 * Resolve sourceDuration / mediaDuration / sourceEnd for an addLayer
		 * action. Returns source-time values (in seconds).
		 */
		const resolveMediaTimings = async (
			action: Extract<Action, { statement: 'addLayer' }>
		): Promise<{
			sourceDurationSec: number | null;
			mediaDurationSec: number | undefined;
			sourceEndUnresolvedSec: number | undefined;
		}> => {
			const isMedia = action.type === 'video' || action.type === 'audio';
			const s = action.settings || {};
			const sourceStartSec = s.sourceStart != null ? parseTime(s.sourceStart, fps) : 0;
			const sourceEndSec = s.sourceEnd != null ? parseTime(s.sourceEnd, fps) : 0;

			// 1. Explicit sourceDuration always wins (silently overrides sourceEnd).
			if (s.sourceDuration != null) {
				let mediaDurationSec: number | undefined;
				if (s.mediaDuration != null) {
					mediaDurationSec = parseTime(s.mediaDuration, fps);
				}
				return {
					sourceDurationSec: parseTime(s.sourceDuration, fps),
					mediaDurationSec,
					sourceEndUnresolvedSec: undefined,
				};
			}

			if (!isMedia) {
				return { sourceDurationSec: null, mediaDurationSec: undefined, sourceEndUnresolvedSec: undefined };
			}

			// 2. Explicit mediaDuration.
			if (s.mediaDuration != null) {
				const dm = parseTime(s.mediaDuration, fps);
				const dur = Math.max(0, dm - sourceStartSec - sourceEndSec);
				return {
					sourceDurationSec: dur,
					mediaDurationSec: dm,
					sourceEndUnresolvedSec: undefined,
				};
			}

			// 3. Probe (if enabled and source available).
			const source = typeof s.source === 'string' ? s.source : undefined;
			if (source) {
				let probed: number = NaN;
				const pending = probePromises.get(source);
				if (pending) {
					probed = await pending;
				}
				// If the probe returned NaN (failed or skipped because the
				// cache already had the entry), try to read duration straight
				// from the existing cache entry instead.
				if (!(Number.isFinite(probed) && probed > 0) && loadedMedia.has(source)) {
					try {
						const entry = await loadedMedia.acquire(source);
						probed = entry.duration;
						loadedMedia.release(source);
					} catch { /* ignore */ }
				}
				if (Number.isFinite(probed) && probed > 0) {
					const dur = Math.max(0, probed - sourceStartSec - sourceEndSec);
					return {
						sourceDurationSec: dur,
						mediaDurationSec: probed,
						sourceEndUnresolvedSec: undefined,
					};
				}
			}

			// 4. Unbounded — leave duration unknown. If user passed sourceEnd we keep
			//    it in the JSON for the renderer to resolve later.
			return {
				sourceDurationSec: null,
				mediaDurationSec: undefined,
				sourceEndUnresolvedSec: s.sourceEnd != null ? sourceEndSec : undefined,
			};
		};

		/**
		 * Convert a flow-time pointer (timeline frames) into the matching
		 * source-time (seconds) for the given compiled layer. Used to anchor
		 * keyframes — keyframes are always stored in **source seconds** so
		 * the renderer can look them up directly without needing to know the
		 * timeline at lookup time.
		 */
		const flowFrameToSourceSec = (comp: CompiledLayer, t: number): number => {
			const elapsedTimelineSec = (t - comp.startTimeFrames) / fps;
			const speedAbs = Math.abs(comp.speed);
			const elapsedSegmentSec = elapsedTimelineSec * speedAbs;
			if (comp.speed < 0) {
				// Reverse playback — source position runs from end → start.
				// `sourceDurationSec` is only known once the layer's
				// endTimeFrames is set; for unbounded layers we fall back to 0
				// (i.e. treat reverse-without-known-duration as forward).
				const sourceDurationSec = comp.endTimeFrames !== false
					? ((comp.endTimeFrames - comp.startTimeFrames) / fps) * speedAbs
					: 0;
				return comp.sourceStartSec + sourceDurationSec - elapsedSegmentSec;
			}
			return comp.sourceStartSec + elapsedSegmentSec;
		};

		/**
		 * Parse a series of flow actions, advancing the time pointer `t`.
		 * Returns the final time pointer value.
		 */
		const parseSeries = async (actions: Action[], t: number = 0): Promise<number> => {
			for (const action of actions) {
				switch (action.statement) {
					case 'wait': {
						t += timeToFrames(action.duration, fps);
						break;
					}

					case 'parallel': {
						const times = await Promise.all(
							action.actions.map(branch => parseSeries(branch, t))
						);
						t = Math.max(...times);
						break;
					}

					case 'addLayer': {
						const layerObj = this.layers.find(l => l.id === action.id);
						if (!layerObj) throw new Error(`Layer ${action.id} not found`);

						const sourceStartSec = action.settings?.sourceStart != null
							? parseTime(action.settings.sourceStart, fps) : 0;
						const speed = action.settings?.speed ?? 1;
						const speedAbs = Math.abs(speed) || 1;

						// New semantics: startTime is the timeline-time at which
						// the (already-trimmed) playable segment starts. It does
						// NOT compensate for sourceStart.
						let startTimeFrames: number;
						if (action.settings?.startTime != null) {
							startTimeFrames = timeToFrames(action.settings.startTime, fps);
						} else {
							startTimeFrames = t;
						}

						const timings = await resolveMediaTimings(action);
						let endTimeFrames: number | false = false;
						if (timings.sourceDurationSec != null) {
							const timelineDurFrames = Math.round(
								(timings.sourceDurationSec / speedAbs) * fps
							);
							endTimeFrames = startTimeFrames + timelineDurFrames;
						}

						const comp: CompiledLayer = {
							id: action.id,
							type: action.type,
							startTimeFrames,
							endTimeFrames,
							speed,
							sourceStartSec,
							name: action.settings?.name,
							enabled: action.settings?.enabled ?? true,
							settings: action.settings,
							properties: {},
							index: action.options?.index ?? 0,
							layerObj,
							mediaDurationSec: timings.mediaDurationSec,
							sourceEndUnresolvedSec: timings.sourceEndUnresolvedSec,
						};
						compiled.set(action.id, comp);
						indexes[action.id] = action.options?.index ?? 0;

						// Initial properties → keyframe at sourceStart (i.e. the
						// source-time at which the segment starts playing).
						if (action.properties) {
							for (const [prop, value] of Object.entries(action.properties)) {
								comp.properties[prop] = [{ time: sourceStartSec, value, easing: 'step' as Easing }];
							}
						}

						// Handle waitFor
						if (action.options?.waitFor) {
							if (action.options.waitFor === 'finish') {
								if (endTimeFrames !== false) {
									t = endTimeFrames;
								}
								// else the layer has no known end, don't advance
							} else {
								t += timeToFrames(action.options.waitFor, fps);
							}
						}
						break;
					}

					case 'removeLayer': {
						const comp = compiled.get(action.id);
						if (!comp) throw new Error(`Layer ${action.id} not found`);
						if (comp.endTimeFrames !== false && comp.endTimeFrames < t) {
							throw new Error(`Layer ${action.id} already ended at frame ${comp.endTimeFrames}`);
						}
						comp.endTimeFrames = t;
						break;
					}

					case 'set': {
						const comp = compiled.get(action.id);
						if (!comp) throw new Error(`Layer ${action.id} not found`);
						const sourceTimeSec = flowFrameToSourceSec(comp, t);
						for (const [prop, value] of Object.entries(action.value)) {
							if (!comp.properties[prop]) {
								comp.properties[prop] = [];
							}
							// Remove any existing keyframe at this exact time
							comp.properties[prop] = comp.properties[prop].filter((kf: any) => kf.time !== sourceTimeSec);
							comp.properties[prop].push({ time: sourceTimeSec, value, easing: 'step' as Easing });
							comp.properties[prop].sort((a: any, b: any) => a.time - b.time);
						}
						break;
					}

					case 'animate': {
						const comp = compiled.get(action.id);
						if (!comp) throw new Error(`Layer ${action.id} not found`);
						const startSourceTimeSec = flowFrameToSourceSec(comp, t);
						const animTimelineFrames = timeToFrames(action.settings?.duration ?? '1s', fps);
						const speedAbs = Math.abs(comp.speed) || 1;
						// `duration` from animate() is timeline seconds. Convert
						// to source seconds via the speed factor so the kf.time
						// span lines up with what the renderer will see.
						const animSourceSec = (animTimelineFrames / fps) * speedAbs;
						const easing: Easing = action.settings?.easing || this.settings.defaults?.easing || 'easeInOut';

						const allProps = [...new Set([
							...Object.keys(action.from),
							...Object.keys(action.to),
						])];

						for (const prop of allProps) {
							if (!comp.properties[prop]) {
								comp.properties[prop] = [];
							}
							const fromVal = action.from[prop] ?? this._getLastValue(comp.properties[prop], startSourceTimeSec, prop, comp.layerObj);
							const toVal = action.to[prop] ?? fromVal;

							// Add start keyframe
							comp.properties[prop] = comp.properties[prop].filter((kf: any) => kf.time !== startSourceTimeSec);
							comp.properties[prop].push({ time: startSourceTimeSec, value: fromVal, easing });

							// Add end keyframe — for reverse playback, source
							// time runs backward, so subtract instead of add.
							const endSourceTimeSec = comp.speed < 0
								? startSourceTimeSec - animSourceSec
								: startSourceTimeSec + animSourceSec;
							comp.properties[prop] = comp.properties[prop].filter((kf: any) => kf.time !== endSourceTimeSec);
							comp.properties[prop].push({ time: endSourceTimeSec, value: toVal, easing: 'step' as Easing });

							comp.properties[prop].sort((a: any, b: any) => a.time - b.time);
						}

						if (action.settings?.wait !== false) {
							t += animTimelineFrames;
						}
						break;
					}
				}
			}
			return t;
		};

		// Execute the flow
		const totalFrames = await parseSeries(this.flow);

		// Calculate project duration
		let projectDuration = totalFrames;
		for (const comp of compiled.values()) {
			if (comp.endTimeFrames !== false) {
				projectDuration = Math.max(projectDuration, comp.endTimeFrames);
			}
			// Set unbounded layers to end at the project duration
			if (comp.endTimeFrames === false) {
				comp.endTimeFrames = projectDuration;
			}
		}

		// Second pass: ensure all unbounded layers are capped to the final duration
		for (const comp of compiled.values()) {
			if (comp.endTimeFrames === false) {
				comp.endTimeFrames = projectDuration;
			}
		}

		// Build sorted layers array
		const sortedLayers = [...compiled.values()].sort((a, b) => {
			if (a.index !== b.index) return a.index - b.index;
			return 0;
		});

		// Convert to VideoJSON
		const layers = sortedLayers.map(comp => {
			const animations = Object.entries(comp.properties).map(([prop, keyframes]) => ({
				property: prop,
				// Keyframes are already stored in absolute source seconds.
				keyframes: (keyframes as any[]).map(kf => ({
					time: kf.time,
					value: kf.value,
					...(kf.easing && kf.easing !== 'step' ? { easing: kf.easing } : {}),
				})),
			}));

			const startTimeSec = comp.startTimeFrames / fps;
			const endTimeSec = (comp.endTimeFrames as number) / fps;
			const timelineDurSec = endTimeSec - startTimeSec;
			// sourceDuration in JSON is **source seconds**, derived from the
			// timeline footprint via speed: sourceDur = timelineDur * |speed|.
			const speedAbs = Math.abs(comp.speed) || 1;
			const sourceDurationSec = timelineDurSec * speedAbs;

			return {
				id: comp.id,
				type: comp.type,
				settings: {
					enabled: comp.enabled,
					startTime: startTimeSec,
					sourceDuration: sourceDurationSec,
					...(comp.name ? { name: comp.name } : {}),
					...(comp.speed !== 1 ? { speed: comp.speed } : {}),
					...(comp.sourceStartSec > 0 ? { sourceStart: comp.sourceStartSec } : {}),
					...(comp.mediaDurationSec != null ? { mediaDuration: comp.mediaDurationSec } : {}),
					...(comp.sourceEndUnresolvedSec != null ? { sourceEnd: comp.sourceEndUnresolvedSec } : {}),
					// Include layer-type-specific settings via settingsKeys
					// (mediaDuration / sourceEnd are handled explicitly above)
					...Object.fromEntries(
						((comp.layerObj.constructor as typeof BaseLayer).settingsKeys ?? [])
							.filter(key => key !== 'mediaDuration' && key !== 'sourceEnd')
							.filter(key => comp.settings?.[key] != null)
							.map(key => [key, comp.settings[key]])
					),
				},
				properties: {},
				animations,
			};
		});

		return {
			name: this.settings.name,
			duration: projectDuration / fps,
			width: this.settings.width,
			height: this.settings.height,
			fps,
			backgroundColor: this.settings.backgroundColor,
			layers,
		};
	}

	/**
	 * Get the last known value of a property at the given time.
	 * Falls back to the layer class's default property value.
	 */
	private _getLastValue(keyframes: any[], time: number, prop: string, layerObj: BaseLayer): any {
		if (keyframes.length === 0) {
			const def = (layerObj.constructor as typeof BaseLayer).propertiesDefinition[prop];
			return def?.default;
		}
		// Find the last keyframe at or before the given time
		let last = keyframes[0];
		for (const kf of keyframes) {
			if (kf.time <= time) last = kf;
			else break;
		}
		return last?.value;
	}

	// -----------------------------------------------------------------------
	//  Convenience render method
	// -----------------------------------------------------------------------

	/**
	 * Resolve the renderer module for the current environment.
	 *
	 * @returns The renderer module (with `default` export being the renderer class).
	 * @throws If the renderer package is not installed.
	 */
	private async _resolveRendererModule(): Promise<any> {
		const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

		// Build the package name at runtime so bundlers (Vite, webpack,
		// esbuild, …) cannot statically analyse the dynamic import and try
		// to resolve the "other" renderer the consumer hasn't installed.
		// The /* @vite-ignore */ + /* webpackIgnore */ comments are belt-and-braces.
		const pkg = isBrowser
			? ['@videoflow', 'renderer-browser'].join('/')
			: ['@videoflow', 'renderer-server'].join('/');
		try {
			return await import(/* @vite-ignore */ /* webpackIgnore: true */ pkg);
		} catch {
			throw new Error(
				isBrowser
					? 'Browser renderer not available. Install @videoflow/renderer-browser.'
					: 'Server renderer not available. Install @videoflow/renderer-server.'
			);
		}
	}

	/**
	 * Compile and render the video in one call.
	 *
	 * Automatically detects the environment and uses the appropriate renderer:
	 * - **Browser** (window/DOM present) → `@videoflow/renderer-browser`
	 * - **Node.js** (no DOM, `process.versions.node` exists) → `@videoflow/renderer-server`
	 *
	 * The renderer package must be installed separately.
	 *
	 * @param options - Rendering options passed to the renderer.
	 * @returns The rendered video output (Buffer, Blob, or file path depending on options).
	 */
	async renderVideo(options: Record<string, any> = {}): Promise<any> {
		const mod = await this._resolveRendererModule();
		const json = await this.compile();
		return await mod.default.render(json, options);
	}

	/**
	 * Compile and render a single frame of the video.
	 *
	 * Automatically detects the environment and uses the appropriate renderer.
	 * The renderer package must be installed separately.
	 *
	 * @param frame - The frame number to render.
	 * @returns The rendered frame output — `OffscreenCanvas` (browser) or JPEG `Buffer` (server).
	 */
	async renderFrame(frame: number): Promise<any> {
		const mod = await this._resolveRendererModule();
		const json = await this.compile();
		const renderer = new mod.default(json);
		try {
			return await renderer.renderFrame(frame);
		} finally {
			if (typeof renderer.destroy === 'function') renderer.destroy();
			if (typeof renderer.cleanup === 'function') await renderer.cleanup();
		}
	}

	/**
	 * Compile and render the full audio track of the video.
	 *
	 * Automatically detects the environment and uses the appropriate renderer.
	 * The renderer package must be installed separately.
	 *
	 * @returns The rendered audio — `AudioBuffer` (browser) or WAV `Buffer` (server),
	 *          or `null` if the video has no audio layers.
	 */
	async renderAudio(): Promise<any> {
		const mod = await this._resolveRendererModule();
		const json = await this.compile();
		const renderer = new mod.default(json);
		try {
			return await renderer.renderAudio();
		} finally {
			if (typeof renderer.destroy === 'function') renderer.destroy();
			if (typeof renderer.cleanup === 'function') await renderer.cleanup();
		}
	}
}
