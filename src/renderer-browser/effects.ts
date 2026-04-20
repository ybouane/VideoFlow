/**
 * Effect registry — shared between renderers.
 *
 * Each effect is a GLSL fragment-shader body that defines a single function:
 *
 * ```glsl
 *   vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) { ... }
 * ```
 *
 * The compositor wraps this body with boilerplate (varying `v_uv`, the
 * `u_texture` sampler, the `u_resolution` vec2, and one uniform per declared
 * param named `u_<paramName>`) at registration time, producing a complete
 * fragment shader.
 *
 * Params are described via `EffectParamDefinition`, which mirrors
 * `PropertyDefinition` in spirit but carries a GL-typed `type` that both
 * drives uniform creation and informs future editor UI.
 */

/** Supported GL uniform types for effect parameters. */
export type EffectParamType =
	| 'float'
	| 'int'
	| 'bool'
	| 'vec2'
	| 'vec3'
	| 'vec4'
	| 'color';

/**
 * Metadata describing a single effect parameter.
 *
 * `default` is used when the layer's JSON does not override it. For `color`,
 * the value is a CSS colour string (`"#rrggbb"` / `"rgba(..)"`), converted to
 * a `vec4` by the compositor at draw time.
 */
export type EffectParamDefinition = {
	type: EffectParamType;
	default: any;
	min?: number;
	max?: number;
	/** Reserved for future animation support. */
	animatable?: boolean;
};

/** A registered effect. `glsl` is the body, not a full shader. */
export type EffectDefinition = {
	name: string;
	glsl: string;
	params: Record<string, EffectParamDefinition>;
};

const registry: Map<string, EffectDefinition> = new Map();

/** Register an effect. Last registration wins. */
export function registerEffect(
	name: string,
	glsl: string,
	params: Record<string, EffectParamDefinition> = {},
): void {
	registry.set(name, { name, glsl, params });
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
