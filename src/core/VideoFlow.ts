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
	VideoJSON, ProjectSettings, LayerTransitionJSON, LayerEffectJSON,
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
import ShapeLayer from './layers/ShapeLayer.js';
import type { ShapeLayerProperties, ShapeLayerSettings } from './layers/ShapeLayer.js';
import GroupLayer from './layers/GroupLayer.js';
import type { GroupLayerProperties, GroupLayerSettings } from './layers/GroupLayer.js';

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

	/** Add a vector shape layer (rectangle, ellipse, polygon, or star). */
	addShape(properties?: ShapeLayerProperties, settings?: ShapeLayerSettings, options?: AddLayerOptions): ShapeLayer {
		return this.addLayer(ShapeLayer, properties, settings, options);
	}

	/**
	 * Add a layer group — a container that nests other layers and treats them
	 * as one. Inside `fn`, the flow's time pointer resets to `0` (relative to
	 * the group's start), so children's timing is authored independently of
	 * where the group sits on the project timeline. The flow pointer of the
	 * outer scope advances by the group's `waitFor` (default `'finish'` = the
	 * group's full footprint).
	 *
	 * The group itself is a {@link VisualLayer}, so its `position`, `scale`,
	 * `rotation`, `opacity`, filters, transitions and effects all apply to the
	 * composited child sub-tree.
	 *
	 * ```ts
	 * const card = $.group({ position: [0.5, 0.5], scale: 1 }, {}, () => {
	 *   $.addShape({ width: 60, height: 30, fill: '#fff' });
	 *   $.addText({ text: 'Hello' });
	 * });
	 * card.animate({ scale: 1 }, { scale: 1.1 }, { duration: '500ms' });
	 * ```
	 *
	 * Group timing is auto-derived: `startTime` defaults to the current flow
	 * time, and `sourceDuration` defaults to the latest child's end (so a
	 * group whose last child finishes at +5s lasts 5s). Both can still be
	 * overridden in `settings` if you need to.
	 *
	 * @param properties - Visual properties applied to the group as a whole.
	 * @param settings   - Layer settings (timing, transitions, …). `startTime`
	 *                     and `sourceDuration` are normally auto-derived; pass
	 *                     them explicitly only to override.
	 * @param fn         - Builder callback. Children added inside this callback
	 *                     belong to the group; their flow timing is relative
	 *                     to the group's start.
	 * @param options    - Flow options. `waitFor` defaults to `'finish'`, so
	 *                     the next layer added after the group starts when the
	 *                     group ends. Pass a {@link Time} to add a delay
	 *                     instead.
	 */
	group(
		properties: GroupLayerProperties = {},
		settings: GroupLayerSettings = {},
		fn: (group: GroupLayer) => void = () => {},
		options: AddLayerOptions = {},
	): GroupLayer {
		const layer = new GroupLayer(this, properties, settings);
		this.layers.push(layer);

		// Capture the children's flow into a private branch — same idea as
		// `parallel()`, but with a single sub-flow rather than several.
		const initialPointer = this._flowPointer;
		const childActions: Action[] = [];
		this._flowPointer = childActions;
		try {
			fn(layer);
		} finally {
			this._flowPointer = initialPointer;
		}

		this.pushAction({
			statement: 'group',
			id: layer.id,
			settings,
			properties,
			options,
			actions: childActions,
		});
		return layer;
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
			/** Normalised transitionIn (seconds) pulled from layer settings. */
			transitionIn?: LayerTransitionJSON;
			/** Normalised transitionOut (seconds) pulled from layer settings. */
			transitionOut?: LayerTransitionJSON;
			/** Effects declared at creation time (from properties.effects). */
			effects?: LayerEffectJSON[];
			/** Parent group id, when this layer is nested inside a group. */
			parentGroupId?: string;
			/** Compiled child ids, in flow order (only set on group layers). */
			childIds?: string[];
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
				} else if (action.statement === 'group') {
					collectMediaActions(action.actions);
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
		 * Returns the final time pointer value. `parentGroupId`, when set,
		 * marks every layer added in this branch as a child of that group.
		 */
		const parseSeries = async (actions: Action[], t: number = 0, parentGroupId?: string): Promise<number> => {
			for (const action of actions) {
				switch (action.statement) {
					case 'wait': {
						t += timeToFrames(action.duration, fps);
						break;
					}

					case 'parallel': {
						const times = await Promise.all(
							action.actions.map(branch => parseSeries(branch, t, parentGroupId))
						);
						t = Math.max(...times);
						break;
					}

					case 'group': {
						const layerObj = this.layers.find(l => l.id === action.id);
						if (!layerObj) throw new Error(`Group layer ${action.id} not found`);

						// Group's start frame: respect explicit `startTime` like a
						// regular layer; otherwise it begins at the current flow t.
						const groupStartFrames: number = action.settings?.startTime != null
							? timeToFrames(action.settings.startTime, fps)
							: t;

						// Extract transitions on the group itself (in/out apply to
						// the composited sub-tree).
						const normalizeTransition = (spec: any): LayerTransitionJSON | undefined => {
							if (!spec || typeof spec !== 'object' || !spec.transition) return undefined;
							const durationSec = spec.duration != null ? parseTime(spec.duration, fps) : 0.2;
							return {
								transition: String(spec.transition),
								duration: durationSec,
								...(spec.easing ? { easing: spec.easing } : {}),
								...(spec.params ? { params: { ...spec.params } } : {}),
							};
						};
						const groupTransitionIn = normalizeTransition(action.settings?.transitionIn);
						const groupTransitionOut = normalizeTransition(action.settings?.transitionOut);

						// Effects declared at group creation time apply to the
						// rasterized group surface — same shape as on any layer.
						let groupEffects: LayerEffectJSON[] | undefined;
						const rawGroupEffects = action.properties?.effects;
						if (Array.isArray(rawGroupEffects) && rawGroupEffects.length > 0) {
							groupEffects = rawGroupEffects
								.filter((e: any) => e && typeof e === 'object' && typeof e.effect === 'string')
								.map((e: any) => ({
									effect: String(e.effect),
									...(e.params ? { params: { ...e.params } } : {}),
								}));
							if (groupEffects.length === 0) groupEffects = undefined;
						}

						const groupComp: CompiledLayer = {
							id: action.id,
							type: 'group',
							startTimeFrames: groupStartFrames,
							endTimeFrames: false, // resolved below from children
							speed: 1,
							sourceStartSec: 0,
							name: action.settings?.name,
							enabled: action.settings?.enabled ?? true,
							settings: action.settings,
							properties: {},
							index: action.options?.index ?? 0,
							layerObj,
							childIds: [],
							...(parentGroupId ? { parentGroupId } : {}),
							...(groupTransitionIn ? { transitionIn: groupTransitionIn } : {}),
							...(groupTransitionOut ? { transitionOut: groupTransitionOut } : {}),
							...(groupEffects ? { effects: groupEffects } : {}),
						};
						compiled.set(action.id, groupComp);
						indexes[action.id] = action.options?.index ?? 0;
						if (parentGroupId) {
							const parent = compiled.get(parentGroupId);
							parent?.childIds?.push(action.id);
						}

						// Initial group properties → step keyframe at t=0
						// (groups have no source, so source-time always == 0).
						if (action.properties) {
							for (const [prop, value] of Object.entries(action.properties)) {
								if (prop === 'effects') continue;
								groupComp.properties[prop] = [{ time: 0, value, easing: 'step' as Easing }];
							}
						}

						// Recurse — a group is a sub-timeline, so its children's
						// frame timing is RELATIVE to the group: `t` resets to 0
						// inside the group's scope. Children's `startTimeFrames`
						// and `endTimeFrames` are stored in group-local frames;
						// `RuntimeGroupLayer` translates the absolute project
						// frame to local frames before invoking each child.
						const childEndT = await parseSeries(action.actions, 0, action.id);

						// If user gave an explicit sourceDuration, honor it.
						// Otherwise the group spans from its start to the end of
						// its last child (or to the project's end at finalization
						// time when no children are bounded yet). Children's ends
						// are now relative, so add `groupStartFrames` to convert
						// back to absolute for the group's own footprint.
						if (action.settings?.sourceDuration != null) {
							const explicitFrames = timeToFrames(action.settings.sourceDuration, fps);
							groupComp.endTimeFrames = groupStartFrames + explicitFrames;
						} else if (groupComp.childIds!.length > 0) {
							let maxRelEnd = 0;
							let anyBounded = false;
							for (const cid of groupComp.childIds!) {
								const child = compiled.get(cid);
								if (!child) continue;
								if (child.endTimeFrames !== false) {
									anyBounded = true;
									if (child.endTimeFrames > maxRelEnd) maxRelEnd = child.endTimeFrames;
								}
							}
							groupComp.endTimeFrames = anyBounded ? groupStartFrames + maxRelEnd : false;
						}

						// Advance the outer flow pointer. `waitFor` on a group
						// defaults to `'finish'` (the whole composite is treated
						// as one unit on the outer timeline), mirroring how
						// `$.parallel()` advances to its longest branch. Convert
						// the relative `childEndT` fallback to absolute.
						const groupEndForWait = groupComp.endTimeFrames !== false
							? groupComp.endTimeFrames
							: groupStartFrames + childEndT;
						const waitFor = action.options?.waitFor ?? 'finish';
						if (waitFor === 'finish') {
							t = groupEndForWait;
						} else {
							t += timeToFrames(waitFor, fps);
						}
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

						// Extract transitions from settings (user-facing spec →
						// normalised JSON form with seconds durations).
						const normalizeTransition = (spec: any): LayerTransitionJSON | undefined => {
							if (!spec || typeof spec !== 'object' || !spec.transition) return undefined;
							const durationSec = spec.duration != null ? parseTime(spec.duration, fps) : 0.2;
							return {
								transition: String(spec.transition),
								duration: durationSec,
								...(spec.easing ? { easing: spec.easing } : {}),
								...(spec.params ? { params: { ...spec.params } } : {}),
							};
						};
						const transitionIn = normalizeTransition(action.settings?.transitionIn);
						const transitionOut = normalizeTransition(action.settings?.transitionOut);

						// Extract effects from properties (creation-time only — the
						// effects list itself isn't animatable, though individual
						// effect params can be animated via dot-path properties).
						let effects: LayerEffectJSON[] | undefined;
						const rawEffects = action.properties?.effects;
						if (Array.isArray(rawEffects) && rawEffects.length > 0) {
							effects = rawEffects
								.filter((e: any) => e && typeof e === 'object' && typeof e.effect === 'string')
								.map((e: any) => ({
									effect: String(e.effect),
									...(e.params ? { params: { ...e.params } } : {}),
								}));
							if (effects.length === 0) effects = undefined;
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
							...(parentGroupId ? { parentGroupId } : {}),
							...(transitionIn ? { transitionIn } : {}),
							...(transitionOut ? { transitionOut } : {}),
							...(effects ? { effects } : {}),
						};
						compiled.set(action.id, comp);
						indexes[action.id] = action.options?.index ?? 0;
						if (parentGroupId) {
							const parent = compiled.get(parentGroupId);
							parent?.childIds?.push(action.id);
						}

						// Initial properties → keyframe at sourceStart (i.e. the
						// source-time at which the segment starts playing).
						// `effects` is a special creation-time property promoted
						// to the top-level JSON; skip it here.
						if (action.properties) {
							for (const [prop, value] of Object.entries(action.properties)) {
								if (prop === 'effects') continue;
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
						const removeAtFrames = t + timeToFrames(action.in ?? 0, fps);
						if (comp.endTimeFrames !== false && comp.endTimeFrames < removeAtFrames) {
							throw new Error(`Layer ${action.id} already ended at frame ${comp.endTimeFrames}`);
						}
						comp.endTimeFrames = removeAtFrames;
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
						// `$.group()` advances flow `t` to the group's end by default
						// (waitFor='finish'), so a follow-up `g.animate(...)` would
						// otherwise plant keyframes past the group's source duration
						// — outside its visible lifespan. Detect this and anchor the
						// animation to the group's start, which is what users mean
						// when they animate a group "during its lifetime".
						const flowAtOrPastEnd = comp.endTimeFrames !== false && t >= comp.endTimeFrames;
						const startSourceTimeSec = (comp.type === 'group' && flowAtOrPastEnd)
							? 0
							: flowFrameToSourceSec(comp, t);
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

		// Calculate the project's overall duration. Only TOP-LEVEL layers count
		// here — children of groups live in the group's local timeline (their
		// `startTimeFrames` / `endTimeFrames` are group-relative) so it would
		// be wrong to mix their numbers with absolute project frames.
		let projectDuration = totalFrames;
		for (const comp of compiled.values()) {
			if (comp.parentGroupId) continue;
			if (comp.endTimeFrames !== false) {
				projectDuration = Math.max(projectDuration, comp.endTimeFrames);
			}
		}

		// Second pass: cap every layer that's still unbounded.
		//
		// - Top-level layers and groups end at the overall project duration.
		// - Children of groups end at their parent group's local duration, so
		//   their (relative) `endTimeFrames` stays in the same coordinate
		//   system as their (relative) `startTimeFrames`. Falls through to the
		//   project duration when the group itself is still unbounded.
		for (const comp of compiled.values()) {
			if (comp.endTimeFrames !== false) continue;
			if (comp.parentGroupId) {
				const parent = compiled.get(comp.parentGroupId);
				if (parent && parent.endTimeFrames !== false) {
					const groupLocalDuration = parent.endTimeFrames - parent.startTimeFrames;
					comp.endTimeFrames = groupLocalDuration;
					continue;
				}
			}
			comp.endTimeFrames = projectDuration;
		}

		// Re-derive group bounds now that previously-unbounded children have
		// been resolved — a group whose only child was open-ended will
		// otherwise still be `false` at this point.
		for (const comp of compiled.values()) {
			if (comp.type !== 'group' || comp.endTimeFrames !== false) continue;
			if (!comp.childIds || comp.childIds.length === 0) continue;
			let maxRelEnd = 0;
			let anyBounded = false;
			for (const cid of comp.childIds) {
				const child = compiled.get(cid);
				if (!child || child.endTimeFrames === false) continue;
				anyBounded = true;
				if (child.endTimeFrames > maxRelEnd) maxRelEnd = child.endTimeFrames;
			}
			if (anyBounded) comp.endTimeFrames = comp.startTimeFrames + maxRelEnd;
			else comp.endTimeFrames = projectDuration;
		}

		// Third pass: clamp children to their parent group's local duration.
		// `endTimeFrames` for a child is in group-relative frames, so the
		// comparison must be against the group's relative duration, NOT its
		// absolute end on the parent timeline.
		for (const comp of compiled.values()) {
			if (!comp.parentGroupId) continue;
			const parent = compiled.get(comp.parentGroupId);
			if (!parent || parent.endTimeFrames === false) continue;
			const groupLocalDuration = parent.endTimeFrames - parent.startTimeFrames;
			if (typeof comp.endTimeFrames === 'number' && comp.endTimeFrames > groupLocalDuration) {
				comp.endTimeFrames = groupLocalDuration;
			}
		}

		// Build sorted layers array — only top-level. Layers nested inside
		// groups are surfaced as `children` of their group.
		const sortedLayers = [...compiled.values()]
			.filter(c => !c.parentGroupId)
			.sort((a, b) => {
				if (a.index !== b.index) return a.index - b.index;
				return 0;
			});

		// Deduce a human-readable name for a layer when none was explicitly set.
		const deduceLayerName = (comp: CompiledLayer): string => {
			// Text / captions: use the text content (truncated)
			if (comp.type === 'text' || comp.type === 'captions') {
				const textKfs = comp.properties['text'];
				if (textKfs?.length > 0) {
					const raw = String(textKfs[0].value ?? '').trim();
					if (raw) return raw.length > 30 ? raw.slice(0, 30) + '\u2026' : raw;
				}
				return comp.type === 'captions' ? 'Captions' : 'Text';
			}
			// Media layers: derive from the source filename
			const source = comp.settings?.source;
			if (source) {
				// Strip path separators and query/hash to get a bare filename
				const filename = String(source).split(/[/\\]/).pop() ?? '';
				const base = filename.split(/[?#]/)[0];
				if (base) return base;
			}
			// Fallback: capitalise the type tag
			return comp.type.charAt(0).toUpperCase() + comp.type.slice(1);
		};

		// Convert to VideoJSON. Properties that only have a single keyframe
		// (creation-time values or one-off `.set()` calls that were never
		// animated) go into the static `properties` map. Properties with two
		// or more keyframes go into `animations`.
		//
		// Easing serialization: missing easing means `'linear'` at the library
		// level, so we strip `'linear'` from keyframes and keep everything
		// else (including `'step'`, which is load-bearing — it's what holds
		// animation end values steady until the next keyframe).
		//
		// Group layers carry their nested layers as `children`, recursively. The
		// top-level `layers` array only contains layers that aren't inside a
		// group; nested layers surface via their parent's `children`.
		const serializeLayer = (comp: CompiledLayer): any => {
			const staticProps: Record<string, any> = {};
			const animations: any[] = [];

			for (const [prop, keyframes] of Object.entries(comp.properties)) {
				const kfs = keyframes as any[];
				if (kfs.length === 1) {
					staticProps[prop] = kfs[0].value;
					continue;
				}
				animations.push({
					property: prop,
					// Keyframes are already stored in absolute source seconds.
					keyframes: kfs.map(kf => ({
						time: kf.time,
						value: kf.value,
						...(kf.easing && kf.easing !== 'linear' ? { easing: kf.easing } : {}),
					})),
				});
			}

			const startTimeSec = comp.startTimeFrames / fps;
			const endTimeSec = (comp.endTimeFrames as number) / fps;
			const timelineDurSec = endTimeSec - startTimeSec;
			// sourceDuration in JSON is **source seconds**, derived from the
			// timeline footprint via speed: sourceDur = timelineDur * |speed|.
			const speedAbs = Math.abs(comp.speed) || 1;
			const sourceDurationSec = timelineDurSec * speedAbs;

			// Resolve nested children recursively (groups only). Children are
			// emitted in the same order they were declared in the flow.
			let children: any[] | undefined;
			if (comp.type === 'group' && comp.childIds && comp.childIds.length > 0) {
				children = comp.childIds
					.map(id => compiled.get(id))
					.filter((c): c is CompiledLayer => !!c)
					.sort((a, b) => {
						if (a.index !== b.index) return a.index - b.index;
						return 0;
					})
					.map(serializeLayer);
			}

			return {
				id: comp.id,
				type: comp.type,
				settings: {
					enabled: comp.enabled,
					startTime: startTimeSec,
					sourceDuration: sourceDurationSec,
					name: comp.name || deduceLayerName(comp),
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
				properties: staticProps,
				animations,
				...(comp.transitionIn ? { transitionIn: comp.transitionIn } : {}),
				...(comp.transitionOut ? { transitionOut: comp.transitionOut } : {}),
				...(comp.effects ? { effects: comp.effects } : {}),
				...(children ? { children } : {}),
			};
		};

		const layers = sortedLayers.map(serializeLayer);

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
	 * Falls back to the layer class's default property value, or — for
	 * effect param dot-paths — to the initial value declared in the layer's
	 * `effects` property array.
	 */
	private _getLastValue(keyframes: any[], time: number, prop: string, layerObj: BaseLayer): any {
		if (keyframes.length === 0) {
			// Effect param dot-path: effects.<name>[idx].<param>
			const m = /^effects\.([a-zA-Z_][\w-]*)(?:\[(\d+)\])?\.([a-zA-Z_]\w*)$/.exec(prop);
			if (m) {
				const [, effectName, idxStr, paramName] = m;
				const idx = idxStr ? Number(idxStr) : 0;
				const declaredEffects: any[] = layerObj.properties['effects'];
				if (Array.isArray(declaredEffects)) {
					let occurrence = 0;
					for (const e of declaredEffects) {
						if (e?.effect === effectName) {
							if (occurrence === idx) return e.params?.[paramName];
							occurrence++;
						}
					}
				}
				return undefined;
			}
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
