/**
 * Built-in effect presets.
 *
 * Each effect declares its GLSL body (or array of pass bodies) plus its
 * parameter schema. Helpers like `luminance`, `sampleEdge`, `hash21`,
 * `valueNoise`, `fbm`, `rotate2d` come from the shared preamble injected by
 * the compositor — see SHADER_PREAMBLE in WebGLEffectCompositor.ts.
 *
 * Conventions:
 * - Coordinates: `uv` is in [0,1]² (origin top-left after the compositor's
 *   FLIP_Y_WEBGL upload).
 * - Pixel-space units (`radius`, `amount`, blur lengths) are in **pixels**;
 *   the shader divides by `resolution` to translate into UV space.
 * - Channel offsets in chromatic effects (`intensity`, `amount` on RGB
 *   split) are in **UV units** (typical range 0–0.05).
 * - Premultiplied alpha throughout. Helpers preserve premultiplication.
 * - Variable sample loops use the `for (int i = 0; i < MAX; i++) {
 *     if (i >= dynamic) break; ... }` idiom (GLSL ES 1.00 needs constant
 *   loop bounds). Each effect picks a MAX appropriate to its quality
 *   ceiling.
 */

import { registerEffect } from '../effects.js';

// ---------------------------------------------------------------------------
// 1. Gaussian Blur — separable 2-pass, with direction / quality / edge mode.
// ---------------------------------------------------------------------------
const gaussianBlurPass = (axis: 'h' | 'v') => `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	int dir = int(u_direction);
	${axis === 'h' ? 'if (dir == 2) return texture2D(tex, uv);' : 'if (dir == 1) return texture2D(tex, uv);'}
	float radius = max(0.0, u_radius);
	if (radius < 0.5) return texture2D(tex, uv);
	// Auto-derived tap count from blur radius — enough samples to avoid banding.
	int quality = int(clamp(radius * 0.7 + 3.0, 4.0, 24.0));
	int edgeMode = int(u_edgeMode);
	bool alphaAware = u_alphaAware;
	vec2 step = ${axis === 'h' ? 'vec2(1.0 / resolution.x, 0.0)' : 'vec2(0.0, 1.0 / resolution.y)'} * radius;
	vec4 sum = vec4(0.0);
	float wSum = 0.0;
	for (int i = -32; i <= 32; i++) {
		if (i < -quality || i > quality) continue;
		float t = float(i) / float(quality);
		float w = exp(-2.5 * t * t);
		sum += sampleEdge(tex, uv + step * t, edgeMode) * w;
		wSum += w;
	}
	vec4 outc = sum / wSum;
	if (!alphaAware) {
		outc.a = texture2D(tex, uv).a;
	}
	return outc;
}`;
registerEffect('gaussianBlur', [
	{ glsl: gaussianBlurPass('h') },
	{ glsl: gaussianBlurPass('v') },
], {
	radius:     { type: 'float',  default: 0.4, min: 0, max: 10, animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	direction:  { type: 'option', default: 'both', fieldConfig: { options: { both: 'Both', horizontal: 'Horizontal', vertical: 'Vertical' } } },
	edgeMode:   { type: 'option', default: 'clamp', fieldConfig: { options: { clamp: 'Clamp', transparent: 'Transparent', mirror: 'Mirror' } } },
	alphaAware: { type: 'bool',   default: true },
});

// ---------------------------------------------------------------------------
// 2. Directional Motion Blur — sample along an angle, with center bias.
// ---------------------------------------------------------------------------
registerEffect('motionBlur', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float amount = u_amount;
	if (amount < 0.5) return texture2D(tex, uv);
	float angle = radians(u_angle);
	// Auto-derived sample count from blur length — denser sampling for longer trails.
	int n = int(clamp(amount * 0.3 + 8.0, 8.0, 32.0));
	float bias = clamp(u_centerBias, 0.0, 1.0);
	int edgeMode = int(u_edgeMode);
	vec2 dir = vec2(cos(angle), sin(angle)) * amount / resolution;
	vec4 sum = vec4(0.0);
	float wSum = 0.0;
	for (int i = 0; i < 64; i++) {
		if (i >= n) break;
		float t = (float(i) + 0.5) / float(n) * 2.0 - 1.0;
		float w = mix(1.0, max(0.0, 1.0 - abs(t)), bias);
		sum += sampleEdge(tex, uv + dir * t, edgeMode) * w;
		wSum += w;
	}
	return sum / max(wSum, 0.0001);
}`, {
	amount:     { type: 'float',  default: 1.25, min: 0, max: 10, animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	angle:      { type: 'float',  default: 0,    min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	centerBias: { type: 'float',  default: 0,    min: 0, max: 1,   animatable: true, fieldConfig: { step: 0.01 } },
	edgeMode:   { type: 'option', default: 'clamp', fieldConfig: { options: { clamp: 'Clamp', transparent: 'Transparent', mirror: 'Mirror' } } },
});

// ---------------------------------------------------------------------------
// 3. Radial Zoom Blur — samples between current UV and a center.
// ---------------------------------------------------------------------------
registerEffect('zoomBlur', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec2 center = vec2(u_centerX, u_centerY);
	float amount = u_amount;
	int mode = int(u_mode);
	// Auto-derived sample count from zoom amount — wider stretches need more taps.
	int n = int(clamp(amount * 50.0 + 12.0, 12.0, 48.0));
	float falloff = max(u_falloff, 0.0);
	vec2 d = uv - center;
	float scale = (mode == 1) ? amount : -amount;
	vec4 sum = vec4(0.0);
	float wSum = 0.0;
	for (int i = 0; i < 64; i++) {
		if (i >= n) break;
		float t = float(i) / max(float(n - 1), 1.0);
		float w = pow(1.0 - t, falloff);
		vec2 sUv = center + d * (1.0 + scale * t);
		sum += texture2D(tex, clamp(sUv, 0.0, 1.0)) * w;
		wSum += w;
	}
	return sum / max(wSum, 0.0001);
}`, {
	amount:  { type: 'float',  default: 0.4, min: 0, max: 2,  animatable: true, fieldConfig: { step: 0.05 } },
	centerX: { type: 'float',  default: 0.5, min: 0, max: 1,  animatable: true, fieldConfig: { step: 0.01 } },
	centerY: { type: 'float',  default: 0.5, min: 0, max: 1,  animatable: true, fieldConfig: { step: 0.01 } },
	falloff: { type: 'float',  default: 1,   min: 0, max: 4,  animatable: true, fieldConfig: { step: 0.1 } },
	mode:    { type: 'option', default: 'out', fieldConfig: { options: { in: 'Zoom In', out: 'Zoom Out' } } },
});

// ---------------------------------------------------------------------------
// 4. Chromatic Aberration — directional or radial RGB channel offset.
// ---------------------------------------------------------------------------
registerEffect('chromaticAberration', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float intensity = u_intensity;
	bool radial = u_radial;
	vec2 center = vec2(u_centerX, u_centerY);
	vec2 fromCenter = uv - center;
	float dist = length(fromCenter * vec2(resolution.x / resolution.y, 1.0));
	float edgeMul = mix(1.0, dist * 2.0, clamp(u_edgeFalloff, 0.0, 1.0));
	vec2 dir;
	if (radial) {
		dir = fromCenter;
	} else {
		float a = radians(u_angle);
		dir = vec2(cos(a), sin(a));
	}
	vec2 offset = dir * intensity * edgeMul;
	float r = texture2D(tex, clamp(uv + offset, 0.0, 1.0)).r;
	vec2 mid = uv;
	float g = texture2D(tex, mid).g;
	float b = texture2D(tex, clamp(uv - offset, 0.0, 1.0)).b;
	float a = texture2D(tex, mid).a;
	return vec4(r, g, b, a);
}`, {
	intensity:    { type: 'float',  default: 0.005, min: 0, max: 0.1, animatable: true, fieldConfig: { step: 0.001 } },
	angle:        { type: 'float',  default: 0,     min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	centerX:      { type: 'float',  default: 0.5,   min: 0, max: 1,   animatable: true, fieldConfig: { step: 0.01 } },
	centerY:      { type: 'float',  default: 0.5,   min: 0, max: 1,   animatable: true, fieldConfig: { step: 0.01 } },
	edgeFalloff:  { type: 'float',  default: 0,     min: 0, max: 1,   animatable: true, fieldConfig: { step: 0.01 } },
	radial:       { type: 'bool',   default: false },
});

// ---------------------------------------------------------------------------
// 5. RGB Split Glitch — banded directional channel offsets.
// ---------------------------------------------------------------------------
registerEffect('rgbSplit', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float amount = u_amount;
	int axis = int(u_axis);
	float bandSize = max(u_bandSize, 0.0001);
	float bandOffset = u_bandOffset;
	float randomness = clamp(u_randomness, 0.0, 1.0);
	bool preserveLuma = u_preserveLuminance;

	float band = (axis == 1) ? floor(uv.x / bandSize) : floor(uv.y / bandSize);
	// Reseed each band every frame so the glitch pulses temporally rather
	// than printing one fixed band layout for the whole clip.
	float tFrame = floor(u_time * 60.0);
	float bRand = hash21(vec2(band, 7.31 + tFrame * 0.93));
	float pulse = mix(0.0, (bRand - 0.5) * 2.0, randomness);
	float bandShift = bandOffset * pulse;

	vec2 baseDir = vec2(0.0);
	if (axis == 0 || axis == 2) baseDir.x = 1.0;
	if (axis == 1 || axis == 2) baseDir.y = 1.0;
	vec2 offset = baseDir * (amount + bandShift);

	float r = texture2D(tex, clamp(uv + offset, 0.0, 1.0)).r;
	float g = texture2D(tex, uv).g;
	float b = texture2D(tex, clamp(uv - offset, 0.0, 1.0)).b;
	float a = texture2D(tex, uv).a;
	vec3 result = vec3(r, g, b);
	if (preserveLuma) {
		float origLum = luminance(texture2D(tex, uv).rgb);
		float newLum = max(luminance(result), 0.0001);
		result *= origLum / newLum;
	}
	return vec4(result, a);
}`, {
	amount:            { type: 'float',  default: 0.005, min: 0, max: 0.1, animatable: true, fieldConfig: { step: 0.001 } },
	bandSize:          { type: 'float',  default: 0.05,  min: 0.001, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	bandOffset:        { type: 'float',  default: 0.005, min: 0, max: 0.1, animatable: true, fieldConfig: { step: 0.001 } },
	randomness:        { type: 'float',  default: 0.5,   min: 0, max: 1,   animatable: true, fieldConfig: { step: 0.01 } },
	axis:              { type: 'option', default: 'horizontal', fieldConfig: { options: { horizontal: 'Horizontal', vertical: 'Vertical', both: 'Both' } } },
	preserveLuminance: { type: 'bool',   default: false },
});

