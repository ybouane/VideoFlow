/**
 * WebGLEffectCompositor — lazy WebGL pipeline that applies registered
 * effects to a layer bitmap. Supports both single-pass and multi-pass
 * effects, and gives multi-pass effects access to their own original input
 * via a `u_originalTexture` sampler so pipelines like bloom / glow / edge
 * glow can blur an extracted mask and then composite it back over the
 * unblurred layer.
 *
 * Usage:
 * ```ts
 * const gl = new WebGLEffectCompositor(width, height);
 * const out = gl.apply(sourceBitmap, [{ effect: 'bloom', params: { intensity: 1 } }]);
 * gl.destroy();
 * ```
 *
 * The compositor lazily creates its GL context on first use. Programs are
 * cached per (effect, passIndex). Two ping-pong FBOs are reused across all
 * passes; a third "original-save" FBO is allocated lazily the first time an
 * effect with `readsOriginal` runs as anything other than the very first
 * effect, so its input survives subsequent ping-pong writes.
 */

import {
	getEffect,
	parseColorToVec4,
	resolveOptionIndex,
	type EffectDefinition,
	type EffectParamDefinition,
} from './effects.js';

const VERTEX_SHADER = `#version 100
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
	v_uv = a_position * 0.5 + 0.5;
	gl_Position = vec4(a_position, 0.0, 1.0);
}`;

/**
 * Helper functions injected into every effect shader. Effects can call any
 * of these without having to repeat boilerplate. Kept tight on purpose —
 * each effect that wants something fancier can write it inline.
 *
 * - `luminance(rgb)` — Rec.601 luma coefficients (matches CSS `filter` behaviour).
 * - `sampleEdge(tex, uv, mode)` — sampling with `mode`: 0 clamp, 1 transparent, 2 mirror.
 * - `hash21(p)` / `hash22(p)` — fast 2D → 1D / 2D pseudo-random hashes.
 * - `valueNoise(p)` / `fbm(p)` — value noise + 4-octave fractal Brownian motion.
 * - `rotate2d(angleRad)` — 2×2 rotation matrix for UV/vector rotation.
 * - `srgbToLinear` / `linearToSrgb` — gamma helpers for accurate compositing.
 *
 * GLSL ES 1.00 doesn't allow dynamic loop bounds, so any effect with a
 * variable sample count uses the standard `for (int i = 0; i < MAX; i++) {
 *   if (i >= dynamicCount) break; ... }` idiom with a constant MAX.
 */
const SHADER_PREAMBLE = `
float luminance(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec4 sampleEdge(sampler2D tex, vec2 uv, int mode) {
	if (mode == 1) {
		if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0);
		return texture2D(tex, uv);
	} else if (mode == 2) {
		vec2 m = mod(floor(uv), 2.0);
		vec2 f = fract(uv);
		uv = mix(f, 1.0 - f, m);
		return texture2D(tex, uv);
	}
	return texture2D(tex, clamp(uv, 0.0, 1.0));
}

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
vec2 hash22(vec2 p) {
	float n = sin(dot(p, vec2(127.1, 311.7)));
	return fract(vec2(262144.0, 32768.0) * n);
}

float valueNoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = hash21(i);
	float b = hash21(i + vec2(1.0, 0.0));
	float c = hash21(i + vec2(0.0, 1.0));
	float d = hash21(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
	float v = 0.0;
	float amp = 0.5;
	for (int i = 0; i < 4; i++) {
		v += amp * valueNoise(p);
		p *= 2.02;
		amp *= 0.5;
	}
	return v;
}

mat2 rotate2d(float a) {
	float c = cos(a), s = sin(a);
	return mat2(c, -s, s, c);
}

vec3 srgbToLinear(vec3 c) { return pow(c, vec3(2.2)); }
vec3 linearToSrgb(vec3 c) { return pow(c, vec3(1.0 / 2.2)); }
`;

function buildFragmentShader(effect: EffectDefinition, passGlsl: string, hasOriginal: boolean): string {
	let uniforms = '';
	for (const [name, def] of Object.entries(effect.params)) {
		const glslType =
			def.type === 'color'  ? 'vec4' :
			def.type === 'int'    ? 'int'  :
			def.type === 'bool'   ? 'bool' :
			def.type === 'option' ? 'int'  :
			def.type;
		uniforms += `uniform ${glslType} u_${name};\n`;
	}
	const originalDecl = hasOriginal ? 'uniform sampler2D u_originalTexture;\n' : '';
	return `#version 100
precision highp float;
uniform sampler2D u_texture;
${originalDecl}uniform vec2      u_resolution;
${uniforms}varying vec2 v_uv;
${SHADER_PREAMBLE}
${passGlsl}
void main() {
	gl_FragColor = effect(u_texture, v_uv, u_resolution);
}`;
}

