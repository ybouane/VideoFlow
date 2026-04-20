/**
 * WebGLEffectCompositor — lazy WebGL2 pipeline that applies registered
 * effects (as shader passes) to a layer bitmap.
 *
 * Usage:
 * ```ts
 * const gl = new WebGLEffectCompositor(width, height);
 * const out = gl.apply(sourceBitmap, [{ effect: 'pixelate', params: { size: 8 } }]);
 * // `out` is an OffscreenCanvas / HTMLCanvasElement whose 2D pixels can be
 * // drawImage'd onto the final composite.
 * gl.destroy();
 * ```
 *
 * The compositor lazily creates its GL context on first use and its program
 * cache is keyed on effect name. Framebuffers are ping-ponged so an arbitrary
 * number of effects can be chained without per-pass allocation.
 */

import { getEffect, parseColorToVec4, type EffectDefinition, type EffectParamDefinition } from './effects.js';

const VERTEX_SHADER = `#version 100
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
	v_uv = a_position * 0.5 + 0.5;
	gl_Position = vec4(a_position, 0.0, 1.0);
}`;

function buildFragmentShader(effect: EffectDefinition): string {
	let uniforms = '';
	for (const [name, def] of Object.entries(effect.params)) {
		const glslType =
			def.type === 'color' ? 'vec4' :
			def.type === 'int'   ? 'int'  :
			def.type === 'bool'  ? 'bool' :
			def.type;
		uniforms += `uniform ${glslType} u_${name};\n`;
	}
	return `#version 100
precision mediump float;
uniform sampler2D u_texture;
uniform vec2      u_resolution;
${uniforms}varying vec2 v_uv;
${effect.glsl}
void main() {
	gl_FragColor = effect(u_texture, v_uv, u_resolution);
}`;
}

type ProgramEntry = {
	program: WebGLProgram;
	uTexture: WebGLUniformLocation | null;
	uResolution: WebGLUniformLocation | null;
	paramLocs: Record<string, WebGLUniformLocation | null>;
	effect: EffectDefinition;
};

export default class WebGLEffectCompositor {
	private canvas: OffscreenCanvas | HTMLCanvasElement;
	private gl: WebGLRenderingContext | null = null;
	private programs: Map<string, ProgramEntry> = new Map();
	private quadBuffer: WebGLBuffer | null = null;
	private fbos: WebGLFramebuffer[] = [];
	private fboTextures: WebGLTexture[] = [];
	private inputTexture: WebGLTexture | null = null;

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

		// Fullscreen quad (two triangles covering clip space).
		this.quadBuffer = gl.createBuffer();
		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
			gl.STATIC_DRAW,
		);

		// Ping-pong FBOs + textures sized to the output canvas.
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

		// Input texture (content of the layer bitmap).
		this.inputTexture = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

		return gl;
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

	private getProgram(effectName: string): ProgramEntry | null {
		const cached = this.programs.get(effectName);
		if (cached) return cached;
		const effect = getEffect(effectName);
		if (!effect) return null;

		const gl = this.ensureGL();
		const vs = this.compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
		const fs = this.compileShader(gl, gl.FRAGMENT_SHADER, buildFragmentShader(effect));
		const program = gl.createProgram()!;
		gl.attachShader(program, vs);
		gl.attachShader(program, fs);
		gl.bindAttribLocation(program, 0, 'a_position');
		gl.linkProgram(program);
		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			const log = gl.getProgramInfoLog(program);
			throw new Error(`Program link error (${effectName}): ${log}`);
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
			uResolution: gl.getUniformLocation(program, 'u_resolution'),
			paramLocs,
			effect,
		};
		this.programs.set(effectName, entry);
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
		}
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
		const gl = this.ensureGL();
		const w = this.width;
		const h = this.height;

		gl.viewport(0, 0, w, h);
		gl.disable(gl.DEPTH_TEST);
		gl.disable(gl.BLEND);
		gl.clearColor(0, 0, 0, 0);

		// Upload source into inputTexture.
		gl.bindTexture(gl.TEXTURE_2D, this.inputTexture);
		gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as any);

		gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
		gl.enableVertexAttribArray(0);
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

		let read = this.inputTexture!;
		let writeIdx = 0;

		const runnable = effects.filter(e => !!getEffect(e.effect));
		if (runnable.length === 0) {
			// No-op: draw source straight onto the canvas via default framebuffer
			// so we can still return a consistent canvas surface.
			gl.bindFramebuffer(gl.FRAMEBUFFER, null);
			gl.viewport(0, 0, w, h);
			gl.clear(gl.COLOR_BUFFER_BIT);
			// draw source as-is by running a single identity-like pass: bind input as
			// current texture and blit via the first available effect or a trivial pass.
			// Simpler: just draw the raw source into a 2D canvas wrapper via
			// drawImage on a separate 2D canvas outside WebGL. But we want to keep
			// the API uniform — create a single identity program for this case.
			// Fall back: return the source canvas re-drawn on a 2D canvas surface.
			const out2d = (this.canvas instanceof OffscreenCanvas
				? this.canvas
				: this.canvas) as any;
			const ctx = out2d.getContext('2d');
			if (ctx) {
				ctx.clearRect(0, 0, w, h);
				ctx.drawImage(source as any, 0, 0, w, h);
				return this.canvas as any;
			}
		}

		for (let i = 0; i < runnable.length; i++) {
			const step = runnable[i];
			const entry = this.getProgram(step.effect);
			if (!entry) continue;

			const isLast = i === runnable.length - 1;
			const targetFBO = isLast ? null : this.fbos[writeIdx];
			gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
			gl.viewport(0, 0, w, h);
			gl.clear(gl.COLOR_BUFFER_BIT);

			gl.useProgram(entry.program);
			gl.activeTexture(gl.TEXTURE0);
			gl.bindTexture(gl.TEXTURE_2D, read);
			if (entry.uTexture) gl.uniform1i(entry.uTexture, 0);
			if (entry.uResolution) gl.uniform2f(entry.uResolution, w, h);
			for (const [name, def] of Object.entries(entry.effect.params)) {
				this.setParam(gl, entry.paramLocs[name], def, step.params?.[name]);
			}
			gl.drawArrays(gl.TRIANGLES, 0, 6);

			if (!isLast) {
				read = this.fboTextures[writeIdx];
				writeIdx = 1 - writeIdx;
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
		for (const fbo of this.fbos) gl.deleteFramebuffer(fbo);
		for (const tex of this.fboTextures) gl.deleteTexture(tex);
		if (this.inputTexture) gl.deleteTexture(this.inputTexture);
		if (this.quadBuffer) gl.deleteBuffer(this.quadBuffer);
		this.fbos = [];
		this.fboTextures = [];
		this.inputTexture = null;
		this.quadBuffer = null;
		const loseCtx = gl.getExtension('WEBGL_lose_context');
		if (loseCtx) loseCtx.loseContext();
		this.gl = null;
	}
}
