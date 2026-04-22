/**
 * RuntimeBaseLayer — the root runtime class for all layer types in the renderer.
 *
 * Provides:
 * - Timing helpers (startFrame, endFrame, sourceTimeAtFrame, etc.)
 * - Keyframe interpolation with easing and unit handling
 * - Overridable property application pipeline:
 *     resetCSSProperties() → applyProperties() → applyCSSProperty() / applyProperty()
 * - Overridable lifecycle: initialize(), generateElement(), renderFrame()
 *
 * Time model: VideoFlow exposes three time contexts —
 *   1. **source media time** (`[0, mediaDuration]`)
 *   2. **source segment time** (`[0, sourceDuration]`)
 *   3. **timeline time** (`[0, projectDuration]`)
 * `startTime` and `endTime` live in timeline time. `sourceStart`,
 * `sourceDuration`, `mediaDuration` and keyframe `time` values live in source
 * time. `speed` stretches the segment in the timeline:
 * `timelineDuration = sourceDuration / speed`.
 *
 * Subclasses override methods like {@link applyCSSProperty} and
 * {@link applyProperty} to provide type-specific behaviour.
 */

import type { LayerJSON, LayerEffectJSON, PropertyDefinition } from '@videoflow/core/types';
import { getTransitionDefinition } from '../transitions.js';

/** Regex that matches an animated effect-param key (`effects.name.param` or `effects.name[idx].param`). */
const EFFECT_PARAM_PATH_RE = /^effects\.([a-zA-Z_][\w-]*)(?:\[(\d+)\])?\.([a-zA-Z_]\w*)$/;

// ---------------------------------------------------------------------------
//  ILayerRenderer — minimal interface required by runtime layer classes.
//  Both BrowserRenderer and DomRenderer implement this.
// ---------------------------------------------------------------------------

export interface ILayerRenderer {
	/** All runtime layers in render order. Used for z-index calculation. */
	layers: RuntimeBaseLayer[];
	/** Return the full propertiesDefinition for the given layer type. */
	getPropertyDefinition(layerType: string): Record<string, PropertyDefinition> | undefined;
	/** Load a Google Font by name so it is available for rendering. */
	loadFont(fontName: string): Promise<void>;
}

// ---------------------------------------------------------------------------
//  RuntimeBaseLayer
// ---------------------------------------------------------------------------

export default class RuntimeBaseLayer {
	json: LayerJSON;
	fps: number;
	projectWidth: number;
	projectHeight: number;
	$element: HTMLElement | null = null;
	/** Reference to the parent renderer for font loading, property lookup, etc. */
	renderer: ILayerRenderer;
	/**
	 * The most recent final (post-transition) property map applied to this
	 * layer by `renderFrame`. Used by BrowserRenderer as the per-layer raster
	 * cache key, and as a snapshot of what the DOM currently reflects. `null`
	 * when the layer is out of range for the current frame.
	 */
	lastAppliedProps: Record<string, any> | null = null;

	constructor(json: LayerJSON, fps: number, width: number, height: number, renderer: ILayerRenderer) {
		this.json = json;
		this.fps = fps;
		this.projectWidth = width;
		this.projectHeight = height;
		this.renderer = renderer;
	}

	// -- Capabilities (overridden by subclasses) ----------------------------

	/** Whether this layer type produces visible output. */
	get hasVisual(): boolean { return false; }

	/** Whether this layer type produces audio output. */
	get hasAudio(): boolean { return false; }

	/**
	 * Whether this layer's rasterized frame can be cached across frames based
	 * on a stable property hash. Defaults to `true` (image/text/captions are
	 * effectively static for identical inputs). Overridden to `false` by the
	 * video layer whose content changes every frame regardless of properties.
	 */
	get cacheable(): boolean { return true; }

	/** Whether this layer has any registered effects attached. */
	get hasEffects(): boolean {
		return !!this.json.effects && this.json.effects.length > 0;
	}

	// -- Timing helpers -----------------------------------------------------

	/** Timeline-time (seconds) at which the playable segment starts. */
	get startTime(): number {
		return this.json.settings.startTime ?? 0;
	}

	/** Source-time (seconds) offset where the playable segment begins. */
	get sourceStart(): number {
		return (this.json.settings as any).sourceStart ?? 0;
	}

	/** Length of the playable segment in source seconds. */
	get sourceDuration(): number {
		return (this.json.settings as any).sourceDuration ?? 0;
	}

