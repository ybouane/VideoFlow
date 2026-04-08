/**
 * RuntimeAudioLayer — runtime class for audio-only layers.
 *
 * Has no visual output. Audio is handled by the renderer's audio
 * rendering pipeline. Fetches and caches the audio data during
 * initialization so it is available for decoding.
 */

import { loadedMedia, type MediaEntry } from '@videoflow/core';
import RuntimeBaseLayer from './RuntimeBaseLayer.js';

export default class RuntimeAudioLayer extends RuntimeBaseLayer {
	get hasAudio(): boolean { return true; }

	/** Handle into the global media cache; null until initialize() runs. */
	cacheEntry: MediaEntry | null = null;
	/** Decoded audio buffer (cached when needed for sourceEnd resolution). */
	decodedBuffer: AudioBuffer | null = null;
	/** Intrinsic source duration in seconds (populated when known). */
	duration: number = 0;

	/** Backwards-compatible accessor — returns the cached blob, if any. */
	get dataBlob(): Blob | null {
		return this.cacheEntry?.blob ?? null;
	}

	get intrinsicDuration(): number | undefined {
		return this.duration > 0 ? this.duration : undefined;
	}

	async initialize(): Promise<void> {
		if (this.cacheEntry) return; // Idempotent — already initialised.
		const source = this.json.settings.source;
		if (!source) return;

		this.cacheEntry = await loadedMedia.acquire(source);
		// Inherit duration from the shared entry if a previous consumer
		// already populated it (probe or another audio layer).
		if (this.cacheEntry.duration > 0) {
			this.duration = this.cacheEntry.duration;
		}

		// If the compile pass left an unresolved sourceEnd on this layer, we
		// need the intrinsic duration before any frame is rendered. Decode the
		// blob now and cache it so the audio render pass can reuse it.
		if ((this.json.settings as any).sourceEnd != null && !(this.duration > 0)) {
			try {
				const arrayBuffer = await this.cacheEntry.blob.arrayBuffer();
				const Ctx: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
				const ctx = new Ctx();
				try {
					this.decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
					this.duration = this.decodedBuffer.duration;
					if (this.cacheEntry && !(this.cacheEntry.duration > 0)) {
						this.cacheEntry.duration = this.duration;
					}
				} finally {
					if (typeof ctx.close === 'function') await ctx.close();
				}
			} catch {
				// Decode failure → leave duration unknown; resolveMediaTimings is a no-op.
			}
		}
	}

	destroy(): void {
		if (this.cacheEntry) {
			const source = this.json.settings.source;
			if (typeof source === 'string') loadedMedia.release(source);
			this.cacheEntry = null;
		}
		this.decodedBuffer = null;
	}
}