// ---------------------------------------------------------------------------
// 6. Wipe Mask — linear reveal along an angle.
// ---------------------------------------------------------------------------
registerEffect('wipeMask', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	float progress = u_progress;
	float angle = radians(u_angle);
	float softness = max(u_softness, 0.0001);
	float edgeWidth = max(u_edgeWidth, 0.0);
	vec4 edgeColor = u_edgeColor;
	bool invert = u_invert;
	vec2 dir = vec2(cos(angle), sin(angle));
	float along = dot(uv - 0.5, dir) + 0.5;
	float threshold = invert ? (1.0 - progress) : progress;
	float diff = invert ? (along - threshold) : (threshold - along);
	float mask = smoothstep(-softness * 0.5, softness * 0.5, diff);
	float edge = 0.0;
	if (edgeWidth > 0.0) {
		edge = exp(-pow(diff / edgeWidth, 2.0)) * edgeColor.a;
	}
	// Premultiply edge by c.a so the glow only paints where content exists —
	// otherwise transparent regions of the layer pick up white edge pixels
	// with alpha=0, which compositors render as visible white blobs.
	vec3 result = mix(c.rgb, edgeColor.rgb * c.a, edge);
	return vec4(result * mask, c.a * mask);
}`, {
	progress:  { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	angle:     { type: 'float', default: 0,    min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	softness:  { type: 'float', default: 0.02, min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.005 } },
	edgeWidth: { type: 'float', default: 0,    min: 0, max: 0.5, animatable: true, fieldConfig: { step: 0.005 } },
	edgeColor: { type: 'color', default: '#ffffff' },
	invert:    { type: 'bool',  default: false },
});

// ---------------------------------------------------------------------------
// 7. Noise Dissolve — fbm-thresholded reveal with edge band.
// ---------------------------------------------------------------------------
registerEffect('noiseDissolve', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	float progress = u_progress;
	float scale = max(u_noiseScale, 0.001);
	float softness = max(u_softness, 0.0001);
	float edgeWidth = max(u_edgeWidth, 0.0);
	vec4 edgeColor = u_edgeColor;
	bool invert = u_invert;
	float n = fbm(uv * scale);
	float diff = invert ? (n - (1.0 - progress)) : (progress - n);
	float mask = smoothstep(-softness * 0.5, softness * 0.5, diff);
	float edge = 0.0;
	if (edgeWidth > 0.0) {
		edge = exp(-pow(diff / edgeWidth, 2.0)) * edgeColor.a;
	}
	// Premultiply edge by c.a so the glow only paints where content exists —
	// otherwise transparent regions of the layer pick up white edge pixels
	// with alpha=0, which compositors render as visible white blobs.
	vec3 result = mix(c.rgb, edgeColor.rgb * c.a, edge);
	return vec4(result * mask, c.a * mask);
}`, {
	progress:   { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	noiseScale: { type: 'float', default: 8,    min: 0.5, max: 64, animatable: true, fieldConfig: { step: 0.5 } },
	softness:   { type: 'float', default: 0.05, min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.005 } },
	edgeWidth:  { type: 'float', default: 0.05, min: 0, max: 0.5, animatable: true, fieldConfig: { step: 0.005 } },
	edgeColor:  { type: 'color', default: '#ffffff' },
	invert:     { type: 'bool',  default: false },
});