	/** Intrinsic length of the source media in seconds, when known. */
	get mediaDuration(): number | undefined {
		return (this.json.settings as any).mediaDuration;
	}

	get speed(): number {
		return this.json.settings.speed ?? 1;
	}

	/** Length of the layer's timeline footprint in seconds. */
	get timelineDuration(): number {
		const speedAbs = Math.abs(this.speed);
		if (speedAbs === 0) return 0;
		return this.sourceDuration / speedAbs;
	}

	/** Timeline-time (seconds) at which the layer's footprint ends. */
	get endTime(): number {
		return this.startTime + this.timelineDuration;
	}

	get startFrame(): number {
		return Math.round(this.startTime * this.fps);
	}

	get endFrame(): number {
		return Math.round(this.endTime * this.fps);
	}

	// -- Retiming -----------------------------------------------------------

	/**
	 * Convert a timeline frame to the corresponding **absolute source-time**
	 * (in seconds). This is the value at which keyframes should be looked up
	 * and the value to feed into a video element's `currentTime`.
	 */
	sourceTimeAtFrame(frame: number): number {
		const timelineSec = frame / this.fps;
		const elapsedSec = timelineSec - this.startTime;
		const speedAbs = Math.abs(this.speed);
		if (speedAbs === 0) return this.sourceStart;
		const elapsedSourceSec = elapsedSec * speedAbs;
		if (this.speed < 0) {
			return this.sourceStart + this.sourceDuration - elapsedSourceSec;
		}
		return this.sourceStart + elapsedSourceSec;
	}

	// -- Transitions --------------------------------------------------------

	/**
	 * Compute the clamped, *signed* `{ pIn, pOut }` transition values at a
	 * given frame.
	 *
	 * The transition system uses a single signed parameter `p` across the
	 * layer's lifetime:
	 *
	 * - `p = -1` at the very start of the `transitionIn` window
	 * - `p =  0` at rest (between transitions — layer is in its original state)
	 * - `p = +1` at the very end of the `transitionOut` window
	 *
	 * Because the two windows don't overlap, we split this single axis into
	 * two values to allow different presets and easings at each end:
	 *
	 * - `pIn`  rises from `-1` → `0` across the in-window; `0` elsewhere.
	 * - `pOut` rises from  `0` → `+1` across the out-window; `0` elsewhere.
	 *
	 * Raw values are returned (not eased) — the caller applies the
	 * appropriate easing to each. If `transitionIn.duration +
	 * transitionOut.duration` exceeds the layer's timeline duration, both
	 * are scaled down proportionally so they meet in the middle without
	 * overlap.
	 */
	getTransitionProgress(frame: number): { pIn: number; pOut: number } {
		const tIn = this.json.transitionIn;
		const tOut = this.json.transitionOut;
		if (!tIn && !tOut) return { pIn: 0, pOut: 0 };

		let dIn = tIn?.duration ?? 0;
		let dOut = tOut?.duration ?? 0;
		const total = this.timelineDuration;

		if (dIn + dOut > total && dIn + dOut > 0) {
			const scale = total / (dIn + dOut);
			dIn *= scale;
			dOut *= scale;
		}

		const elapsed = (frame / this.fps) - this.startTime;

		// pIn: -1 at the start of the in-window, rising linearly to 0 at its
		// end. Outside the window (including before the layer starts), stays 0
		// so presets are a natural no-op.
		let pIn = 0;
		if (dIn > 0 && elapsed < dIn) {
			const t = Math.max(0, elapsed / dIn);
			pIn = -1 + t;
		}

		// pOut: 0 at the start of the out-window, rising linearly to +1 at the
		// layer's end. Outside the window, stays 0.
		let pOut = 0;
		if (dOut > 0 && elapsed > total - dOut) {
			const t = Math.min(1, (elapsed - (total - dOut)) / dOut);
			pOut = t;
		}

		return { pIn, pOut };
	}

