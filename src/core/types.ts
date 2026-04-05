/**
 * Core type definitions for VideoFlow.
 *
 * VideoFlow uses a flexible time system that allows specifying durations and
 * timestamps in multiple formats.  Internally every time value is converted to
 * a frame number before rendering, but the public API accepts the human-friendly
 * formats listed by the {@link Time} type.
 */

/**
 * A flexible time value accepted by the VideoFlow API.
 *
 * Supported formats:
 * - `number` — interpreted as seconds (e.g. `5` = 5 seconds)
 * - `string` (no unit) — also seconds (e.g. `"5"` = 5 seconds)
 * - `string` with unit:
 *   - `"5s"`   → 5 seconds
 *   - `"2m"`   → 2 minutes
 *   - `"1h"`   → 1 hour
 *   - `"120f"` → 120 frames
 *   - `"500ms"` → 500 milliseconds
 *   - `"01:30"` → 1 min 30 sec (mm:ss)
 *   - `"01:02:30"` → 1 hr 2 min 30 sec (hh:mm:ss)
 *   - `"01:02:30:15"` → hh:mm:ss:ff (frames at the end)
 */
export type Time = string | number;

/** Unique identifier for a layer (UUID v4). */
export type Id = string;

/**
 * Easing functions supported by the animation system.
 *
 * - `step`      — hold the start value until the next keyframe (no interpolation)
 * - `linear`    — constant rate of change
 * - `easeIn`    — starts slow, accelerates
 * - `easeOut`   — starts fast, decelerates
 * - `easeInOut` — slow at both ends, fast in the middle
 */
export type Easing = 'step' | 'linear' | 'easeIn' | 'easeOut' | 'easeInOut';

/**
 * Options passed when adding a layer to the flow.
 *
 * - `waitFor` controls how long the flow pointer advances after the layer is
 *   added. `'finish'` waits for the layer's full duration; a {@link Time}
 *   value waits for that specific amount.
 * - `index` sets the visual stacking order (negative = back, positive = front).
 */
export type AddLayerOptions = {
	waitFor?: Time | 'finish';
	index?: number;
};

/**
 * An animation keyframe.
 *
 * The `time` field is always in *seconds* in the public JSON model, but
 * internally it is converted to frames once the project compiles.
 */
export type Keyframe = {
	time: number;
	value: any;
	easing?: Easing;
};

/**
 * A single animation definition attached to a layer.
 *
 * Each animation targets one property and defines a sequence of keyframes
 * with an optional default easing function.
 */
export type Animation = {
	property: string;
	keyframes: Keyframe[];
	easing?: Easing;
};

// ---------------------------------------------------------------------------
//  JSON Model types — the serialised representation of a VideoFlow project
// ---------------------------------------------------------------------------

/**
 * Settings block for a layer inside the compiled JSON.
 *
 * Different layer types extend this with additional keys (e.g. `source` for
 * media layers, `captions` for the captions layer).
 */
export type LayerSettingsJSON = {
	enabled: boolean;
	startTime: number;
	duration: number;
	[key: string]: any;
};

/**
 * A single layer as it appears in the compiled JSON model.
 */
export type LayerJSON = {
	id: Id;
	type: string;
	settings: LayerSettingsJSON;
	properties: Record<string, any>;
	animations: Animation[];
};

/**
 * The top-level compiled video JSON model.
 *
 * This is the format accepted by both the browser and server renderers.
 */
export type VideoJSON = {
	name: string;
	duration: number;
	width: number;
	height: number;
	fps: number;
	backgroundColor: string;
	layers: LayerJSON[];
};

// ---------------------------------------------------------------------------
//  Flow actions — the intermediate instructions emitted by the flow API
// ---------------------------------------------------------------------------

/**
 * Union of all possible flow actions produced by the VideoFlow builder.
 *
 * The flow is a sequential list of these actions that gets compiled into the
 * final {@link VideoJSON} by the `compile()` method.
 */
export type Action =
	| { statement: 'wait'; duration: Time }
	| { statement: 'parallel'; actions: Action[][] }
	| { statement: 'addLayer'; id: Id; type: string; settings: Record<string, any>; properties: Record<string, any>; options?: AddLayerOptions }
	| { statement: 'removeLayer'; id: Id }
	| { statement: 'set'; id: Id; value: Record<string, any> }
	| { statement: 'animate'; id: Id; from: Record<string, any>; to: Record<string, any>; settings: { duration: Time; easing?: Easing; wait?: boolean } };

// ---------------------------------------------------------------------------
//  Property definition — metadata about a layer property
// ---------------------------------------------------------------------------

/**
 * Metadata describing a single property on a layer type.
 *
 * Used internally by the rendering system to know how to apply, interpolate,
 * and map properties onto CSS.
 */
export type PropertyDefinition = {
	/** CSS property name, CSS custom property (`--name`), or `false` for non-CSS props. */
	cssProperty?: string | false;
	/** Allowed CSS unit suffixes (e.g. `['px']`, `['deg']`, `['em', 'px']`). */
	units?: string[];
	/** Enumerated allowed values (if applicable). */
	enum?: string[];
	/** Default value when no keyframe is set. */
	default: any;
	/** Whether this property can be interpolated between keyframes. */
	animatable: boolean;
};

/**
 * Rendering options common to both browser and server renderers.
 */
export type RenderOptions = {
	/** Output type — `'buffer'` keeps the video in memory, `'file'` writes to disk. */
	outputType?: 'buffer' | 'file';
	/** Output file path (only used when `outputType` is `'file'`). */
	output?: string;
	/** An AbortSignal that can cancel the rendering process. */
	signal?: AbortSignal;
	/** Whether to log detailed rendering progress. */
	verbose?: boolean;
	/** Progress callback — called with a value from 0 to 1 as rendering advances. */
	onProgress?: (progress: number) => void;
};

/**
 * Project-level settings provided when creating a VideoFlow instance.
 *
 * These control the canvas dimensions, frame rate, visual defaults, and
 * logging behaviour.
 */
export type ProjectSettings = {
	name?: string;
	width?: number;
	height?: number;
	fps?: number;
	backgroundColor?: string;
	verbose?: boolean;
	defaults?: {
		easing?: Easing;
		fontFamily?: string;
	};
};
