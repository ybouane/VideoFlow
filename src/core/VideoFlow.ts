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
import { parseTime, timeToFrames } from './utils.js';

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

const DEFAULT_SETTINGS: Required<Omit<ProjectSettings, 'verbose'>> & { verbose: boolean } = {
	name: 'Untitled Video',
	width: 1920,
	height: 1080,
	fps: 30,
	backgroundColor: '#00000000',
	verbose: false,
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
	settings: Required<Omit<ProjectSettings, 'verbose'>> & { verbose: boolean };

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
		 * Maintains the layer's settings, properties (as keyframe arrays),
		 * and tracks the add-order index for z-ordering.
		 */
		type CompiledLayer = {
			id: string;
			type: string;
			startTime: number;   // frames
			endTime: number | false; // frames, or false if unbounded
			speed: number;
			trimStart: number;   // frames
			name?: string;
			enabled: boolean;
			settings: Record<string, any>; // raw settings passed by user
			properties: Record<string, any[]>; // property → keyframe array
			index: number;
			layerObj: BaseLayer;
		};

		const compiled: Map<string, CompiledLayer> = new Map();
		const indexes: Record<string, number> = {};

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

						const trimStart = action.settings?.trimStart != null
							? timeToFrames(action.settings.trimStart, fps) : 0;
						let startTime = t - trimStart;
						if (action.settings?.startTime != null) {
							startTime = timeToFrames(action.settings.startTime, fps) - trimStart;
						}

						let endTime: number | false = false;
						if (action.settings?.duration != null) {
							endTime = t + timeToFrames(action.settings.duration, fps);
						}

						const comp: CompiledLayer = {
							id: action.id,
							type: action.type,
							startTime,
							endTime,
							speed: action.settings?.speed ?? 1,
							trimStart,
							name: action.settings?.name,
							enabled: action.settings?.enabled ?? true,
							settings: action.settings,
							properties: {},
							index: action.options?.index ?? 0,
							layerObj,
						};
						compiled.set(action.id, comp);
						indexes[action.id] = action.options?.index ?? 0;

						// Set initial properties from the action
						if (action.properties) {
							for (const [prop, value] of Object.entries(action.properties)) {
								comp.properties[prop] = [{ time: 0, value, easing: 'step' as Easing }];
							}
						}

						// Handle waitFor
						if (action.options?.waitFor) {
							if (action.options.waitFor === 'finish') {
								if (endTime !== false) {
									t = endTime;
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
						if (comp.endTime !== false && comp.endTime < t) {
							throw new Error(`Layer ${action.id} already ended at frame ${comp.endTime}`);
						}
						comp.endTime = t;
						break;
					}

					case 'set': {
						const comp = compiled.get(action.id);
						if (!comp) throw new Error(`Layer ${action.id} not found`);
						const relativeTime = t - (comp.startTime || 0);
						for (const [prop, value] of Object.entries(action.value)) {
							if (!comp.properties[prop]) {
								comp.properties[prop] = [];
							}
							// Remove any existing keyframe at this exact time
							comp.properties[prop] = comp.properties[prop].filter((kf: any) => kf.time !== relativeTime);
							comp.properties[prop].push({ time: relativeTime, value, easing: 'step' as Easing });
							comp.properties[prop].sort((a: any, b: any) => a.time - b.time);
						}
						break;
					}

					case 'animate': {
						const comp = compiled.get(action.id);
						if (!comp) throw new Error(`Layer ${action.id} not found`);
						const relativeTime = t - (comp.startTime || 0);
						const duration = timeToFrames(action.settings?.duration ?? '1s', fps);
						const easing: Easing = action.settings?.easing || this.settings.defaults?.easing || 'easeInOut';

						const allProps = [...new Set([
							...Object.keys(action.from),
							...Object.keys(action.to),
						])];

						for (const prop of allProps) {
							if (!comp.properties[prop]) {
								comp.properties[prop] = [];
							}
							const fromVal = action.from[prop] ?? this._getLastValue(comp.properties[prop], relativeTime, prop, comp.layerObj);
							const toVal = action.to[prop] ?? fromVal;

							// Add start keyframe
							comp.properties[prop] = comp.properties[prop].filter((kf: any) => kf.time !== relativeTime);
							comp.properties[prop].push({ time: relativeTime, value: fromVal, easing });

							// Add end keyframe
							const endTime = relativeTime + duration;
							comp.properties[prop] = comp.properties[prop].filter((kf: any) => kf.time !== endTime);
							comp.properties[prop].push({ time: endTime, value: toVal, easing: 'step' as Easing });

							comp.properties[prop].sort((a: any, b: any) => a.time - b.time);
						}

						if (action.settings?.wait !== false) {
							t += duration;
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
			if (comp.endTime !== false) {
				projectDuration = Math.max(projectDuration, comp.endTime);
			}
			// Set unbounded layers to end at the project duration
			if (comp.endTime === false) {
				comp.endTime = projectDuration;
			}
		}

		// Second pass: ensure all unbounded layers are capped to the final duration
		for (const comp of compiled.values()) {
			if (comp.endTime === false) {
				comp.endTime = projectDuration;
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
				keyframes: (keyframes as any[]).map(kf => ({
					time: kf.time / fps,
					value: kf.value,
					...(kf.easing && kf.easing !== 'step' ? { easing: kf.easing } : {}),
				})),
			}));

			const startTimeSec = comp.startTime / fps;
			const endTimeSec = (comp.endTime as number) / fps;
			const durationSec = endTimeSec - startTimeSec;

			return {
				id: comp.id,
				type: comp.type,
				settings: {
					enabled: comp.enabled,
					startTime: startTimeSec,
					duration: durationSec,
					...(comp.name ? { name: comp.name } : {}),
					...(comp.speed !== 1 ? { speed: comp.speed } : {}),
					...(comp.trimStart > 0 ? { trimStart: comp.trimStart / fps } : {}),
					...(comp.settings?.source ? { source: comp.settings.source } : {}),
					...(comp.settings?.captions ? { captions: comp.settings.captions } : {}),
					...(comp.settings?.maxCharsPerLine ? { maxCharsPerLine: comp.settings.maxCharsPerLine } : {}),
					...(comp.settings?.maxLines ? { maxLines: comp.settings.maxLines } : {}),
					...(comp.settings?.fontFamily ? { fontFamily: comp.settings.fontFamily } : {}),
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
		const json = await this.compile();

		const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';

		if (isBrowser) {
			try {
				const { default: BrowserRenderer } = await import('@videoflow/renderer-browser' as string);
				return await BrowserRenderer.render(json, options);
			} catch {
				throw new Error(
					'Browser renderer not available. Install @videoflow/renderer-browser.'
				);
			}
		} else {
			try {
				const { default: ServerRenderer } = await import('@videoflow/renderer-server' as string);
				return await ServerRenderer.render(json, options);
			} catch {
				throw new Error(
					'Server renderer not available. Install @videoflow/renderer-server.'
				);
			}
		}
	}
}
