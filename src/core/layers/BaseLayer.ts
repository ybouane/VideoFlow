/**
 * BaseLayer — the root of the VideoFlow layer hierarchy.
 *
 * Every layer type ultimately extends BaseLayer, which provides:
 * - A unique `id` (UUID v4)
 * - Common settings (enabled, startTime, sourceDuration, speed, sourceStart)
 * - A property system with keyframe animation support
 * - Time ↔ frame conversions via the project's fps
 * - Serialisation to/from the VideoFlow JSON model
 *
 * VideoFlow distinguishes three time contexts:
 * 1. **Source media time** — absolute time inside the source clip
 * 2. **Source segment time** — time within the playable segment (sourceTime − sourceStart)
 * 3. **Timeline time** — time on the project timeline
 *
 * `startTime` lives on the timeline; `sourceStart`/`sourceEnd`/`sourceDuration`
 * live in source time; `speed` stretches the segment in the timeline so that
 * `timelineDuration = sourceDuration / speed`.
 */

import type { Id, Time, Easing, Keyframe, Animation, PropertyDefinition, Action, AddLayerOptions, LayerJSON, LayerTransitionJSON, LayerTransitionSpec, LayerEffectJSON } from '../types.js';
import { timeToFrames, parseTime } from '../utils.js';

function createLayerId(): Id {
	if (typeof globalThis.crypto?.randomUUID === 'function') {
		return globalThis.crypto.randomUUID();
	}

	return `vf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
//  Settings & property types
// ---------------------------------------------------------------------------

/** Settings shared by every layer type. */
export type BaseLayerSettings = {
	name?: string;
	enabled?: boolean;
	/**
	 * Timeline-time at which the playable segment starts. The visible
	 * (already-trimmed) segment begins at exactly this point — `startTime`
	 * does NOT compensate for `sourceStart`.
	 */
	startTime?: Time;
	/**
	 * Length of the playable segment, expressed in **source seconds**.
	 * The actual timeline footprint is `sourceDuration / speed`.
	 */
	sourceDuration?: Time;
	/**
	 * Time-stretch factor applied at the timeline level. Higher = faster.
	 * `timelineDuration = sourceDuration / speed`.
	 */
	speed?: number;
	/**
	 * Offset (in source-time) into the source where the playable segment
	 * begins. Default: `0`.
	 */
	sourceStart?: Time;
	/**
	 * Intrinsic length of the source media (video/audio only). When provided
	 * the system uses it directly to derive `sourceDuration` (together with
	 * `sourceStart` and `sourceEnd`); otherwise it can be auto-detected at
	 * compile time when `autoDetectDurations` is enabled on the project.
	 */
	mediaDuration?: Time;
	/**
	 * Trim N seconds (or other Time format) from the END of the source. This
	 * is a convenience hint that gets resolved into `sourceDuration` as soon
	 * as `mediaDuration` is known. Default: `0`.
	 */
	sourceEnd?: Time;
	/**
	 * Transition played across the start of the layer's timeline footprint.
	 * References a transition registered via `Renderer.registerTransition`.
	 */
	transitionIn?: LayerTransitionSpec;
	/** Transition played across the end of the layer's timeline footprint. */
	transitionOut?: LayerTransitionSpec;
};

/** Properties shared by every layer type (empty at this level). */
export type BaseLayerProperties = Record<string, any>;

// ---------------------------------------------------------------------------
//  BaseLayer class
// ---------------------------------------------------------------------------

export default class BaseLayer {
	/** Unique identifier for this layer instance. */
	readonly id: Id;

	/** Machine-readable layer type tag (overridden by subclasses). */
	static type = 'base';

	/** Layer settings (timing, enable state, etc.). */
	settings: BaseLayerSettings;

	/**
	 * Layer properties — the visual/auditory attributes that can be animated.
	 *
	 * Each property key maps to either a static value or an array of
	 * {@link Keyframe} objects describing its animation over time.
	 */
	properties: BaseLayerProperties;

	/** Reference to the parent VideoFlow builder instance. */
	protected parent: any;

	/** Whether {@link remove} has already been called. */
	private removed = false;

	/** The project's frames-per-second, cached for convenience. */
	protected fps: number;

	constructor(parent: any, properties: BaseLayerProperties = {}, settings: BaseLayerSettings = {}) {
		this.parent = parent;
		this.fps = parent?.settings?.fps ?? 30;
		this.id = createLayerId();
		this.settings = {
			...(this.constructor as typeof BaseLayer).defaultSettings,
			...settings,
		};
		this.properties = {
			...(this.constructor as typeof BaseLayer).defaultProperties,
			...properties,
		};
	}

	// -----------------------------------------------------------------------
	//  Static metadata
	// -----------------------------------------------------------------------

	/** Settings keys to include in the compiled JSON beyond the base keys. */
	static get settingsKeys(): string[] {
		return [];
	}

	/** Default settings for this layer type. */
	static get defaultSettings(): Partial<BaseLayerSettings> {
		return {
			enabled: true,
			startTime: 0,
			sourceDuration: undefined,
			speed: 1,
			sourceStart: 0,
			sourceEnd: 0,
		};
	}

	/**
	 * Default property values derived from the properties definition.
	 * Each key gets the `default` from its {@link PropertyDefinition}.
	 */
	static get defaultProperties(): Partial<BaseLayerProperties> {
		return Object.fromEntries(
			Object.entries(this.propertiesDefinition).map(([k, v]) => [k, v.default ?? ''])
		);
	}

	/**
	 * Property definitions for this layer type.
	 *
	 * Each entry describes one animatable (or static) property, including its
	 * CSS mapping, allowed units, default value, and whether it can be
	 * interpolated between keyframes.
	 */
	static get propertiesDefinition(): Record<string, PropertyDefinition> {
		return {};
	}

	// -----------------------------------------------------------------------
	//  Time getters — derived values useful for inspection
	// -----------------------------------------------------------------------

	/** Timeline-time (frames) at which the playable segment starts. */
	get startFrame(): number {
		return timeToFrames(this.settings.startTime ?? 0, this.fps);
	}

	/** Source-time offset (frames) into the source where the segment begins. */
	get sourceStartFrames(): number {
		return timeToFrames(this.settings.sourceStart ?? 0, this.fps);
	}

	/** Length of the playable segment expressed in source-time frames. */
	get sourceDurationFrames(): number {
		if (this.settings.sourceDuration != null) {
			return timeToFrames(this.settings.sourceDuration, this.fps);
		}
		return 0;
	}

	/**
	 * Length of the layer's footprint on the timeline, in seconds.
	 * `timelineDuration = sourceDuration / |speed|`.
	 */
	get timelineDuration(): number {
		const speed = Math.abs(this.settings.speed ?? 1);
		if (speed === 0) return 0;
		const sourceDur = this.settings.sourceDuration != null
			? parseTime(this.settings.sourceDuration, this.fps)
			: 0;
		return sourceDur / speed;
	}

	/** Length of the layer's footprint on the timeline, in frames. */
	get timelineDurationFrames(): number {
		return Math.round(this.timelineDuration * this.fps);
	}

	/** Timeline-time (frames) at which the layer's footprint ends. */
	get endFrame(): number {
		return this.startFrame + this.timelineDurationFrames;
	}

	/** Timeline-time (seconds) at which the layer's footprint ends. */
	get endTime(): number {
		return parseTime(this.settings.startTime ?? 0, this.fps) + this.timelineDuration;
	}

	// -----------------------------------------------------------------------
	//  Flow actions
	// -----------------------------------------------------------------------

	/**
	 * Set property values at the current flow position (step keyframe).
	 *
	 * @param value - An object mapping property names to their new values.
	 */
	set(value: Record<string, any>): this {
		this.parent.pushAction({ statement: 'set', id: this.id, value });
		return this;
	}

	/**
	 * Animate properties from one state to another.
	 *
	 * @param from     - Starting property values.
	 * @param to       - Ending property values.
	 * @param settings - Animation timing (duration, easing, wait).
	 */
	animate(
		from: Record<string, any>,
		to: Record<string, any>,
		{
			duration = '0.25s',
			easing,
			wait,
		}: {
			duration?: Time;
			easing?: Easing;
			wait?: boolean;
		} = {}
	): this {
		const settings = { duration, easing, wait };
		this.parent.pushAction({ statement: 'animate', id: this.id, from, to, settings });
		return this;
	}

	/**
	 * Remove this layer at the current flow position.
	 *
	 * Once removed, calling any further flow method on this layer throws.
	 */
	remove(): this {
		if (this.removed) throw new Error('Layer already removed');
		this.removed = true;
		this.parent.pushAction({ statement: 'removeLayer', id: this.id });
		return this;
	}

	// -----------------------------------------------------------------------
	//  Convenience visibility helpers
	// -----------------------------------------------------------------------

	/** Show the layer (set `visible` to `true`). */
	show(): this { return this.set({ visible: true }); }
	/** Hide the layer (set `visible` to `false`). */
	hide(): this { return this.set({ visible: false }); }

	/**
	 * Fade the layer in from transparent.
	 *
	 * @param duration - How long the fade takes.
	 * @param easing   - Easing function.
	 * @param wait     - Whether the flow pointer waits for the fade to finish.
	 */
	fadeIn(duration: Time = '300ms', easing?: Easing, wait?: boolean): this {
		return this.animate({ opacity: 0, visible: true }, { opacity: 1 }, { duration, easing, wait });
	}

	/**
	 * Fade the layer out to transparent.
	 *
	 * @param duration - How long the fade takes.
	 * @param easing   - Easing function.
	 * @param wait     - Whether the flow pointer waits for the fade to finish.
	 */
	fadeOut(duration: Time = '300ms', easing?: Easing, wait?: boolean): this {
		return this.animate({ opacity: 1 }, { opacity: 0, visible: false }, { duration, easing, wait });
	}

	// -----------------------------------------------------------------------
	//  Serialisation
	// -----------------------------------------------------------------------

	/**
	 * Serialise this layer into the VideoFlow JSON model format.
	 *
	 * Properties stored as keyframe arrays are converted into the
	 * `animations` array, while static properties go into `properties`.
	 */
	toJSON(): LayerJSON {
		const animations: Animation[] = [];
		const staticProps: Record<string, any> = {};
		let effects: LayerEffectJSON[] | undefined;

		for (const [key, value] of Object.entries(this.properties)) {
			if (key === 'effects') {
				// `effects` is a special creation-time property — promote it to a
				// top-level JSON field instead of treating it as a keyframe property.
				if (Array.isArray(value) && value.length > 0) effects = value.slice();
				continue;
			}
			if (Array.isArray(value) && value.length > 0 && value[0]?.time !== undefined) {
				// Keyframed property → animation
				animations.push({
					property: key,
					keyframes: value.map((kf: any) => ({
						time: kf.time,
						value: kf.value,
						...(kf.easing ? { easing: kf.easing } : {}),
					})),
				});
			} else if (value?.value !== undefined) {
				// Single static value wrapper
				staticProps[key] = value.value;
			} else {
				staticProps[key] = value;
			}
		}

		const startTimeSec = parseTime(this.settings.startTime ?? 0, this.fps);
		const sourceDurationSec = this.settings.sourceDuration != null
			? parseTime(this.settings.sourceDuration, this.fps)
			: 0;
		const sourceStartSec = parseTime(this.settings.sourceStart ?? 0, this.fps);

		const transitionIn = this.normalizeTransitionSpec(this.settings.transitionIn);
		const transitionOut = this.normalizeTransitionSpec(this.settings.transitionOut);

		return {
			id: this.id,
			type: (this.constructor as typeof BaseLayer).type,
			settings: {
				enabled: this.settings.enabled ?? true,
				startTime: startTimeSec,
				sourceDuration: sourceDurationSec,
				...(this.settings.name ? { name: this.settings.name } : {}),
				...(this.settings.speed !== undefined && this.settings.speed !== 1 ? { speed: this.settings.speed } : {}),
				...(sourceStartSec > 0 ? { sourceStart: sourceStartSec } : {}),
			},
			properties: staticProps,
			animations,
			...(transitionIn ? { transitionIn } : {}),
			...(transitionOut ? { transitionOut } : {}),
			...(effects ? { effects } : {}),
		};
	}

	/** Convert a user-facing {@link LayerTransitionSpec} into the JSON shape. */
	protected normalizeTransitionSpec(spec: LayerTransitionSpec | undefined): LayerTransitionJSON | undefined {
		if (!spec || !spec.transition) return undefined;
		const durationSec = spec.duration != null ? parseTime(spec.duration, this.fps) : 0.2;
		return {
			transition: spec.transition,
			duration: durationSec,
			...(spec.params ? { params: spec.params } : {}),
		};
	}
}