	/**
	 * Apply `transitionIn` and `transitionOut` presets to the resolved
	 * property map for this frame. Called between `getPropertiesAtFrame` and
	 * `applyProperties`. Unknown presets are silently skipped.
	 *
	 * Each preset receives the signed `p` so a single function body handles
	 * both enter and exit — e.g. a `rise` preset that moves the layer
	 * continuously upward through `p ∈ [-1, +1]` just works for both windows.
	 */
	applyTransitions(frame: number, props: Record<string, any>): Record<string, any> {
		const tIn = this.json.transitionIn;
		const tOut = this.json.transitionOut;
		if (!tIn && !tOut) return props;

		const { pIn, pOut } = this.getTransitionProgress(frame);

		// In-window: pIn ∈ [-1, 0). Ease the progress portion (0..1) then
		// shift back into the signed range.
		if (tIn && pIn < 0) {
			const def = getTransitionDefinition(tIn.transition);
			if (def) {
				const easing = tIn.easing ?? def.defaultEasing;
				const pEased = -1 + this.applyEasing(pIn + 1, easing);
				props = def.fn(pEased, props, tIn.params ?? {}) ?? props;
			}
		}
		// Out-window: pOut ∈ (0, 1]. Ease directly.
		if (tOut && pOut > 0) {
			const def = getTransitionDefinition(tOut.transition);
			if (def) {
				const easing = tOut.easing ?? def.defaultEasing;
				const pEased = this.applyEasing(pOut, easing);
				props = def.fn(pEased, props, tOut.params ?? {}) ?? props;
			}
		}
		return props;
	}

	// -- Property interpolation ---------------------------------------------

	/**
	 * Get all animated property values for this layer at the given frame.
	 *
	 * Iterates the layer's set properties and interpolates each one at the
	 * retimed frame.
	 */
	getPropertiesAtFrame(frame: number): Record<string, any> {
		// Keyframes live in absolute source seconds, so look them up using
		// the layer's source-time at this timeline frame.
		const sourceTimeSec = this.sourceTimeAtFrame(frame);
		const props: Record<string, any> = {};

		const allDefs = this.getPropertiesDefinition();

		// Process animated properties from the animations array
		for (const anim of this.json.animations) {
			const kfs = anim.keyframes;
			if (kfs.length === 0) continue;

			// Effect param dot-paths (effects.name[.idx].param) aren't in the
			// layer's propertiesDefinition; they're interpolated as bare numeric
			// values with no unit/CSS mapping, then fed to the effect compositor.
			if (EFFECT_PARAM_PATH_RE.test(anim.property)) {
				props[anim.property] = this.interpolateKeyframes(anim.property, sourceTimeSec, kfs);
				continue;
			}

			const definition = allDefs[anim.property];
			// Skip properties not defined for this layer type
			if (!definition) continue;
			props[anim.property] = this.interpolateKeyframes(anim.property, sourceTimeSec, kfs, definition);
		}

		// Merge static properties (properties not in animations)
		for (const [key, value] of Object.entries(this.json.properties)) {
			if (!(key in props)) {
				// Allow static effect-param dot-paths through untouched.
				if (EFFECT_PARAM_PATH_RE.test(key)) {
					props[key] = value;
					continue;
				}
				const definition = allDefs[key];
				// Skip properties not defined for this layer type
				if (!definition) continue;
				props[key] = this.ensureUnit(value, definition);
			}
		}

		// Fill in defaults from propertiesDefinition for any properties
		// that are not set in animations or static properties.
		for (const [key, def] of Object.entries(allDefs)) {
			if (!(key in props) && def.default !== undefined) {
				props[key] = this.ensureUnit(def.default, def);
			}
		}

		return props;
	}

	// -- Effects ------------------------------------------------------------

	/**
	 * Resolve the layer's declared effects with animated-param overrides
	 * merged in, for the current frame's `lastAppliedProps`. Dot-path props
	 * of the form `effects.<name>[idx].<param>` (idx defaults to 0 — the
	 * first occurrence of that effect name) override the static param from
	 * the effect's creation-time declaration.
	 */
	resolveEffectsForProps(props: Record<string, any> | null | undefined): LayerEffectJSON[] {
		const declared = this.json.effects;
		if (!declared || declared.length === 0) return [];
		// Clone each entry so we never mutate the compiled JSON.
		const resolved: LayerEffectJSON[] = declared.map(e => ({
			effect: e.effect,
			params: { ...(e.params ?? {}) },
		}));
		if (!props) return resolved;

		// Index the n-th occurrence of each effect name so [idx] lookups
		// line up with the original array positions.
		const occurrenceSlots: Record<string, number[]> = {};
		for (let i = 0; i < resolved.length; i++) {
			const name = resolved[i].effect;
			(occurrenceSlots[name] ??= []).push(i);
		}

		for (const [key, value] of Object.entries(props)) {
			const match = EFFECT_PARAM_PATH_RE.exec(key);
			if (!match) continue;
			const [, effectName, idxStr, paramName] = match;
			const slots = occurrenceSlots[effectName];
			if (!slots || slots.length === 0) continue;
			const idx = idxStr ? Number(idxStr) : 0;
			const slot = slots[idx];
			if (slot === undefined) continue;
			const entry = resolved[slot];
			entry.params = { ...(entry.params ?? {}), [paramName]: value };
		}

		return resolved;
	}

