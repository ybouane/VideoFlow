/**
 * Built-in effect presets.
 *
 * Each effect is a short GLSL snippet defining `vec4 effect(sampler2D tex,
 * vec2 uv, vec2 resolution)`. Declared params become `u_<name>` uniforms.
 *
 * Registered on first import. The renderer side-effect-imports this file so
 * presets are available without extra setup.
 */

import { registerEffect } from '../effects.js';

// --- chromaticAberration --------------------------------------------------
registerEffect(
	'chromaticAberration',
	`
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec2 offset = vec2(u_amount, 0.0);
	float r = texture2D(tex, uv + offset).r;
	float g = texture2D(tex, uv).g;
	float b = texture2D(tex, uv - offset).b;
	float a = texture2D(tex, uv).a;
	return vec4(r, g, b, a);
}
`,
	{
		amount: { type: 'float', default: 0.005, min: 0, max: 0.1, animatable: true },
	},
);

// --- pixelate -------------------------------------------------------------
registerEffect(
	'pixelate',
	`
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float size = max(1.0, u_size);
	vec2 blocks = resolution / size;
	vec2 snapped = floor(uv * blocks) / blocks + 0.5 / blocks;
	return texture2D(tex, snapped);
}
`,
	{
		size: { type: 'float', default: 8, min: 1, max: 256, animatable: true },
	},
);

// --- vignette -------------------------------------------------------------
registerEffect(
	'vignette',
	`
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	float d = distance(uv, vec2(0.5));
	float v = smoothstep(u_radius, u_radius - 0.4, d);
	v = mix(1.0, v, u_strength);
	return vec4(c.rgb * v, c.a);
}
`,
	{
		strength: { type: 'float', default: 0.6, min: 0, max: 1, animatable: true },
		radius:   { type: 'float', default: 0.8, min: 0, max: 1.5, animatable: true },
	},
);

// --- rgbSplit (directional chromatic aberration) -------------------------
registerEffect(
	'rgbSplit',
	`
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float a = radians(u_angle);
	vec2 dir = vec2(cos(a), sin(a)) * u_amount;
	float r = texture2D(tex, uv + dir).r;
	float g = texture2D(tex, uv).g;
	float b = texture2D(tex, uv - dir).b;
	float alpha = texture2D(tex, uv).a;
	return vec4(r, g, b, alpha);
}
`,
	{
		angle:  { type: 'float', default: 0,     min: 0,  max: 360, animatable: true },
		amount: { type: 'float', default: 0.005, min: 0,  max: 0.1, animatable: true },
	},
);

// --- invert ---------------------------------------------------------------
registerEffect(
	'invert',
	`
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	return vec4(mix(c.rgb, vec3(1.0) - c.rgb, u_amount), c.a);
}
`,
	{
		amount: { type: 'float', default: 1, min: 0, max: 1, animatable: true },
	},
);
