/**
 * Effect registry — shared between renderers.
 *
 * Two flavours of effects:
 *
 * **Single-pass.** A short GLSL body defining one function:
 *
 * ```glsl
 *   vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) { ... }
 * ```
 *
 * The compositor wraps it with boilerplate (varyings, `u_texture` sampler,
 * `u_resolution`, one uniform per declared param named `u_<paramName>`, plus a
 * shared GLSL preamble of helper functions) at registration time.
 *
 * **Multi-pass.** An array of `EffectPass` entries; each pass has the same
 * `effect()` body shape and runs in sequence with ping-pong framebuffers. A
 * pass may declare `readsOriginal: true` to also receive the effect's input
 * texture (the data that arrived at the effect, not the previous pass output)
 * as `u_originalTexture` — this is what makes bloom / glow / edge-glow's
 * "blur then composite over original" pipeline expressible.
 *
 * Params support GLSL primitives (`float` / `int` / `bool` / `vec2..4`),
 * CSS color strings (`color` → `vec4`), and a string-enum `option` type that
 * resolves to an `int u_<name>` whose value is the index of the option in the
 * registered list.
 */

/** Supported GL uniform types for effect parameters. */
export type EffectParamType =
	| 'float'
	| 'int'
	| 'bool'
	| 'vec2'
	| 'vec3'
	| 'vec4'
	| 'color'
	| 'option';

/**
 * Metadata describing a single effect parameter.
 *
 * `default` is used when the layer's JSON does not override it. For `color`,
 * the value is a CSS colour string (`"#rrggbb"` / `"rgba(..)"`), converted to
 * a `vec4` by the compositor at draw time. For `option`, the value is one of
 * the strings in `options`; the compositor resolves it to its index and binds
 * it as an `int u_<name>` uniform.
 */
export type EffectParamDefinition = {
	type: EffectParamType;
	default: any;
	min?: number;
	max?: number;
	/** For `option` type: list of allowed string values (index → GLSL int). */
	options?: string[];
	/** Reserved for future animation support (currently all are animatable). */
	animatable?: boolean;
};

/**
 * One pass of a multi-pass effect. The `glsl` body has the same shape as a
 * single-pass effect; if `readsOriginal` is true, the shader can sample the
 * effect's input texture as `u_originalTexture` (e.g. for the final
 * composite of a bloom / glow / edge-glow pipeline).
 */
export type EffectPass = {
	glsl: string;
	readsOriginal?: boolean;
};

/** A registered effect. Has either `glsl` (single-pass) or `passes`. */
export type EffectDefinition = {
	name: string;
	glsl?: string;
	passes?: EffectPass[];
	params: Record<string, EffectParamDefinition>;
};

const registry: Map<string, EffectDefinition> = new Map();

/**
 * Register an effect. Pass either:
 * - a string `glsl` body for single-pass effects, or
 * - an array of `EffectPass` for multi-pass effects.
 *
 * Last registration wins.
 */
export function registerEffect(
	name: string,
	glslOrPasses: string | EffectPass[],
	params: Record<string, EffectParamDefinition> = {},
): void {
	const def: EffectDefinition = { name, params };
	if (typeof glslOrPasses === 'string') {
		def.glsl = glslOrPasses;
	} else {
		def.passes = glslOrPasses;
	}
	registry.set(name, def);
}

/** Retrieve a registered effect. */
export function getEffect(name: string): EffectDefinition | undefined {
	return registry.get(name);
}

/** List registered effect names. */
export function listEffects(): string[] {
	return [...registry.keys()];
}

/** Parse a CSS colour string into a `[r, g, b, a]` tuple in [0, 1]. */
export function parseColorToVec4(value: any): [number, number, number, number] {
	if (Array.isArray(value) && value.length >= 3) {
		return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1];
	}
	const s = String(value ?? '#000000').trim();
	// #rgb / #rgba / #rrggbb / #rrggbbaa
	const hex = s.match(/^#([0-9a-f]{3,8})$/i);
	if (hex) {
		let h = hex[1];
		if (h.length === 3) h = h.split('').map(c => c + c).join('');
		if (h.length === 4) h = h.split('').map(c => c + c).join('');
		const r = parseInt(h.slice(0, 2), 16) / 255;
		const g = parseInt(h.slice(2, 4), 16) / 255;
		const b = parseInt(h.slice(4, 6), 16) / 255;
		const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
		return [r, g, b, a];
	}
	const rgba = s.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+))?\s*\)$/i);
	if (rgba) {
		return [parseFloat(rgba[1]) / 255, parseFloat(rgba[2]) / 255, parseFloat(rgba[3]) / 255, rgba[4] ? parseFloat(rgba[4]) : 1];
	}
	return [0, 0, 0, 1];
}

/**
 * Resolve an `option`-typed value to its integer index. Accepts either a
 * string from the registered list or a numeric value already in range. Falls
 * back to the default's index, or 0 if the default isn't in the list either.
 */
export function resolveOptionIndex(def: EffectParamDefinition, value: any): number {
	const options = def.options ?? [];
	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.max(0, Math.min(options.length - 1, value | 0));
	}
	if (typeof value === 'string') {
		const idx = options.indexOf(value);
		if (idx >= 0) return idx;
	}
	if (typeof def.default === 'string') {
		const idx = options.indexOf(def.default);
		if (idx >= 0) return idx;
	}
	if (typeof def.default === 'number') return def.default | 0;
	return 0;
}
