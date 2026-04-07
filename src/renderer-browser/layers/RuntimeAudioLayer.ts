/**
 * RuntimeAudioLayer — runtime class for audio-only layers.
 *
 * Has no visual output. Audio is handled by the renderer's audio
 * rendering pipeline. Fetches and caches the audio data during
 * initialization so it is available for decoding.
 */

import RuntimeBaseLayer from './RuntimeBaseLayer.js';

export default class RuntimeAudioLayer extends RuntimeBaseLayer {
	get hasAudio(): boolean { return true; }

	dataBlob: Blob | null = null;
	/** Decoded audio buffer (cached when needed for trimEnd resolution). */
	decodedBuffer: AudioBuffer | null = null;
	/** Intrinsic source duration in seconds (populated when known). */
	duration: number = 0;

	get intrinsicDuration(): number | undefined {
		return this.duration > 0 ? this.duration : undefined;
	}

	async initialize(): Promise<void> {
		const source = this.json.settings.source;
		if (!source) return;

		const response = await fetch(source, { cache: 'no-cache' });
		if (!response.ok) throw new Error(`Failed to fetch audio: ${response.statusText}`);
		this.dataBlob = await response.blob();

		// If the compile pass left an unresolved trimEnd on this layer, we
		// need the intrinsic duration before any frame is rendered. Decode the
		// blob now and cache it so the audio render pass can reuse it.
		if ((this.json.settings as any).trimEnd != null) {
			try {
				const arrayBuffer = await this.dataBlob.arrayBuffer();
				const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
				const ctx = new Ctx();
				try {
					this.decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
					this.duration = this.decodedBuffer.duration;
				} finally {
					if (typeof ctx.close === 'function') await ctx.close();
				}
			} catch {
				// Decode failure → leave duration unknown; resolveMediaTimings is a no-op.
			}
		}
	}
}