	/**
	 * Interpolate keyframes for a property at a given time.
	 */
	interpolateKeyframes(
		property: string,
		time: number,
		keyframes: Array<{ time: number; value: any; easing?: string }>,
		definition?: PropertyDefinition
	): any {
		if (keyframes.length === 0) return definition?.default;

		// Find the first keyframe AFTER the current time
		const kf1Idx = keyframes.findIndex(kf => kf.time > time);
		const kf1 = kf1Idx >= 0 ? keyframes[kf1Idx] : null;

		if (!kf1) {
			// After last keyframe — return last value
			return this.ensureUnit(keyframes[keyframes.length - 1].value, definition);
		}

		const kf2 = kf1Idx > 0 ? keyframes[kf1Idx - 1] : null;
		if (!kf2) {
			// Before first keyframe — return first value
			return this.ensureUnit(kf1.value, definition);
		}

		if (kf2.time === time) {
			// Exact match on previous keyframe
			return this.ensureUnit(kf2.value, definition);
		}

		// Between kf2 (before) and kf1 (after)
		if (definition?.animatable === false) {
			return kf2.value; // Step — return previous value
		}

		const t = (time - kf2.time) / (kf1.time - kf2.time);
		return this.interpolate(kf2.value, kf1.value, t, kf2.easing ?? 'linear', definition);
	}

	// -- Unit handling --

	/** Ensure a value has the correct unit from the property definition. */
	ensureUnit(value: any, definition?: PropertyDefinition): any {
		if (!definition || definition.animatable === false) return value;
		if (Array.isArray(value)) return value.map(v => this.ensureUnit(v, definition));
		if (this.isColor(value)) return value;

		const [v, u] = this.getNumUnit(value);
		const units = definition.units ?? [''];
		if (!units.includes(u)) {
			if (units.includes('')) return v;
			return `${v}${units[0]}`;
		}
		return `${v}${u}`;
	}

	/** Parse a value into [number, unit]. */
	getNumUnit(value: any): [number, string] {
		const match = String(value).match(/^([0-9.-]+)([a-z%]*)$/i);
		if (match) return [parseFloat(match[1]), match[2]];
		return [parseFloat(String(value)), ''];
	}