type ProgramEntry = {
	program: WebGLProgram;
	uTexture: WebGLUniformLocation | null;
	uOriginal: WebGLUniformLocation | null;
	uResolution: WebGLUniformLocation | null;
	paramLocs: Record<string, WebGLUniformLocation | null>;
};

export default class WebGLEffectCompositor {
	private canvas: OffscreenCanvas | HTMLCanvasElement;
	private gl: WebGLRenderingContext | null = null;
	/** Programs keyed by `${effectName}#${passIdx}`. */
	private programs: Map<string, ProgramEntry> = new Map();
	private quadBuffer: WebGLBuffer | null = null;
	private fbos: WebGLFramebuffer[] = [];
	private fboTextures: WebGLTexture[] = [];
	private inputTexture: WebGLTexture | null = null;
	/** Optional save FBO used when a multi-pass effect needs its own input
	 *  preserved across ping-pong writes (`readsOriginal`). Allocated lazily. */
	private originalSaveFBO: WebGLFramebuffer | null = null;
	private originalSaveTex: WebGLTexture | null = null;
	/** Tiny identity blit program used to copy a texture into `originalSaveTex`. */
	private blitProgram: ProgramEntry | null = null;

	constructor(private width: number, private height: number) {
		this.canvas = typeof OffscreenCanvas !== 'undefined'
			? new OffscreenCanvas(width, height)
			: document.createElement('canvas');
		if (!(this.canvas instanceof OffscreenCanvas)) {
			(this.canvas as HTMLCanvasElement).width = width;
			(this.canvas as HTMLCanvasElement).height = height;
		}
	}

	private ensureGL(): WebGLRenderingContext {
		if (this.gl) return this.gl;
		const attribs: WebGLContextAttributes = {
			premultipliedAlpha: true,
			alpha: true,
			preserveDrawingBuffer: false,
			antialias: false,
			depth: false,
			stencil: false,
		};
		const gl = this.canvas.getContext('webgl2', attribs) as WebGLRenderingContext | null
			?? this.canvas.getContext('webgl', attribs) as WebGLRenderingContext | null;
		if (!gl) throw new Error('WebGL not available');
		this.gl = gl;

		this.quadBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
			gl.STATIC_DRAW,
		);

		for (let i = 0; i < 2; i++) {
			const tex = gl.createTexture()!;
			gl.bindTexture(gl.TEXTURE_2D, tex);
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
			gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
			const fbo = gl.createFramebuffer()!;
			gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
			gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
			this.fbos.push(fbo);
			this.fboTextures.push(tex);
		}

