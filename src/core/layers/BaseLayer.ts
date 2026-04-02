/**
 * BaseLayer — the root of the VideoFlow layer hierarchy.
 *
 * Every layer type ultimately extends BaseLayer, which provides:
 * - A unique `id` (UUID v4)
 * - Common settings (enabled, startTime, duration, speed, trimStart)
 * - A property system with keyframe animation support
 * - Time ↔ frame conversions via the project's fps
 * - Serialisation to/from the VideoFlow JSON model
 *
 * The class mirrors Scrptly's BaseLayer but adapts the data model to
 * VideoFlow's time-in-seconds API with internal frame-based processing.
 */

import type { Id, Time, Easing, Keyframe, Animation, PropertyDefinition, Action, AddLayerOptions, LayerJSON } from '../types.js';
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
	startTime?: Time;
	duration?: Time;
	speed?: number;
	trimStart?: Time;
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

	/** Default settings for this layer type. */
	static get defaultSettings(): Partial<BaseLayerSettings> {
		return {
			enabled: true,
			startTime: 0,
			duration: undefined,
			speed: 1,
			trimStart: 0,
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
	//  Frame getters — convert time-based settings into frame numbers
	// -----------------------------------------------------------------------

	/** The frame at which this layer starts (after accounting for trimStart). */
	get startFrame(): number {
		return timeToFrames(this.settings.startTime ?? 0, this.fps) +
		       timeToFrames(this.settings.trimStart ?? 0, this.fps);
	}

	/** The frame at which this layer ends. */
	get endFrame(): number {
		const start = timeToFrames(this.settings.startTime ?? 0, this.fps);
		const dur = this.settings.duration != null
			? timeToFrames(this.settings.duration, this.fps)
			: 0;
		return start + dur;
	}

	/** The raw start time in frames (before trim). */
	get startTimeFrames(): number {
		return timeToFrames(this.settings.startTime ?? 0, this.fps);
	}

	/** Trim offset in frames. */
	get trimStartFrames(): number {
		return timeToFrames(this.settings.trimStart ?? 0, this.fps);
	}

	/** Duration of this layer in frames. */
	get durationFrames(): number {
		if (this.settings.duration != null) {
			return timeToFrames(this.settings.duration, this.fps);
		}
		return 0;
	}

	/** Duration of the layer visible in the timeline (after trim & speed). */
	get actualDuration(): number {
		return this.endFrame - this.startFrame;
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

		for (const [key, value] of Object.entries(this.properties)) {
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
		const durationSec = this.settings.duration != null
			? parseTime(this.settings.duration, this.fps)
			: 0;

		return {
			id: this.id,
			type: (this.constructor as typeof BaseLayer).type,
			settings: {
				enabled: this.settings.enabled ?? true,
				startTime: startTimeSec,
				duration: durationSec,
				...(this.settings.name ? { name: this.settings.name } : {}),
				...(this.settings.speed !== undefined && this.settings.speed !== 1 ? { speed: this.settings.speed } : {}),
				...(parseTime(this.settings.trimStart ?? 0, this.fps) > 0 ? { trimStart: parseTime(this.settings.trimStart ?? 0, this.fps) } : {}),
			},
			properties: staticProps,
			animations,
		};
	}
}
