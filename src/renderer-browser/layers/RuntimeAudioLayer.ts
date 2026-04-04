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

	async initialize(): Promise<void> {
		const source = this.json.settings.source;
		if (!source) return;

		const response = await fetch(source, { cache: 'no-cache' });
		if (!response.ok) throw new Error(`Failed to fetch audio: ${response.statusText}`);
		this.dataBlob = await response.blob();
	}
}