		this.inputTexture = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		return gl;
	}

	private ensureOriginalSave(gl: WebGLRenderingContext): { fbo: WebGLFramebuffer, tex: WebGLTexture } {
		if (this.originalSaveFBO && this.originalSaveTex) {
			return { fbo: this.originalSaveFBO, tex: this.originalSaveTex };
		}
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, this.width, this.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		const fbo = gl.createFramebuffer()!;
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
		this.originalSaveFBO = fbo;
		this.originalSaveTex = tex;
		return { fbo, tex };
	}

	private ensureBlitProgram(gl: WebGLRenderingContext): ProgramEntry {
		if (this.blitProgram) return this.blitProgram;
		const fs = `#version 100
precision mediump float;
uniform sampler2D u_texture;
varying vec2 v_uv;
void main() { gl_FragColor = texture2D(u_texture, v_uv); }`;
		const vsh = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
		const fsh = this.compileShader(gl, gl.FRAGMENT_SHADER, fs);
		const program = gl.createProgram()!;
		gl.attachShader(program, vsh);
		gl.attachShader(program, fsh);
		gl.bindAttribLocation(program, 0, 'a_position');
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(`Blit program link error: ${gl.getProgramInfoLog(program)}`);
		}
		gl.deleteShader(vsh);
		gl.deleteShader(fsh);
		this.blitProgram = {
			program,
			uTexture: gl.getUniformLocation(program, 'u_texture'),
			uOriginal: null,
			uResolution: null,
			paramLocs: {},
		};
		return this.blitProgram;
	}

	private compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
		const s = gl.createShader(type)!;
		gl.shaderSource(s, src);
		gl.compileShader(s);
		if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
			const log = gl.getShaderInfoLog(s);
			gl.deleteShader(s);
			throw new Error(`Shader compile error: ${log}\n${src}`);
		}
		return s;
	}

	private getProgram(effect: EffectDefinition, passIdx: number, passGlsl: string, hasOriginal: boolean): ProgramEntry | null {
		const cacheKey = `${effect.name}#${passIdx}`;
		const cached = this.programs.get(cacheKey);
		if (cached) return cached;

		const gl = this.ensureGL();
		const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
		const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, buildFragmentShader(effect, passGlsl, hasOriginal));
		const program = gl.createProgram()!;
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.bindAttribLocation(program, 0, 'a_position');
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			const log = gl.getProgramInfoLog(program);
			throw new Error(`Program link error (${cacheKey}): ${log}`);
		}
		gl.deleteShader(vs);
		gl.deleteShader(fs);

		const paramLocs: Record<string, WebGLUniformLocation | null> = {};
		for (const name of Object.keys(effect.params)) {
			paramLocs[name] = gl.getUniformLocation(program, `u_${name}`);
		}
		const entry: ProgramEntry = {
			program,
			uTexture: gl.getUniformLocation(program, 'u_texture'),
			uOriginal: gl.getUniformLocation(program, 'u_originalTexture'),
			uResolution: gl.getUniformLocation(program, 'u_resolution'),
			paramLocs,
		};
		this.programs.set(cacheKey, entry);
		return entry;
	}

	private setParam(
		gl: WebGLRenderingContext,
		loc: WebGLUniformLocation | null,
		def: EffectParamDefinition,
		value: any,
	): void {
		if (!loc) return;
		const v = value === undefined ? def.default : value;
		switch (def.type) {
			case 'float':
				gl.uniform1f(loc, Number(v));
				break;
			case 'int':
				gl.uniform1i(loc, Number(v) | 0);
				break;
			case 'bool':
				gl.uniform1i(loc, v ? 1 : 0);
				break;
			case 'vec2':
				gl.uniform2f(loc, Number(v?.[0] ?? 0), Number(v?.[1] ?? 0));
				break;
			case 'vec3':
				gl.uniform3f(loc, Number(v?.[0] ?? 0), Number(v?.[1] ?? 0), Number(v?.[2] ?? 0));
				break;
			case 'vec4':
				gl.uniform4f(loc, Number(v?.[0] ?? 0), Number(v?.[1] ?? 0), Number(v?.[2] ?? 0), Number(v?.[3] ?? 0));
				break;
			case 'color': {
				const [r, g, b, a] = parseColorToVec4(v);
				gl.uniform4f(loc, r, g, b, a);
				break;
			}
			case 'option': {
				gl.uniform1i(loc, resolveOptionIndex(def, v));
				break;
			}
		}
	}

	private get2dCanvasContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null {
		if (this.canvas instanceof OffscreenCanvas) {
			try { return this.canvas.getContext('2d') as any; } catch { return null; }
		}
		try { return (this.canvas as HTMLCanvasElement).getContext('2d'); } catch { return null; }
	}

	/**
	 * Apply a sequence of effects to a source bitmap and return the rendered
	 * canvas. The returned canvas is the compositor's own drawing surface —
	 * its contents are overwritten on the next `apply()` call, so callers
	 * must consume or copy the pixels before invoking `apply()` again.
	 */
	apply(
		source: CanvasImageSource,
		effects: Array<{ effect: string; params?: Record<string, any> }>,
	): OffscreenCanvas | HTMLCanvasElement {
		const w = this.width;
		const h = this.height;

		const runnableSteps = effects
			.map(e => ({ step: e, def: getEffect(e.effect) }))
			.filter((e): e is { step: { effect: string; params?: Record<string, any> }, def: EffectDefinition } => !!e.def);

		// No runnable effects — just blit the source. We can't easily share a
		// 2d context with an active webgl context on the same canvas, so if
		// GL was already initialised we route through it instead.
		if (runnableSteps.length === 0 && !this.gl) {
			const ctx = this.get2dCanvasContext();
			if (ctx) {
				ctx.clearRect(0, 0, w, h);
				ctx.drawImage(source as any, 0, 0, w, h);
				return this.canvas as any;
			}
		}

		const gl = this.ensureGL();
		gl.viewport(0, 0, w, h);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.clearColor(0, 0, 0, 0);

		gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as any);

		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

		// If there are no effects, blit input to default framebuffer once.
		if (runnableSteps.length === 0) {
			const blit = this.ensureBlitProgram(gl);
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.viewport(0, 0, w, h);
			gl.clear(gl.COLOR_BUFFER_BIT);
			gl.useProgram(blit.program);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
			if (blit.uTexture) gl.uniform1i(blit.uTexture, 0);
			gl.drawArrays(gl.TRIANGLES, 0, 6);
			return this.canvas as any;
		}

		// `read` is the texture currently holding the "input" for the next
		// pass. Starts as the uploaded source; after each pass becomes the
		// FBO texture just written.
		let read: WebGLTexture = this.inputTexture!;
		let writeIdx = 0;

		for (let effIdx = 0; effIdx < runnableSteps.length; effIdx++) {
			const { step, def } = runnableSteps[effIdx];
			const isLastEffect = effIdx === runnableSteps.length - 1;
			const passes = def.passes ?? [{ glsl: def.glsl ?? '' }];

			// If any pass in this effect requests `u_originalTexture`, ensure
			// we have a stable texture reference for the effect's input across
			// its passes. If `read === inputTexture` we can just reuse it
			// (never written to during apply); otherwise we must blit it into
			// the dedicated save FBO so subsequent ping-pong writes don't
			// clobber it.
			const needsOriginal = passes.some(p => !!p.readsOriginal);
			let originalTex: WebGLTexture | null = null;
			if (needsOriginal) {
				if (read === this.inputTexture) {
					originalTex = this.inputTexture;
				} else {
					const save = this.ensureOriginalSave(gl);
					gl.bindFramebuffer(gl.FRAMEBUFFER, save.fbo);
					gl.viewport(0, 0, w, h);
					gl.clear(gl.COLOR_BUFFER_BIT);
					const blit = this.ensureBlitProgram(gl);
					gl.useProgram(blit.program);
					gl.activeTexture(gl.TEXTURE0);
					gl.bindTexture(gl.TEXTURE_2D, read);
					if (blit.uTexture) gl.uniform1i(blit.uTexture, 0);
					gl.drawArrays(gl.TRIANGLES, 0, 6);
					originalTex = save.tex;
				}
			}

			for (let passIdx = 0; passIdx < passes.length; passIdx++) {
				const pass = passes[passIdx];
				const entry = this.getProgram(def, passIdx, pass.glsl, !!pass.readsOriginal);
				if (!entry) continue;

				const isLastPass = passIdx === passes.length - 1;
				const isFinalDraw = isLastEffect && isLastPass;
				const targetFBO = isFinalDraw ? null : this.fbos[writeIdx];
				gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
				gl.viewport(0, 0, w, h);
				gl.clear(gl.COLOR_BUFFER_BIT);

				gl.useProgram(entry.program);
				gl.activeTexture(gl.TEXTURE0);
				gl.bindTexture(gl.TEXTURE_2D, read);
				if (entry.uTexture) gl.uniform1i(entry.uTexture, 0);
				if (entry.uResolution) gl.uniform2f(entry.uResolution, w, h);

				if (pass.readsOriginal && originalTex) {
					gl.activeTexture(gl.TEXTURE1);
					gl.bindTexture(gl.TEXTURE_2D, originalTex);
					if (entry.uOriginal) gl.uniform1i(entry.uOriginal, 1);
				}

				for (const [name, paramDef] of Object.entries(def.params)) {
					this.setParam(gl, entry.paramLocs[name], paramDef, step.params?.[name]);
				}
				gl.drawArrays(gl.TRIANGLES, 0, 6);

				if (!isFinalDraw) {
					read = this.fboTextures[writeIdx];
					writeIdx = 1 - writeIdx;
				}
			}
		}

		return this.canvas as any;
	}

	/** Release all GL resources. Safe to call multiple times. */
	destroy(): void {
		if (!this.gl) return;
		const gl = this.gl;
		for (const p of this.programs.values()) gl.deleteProgram(p.program);
		this.programs.clear();
		if (this.blitProgram) gl.deleteProgram(this.blitProgram.program);
		this.blitProgram = null;
		for (const fbo of this.fbos) gl.deleteFramebuffer(fbo);
		for (const tex of this.fboTextures) gl.deleteTexture(tex);
		if (this.inputTexture) gl.deleteTexture(this.inputTexture);
		if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
		if (this.originalSaveFBO) gl.deleteFramebuffer(this.originalSaveFBO);
		if (this.originalSaveTex) gl.deleteTexture(this.originalSaveTex);
		this.fbos = [];
		this.fboTextures = [];
		this.inputTexture = null;
		this.quadBuffer = null;
		this.originalSaveFBO = null;
		this.originalSaveTex = null;
		const loseCtx = gl.getExtension('WEBGL_lose_context');
		if (loseCtx) loseCtx.loseContext();
		this.gl = null;
	}
}