// ---------------------------------------------------------------------------
// 8. Displacement — noise / waves / swirl UV displacement.
// ---------------------------------------------------------------------------
registerEffect('displacement', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float amount = u_amount;
	float scale = max(u_scale, 0.001);
	float angle = radians(u_angle);
	float noiseStr = u_noiseStrength;
	int mode = int(u_mode);
	int axis = int(u_axis);
	vec2 disp = vec2(0.0);
	if (mode == 0) {
		// Slow continuous drift on the noise field so the displacement evolves
		// each frame instead of locking the same pattern for the whole clip.
		vec2 p = uv * scale + vec2(u_time * 0.35, -u_time * 0.27);
		disp = vec2(fbm(p) - 0.5, fbm(p + vec2(13.7, 91.3)) - 0.5) * 2.0 * noiseStr;
		if (angle != 0.0) disp = rotate2d(angle) * disp;
	} else if (mode == 1) {
		disp.x = sin((uv.y + sin(angle) * 0.5) * scale * 6.2832) * 0.5;
		disp.y = sin((uv.x + cos(angle) * 0.5) * scale * 6.2832 + 1.5708) * 0.5;
	} else {
		vec2 d = uv - 0.5;
		float r = length(d);
		float a = atan(d.y, d.x) + r * scale;
		vec2 swirled = 0.5 + r * vec2(cos(a), sin(a));
		disp = (swirled - uv) * 2.0;
	}
	if (axis == 0) disp.y = 0.0;
	else if (axis == 1) disp.x = 0.0;
	vec2 sUv = uv + disp * amount;
	return texture2D(tex, clamp(sUv, 0.0, 1.0));
}`, {
	amount:         { type: 'float',  default: 0.05, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	scale:          { type: 'float',  default: 4,    min: 0.001, max: 64, animatable: true, fieldConfig: { step: 0.5 } },
	angle:          { type: 'float',  default: 0,    min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	noiseStrength:  { type: 'float',  default: 1,    min: 0, max: 4, animatable: true, fieldConfig: { step: 0.1 } },
	mode:           { type: 'option', default: 'noise', fieldConfig: { options: { noise: 'Noise', waves: 'Waves', swirl: 'Swirl' } } },
	axis:           { type: 'option', default: 'both',  fieldConfig: { options: { x: 'X', y: 'Y', both: 'Both' } } },
});

// ---------------------------------------------------------------------------
// 9. Lens Distortion — radial barrel/pincushion based on distance.
// ---------------------------------------------------------------------------
registerEffect('lensDistortion', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec2 center = vec2(u_centerX, u_centerY);
	float distortion = u_distortion;
	float zoom = max(u_zoom, 0.001);
	float curve = max(u_curve, 0.001);
	int edgeMode = int(u_edgeMode);
	vec2 d = uv - center;
	d.x *= resolution.x / resolution.y;
	float r = length(d);
	float scale = 1.0 + distortion * pow(r, curve);
	vec2 newD = d * scale / zoom;
	newD.x *= resolution.y / resolution.x;
	return sampleEdge(tex, center + newD, edgeMode);
}`, {
	distortion: { type: 'float',  default: 0.3, min: -1, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerX:    { type: 'float',  default: 0.5, min: 0,  max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerY:    { type: 'float',  default: 0.5, min: 0,  max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	zoom:       { type: 'float',  default: 1,   min: 0.1, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	curve:      { type: 'float',  default: 2,   min: 0.5, max: 6, animatable: true, fieldConfig: { step: 0.1 } },
	edgeMode:   { type: 'option', default: 'clamp', fieldConfig: { options: { clamp: 'Clamp', transparent: 'Transparent', mirror: 'Mirror' } } },
});

// ---------------------------------------------------------------------------
// 10. Fisheye — strong radial remap (positive=bulge, negative=pinch).
// ---------------------------------------------------------------------------
registerEffect('fisheye', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec2 center = vec2(u_centerX, u_centerY);
	float strength = clamp(u_strength, -1.5, 1.5);
	float radius = max(u_radius, 0.001);
	float zoom = max(u_zoom, 0.001);
	int edgeMode = int(u_edgeMode);
	vec2 d = uv - center;
	d.x *= resolution.x / resolution.y;
	float r = length(d) / radius;
	float remapped;
	if (strength >= 0.0) remapped = mix(r, sin(clamp(r, 0.0, 1.0) * 1.5707963), strength);
	else remapped = mix(r, r * r, -strength);
	vec2 newD = (r > 0.0) ? d * (remapped / r) : d;
	newD /= zoom;
	newD.x *= resolution.y / resolution.x;
	return sampleEdge(tex, center + newD, edgeMode);
}`, {
	strength: { type: 'float',  default: 0.5, min: -1.5, max: 1.5, animatable: true, fieldConfig: { step: 0.01 } },
	centerX:  { type: 'float',  default: 0.5, min: 0,    max: 1,   animatable: true, fieldConfig: { step: 0.01 } },
	centerY:  { type: 'float',  default: 0.5, min: 0,    max: 1,   animatable: true, fieldConfig: { step: 0.01 } },
	radius:   { type: 'float',  default: 0.5, min: 0.01, max: 2,   animatable: true, fieldConfig: { step: 0.01 } },
	zoom:     { type: 'float',  default: 1,   min: 0.1,  max: 4,   animatable: true, fieldConfig: { step: 0.05 } },
	edgeMode: { type: 'option', default: 'clamp', fieldConfig: { options: { clamp: 'Clamp', transparent: 'Transparent', mirror: 'Mirror' } } },
});

// ---------------------------------------------------------------------------
// Shared blur snippets used by glow / bloom / edge-glow / frosted-glass.
// ---------------------------------------------------------------------------
const blurH9 = `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float radius = max(u_radius, 0.0);
	if (radius < 0.5) return texture2D(tex, uv);
	vec2 step = vec2(1.0 / resolution.x, 0.0) * radius;
	vec4 sum = vec4(0.0);
	float wSum = 0.0;
	for (int i = -8; i <= 8; i++) {
		float t = float(i) / 8.0;
		float w = exp(-2.5 * t * t);
		sum += texture2D(tex, clamp(uv + step * t, 0.0, 1.0)) * w;
		wSum += w;
	}
	return sum / wSum;
}`;
const blurV9 = `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float radius = max(u_radius, 0.0);
	if (radius < 0.5) return texture2D(tex, uv);
	vec2 step = vec2(0.0, 1.0 / resolution.y) * radius;
	vec4 sum = vec4(0.0);
	float wSum = 0.0;
	for (int i = -8; i <= 8; i++) {
		float t = float(i) / 8.0;
		float w = exp(-2.5 * t * t);
		sum += texture2D(tex, clamp(uv + step * t, 0.0, 1.0)) * w;
		wSum += w;
	}
	return sum / wSum;
}`;

// ---------------------------------------------------------------------------
// 11. Glow — extract mask (alpha or brightness), blur, composite.
// ---------------------------------------------------------------------------
registerEffect('glow', [
	{ glsl: `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	int source = int(u_source);
	float threshold = u_threshold;
	float mask;
	if (source == 0) {
		mask = c.a;
	} else {
		float lum = luminance(c.rgb);
		mask = smoothstep(threshold, threshold + 0.1, lum);
	}
	return vec4(u_color.rgb * u_color.a * mask, mask * u_color.a);
}` },
	{ glsl: blurH9 },
	{ glsl: blurV9 },
	{ readsOriginal: true, glsl: `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 orig = texture2D(u_originalTexture, uv);
	vec4 glow = texture2D(tex, uv) * u_intensity;
	int blendMode = int(u_blendMode);
	vec3 result;
	if (blendMode == 0) result = orig.rgb + glow.rgb;
	else if (blendMode == 1) result = orig.rgb + glow.rgb - orig.rgb * glow.rgb;
	else result = mix(orig.rgb, glow.rgb / max(glow.a, 0.001), clamp(glow.a, 0.0, 1.0));
	return vec4(result, max(orig.a, glow.a));
}` },
], {
	intensity: { type: 'float',  default: 1,    min: 0, max: 4, animatable: true, fieldConfig: { step: 0.1 } },
	radius:    { type: 'float',  default: 0.6,  min: 0, max: 10, animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	threshold: { type: 'float',  default: 0.6,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	color:     { type: 'color',  default: '#ffffff' },
	source:    { type: 'option', default: 'alpha', fieldConfig: { options: { alpha: 'Alpha', brightness: 'Brightness' } } },
	blendMode: { type: 'option', default: 'screen', fieldConfig: { options: { add: 'Add', screen: 'Screen', normal: 'Normal' } } },
});

// ---------------------------------------------------------------------------
// 12. Bloom — knee-soft threshold extract, blur, composite.
// ---------------------------------------------------------------------------
registerEffect('bloom', [
	{ glsl: `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	float lum = luminance(c.rgb);
	float t = u_threshold;
	float k = max(u_knee, 0.0001);
	float soft = smoothstep(t - k, t + k, lum);
	float bright = max(0.0, lum - t);
	float mul = soft * bright / max(lum, 0.0001);
	return vec4(c.rgb * mul, c.a * soft);
}` },
	{ glsl: blurH9 },
	{ glsl: blurV9 },
	{ readsOriginal: true, glsl: `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 orig = texture2D(u_originalTexture, uv);
	vec4 bloom = texture2D(tex, uv) * u_intensity;
	int blendMode = int(u_blendMode);
	vec3 result;
	if (blendMode == 1) result = orig.rgb + bloom.rgb - orig.rgb * bloom.rgb;
	else result = orig.rgb + bloom.rgb;
	return vec4(result, orig.a);
}` },
], {
	threshold: { type: 'float',  default: 0.7, min: 0, max: 1.5, animatable: true, fieldConfig: { step: 0.05 } },
	intensity: { type: 'float',  default: 0.8, min: 0, max: 4,   animatable: true, fieldConfig: { step: 0.1 } },
	radius:    { type: 'float',  default: 0.8, min: 0, max: 10,  animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	knee:      { type: 'float',  default: 0.1, min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	blendMode: { type: 'option', default: 'add', fieldConfig: { options: { add: 'Add', screen: 'Screen' } } },
});

// ---------------------------------------------------------------------------
// 13. Color Correction — exposure / contrast / saturation / temperature / tint / gamma.
// ---------------------------------------------------------------------------
registerEffect('colorCorrection', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	if (c.a < 0.0001) return c;
	vec3 col = c.rgb / c.a;
	col *= pow(2.0, u_exposure);
	col = (col - 0.5) * (1.0 + u_contrast) + 0.5;
	col.r += u_temperature * 0.1;
	col.b -= u_temperature * 0.1;
	col.g -= u_tint * 0.1;
	float lum = luminance(col);
	col = mix(vec3(lum), col, 1.0 + u_saturation);
	col = pow(max(col, 0.0), vec3(1.0 / max(u_gamma, 0.0001)));
	return vec4(col * c.a, c.a);
}`, {
	exposure:    { type: 'float', default: 0, min: -4, max: 4, animatable: true, fieldConfig: { step: 0.1 } },
	contrast:    { type: 'float', default: 0, min: -1, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	saturation:  { type: 'float', default: 0, min: -1, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	temperature: { type: 'float', default: 0, min: -2, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	tint:        { type: 'float', default: 0, min: -2, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	gamma:       { type: 'float', default: 1, min: 0.1, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
});

// ---------------------------------------------------------------------------
// 14. Vignette — circle / ellipse / rectangle falloff.
// ---------------------------------------------------------------------------
registerEffect('vignette', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	vec2 center = vec2(u_centerX, u_centerY);
	int shape = int(u_shape);
	vec2 d = uv - center;
	float dist;
	if (shape == 0) {
		d.x *= resolution.x / resolution.y;
		dist = length(d) * 2.0;
	} else if (shape == 1) {
		dist = length(d * 2.0);
	} else {
		dist = max(abs(d.x), abs(d.y)) * 2.0;
	}
	float falloff = smoothstep(u_radius - u_softness, u_radius + u_softness, dist);
	vec3 result = mix(c.rgb, u_color.rgb * c.a, falloff * u_intensity * u_color.a);
	return vec4(result, c.a);
}`, {
	intensity: { type: 'float',  default: 0.6, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	radius:    { type: 'float',  default: 0.8, min: 0, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	softness:  { type: 'float',  default: 0.4, min: 0.0001, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	centerX:   { type: 'float',  default: 0.5, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerY:   { type: 'float',  default: 0.5, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	color:     { type: 'color',  default: '#000000' },
	shape:     { type: 'option', default: 'circle', fieldConfig: { options: { circle: 'Circle', ellipse: 'Ellipse', rectangle: 'Rectangle' } } },
});

// ---------------------------------------------------------------------------
// 15. Light Sweep — gloss band that travels across.
// ---------------------------------------------------------------------------
registerEffect('lightSweep', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	float angle = radians(u_angle);
	vec2 dir = vec2(cos(angle), sin(angle));
	float along = dot(uv - 0.5, dir) + 0.5;
	float progress = mix(-0.3, 1.3, u_progress);
	float dist = abs(along - progress);
	float band = 1.0 - smoothstep(u_width * 0.5 - u_softness, u_width * 0.5 + u_softness, dist);
	band *= u_intensity * u_color.a;
	int blendMode = int(u_blendMode);
	vec3 added = u_color.rgb * band;
	vec3 result;
	if (blendMode == 0) result = c.rgb + added * c.a;
	else if (blendMode == 1) result = c.rgb + added * c.a - c.rgb * added;
	else result = mix(c.rgb, u_color.rgb * c.a, band);
	return vec4(result, c.a);
}`, {
	progress:  { type: 'float',  default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	angle:     { type: 'float',  default: 30,   min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	width:     { type: 'float',  default: 0.15, min: 0.001, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	softness:  { type: 'float',  default: 0.06, min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	intensity: { type: 'float',  default: 1,    min: 0, max: 4, animatable: true, fieldConfig: { step: 0.1 } },
	color:     { type: 'color',  default: '#ffffff' },
	blendMode: { type: 'option', default: 'add', fieldConfig: { options: { add: 'Add', screen: 'Screen', normal: 'Normal' } } },
});

// ---------------------------------------------------------------------------
// 16. Scan Reveal — directional scanner with edge glow + distortion.
// ---------------------------------------------------------------------------
registerEffect('scanReveal', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float angle = radians(u_angle);
	vec2 dir = vec2(cos(angle), sin(angle));
	float along = dot(uv - 0.5, dir) + 0.5;
	float progress = u_progress;
	bool invert = u_invert;
	float bandDist = abs(along - progress);
	float band = 1.0 - smoothstep(u_bandWidth * 0.5, u_bandWidth * 0.5 + u_softness, bandDist);
	vec2 perp = vec2(-dir.y, dir.x);
	// Reseed the edge-distortion noise each frame so the scan band scintillates.
	// mod() keeps the time offset bounded so 32-bit float precision in fract()
	// stays stable at long timestamps.
	float tFrame = floor(u_time * 60.0);
	vec2 tOff = vec2(mod(tFrame * 53.17, 977.0), mod(tFrame * 71.93, 991.0));
	vec2 distort = perp * u_edgeDistortion * band * (hash21(uv * 50.0 + tOff) - 0.5) * 2.0;
	vec4 c = texture2D(tex, clamp(uv + distort, 0.0, 1.0));
	float reveal = invert ? step(progress, along) : step(along, progress);
	float softReveal = invert
		? smoothstep(progress - u_softness, progress + u_softness, along)
		: smoothstep(progress + u_softness, progress - u_softness, along);
	// Gate the additive glow by c.a so transparent regions don't pick up white
	// edge contributions with alpha=0 (invalid premultiplied → visible blobs).
	vec3 result = c.rgb + vec3(1.0) * u_edgeGlow * band * c.a;
	return vec4(result, c.a * softReveal);
}`, {
	progress:       { type: 'float', default: 0.5,   min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	angle:          { type: 'float', default: 0,     min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	bandWidth:      { type: 'float', default: 0.04,  min: 0, max: 0.5, animatable: true, fieldConfig: { step: 0.005 } },
	softness:       { type: 'float', default: 0.01,  min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.005 } },
	edgeGlow:       { type: 'float', default: 1,     min: 0, max: 4, animatable: true, fieldConfig: { step: 0.1 } },
	edgeDistortion: { type: 'float', default: 0.005, min: 0, max: 0.1, animatable: true, fieldConfig: { step: 0.001 } },
	invert:         { type: 'bool',  default: false },
});

// ---------------------------------------------------------------------------
// 17. Radial Reveal — circular point reveal.
// ---------------------------------------------------------------------------
registerEffect('radialReveal', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	vec2 center = vec2(u_centerX, u_centerY);
	vec2 d = uv - center;
	d.x *= resolution.x / resolution.y;
	float dist = length(d);
	float maxX = max(center.x, 1.0 - center.x) * resolution.x / resolution.y;
	float maxY = max(center.y, 1.0 - center.y);
	float maxDist = length(vec2(maxX, maxY));
	float radius = u_progress * maxDist * 1.05;
	bool invert = u_invert;
	float diff = invert ? (dist - radius) : (radius - dist);
	float mask = smoothstep(-u_softness, u_softness, diff);
	float edge = exp(-pow((dist - radius) / max(u_softness * 1.5, 0.0001), 2.0));
	// Gate the additive glow by c.a so transparent regions don't pick up white
	// edge contributions with alpha=0 (invalid premultiplied → visible blobs).
	vec3 result = c.rgb + vec3(1.0) * u_edgeGlow * edge * c.a;
	return vec4(result, c.a * mask);
}`, {
	progress: { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerX:  { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerY:  { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	softness: { type: 'float', default: 0.02, min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.005 } },
	edgeGlow: { type: 'float', default: 0.5,  min: 0, max: 4, animatable: true, fieldConfig: { step: 0.1 } },
	invert:   { type: 'bool',  default: false },
});

// ---------------------------------------------------------------------------
// 18. Linear Blur / Streak — bidirectional with highlight bias.
// ---------------------------------------------------------------------------
registerEffect('streakBlur', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float amount = u_amount;
	if (amount < 0.5) return texture2D(tex, uv);
	float angle = radians(u_angle);
	int n = int(clamp(u_samples, 2.0, 64.0));
	float bias = max(u_highlightBias, 0.0);
	float falloff = max(u_falloff, 0.0);
	int edgeMode = int(u_edgeMode);
	vec2 dir = vec2(cos(angle), sin(angle)) * amount / resolution;
	vec4 sum = vec4(0.0);
	float wSum = 0.0;
	for (int i = 0; i < 64; i++) {
		if (i >= n) break;
		float t = (float(i) + 0.5) / float(n) * 2.0 - 1.0;
		vec4 c = sampleEdge(tex, uv + dir * t, edgeMode);
		float lum = luminance(c.rgb);
		float w = pow(max(0.0, 1.0 - abs(t)), falloff) * (1.0 + bias * lum * lum);
		sum += c * w;
		wSum += w;
	}
	return sum / max(wSum, 0.0001);
}`, {
	amount:        { type: 'float',  default: 2.5, min: 0, max: 20, animatable: true, fieldConfig: { step: 0.1, unit: 'em' } },
	angle:         { type: 'float',  default: 0,   min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	samples:       { type: 'float',  default: 24,  min: 2, max: 64, animatable: true, fieldConfig: { step: 1, integer: true } },
	highlightBias: { type: 'float',  default: 2,   min: 0, max: 10, animatable: true, fieldConfig: { step: 0.1 } },
	falloff:       { type: 'float',  default: 1,   min: 0, max: 4, animatable: true, fieldConfig: { step: 0.1 } },
	edgeMode:      { type: 'option', default: 'transparent', fieldConfig: { options: { clamp: 'Clamp', transparent: 'Transparent', mirror: 'Mirror' } } },
});

// ---------------------------------------------------------------------------
// 19. Spin Blur — rotational sample averaging.
// ---------------------------------------------------------------------------
registerEffect('spinBlur', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float amount = radians(u_amount);
	if (abs(amount) < 0.001) return texture2D(tex, uv);
	vec2 center = vec2(u_centerX, u_centerY);
	int n = int(clamp(u_samples, 2.0, 64.0));
	float radiusFalloff = max(u_radiusFalloff, 0.0);
	int dir = int(u_direction);
	float aspect = resolution.x / resolution.y;
	vec2 d = uv - center;
	d.x *= aspect;
	float r = length(d);
	float intensity = pow(clamp(r * 2.0, 0.0, 1.0), radiusFalloff);
	float maxAngle = amount * intensity * (dir == 0 ? 1.0 : -1.0);
	vec4 sum = vec4(0.0);
	float wSum = 0.0;
	for (int i = 0; i < 64; i++) {
		if (i >= n) break;
		float t = (float(i) + 0.5) / float(n) - 0.5;
		float a = maxAngle * t;
		mat2 rot = rotate2d(a);
		vec2 rotated = rot * d;
		rotated.x /= aspect;
		sum += texture2D(tex, clamp(center + rotated, 0.0, 1.0));
		wSum += 1.0;
	}
	return sum / wSum;
}`, {
	amount:         { type: 'float',  default: 12,  min: 0, max: 180, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	centerX:        { type: 'float',  default: 0.5, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerY:        { type: 'float',  default: 0.5, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	samples:        { type: 'float',  default: 24,  min: 2, max: 64, animatable: true, fieldConfig: { step: 1, integer: true } },
	radiusFalloff:  { type: 'float',  default: 0,   min: 0, max: 4, animatable: true, fieldConfig: { step: 0.1 } },
	direction:      { type: 'option', default: 'clockwise', fieldConfig: { options: { clockwise: 'Clockwise', counterClockwise: 'Counter-Clockwise' } } },
});

// ---------------------------------------------------------------------------
// 20. Wave Warp — sine-wave UV offsets with axis filter and edge falloff.
// ---------------------------------------------------------------------------
registerEffect('waveWarp', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float amplitude = u_amplitude;
	float frequency = max(u_frequency, 0.001);
	float angle = radians(u_angle);
	float phase = u_phase;
	float falloff = clamp(u_falloff, 0.0, 1.0);
	int axis = int(u_axis);
	vec2 dir = vec2(cos(angle), sin(angle));
	vec2 perp = vec2(-dir.y, dir.x);
	vec2 offset = vec2(0.0);
	if (axis == 0 || axis == 2) {
		float along = dot(uv - 0.5, perp);
		offset += dir * sin(along * frequency * 6.2832 + phase) * amplitude;
	}
	if (axis == 1 || axis == 2) {
		float along2 = dot(uv - 0.5, dir);
		offset += perp * sin(along2 * frequency * 6.2832 + phase + 1.5708) * amplitude;
	}
	float distFromCenter = length((uv - 0.5) * 2.0);
	float window = mix(1.0, max(0.0, 1.0 - distFromCenter), falloff);
	offset *= window;
	return texture2D(tex, clamp(uv + offset, 0.0, 1.0));
}`, {
	amplitude: { type: 'float',  default: 0.02, min: 0, max: 0.5, animatable: true, fieldConfig: { step: 0.005 } },
	frequency: { type: 'float',  default: 4,    min: 0.1, max: 64, animatable: true, fieldConfig: { step: 0.5 } },
	angle:     { type: 'float',  default: 0,    min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	phase:     { type: 'float',  default: 0,    min: 0, max: 6.2832, animatable: true, fieldConfig: { step: 0.1, unit: 'rad' } },
	falloff:   { type: 'float',  default: 0,    min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	axis:      { type: 'option', default: 'both', fieldConfig: { options: { x: 'X', y: 'Y', both: 'Both' } } },
});

// ---------------------------------------------------------------------------
// 21. Liquid Ripple — radial sine wave from a point with decay.
// ---------------------------------------------------------------------------
registerEffect('liquidRipple', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec2 center = vec2(u_centerX, u_centerY);
	float aspect = resolution.x / resolution.y;
	vec2 d = uv - center;
	d.x *= aspect;
	float r = length(d);
	float radius = max(u_radius, 0.0001);
	if (r > radius) return texture2D(tex, uv);
	float wave = sin(r * u_frequency * 6.2832 - u_phase) * exp(-r * u_decay);
	float falloff = 1.0 - smoothstep(0.0, radius, r);
	vec2 dir = (r > 0.0) ? (d / r) : vec2(0.0);
	dir.x /= aspect;
	vec2 offset = dir * wave * u_amplitude * falloff;
	return texture2D(tex, clamp(uv + offset, 0.0, 1.0));
}`, {
	centerX:   { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerY:   { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	amplitude: { type: 'float', default: 0.02, min: 0, max: 0.5, animatable: true, fieldConfig: { step: 0.005 } },
	frequency: { type: 'float', default: 8,    min: 0.1, max: 64, animatable: true, fieldConfig: { step: 0.5 } },
	decay:     { type: 'float', default: 4,    min: 0, max: 32, animatable: true, fieldConfig: { step: 0.5 } },
	radius:    { type: 'float', default: 0.5,  min: 0.001, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	phase:     { type: 'float', default: 0,    min: 0, max: 6.2832, animatable: true, fieldConfig: { step: 0.1, unit: 'rad' } },
});

// ---------------------------------------------------------------------------
// 22. Shockwave — narrow distortion band radiating from a center.
// ---------------------------------------------------------------------------
registerEffect('shockwave', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec2 center = vec2(u_centerX, u_centerY);
	float aspect = resolution.x / resolution.y;
	vec2 d = uv - center;
	d.x *= aspect;
	float r = length(d);
	float progress = u_progress;
	float strength = u_strength;
	float width = max(u_width, 0.0001);
	float softness = max(u_softness, 0.0001);
	bool invert = u_invert;
	float dist = r - progress;
	float band = exp(-pow(dist / width, 2.0));
	float bandPos = clamp(dist / width, -1.0, 1.0);
	float profile = sin(bandPos * 3.1415926);
	vec2 dir = (r > 0.0) ? (d / r) : vec2(0.0);
	dir.x /= aspect;
	float push = profile * band * strength * (invert ? -1.0 : 1.0);
	vec2 offset = dir * push;
	return texture2D(tex, clamp(uv + offset, 0.0, 1.0));
}`, {
	progress: { type: 'float', default: 0.5,  min: 0, max: 2, animatable: true, fieldConfig: { step: 0.01 } },
	centerX:  { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerY:  { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	strength: { type: 'float', default: 0.06, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	width:    { type: 'float', default: 0.08, min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	softness: { type: 'float', default: 0.02, min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.005 } },
	invert:   { type: 'bool',  default: false },
});

// ---------------------------------------------------------------------------
// 23. Heat Haze — layered waves + noise, stronger near bottom.
// ---------------------------------------------------------------------------
registerEffect('heatHaze', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float intensity = u_intensity;
	float waveScale = max(u_waveScale, 0.001);
	float waveAngle = radians(u_waveAngle);
	float noiseAmount = u_noiseAmount;
	float verticalFalloff = clamp(u_verticalFalloff, 0.0, 1.0);
	float vF = mix(1.0, smoothstep(0.0, 1.0, 1.0 - uv.y), verticalFalloff);
	vec2 dir = vec2(cos(waveAngle), sin(waveAngle));
	vec2 perp = vec2(-dir.y, dir.x);
	// Continuous time drives the wave and noise field so the haze shimmers
	// every frame instead of looking like a frozen still.
	float t = u_time;
	vec2 disp = vec2(0.0);
	disp += dir * sin(dot(uv, perp) * waveScale * 20.0 + t * 4.7) * 0.5;
	disp += perp * sin(dot(uv, dir) * waveScale * 17.0 + 1.0 + t * 3.9) * 0.3;
	vec2 nd = vec2(
		fbm(uv * waveScale * 3.0 + vec2(t * 0.6, -t * 0.4)),
		fbm(uv * waveScale * 3.0 + vec2(31.7 - t * 0.5, 23.1 + t * 0.7))
	);
	disp += (nd - 0.5) * 2.0 * noiseAmount;
	disp *= intensity * vF * 0.01;
	return texture2D(tex, clamp(uv + disp, 0.0, 1.0));
}`, {
	intensity:       { type: 'float', default: 1,   min: 0, max: 8, animatable: true, fieldConfig: { step: 0.1 } },
	waveScale:       { type: 'float', default: 1,   min: 0.001, max: 16, animatable: true, fieldConfig: { step: 0.1 } },
	waveAngle:       { type: 'float', default: 0,   min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	noiseAmount:     { type: 'float', default: 0.5, min: 0, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	verticalFalloff: { type: 'float', default: 0.7, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
});

// ---------------------------------------------------------------------------
// 24. Frosted Glass — separable blur + distortion + tint + highlight.
// ---------------------------------------------------------------------------
registerEffect('frostedGlass', [
	{ glsl: `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec2 dUv = uv;
	if (u_distortion > 0.0) {
		vec2 nd = vec2(fbm(uv * 30.0), fbm(uv * 30.0 + vec2(13.7, 91.3)));
		dUv += (nd - 0.5) * u_distortion * 0.05;
	}
	float radius = max(u_blurRadius, 0.0);
	if (radius < 0.5) return texture2D(tex, clamp(dUv, 0.0, 1.0));
	vec2 step = vec2(1.0 / resolution.x, 0.0) * radius;
	vec4 sum = vec4(0.0);
	float wSum = 0.0;
	for (int i = -8; i <= 8; i++) {
		float t = float(i) / 8.0;
		float w = exp(-2.5 * t * t);
		sum += texture2D(tex, clamp(dUv + step * t, 0.0, 1.0)) * w;
		wSum += w;
	}
	return sum / wSum;
}` },
	{ glsl: `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float radius = max(u_blurRadius, 0.0);
	vec4 blurred;
	if (radius < 0.5) {
		blurred = texture2D(tex, uv);
	} else {
		vec2 step = vec2(0.0, 1.0 / resolution.y) * radius;
		vec4 sum = vec4(0.0);
		float wSum = 0.0;
		for (int i = -8; i <= 8; i++) {
			float t = float(i) / 8.0;
			float w = exp(-2.5 * t * t);
			sum += texture2D(tex, clamp(uv + step * t, 0.0, 1.0)) * w;
			wSum += w;
		}
		blurred = sum / wSum;
	}
	vec3 baseRgb = blurred.a > 0.0001 ? blurred.rgb / blurred.a : blurred.rgb;
	vec3 tinted = mix(baseRgb, u_tintColor.rgb, u_tintAmount * u_tintColor.a);
	// Per-frame seed makes the frost speckle alive (the underlying blur and
	// fbm highlight stay frozen because they should scroll with the layer).
	// mod() keeps the time offset bounded so hash21 stays well-distributed
	// at long timestamps (large tFrame * constant overflows float32 fract
	// precision and turns the speckle into structured stripes).
	float tFrame = floor(u_time * 60.0);
	vec2 tOff = vec2(mod(tFrame * 53.17, 977.0), mod(tFrame * 71.93, 991.0));
	float frost = u_frostAmount * (hash21(uv * 200.0 + tOff) * 0.2 - 0.1);
	tinted += vec3(frost);
	float h = fbm(uv * 8.0);
	float highlight = u_highlightAmount * smoothstep(0.55, 0.95, h);
	tinted += vec3(highlight);
	// Clamp to [0,1] before re-premultiplying. frost/highlight can push tinted
	// slightly above 1, and for semi-transparent layers tinted * blurred.a
	// would then exceed blurred.a — invalid premultiplied alpha that the 2D
	// canvas source-over composite reads as over-bright fringe artefacts.
	tinted = clamp(tinted, 0.0, 1.0);
	return vec4(tinted * blurred.a, blurred.a);
}` },
], {
	blurRadius:      { type: 'float', default: 0.6,  min: 0, max: 10, animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	distortion:      { type: 'float', default: 1.2,  min: 0, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	frostAmount:     { type: 'float', default: 0.2,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	tintAmount:      { type: 'float', default: 0, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	highlightAmount: { type: 'float', default: 0,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	tintColor:       { type: 'color', default: '#ffffff' },
});

// ---------------------------------------------------------------------------
// 25. Glass Refraction — procedural normal-driven UV warp + highlights.
// ---------------------------------------------------------------------------
registerEffect('glassRefraction', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float refraction = u_refractionAmount;
	float roughness = u_roughness;
	float highlight = u_highlightAmount;
	float edgeStrength = u_edgeStrength;
	float ior = max(u_ior, 0.5);
	vec2 e = vec2(0.002, 0.0);
	float h0 = fbm(uv * 6.0);
	float hx = fbm((uv + e.xy) * 6.0);
	float hy = fbm((uv + e.yx) * 6.0);
	vec2 normal = vec2(hx - h0, hy - h0) / e.x;
	if (roughness > 0.0) {
		float r0 = fbm(uv * 30.0);
		float rx = fbm((uv + e.xy) * 30.0);
		float ry = fbm((uv + e.yx) * 30.0);
		normal += vec2(rx - r0, ry - r0) / e.x * roughness * 0.5;
	}
	vec2 offset = normal * refraction * 0.005 * (ior - 0.5);
	vec4 c = texture2D(tex, clamp(uv + offset, 0.0, 1.0));
	float specBase = max(0.0, dot(normalize(vec2(0.7, 0.7)), normal * 0.005));
	c.rgb += vec3(pow(specBase, 2.0) * highlight);
	float edgeMag = length(normal) * 0.001;
	c.rgb += vec3(smoothstep(0.5, 1.0, edgeMag) * edgeStrength);
	return c;
}`, {
	refractionAmount: { type: 'float', default: 1,    min: 0, max: 8, animatable: true, fieldConfig: { step: 0.1 } },
	roughness:        { type: 'float', default: 0.2,  min: 0, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	highlightAmount:  { type: 'float', default: 0.6,  min: 0, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	edgeStrength:     { type: 'float', default: 0.3,  min: 0, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	ior:              { type: 'float', default: 1.45, min: 0.5, max: 3, animatable: true, fieldConfig: { step: 0.01 } },
});

// ---------------------------------------------------------------------------
// 26. Prism Split — angled spectral channel separation.
// ---------------------------------------------------------------------------
registerEffect('prismSplit', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float amount = u_amount;
	float angle = radians(u_angle);
	float spectrumWidth = u_spectrumWidth;
	vec2 center = vec2(u_centerX, u_centerY);
	float falloff = max(u_falloff, 0.0);
	vec2 dir = vec2(cos(angle), sin(angle));
	vec2 d = uv - center;
	float dist = length(d);
	float fall = pow(dist, falloff);
	float spread = amount * fall;
	float r = texture2D(tex, clamp(uv + dir * spread, 0.0, 1.0)).r;
	float g = texture2D(tex, uv).g;
	float b = texture2D(tex, clamp(uv - dir * spread, 0.0, 1.0)).b;
	float a = texture2D(tex, uv).a;
	vec3 col = vec3(r, g, b);
	if (spectrumWidth > 0.0) {
		float sp = clamp(spread / max(amount, 0.0001), 0.0, 1.0);
		vec3 rainbow = vec3(
			0.5 + 0.5 * cos(sp * 6.2832 + 0.0),
			0.5 + 0.5 * cos(sp * 6.2832 + 2.094),
			0.5 + 0.5 * cos(sp * 6.2832 + 4.188)
		);
		col = mix(col, col + (rainbow - 0.5) * 0.4, spectrumWidth * fall);
	}
	return vec4(col, a);
}`, {
	amount:        { type: 'float', default: 0.01, min: 0, max: 0.2, animatable: true, fieldConfig: { step: 0.005 } },
	angle:         { type: 'float', default: 0,    min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	spectrumWidth: { type: 'float', default: 0.4,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerX:       { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerY:       { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	falloff:       { type: 'float', default: 1,    min: 0, max: 4, animatable: true, fieldConfig: { step: 0.1 } },
});

// ---------------------------------------------------------------------------
// 27. Slice Glitch — banded slice offsets along axis with optional gaps.
// ---------------------------------------------------------------------------
registerEffect('sliceGlitch', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	int sliceCount = int(clamp(u_sliceCount, 2.0, 256.0));
	float offsetAmount = u_offsetAmount;
	float gap = clamp(u_gap, 0.0, 1.0);
	float randomness = clamp(u_randomness, 0.0, 1.0);
	int axis = int(u_axis);
	int edgeMode = int(u_edgeMode);
	float along = (axis == 0) ? uv.y : uv.x;
	float sliceFloat = along * float(sliceCount);
	float sliceIdx = floor(sliceFloat);
	// Reseed slice offsets every frame so the glitch dances rather than freezes.
	float tFrame = floor(u_time * 60.0);
	float r = hash21(vec2(sliceIdx, 7.31 + tFrame * 0.93));
	float perSlice = mix(1.0, r * 2.0 - 1.0, randomness) * offsetAmount;
	float withinSlice = fract(sliceFloat);
	if (gap > 0.0 && (withinSlice < gap * 0.5 || withinSlice > 1.0 - gap * 0.5)) {
		return vec4(0.0);
	}
	vec2 sUv = uv;
	if (axis == 0) sUv.x += perSlice;
	else sUv.y += perSlice;
	return sampleEdge(tex, sUv, edgeMode);
}`, {
	sliceCount:   { type: 'float',  default: 30,   min: 2, max: 256, animatable: true, fieldConfig: { step: 1, integer: true } },
	offsetAmount: { type: 'float',  default: 0.04, min: 0, max: 0.5, animatable: true, fieldConfig: { step: 0.005 } },
	gap:          { type: 'float',  default: 0,    min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	randomness:   { type: 'float',  default: 0.7,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	axis:         { type: 'option', default: 'horizontal', fieldConfig: { options: { horizontal: 'Horizontal', vertical: 'Vertical' } } },
	edgeMode:     { type: 'option', default: 'transparent', fieldConfig: { options: { clamp: 'Clamp', transparent: 'Transparent', mirror: 'Mirror' } } },
});

// ---------------------------------------------------------------------------
// 28. Digital Blocks — random per-block offset / hide / color shift.
// ---------------------------------------------------------------------------
registerEffect('digitalBlocks', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float blockSize = max(u_blockSize, 1.0);
	float blockAmount = clamp(u_blockAmount, 0.0, 1.0);
	float offsetAmount = u_offsetAmount;
	float colorShift = u_colorShift;
	float randomness = clamp(u_randomness, 0.0, 1.0);
	bool hideBlocks = u_hideBlocks;
	vec2 blocks = resolution / blockSize;
	vec2 blockUv = floor(uv * blocks);
	// Reseed per frame so glitchy blocks change pattern rather than freeze.
	// mod() keeps the time offset bounded — at large tFrame values the raw
	// product overflows into the regime where 32-bit float fract() quantises
	// into structured patterns (vertical stripes), so we wrap it.
	float tFrame = floor(u_time * 60.0);
	vec2 tOff1 = vec2(mod(tFrame * 53.17, 977.0), mod(tFrame * 71.93, 991.0));
	vec2 tOff2 = vec2(mod(tFrame * 0.91 + 7.31, 983.0), mod(tFrame * 1.27 + 13.7, 997.0));
	vec2 tOff3 = vec2(mod(tFrame * 1.71 + 31.7, 971.0), mod(tFrame * 2.13 + 47.3, 967.0));
	// Three independent hashes: gate, x-offset, y-offset. Reusing the gate
	// hash for x-offset biases visible blocks toward negative x (since the
	// gate keeps only blocks with r < blockAmount), producing the
	// vertical-stripe pattern.
	float gate = hash21(blockUv + tOff1);
	float r  = hash21(blockUv + tOff2);
	float r2 = hash21(blockUv + tOff3);
	if (gate >= blockAmount) return texture2D(tex, uv);
	if (hideBlocks && r2 < 0.3) return vec4(0.0);
	vec2 offset = (vec2(r, r2) - 0.5) * 2.0 * offsetAmount * randomness;
	vec2 sUv = uv + offset;
	float a = texture2D(tex, clamp(sUv, 0.0, 1.0)).a;
	float chR = texture2D(tex, clamp(sUv + vec2(colorShift, 0.0), 0.0, 1.0)).r;
	float chG = texture2D(tex, clamp(sUv, 0.0, 1.0)).g;
	float chB = texture2D(tex, clamp(sUv - vec2(colorShift, 0.0), 0.0, 1.0)).b;
	return vec4(chR, chG, chB, a);
}`, {
	blockSize:    { type: 'float', default: 1.25,  min: 0.05, max: 16, animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	blockAmount:  { type: 'float', default: 0.3,   min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	offsetAmount: { type: 'float', default: 0.03,  min: 0, max: 0.5, animatable: true, fieldConfig: { step: 0.005 } },
	colorShift:   { type: 'float', default: 0.005, min: 0, max: 0.1, animatable: true, fieldConfig: { step: 0.001 } },
	randomness:   { type: 'float', default: 1,     min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	hideBlocks:   { type: 'bool',  default: false },
});

// ---------------------------------------------------------------------------
// 29. Datamosh Smear — UV smearing in soft / blocky / streak modes.
// ---------------------------------------------------------------------------
registerEffect('datamoshSmear', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float amount = u_amount;
	float blockSize = max(u_blockSize, 1.0);
	float angle = radians(u_angle);
	float smearLength = u_smearLength;
	float randomness = clamp(u_randomness, 0.0, 1.0);
	int mode = int(u_mode);
	vec2 dir = vec2(cos(angle), sin(angle)) / resolution;
	vec2 blocks = resolution / blockSize;
	vec2 blockUv = floor(uv * blocks);
	// Per-frame reseed lets blocks decide a fresh smear length each frame
	// rather than printing the same trail for the whole clip. mod() keeps the
	// time offset bounded so hash21 stays well-distributed at long timestamps.
	float tFrame = floor(u_time * 60.0);
	vec2 tOff = vec2(mod(tFrame * 53.17, 977.0), mod(tFrame * 71.93, 991.0));
	float r = hash21(blockUv + tOff);
	float perSmear = mix(smearLength, smearLength * r, randomness);
	if (mode == 1) {
		vec2 snapped = blockUv / blocks + 0.5 / blocks;
		return texture2D(tex, clamp(snapped + dir * amount * perSmear, 0.0, 1.0));
	} else if (mode == 2) {
		vec4 sum = vec4(0.0);
		float wSum = 0.0;
		for (int i = 0; i < 16; i++) {
			float t = float(i) / 15.0;
			float w = 1.0 - t;
			sum += texture2D(tex, clamp(uv - dir * t * amount * perSmear, 0.0, 1.0)) * w;
			wSum += w;
		}
		return sum / wSum;
	}
	vec4 c = texture2D(tex, uv);
	vec4 off = texture2D(tex, clamp(uv - dir * amount * perSmear, 0.0, 1.0));
	return mix(c, off, randomness);
}`, {
	amount:       { type: 'float',  default: 4.2,  min: 0, max: 25, animatable: true, fieldConfig: { step: 0.1, unit: 'em' } },
	blockSize:    { type: 'float',  default: 1.25, min: 0.05, max: 16, animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	angle:        { type: 'float',  default: 0,    min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	smearLength:  { type: 'float',  default: 0.5,  min: 0, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	randomness:   { type: 'float',  default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	mode:         { type: 'option', default: 'streak', fieldConfig: { options: { soft: 'Soft', blocky: 'Blocky', streak: 'Streak' } } },
});

// ---------------------------------------------------------------------------
// 30. VHS Distortion — per-row jitter, tear bands, color bleed, scanlines, noise.
// ---------------------------------------------------------------------------
registerEffect('vhsDistortion', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec2 sUv = uv;
	// Per-frame seed reshapes tracking jitter, tear positions and noise speckle
	// so the VHS artifacts breathe instead of looking like a single still frame.
	float tFrame = floor(u_time * 60.0);
	float rowNoise = (valueNoise(vec2(uv.y * 80.0 + tFrame * 17.3, tFrame * 0.27)) - 0.5) * 2.0;
	sUv.x += rowNoise * u_trackingAmount * 0.02;
	float tearKey = floor(uv.y / max(u_tearSize, 0.0001));
	float tearBand = step(1.0 - clamp(u_tearAmount, 0.0, 1.0), hash21(vec2(tearKey, 1.7) + tFrame * 0.93));
	sUv.x += tearBand * u_tearAmount * 0.1;
	float bleed = u_colorBleed * 0.004;
	float r = texture2D(tex, clamp(sUv + vec2(bleed, 0.0), 0.0, 1.0)).r;
	float g = texture2D(tex, clamp(sUv, 0.0, 1.0)).g;
	float b = texture2D(tex, clamp(sUv - vec2(bleed, 0.0), 0.0, 1.0)).b;
	float a = texture2D(tex, clamp(sUv, 0.0, 1.0)).a;
	float scan = 0.5 + 0.5 * cos(uv.y * resolution.y * 3.1415926);
	vec3 col = vec3(r, g, b) * mix(1.0, scan, clamp(u_scanlineIntensity, 0.0, 1.0));
	vec2 nOff = vec2(mod(tFrame * 53.17, 977.0), mod(tFrame * 71.93, 991.0));
	float n = (hash21(uv * resolution + nOff) - 0.5) * 2.0;
	col += vec3(n) * u_noiseAmount * 0.1;
	return vec4(col, a);
}`, {
	trackingAmount:    { type: 'float', default: 1,    min: 0, max: 8, animatable: true, fieldConfig: { step: 0.1 } },
	tearAmount:        { type: 'float', default: 0.3,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	tearSize:          { type: 'float', default: 0.05, min: 0.001, max: 1, animatable: true, fieldConfig: { step: 0.005 } },
	colorBleed:        { type: 'float', default: 1,    min: 0, max: 8, animatable: true, fieldConfig: { step: 0.1 } },
	noiseAmount:       { type: 'float', default: 0.5,  min: 0, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	scanlineIntensity: { type: 'float', default: 0.4,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
});

// ---------------------------------------------------------------------------
// 31. Pixelate — snap UV to a coarse grid, with mix back to original.
// ---------------------------------------------------------------------------
registerEffect('pixelate', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float pixelSize = max(u_pixelSize, 1.0);
	float aspect = max(u_pixelAspect, 0.001);
	float mixAmt = clamp(u_mix, 0.0, 1.0);
	bool snapInt = u_snapToIntegerPixels;
	vec2 size = vec2(pixelSize, pixelSize / aspect);
	vec2 blocks = resolution / size;
	vec2 cell = floor(uv * blocks) + 0.5;
	if (snapInt) cell = floor(cell);
	vec2 sUv = cell / blocks;
	vec4 pix = texture2D(tex, clamp(sUv, 0.0, 1.0));
	vec4 orig = texture2D(tex, uv);
	return mix(orig, pix, mixAmt);
}`, {
	pixelSize:           { type: 'float', default: 0.8, min: 0.05, max: 16, animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	pixelAspect:         { type: 'float', default: 1,   min: 0.1, max: 8, animatable: true, fieldConfig: { step: 0.05 } },
	mix:                 { type: 'float', default: 1,   min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	snapToIntegerPixels: { type: 'bool',  default: false },
});

// ---------------------------------------------------------------------------
// 32. Mosaic Reveal — per-cell reveal driven by direction/random.
// ---------------------------------------------------------------------------
registerEffect('mosaicReveal', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float progress = u_progress;
	float cellSize = max(u_cellSize, 1.0);
	float randomness = clamp(u_randomness, 0.0, 1.0);
	float softness = max(u_softness, 0.0001);
	int direction = int(u_direction);
	bool invert = u_invert;
	vec2 blocks = resolution / cellSize;
	vec2 cell = floor(uv * blocks);
	float r = hash21(cell);
	float dirVal;
	if (direction == 0) dirVal = (cell.x + 0.5) / blocks.x;
	else if (direction == 1) dirVal = 1.0 - (cell.x + 0.5) / blocks.x;
	else if (direction == 2) dirVal = (cell.y + 0.5) / blocks.y;
	else if (direction == 3) dirVal = 1.0 - (cell.y + 0.5) / blocks.y;
	else dirVal = r;
	float threshold = mix(dirVal, r, randomness);
	float diff = invert ? (threshold - progress) : (progress - threshold);
	float mask = smoothstep(-softness, softness, diff);
	vec4 c = texture2D(tex, uv);
	return vec4(c.rgb * mask, c.a * mask);
}`, {
	progress:   { type: 'float',  default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	cellSize:   { type: 'float',  default: 1.6,  min: 0.05, max: 16, animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	randomness: { type: 'float',  default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	softness:   { type: 'float',  default: 0.05, min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.005 } },
	direction:  { type: 'option', default: 'left', fieldConfig: { options: { left: 'Left', right: 'Right', top: 'Top', bottom: 'Bottom', random: 'Random' } } },
	invert:     { type: 'bool',   default: false },
});

// ---------------------------------------------------------------------------
// 33. Burn Dissolve — noise dissolve with hot edges and ash residue.
// ---------------------------------------------------------------------------
registerEffect('burnDissolve', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	float progress = u_progress;
	float scale = max(u_noiseScale, 0.001);
	float edgeWidth = max(u_edgeWidth, 0.0001);
	float softness = max(u_softness, 0.0001);
	float ashAmount = clamp(u_ashAmount, 0.0, 1.0);
	vec4 burnColor = u_burnColor;
	vec4 hotColor = u_hotColor;
	float n = fbm(uv * scale);
	float diff = n - (1.0 - progress);
	float alphaMask = smoothstep(-softness, softness, diff);
	float edgeT = clamp(diff / edgeWidth, 0.0, 1.0);
	vec3 ember = mix(hotColor.rgb, burnColor.rgb, edgeT);
	vec3 result = mix(ember * c.a, c.rgb, edgeT);
	// Gate ash by c.a so transparent regions of the layer don't pick up ash
	// pigment with alpha=0 (invalid premultiplied → visible blobs/banding).
	float ash = smoothstep(softness, -softness, diff) * ashAmount * c.a;
	return vec4(result + (vec3(0.04, 0.03, 0.03) - result) * ash, c.a * max(alphaMask, ash * 0.4));
}`, {
	progress:   { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	noiseScale: { type: 'float', default: 6,    min: 0.5, max: 64, animatable: true, fieldConfig: { step: 0.5 } },
	edgeWidth:  { type: 'float', default: 0.05, min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.005 } },
	softness:   { type: 'float', default: 0.02, min: 0.0001, max: 1, animatable: true, fieldConfig: { step: 0.005 } },
	ashAmount:  { type: 'float', default: 0.4,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	burnColor:  { type: 'color', default: '#3a0a00' },
	hotColor:   { type: 'color', default: '#ffb347' },
});

// ---------------------------------------------------------------------------
// 34. Film Grain — additive / overlay / soft-light noise tied to luminance.
// ---------------------------------------------------------------------------
registerEffect('filmGrain', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	float amount = u_amount;
	float grainSize = max(u_grainSize, 0.5);
	float lumResp = clamp(u_luminanceResponse, 0.0, 1.0);
	int blendMode = int(u_blendMode);
	bool monochrome = u_monochrome;
	vec2 grainCoord = uv * resolution / grainSize;
	// Reseed every frame so the grain pattern animates at the playhead's
	// frame rate (60Hz cap to avoid identical frames at >60fps timelines).
	vec2 timeSeed = vec2(floor(u_time * 60.0) * 53.17, floor(u_time * 60.0) * 71.93);
	float n = hash21(grainCoord + timeSeed) * 2.0 - 1.0;
	vec3 noise = monochrome
		? vec3(n)
		: vec3(n, hash21(grainCoord + timeSeed + vec2(7.7, 11.3)) * 2.0 - 1.0, hash21(grainCoord + timeSeed + vec2(13.4, 19.8)) * 2.0 - 1.0);
	float lum = c.a > 0.0001 ? luminance(c.rgb / c.a) : 0.0;
	float resp = mix(1.0, 1.0 - abs(lum - 0.5) * 2.0, lumResp);
	noise *= amount * resp;
	vec3 base = c.a > 0.0001 ? c.rgb / c.a : c.rgb;
	vec3 result;
	if (blendMode == 2) {
		result = base + noise * 0.3;
	} else if (blendMode == 0) {
		vec3 g = noise * 0.5 + 0.5;
		vec3 lo = 2.0 * base * g;
		vec3 hi = 1.0 - 2.0 * (1.0 - base) * (1.0 - g);
		vec3 mask = step(vec3(0.5), base);
		result = mix(lo, hi, mask);
		result = mix(base, result, amount);
	} else {
		vec3 g = noise * 0.5 + 0.5;
		vec3 lo = 2.0 * base * g + base * base * (1.0 - 2.0 * g);
		vec3 hi = sqrt(max(base, 0.0)) * (2.0 * g - 1.0) + 2.0 * base * (1.0 - g);
		vec3 mask = step(vec3(0.5), g);
		result = mix(lo, hi, mask);
		result = mix(base, result, amount);
	}
	return vec4(clamp(result, 0.0, 1.0) * c.a, c.a);
}`, {
	amount:            { type: 'float',  default: 0.2,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	grainSize:         { type: 'float',  default: 0.08, min: 0.02, max: 1, animatable: true, fieldConfig: { step: 0.01, unit: 'em' } },
	luminanceResponse: { type: 'float',  default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	blendMode:         { type: 'option', default: 'overlay', fieldConfig: { options: { overlay: 'Overlay', softLight: 'Soft Light', add: 'Add' } } },
	monochrome:        { type: 'bool',   default: true },
});

// ---------------------------------------------------------------------------
// 35. CRT Scanlines — scanlines + RGB mask + curvature + brightness rolloff.
// ---------------------------------------------------------------------------
registerEffect('crtScanlines', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec2 sUv = uv;
	if (u_curvature > 0.0) {
		vec2 cv = uv - 0.5;
		float r2 = dot(cv, cv);
		sUv = 0.5 + cv * (1.0 + r2 * u_curvature);
		if (sUv.x < 0.0 || sUv.x > 1.0 || sUv.y < 0.0 || sUv.y > 1.0) return vec4(0.0);
	}
	vec4 c = texture2D(tex, sUv);
	float scan = 0.5 + 0.5 * cos(sUv.y * u_scanlineCount * 6.2832);
	c.rgb *= mix(1.0, scan, clamp(u_scanlineIntensity, 0.0, 1.0));
	float maskCol = mod(sUv.x * resolution.x / 3.0, 1.0) * 3.0;
	vec3 rgbMask;
	if (maskCol < 1.0) rgbMask = vec3(1.0, 0.6, 0.6);
	else if (maskCol < 2.0) rgbMask = vec3(0.6, 1.0, 0.6);
	else rgbMask = vec3(0.6, 0.6, 1.0);
	c.rgb *= mix(vec3(1.0), rgbMask, clamp(u_rgbMaskAmount, 0.0, 1.0));
	float vd = length(sUv - 0.5);
	float roll = 1.0 - u_brightnessRollOff * smoothstep(0.5, 0.95, vd);
	c.rgb *= roll;
	if (u_flicker) {
		float f = 0.93 + 0.07 * sin(sUv.y * 220.0);
		c.rgb *= f;
	}
	return c;
}`, {
	scanlineCount:     { type: 'float', default: 240, min: 10, max: 1080, animatable: true, fieldConfig: { step: 1, integer: true } },
	scanlineIntensity: { type: 'float', default: 0.4, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	rgbMaskAmount:     { type: 'float', default: 0.3, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	curvature:         { type: 'float', default: 0.1, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	brightnessRollOff: { type: 'float', default: 0.4, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	flicker:           { type: 'bool',  default: false },
});

// ---------------------------------------------------------------------------
// 36. Duotone — luminance mapped to two colors.
// ---------------------------------------------------------------------------
registerEffect('duotone', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	if (c.a < 0.0001) return c;
	vec3 base = c.rgb / c.a;
	float lum = luminance(base);
	lum = (lum - 0.5) * (1.0 + u_contrast) + 0.5 + u_brightness;
	float biased = pow(clamp(lum, 0.0, 1.0), exp(-u_midtoneBias * 2.0));
	vec3 duo = mix(u_shadowColor.rgb, u_highlightColor.rgb, biased);
	vec3 result = mix(base, duo, clamp(u_mix, 0.0, 1.0));
	return vec4(result * c.a, c.a);
}`, {
	shadowColor:    { type: 'color', default: '#1a1a3a' },
	highlightColor: { type: 'color', default: '#ffd966' },
	contrast:       { type: 'float', default: 0, min: -1, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	brightness:     { type: 'float', default: 0, min: -1, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	midtoneBias:    { type: 'float', default: 0, min: -1, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	mix:            { type: 'float', default: 1, min: 0,  max: 1, animatable: true, fieldConfig: { step: 0.01 } },
});

// ---------------------------------------------------------------------------
// 37. Halftone — luminance-driven dot grid at an angle.
// ---------------------------------------------------------------------------
registerEffect('halftone', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	float dotSize = max(u_dotSize, 0.001);
	float spacing = max(u_spacing, 2.0);
	float angle = radians(u_angle);
	float threshold = u_threshold;
	float softness = max(u_softness, 0.001);
	int colorMode = int(u_colorMode);
	vec2 cv = (uv - 0.5) * resolution;
	vec2 cvr = rotate2d(angle) * cv;
	vec2 grid = floor(cvr / spacing);
	vec2 cell = cvr - grid * spacing - spacing * 0.5;
	vec2 cellCenterRot = grid * spacing + spacing * 0.5;
	vec2 cellCenterUv = (rotate2d(-angle) * cellCenterRot) / resolution + 0.5;
	vec4 c = texture2D(tex, clamp(cellCenterUv, 0.0, 1.0));
	float lum = luminance(c.rgb);
	float fillNorm = clamp(1.0 - lum + threshold, 0.0, 1.0);
	float radius = sqrt(fillNorm) * spacing * 0.5 * dotSize;
	float d = length(cell);
	float dot_ = smoothstep(radius + softness, radius - softness, d);
	vec3 result;
	float alpha = c.a;
	if (colorMode == 0) {
		result = vec3(dot_) * c.a;
		alpha = dot_ * c.a;
	} else if (colorMode == 1) {
		vec3 dark = vec3(0.05, 0.07, 0.15);
		vec3 light = vec3(0.95, 0.95, 0.85);
		result = mix(dark, light, dot_) * c.a;
	} else {
		vec3 base = c.a > 0.0001 ? c.rgb / c.a : vec3(0.0);
		result = base * dot_ * c.a;
		alpha = dot_ * c.a;
	}
	return vec4(result, alpha);
}`, {
	dotSize:   { type: 'float',  default: 1,   min: 0.1, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	spacing:   { type: 'float',  default: 0.4, min: 0.1, max: 4, animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	angle:     { type: 'float',  default: 30,  min: 0, max: 180, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	threshold: { type: 'float',  default: 0,   min: -0.5, max: 0.5, animatable: true, fieldConfig: { step: 0.01 } },
	softness:  { type: 'float',  default: 0.5, min: 0.001, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	colorMode: { type: 'option', default: 'blackWhite', fieldConfig: { options: { blackWhite: 'Black & White', duotone: 'Duotone', original: 'Original' } } },
});

// ---------------------------------------------------------------------------
// 38. Light Rays — directional bright-pixel streaks toward a center.
// ---------------------------------------------------------------------------
registerEffect('lightRays', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	vec2 center = vec2(u_centerX, u_centerY);
	float threshold = u_threshold;
	float length_ = u_length;
	float intensity = u_intensity;
	int n = int(clamp(u_samples, 4.0, 64.0));
	vec2 d = uv - center;
	vec3 rays = vec3(0.0);
	for (int i = 0; i < 64; i++) {
		if (i >= n) break;
		float t = float(i) / float(n);
		vec2 sUv = uv - d * t * length_;
		vec4 s = texture2D(tex, clamp(sUv, 0.0, 1.0));
		float lum = luminance(s.rgb);
		float bright = max(0.0, lum - threshold);
		rays += s.rgb * bright * (1.0 - t);
	}
	rays *= intensity / float(n);
	rays *= u_color.rgb * u_color.a;
	return vec4(c.rgb + rays, c.a);
}`, {
	intensity: { type: 'float', default: 1.5, min: 0, max: 8, animatable: true, fieldConfig: { step: 0.1 } },
	length:    { type: 'float', default: 0.3, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerX:   { type: 'float', default: 0.5, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerY:   { type: 'float', default: 0.5, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	threshold: { type: 'float', default: 0.7, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	samples:   { type: 'float', default: 32,  min: 4, max: 64, animatable: true, fieldConfig: { step: 1, integer: true } },
	color:     { type: 'color', default: '#ffffff' },
});

// ---------------------------------------------------------------------------
// 39. Volumetric Light — Crytek-style radial accumulation toward a light center.
// ---------------------------------------------------------------------------
registerEffect('volumetricLight', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	vec2 center = vec2(u_centerX, u_centerY);
	float density = u_density;
	float decay = clamp(u_decay, 0.0, 1.0);
	float weight = u_weight;
	float intensity = u_intensity;
	int n = int(clamp(u_samples, 4.0, 100.0));
	vec2 deltaUv = (uv - center) * (density / float(n));
	vec3 rays = vec3(0.0);
	vec2 sampleUv = uv;
	float illum = 1.0;
	for (int i = 0; i < 100; i++) {
		if (i >= n) break;
		sampleUv -= deltaUv;
		vec3 s = texture2D(tex, clamp(sampleUv, 0.0, 1.0)).rgb;
		float lum = luminance(s);
		rays += s * lum * illum * weight;
		illum *= decay;
	}
	return vec4(c.rgb + rays * intensity / float(n), c.a);
}`, {
	intensity: { type: 'float', default: 1.5,  min: 0, max: 8, animatable: true, fieldConfig: { step: 0.1 } },
	decay:     { type: 'float', default: 0.95, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	density:   { type: 'float', default: 1,    min: 0, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	weight:    { type: 'float', default: 1,    min: 0, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	centerX:   { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	centerY:   { type: 'float', default: 0.5,  min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
	samples:   { type: 'float', default: 48,   min: 4, max: 100, animatable: true, fieldConfig: { step: 1, integer: true } },
});

// ---------------------------------------------------------------------------
// 40. Edge Glow — Sobel edge mask, blurred and composited.
// ---------------------------------------------------------------------------
registerEffect('edgeGlow', [
	{ glsl: `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec2 step = vec2(max(u_sampleDistance, 1.0)) / resolution;
	vec3 tl = texture2D(tex, uv + vec2(-step.x, -step.y)).rgb;
	vec3 tc = texture2D(tex, uv + vec2(0.0, -step.y)).rgb;
	vec3 tr = texture2D(tex, uv + vec2(step.x, -step.y)).rgb;
	vec3 ml = texture2D(tex, uv + vec2(-step.x, 0.0)).rgb;
	vec3 mr = texture2D(tex, uv + vec2(step.x, 0.0)).rgb;
	vec3 bl = texture2D(tex, uv + vec2(-step.x, step.y)).rgb;
	vec3 bc = texture2D(tex, uv + vec2(0.0, step.y)).rgb;
	vec3 br = texture2D(tex, uv + vec2(step.x, step.y)).rgb;
	vec3 sx = -tl - 2.0 * ml - bl + tr + 2.0 * mr + br;
	vec3 sy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
	float edge = length(vec2(luminance(sx), luminance(sy)));
	float mask = smoothstep(u_threshold, u_threshold + 0.15, edge);
	return vec4(u_color.rgb * u_color.a * mask, mask * u_color.a);
}` },
	{ glsl: blurH9 },
	{ glsl: blurV9 },
	{ readsOriginal: true, glsl: `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 orig = texture2D(u_originalTexture, uv);
	vec4 glow = texture2D(tex, uv) * u_strength;
	int blendMode = int(u_blendMode);
	vec3 result;
	if (blendMode == 0) result = orig.rgb + glow.rgb;
	else if (blendMode == 1) result = orig.rgb + glow.rgb - orig.rgb * glow.rgb;
	else result = mix(orig.rgb, glow.rgb / max(glow.a, 0.001), clamp(glow.a, 0.0, 1.0));
	return vec4(result, max(orig.a, glow.a));
}` },
], {
	strength:       { type: 'float',  default: 1,    min: 0, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	threshold:      { type: 'float',  default: 0.15, min: 0, max: 2, animatable: true, fieldConfig: { step: 0.01 } },
	radius:         { type: 'float',  default: 0.4,  min: 0, max: 5, animatable: true, fieldConfig: { step: 0.05, unit: 'em' } },
	sampleDistance: { type: 'float',  default: 0.05, min: 0.02, max: 0.5, animatable: true, fieldConfig: { step: 0.01, unit: 'em' } },
	color:          { type: 'color',  default: '#ffffff' },
	blendMode:      { type: 'option', default: 'screen', fieldConfig: { options: { add: 'Add', screen: 'Screen', normal: 'Normal' } } },
});

// ---------------------------------------------------------------------------
// 41. Light Leak — soft colored gradient blob blended over the layer.
// ---------------------------------------------------------------------------
registerEffect('lightLeak', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	float amount = u_amount;
	float scale = max(u_scale, 0.001);
	float softness = max(u_softness, 0.0001);
	float angle = radians(u_angle);
	vec2 pos = vec2(u_positionX, u_positionY);
	vec4 colorA = u_colorA;
	vec4 colorB = u_colorB;
	int blendMode = int(u_blendMode);
	int shape = int(u_shape);
	float t;
	if (shape == 0) {
		vec2 dir = vec2(cos(angle), sin(angle));
		float along = dot(uv - pos, dir);
		t = smoothstep(-softness, softness, along) * (1.0 - smoothstep(scale * 0.5, scale * 0.5 + softness * 2.0, abs(along)));
	} else if (shape == 1) {
		float r = length(uv - pos);
		t = 1.0 - smoothstep(scale * 0.5, scale * 0.5 + softness, r);
	} else {
		float r = length(uv - pos);
		float n = fbm(uv * 4.0 + vec2(angle));
		t = (1.0 - smoothstep(scale * 0.5, scale * 0.5 + softness, r)) * (0.5 + 0.5 * n);
	}
	vec3 leak = mix(colorA.rgb, colorB.rgb, t);
	float leakA = mix(colorA.a, colorB.a, t);
	float amt = amount * t * leakA;
	vec3 result;
	if (blendMode == 0) {
		result = c.rgb + leak * amt - c.rgb * leak * amt;
	} else if (blendMode == 1) {
		result = c.rgb + leak * amt * c.a;
	} else {
		vec3 g = leak * amt * 0.5 + 0.5;
		vec3 base = c.a > 0.0001 ? c.rgb / c.a : c.rgb;
		vec3 lo = 2.0 * base * g + base * base * (1.0 - 2.0 * g);
		vec3 hi = sqrt(max(base, 0.0)) * (2.0 * g - 1.0) + 2.0 * base * (1.0 - g);
		vec3 mask = step(vec3(0.5), g);
		vec3 blended = mix(lo, hi, mask);
		result = mix(c.rgb, blended * c.a, amt);
	}
	return vec4(result, c.a);
}`, {
	amount:    { type: 'float',  default: 0.6, min: 0, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	scale:     { type: 'float',  default: 0.6, min: 0.01, max: 4, animatable: true, fieldConfig: { step: 0.05 } },
	softness:  { type: 'float',  default: 0.3, min: 0.0001, max: 2, animatable: true, fieldConfig: { step: 0.05 } },
	angle:     { type: 'float',  default: 30,  min: 0, max: 360, animatable: true, fieldConfig: { step: 1, unit: 'deg' } },
	positionX: { type: 'float',  default: 0.2, min: -0.5, max: 1.5, animatable: true, fieldConfig: { step: 0.01 } },
	positionY: { type: 'float',  default: 0.2, min: -0.5, max: 1.5, animatable: true, fieldConfig: { step: 0.01 } },
	colorA:    { type: 'color',  default: '#ff8a3d' },
	colorB:    { type: 'color',  default: '#ffd96b' },
	blendMode: { type: 'option', default: 'screen', fieldConfig: { options: { screen: 'Screen', add: 'Add', softLight: 'Soft Light' } } },
	shape:     { type: 'option', default: 'organic', fieldConfig: { options: { linear: 'Linear', radial: 'Radial', organic: 'Organic' } } },
});

// ---------------------------------------------------------------------------
// Invert — RGB colour inversion. Operates in straight-alpha space so
// premultiplied edges stay clean. `amount` cross-fades between original and
// inverted (1 = full negative).
// ---------------------------------------------------------------------------
registerEffect('invert', `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
	vec4 c = texture2D(tex, uv);
	if (c.a < 0.0001) return c;
	vec3 base = c.rgb / c.a;
	return vec4(mix(base, vec3(1.0) - base, u_amount) * c.a, c.a);
}`, {
	amount: { type: 'float', default: 1, min: 0, max: 1, animatable: true, fieldConfig: { step: 0.01 } },
});