	/** Check if a value is a CSS color string. */
	isColor(v: any): boolean {
		return typeof v === 'string' && /^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|[a-z]+$)/i.test(v);
	}

	/** Prepare two values for interpolation, ensuring compatible units. */
	prepareUnits(v1: any, v2: any, definition?: PropertyDefinition): [any, string | undefined, any, string | undefined] {
		const units = definition?.units ?? [''];
		if ((typeof v1 === 'number' && typeof v2 === 'number') && units.includes('')) {
			return [v1, undefined, v2, undefined];
		}

		let [n1, u1] = this.getNumUnit(v1);
		let [n2, u2] = this.getNumUnit(v2);

		if (!units.includes(u1)) u1 = units[0];
		if (!units.includes(u2)) u2 = units[0];

		if (u1 !== u2) {
			return [`${n1}${u1}`, u1, `${n2}${u2}`, u2];
		}
		return [n1, u1, n2, u2];
	}

	/** Match array sizes for interpolation. */
	matchArraySizes(v1: any, v2: any, cssProperty?: string): [any[], any[]] {
		const a1 = Array.isArray(v1) ? v1 : [v1];
		const a2 = Array.isArray(v2) ? v2 : [v2];

		// For position, rotation, anchor — extend with 0; otherwise repeat last value
		const extendSame = !['--position', '--rotation', '--anchor'].includes(cssProperty ?? '');

		if (a1.length > a2.length) {
			return [a1, a2.concat(new Array(a1.length - a2.length).fill(extendSame ? a2[a2.length - 1] : 0))];
		}
		if (a1.length < a2.length) {
			return [a1.concat(new Array(a2.length - a1.length).fill(extendSame ? a1[a1.length - 1] : 0)), a2];
		}
		return [a1, a2];
	}

	// -- Interpolation --

	/** Interpolate between two values with easing. */
	interpolate(v1: any, v2: any, t: number, easing: string, definition?: PropertyDefinition): any {
		const cssProperty = (typeof definition?.cssProperty === 'string') ? definition.cssProperty : undefined;

		if (Array.isArray(v1) || Array.isArray(v2)) {
			const [a1, a2] = this.matchArraySizes(v1, v2, cssProperty);
			return a1.map((_: any, i: number) => this.interpolate(a1[i], a2[i], t, easing, definition));
		}

		const isCol = this.isColor(v1);
		let n1: any, u1: string | undefined, n2: any, u2: string | undefined;

		if (isCol) {
			[n1, u1, n2, u2] = [v1, undefined, v2, undefined];
		} else {
			[n1, u1, n2, u2] = this.prepareUnits(v1, v2, definition);
		}

		if ((typeof n1 === 'number' && typeof n2 === 'number') || easing === 'step') {
			const outUnit = u2 ?? '';
			switch (easing) {
				case 'step':
					return outUnit ? n1 + outUnit : n1;
				case 'easeIn':
					return (n1 + (n2 - n1) * (t * t)) + outUnit;
				case 'easeOut':
					return (n1 + (n2 - n1) * (t * (2 - t))) + outUnit;
				case 'easeInOut':
					return (n1 + (n2 - n1) * ((t < 0.5) ? 2 * t * t : -1 + (4 - 2 * t) * t)) + outUnit;
				case 'linear':
				default:
					return (n1 + (n2 - n1) * t) + outUnit;
			}
		} else {
			// Fallback: use Web Animations API for non-numeric interpolation (e.g. colors)
			if (!this.$element) return v1;

			let propAnim = cssProperty ?? '--value';
			if (propAnim.startsWith('--')) {
				if (isCol) propAnim = 'color';
				else if (u1 === '%' || u2 === '%' || u1 === '' || u2 === '') propAnim = 'flex-grow';
				else propAnim = 'width';
			}

			const anim = this.$element.animate([
				{ [propAnim]: v1 },
				{ [propAnim]: v2 },
			], {
				duration: 1000,
				fill: 'both',
				easing: ({
					linear: 'linear',
					easeIn: 'ease-in',
					easeOut: 'ease-out',
					easeInOut: 'ease-in-out',
				} as Record<string, string>)[easing] || 'ease-in-out',
			});

			anim.pause();
			anim.currentTime = t * 1000;

			const computed = getComputedStyle(this.$element)[propAnim as any];
			anim.cancel();
			return computed;
		}
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

	// -- Lifecycle (overridden by subclasses) --------------------------------

	/** Initialise media assets (fetch, decode, extract metadata). */
	async initialize(): Promise<void> {}

	/**
	 * Intrinsic source duration in seconds, when known by this runtime layer.
	 * Subclasses (RuntimeMediaLayer / RuntimeAudioLayer) override.
	 */
	get intrinsicDuration(): number | undefined {
		return undefined;
	}

	/**
	 * Resolve a deferred `sourceEnd` setting into a concrete `sourceDuration`
	 * once the runtime layer's intrinsic media duration is known. Called by
	 * the renderer after `initialize()` and before any frame is rendered.
	 * No-op when there is no `sourceEnd` to resolve, or when the intrinsic
	 * duration is unknown.
	 */
	resolveMediaTimings(): void {
		const s = this.json.settings as any;
		if (s.sourceEnd == null) return;
		const intrinsic = this.intrinsicDuration;
		if (intrinsic == null || !Number.isFinite(intrinsic) || intrinsic <= 0) return;
		const sourceStart = s.sourceStart ?? 0;
		const sourceDuration = Math.max(0, intrinsic - sourceStart - s.sourceEnd);
		s.sourceDuration = sourceDuration;
		s.mediaDuration = intrinsic;
		delete s.sourceEnd;
	}

	/**
	 * Create the DOM element for this layer.
	 *
	 * Uses the static elementTag from the constructor and sets data-element and
	 * data-id attributes. Returns `null` for layers with no visual output.
	 */
	async generateElement(): Promise<HTMLElement | null> {
		if (!this.hasVisual) return null;
		if (this.$element) return this.$element;
		return null; // Subclasses provide the element
	}

	// -- Frame rendering ----------------------------------------------------

	/**
	 * Render this layer's visual state at the given frame.
	 *
	 * Hides if out of range, gets properties, applies transitions, applies them, shows.
	 */
	async renderFrame(frame: number): Promise<void> {
		if (!this.$element) return;

		if (frame < this.startFrame || frame >= this.endFrame || !this.json.settings.enabled) {
			this.$element.style.display = 'none';
			this.lastAppliedProps = null;
			return;
		}

		const props = this.applyTransitions(frame, this.getPropertiesAtFrame(frame));
		await this.applyProperties(props);
		this.lastAppliedProps = props;
		this.$element.style.display = '';
	}

	// -- Property application --

	/**
	 * Reset CSS on the element before applying new properties.
	 * Subclasses override to add layer-specific resets (e.g. data-fit, --object-width).
	 */
	resetCSSProperties(): void {
		if (!this.$element) return;
		if (this.$element.style.display === 'none')
			this.$element.style.cssText = 'display:none;';
		else
			this.$element.style.cssText = '';
	}

	/**
	 * Apply interpolated property values to the DOM element.
	 *
	 * 1. Reset CSS
	 * 2. Set z-index
	 * 3. For each property:
	 *    - cssProperty === false → applyProperty() (non-CSS, e.g. text)
	 *    - otherwise → applyCSSProperty() (CSS property or variable)
	 *
	 * Subclasses override applyProperties to pre-process props (e.g.
	 * VisualLayer removes unused shadow sub-props, builds filter array).
	 */
	async applyProperties(props: Record<string, any>): Promise<void> {
		if (!this.$element) return;

		this.resetCSSProperties();
		const propertiesDefinition = this.getPropertiesDefinition();

		this.$element.style.setProperty('z-index', String(this.getLayerIndex() + 1));

		for (const prop of Object.keys(props)) {
			// Effect param dot-paths never drive CSS — they're consumed by the
			// WebGL compositor in `resolveEffectsForProps`.
			if (EFFECT_PARAM_PATH_RE.test(prop)) continue;

			const definition = propertiesDefinition[prop];

			if (definition?.cssProperty === false) {
				// Non-CSS property (text, fit handled via data attribute, etc.)
				await this.applyProperty(prop, props[prop], definition);
			} else {
				// CSS property — use explicit cssProperty or fall back to prop name
				const value = props[prop];
				const cssProp = (typeof definition?.cssProperty === 'string') ? definition.cssProperty : prop;

				if (Array.isArray(value) && cssProp.startsWith('--')) {
					// Array → split into --var-0, --var-1, etc.
					for (let i = 0; i < value.length; i++) {
						await this.applyCSSProperty(`${cssProp}-${i}`, String(value[i]), definition);
					}
				} else {
					await this.applyCSSProperty(cssProp, value, definition);
				}
			}
		}
	}

	/**
	 * Apply a single CSS property to the element.
	 * Subclasses override to intercept specific properties (e.g. boxShadow,
	 * filter, text-align, font-family, fit).
	 */
	async applyCSSProperty(prop: string, value: any, definition?: PropertyDefinition): Promise<void> {
		if (!this.$element) return;
		this.$element.style.setProperty(prop, Array.isArray(value) ? value.join(' ') : String(value));
	}

	/**
	 * Handle a non-CSS property (cssProperty === false).
	 * Subclasses override to handle properties like `text`, `mute`, etc.
	 */
	async applyProperty(prop: string, value: any, definition?: PropertyDefinition): Promise<void> {
		// Base: no non-CSS properties to handle
	}

	/**
	 * Get the full propertiesDefinition for this layer's type.
	 */
	getPropertiesDefinition(): Record<string, PropertyDefinition> {
		return this.renderer.getPropertyDefinition(this.json.type) ?? {};
	}

	/**
	 * Look up a single property definition.
	 */
	getPropertyDefinition(prop: string): PropertyDefinition | undefined {
		return this.getPropertiesDefinition()[prop];
	}

	/** Get this layer's index in the parent layers array (for z-ordering). */
	getLayerIndex(): number {
		return this.renderer.layers.indexOf(this);
	}

	// -- Cleanup ------------------------------------------------------------

	/** Release resources. */
	destroy(): void {}
}
