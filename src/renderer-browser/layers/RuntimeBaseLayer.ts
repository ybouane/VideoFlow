/**
 * RuntimeBaseLayer — the root runtime class for all layer types in the renderer.
 *
 * Provides:
 * - Timing helpers (startFrame, endFrame, retimeFrame, etc.)
 * - Keyframe interpolation with easing and unit handling
 * - Overridable property application pipeline:
 *     resetCSSProperties() → applyProperties() → applyCSSProperty() / applyProperty()
 * - Overridable lifecycle: initialize(), generateElement(), renderFrame()
 *
 * Subclasses override methods like {@link applyCSSProperty} and
 * {@link applyProperty} to provide type-specific behaviour.
 */

import type { LayerJSON, PropertyDefinition } from '@videoflow/core/types';

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

	// -- Timing helpers -----------------------------------------------------

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

	// -- Retiming -----------------------------------------------------------

	/** Convert an absolute frame to the layer-local retimed frame. */
	retimeFrame(frame: number): number {
		if (this.speed === 0) return 0;
		if (this.speed < 0) return Math.abs(this.speed) * (this.endFrame - frame);
		return this.speed * (frame - this.startFrame);
	}

	// -- Property interpolation ---------------------------------------------

	/**
	 * Get all animated property values for this layer at the given frame.
	 *
	 * Iterates the layer's set properties and interpolates each one at the
	 * retimed frame.
	 */
	getPropertiesAtFrame(frame: number): Record<string, any> {
		const retimedFrame = this.retimeFrame(frame);
		const retimedTime = retimedFrame / this.fps;
		const props: Record<string, any> = {};

		// Process animated properties from the animations array
		for (const anim of this.json.animations) {
			const kfs = anim.keyframes;
			if (kfs.length === 0) continue;

			const definition = this.getPropertyDefinition(anim.property);
			props[anim.property] = this.interpolateKeyframes(anim.property, retimedTime, kfs, definition);
		}

		// Merge static properties (properties not in animations)
		for (const [key, value] of Object.entries(this.json.properties)) {
			if (!(key in props)) {
				const definition = this.getPropertyDefinition(key);
				props[key] = definition ? this.ensureUnit(value, definition) : value;
			}
		}

		// Fill in defaults from propertiesDefinition for any properties
		// that are not set in animations or static properties.
		const allDefs = this.getPropertiesDefinition();
		for (const [key, def] of Object.entries(allDefs)) {
			if (!(key in props) && def.default !== undefined) {
				props[key] = this.ensureUnit(def.default, def);
			}
		}

		return props;
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
		return this.interpolate(kf2.value, kf1.value, t, kf2.easing ?? 'step', definition);
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
	 * Hides if out of range, gets properties, applies them, shows.
	 */
	async renderFrame(frame: number): Promise<void> {
		if (!this.$element) return;

		if (frame < this.actualStartFrame || frame >= this.endFrame || !this.json.settings.enabled) {
			this.$element.style.display = 'none';
			return;
		}

		const props = this.getPropertiesAtFrame(frame);
		await this.applyProperties(props);
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
