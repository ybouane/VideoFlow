export {};

import {
	Output,
	Mp4OutputFormat,
	BufferTarget,
	CanvasSource,
	AudioSampleSource,
	AudioSample,
	QUALITY_HIGH,
} from 'mediabunny';

// Typed reference to the worker global scope.  The project tsconfig includes
// the DOM lib rather than WebWorker, so we cast once to avoid type conflicts.
const _self = self as unknown as {
	onmessage: ((e: MessageEvent) => void) | null;
	postMessage(msg: any, transfer?: Transferable[]): void;
};

// ---------------------------------------------------------------------------
//  Message types (main → worker)
// ---------------------------------------------------------------------------

type InitMsg = {
	type: 'init';
	width: number;
	height: number;
	fps: number;
};

type FrameMsg = {
	type: 'frame';
	bitmap: ImageBitmap;
	timestamp: number;
	duration: number;
};

type AudioMsg = {
	type: 'audio';
	data: Float32Array;
	sampleRate: number;
	numberOfChannels: number;
};

type FinalizeMsg = { type: 'finalize' };
type AbortMsg = { type: 'abort' };

type InMsg = InitMsg | FrameMsg | AudioMsg | FinalizeMsg | AbortMsg;

// ---------------------------------------------------------------------------
//  Audio encoder probe — same shape as the main-thread helper. WebCodecs is
//  available in workers, so we can probe directly here. Prefers AAC and
//  falls back to Opus when AAC isn't shipped (e.g. Linux Chrome).
// ---------------------------------------------------------------------------

type AudioCodecChoice = { codec: 'aac' | 'opus'; bitrate: number };

const AAC_BITRATE_CANDIDATES = [192_000, 128_000, 96_000];
const OPUS_BITRATE_CANDIDATES = [128_000, 96_000, 64_000];

async function pickSupportedAudioCodec(
	numberOfChannels: number,
	sampleRate: number,
): Promise<AudioCodecChoice | null> {
	const Encoder = (self as any).AudioEncoder;
	if (typeof Encoder === 'undefined') return null;

	const probe = async (codec: string, bitrate: number) => {
		try {
			const r = await Encoder.isConfigSupported({ codec, sampleRate, numberOfChannels, bitrate });
			return r.supported === true;
		} catch { return false; }
	};

	for (const bitrate of AAC_BITRATE_CANDIDATES) {
		if (await probe('mp4a.40.2', bitrate)) return { codec: 'aac', bitrate };
	}
	for (const bitrate of OPUS_BITRATE_CANDIDATES) {
		if (await probe('opus', bitrate)) return { codec: 'opus', bitrate };
	}
	return null;
}

// ---------------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------------

let initParams: { width: number; height: number; fps: number } | null = null;
let canvas: OffscreenCanvas;
let ctx: OffscreenCanvasRenderingContext2D;
let output: Output;
let videoSource: CanvasSource;
let audioSource: AudioSampleSource | null = null;
let outputStarted = false;
let aborted = false;

// ---------------------------------------------------------------------------
//  Sequential message queue — ensures frames are encoded in order even though
//  each handler is async.
// ---------------------------------------------------------------------------

const queue: InMsg[] = [];
let processing = false;

async function drain() {
	if (processing) return;
	processing = true;
	while (queue.length > 0) {
		const msg = queue.shift()!;
		try {
			await handle(msg);
		} catch (err: any) {
			_self.postMessage({ type: 'error', message: String(err?.message ?? err) });
			queue.length = 0;
		}
	}
	processing = false;
}

_self.onmessage = (e: MessageEvent<InMsg>) => {
	queue.push(e.data);
	drain();
};

// ---------------------------------------------------------------------------
//  MediaBunny setup
//
//  We defer the actual track creation + `output.start()` until the audio
//  message arrives, because we need to know the audio config (channels,
//  sampleRate) up front to decide whether to add an audio track at all.
//  Trying to add a track and discovering the AAC config is unsupported only
//  after the first sample is fed to MediaBunny throws an unrecoverable error
//  mid-render — we'd rather skip audio gracefully than crash.
// ---------------------------------------------------------------------------

async function setupOutput(audioChannels: number, audioSampleRate: number) {
	if (!initParams) throw new Error('setupOutput called before init');

	canvas = new OffscreenCanvas(initParams.width, initParams.height);
	ctx = canvas.getContext('2d')!;

	output = new Output({
		format: new Mp4OutputFormat(),
		target: new BufferTarget(),
	});

	videoSource = new CanvasSource(canvas, {
		codec: 'avc',
		bitrate: QUALITY_HIGH,
	});
	output.addVideoTrack(videoSource, { frameRate: initParams.fps });

	if (audioChannels > 0 && audioSampleRate > 0) {
		const choice = await pickSupportedAudioCodec(audioChannels, audioSampleRate);
		if (choice) {
			audioSource = new AudioSampleSource({ codec: choice.codec, bitrate: choice.bitrate });
			output.addAudioTrack(audioSource);
			if (choice.codec === 'opus') {
				_self.postMessage({
					type: 'info',
					message: `Using Opus audio (${choice.bitrate / 1000} kbps) — AAC not available on this platform.`,
				});
			}
		} else {
			_self.postMessage({
				type: 'warn',
				message: `No supported audio encoder for ${audioChannels} ch / ${audioSampleRate} Hz — encoding silent video.`,
			});
		}
	}

	await output.start();
	outputStarted = true;
}

// ---------------------------------------------------------------------------
//  Handlers
// ---------------------------------------------------------------------------

async function handle(msg: InMsg) {
	switch (msg.type) {
		case 'init': {
			initParams = { width: msg.width, height: msg.height, fps: msg.fps };
			// Reply ready immediately — the main thread will follow up with
			// the audio message, at which point we'll actually configure
			// MediaBunny.
			_self.postMessage({ type: 'ready' });
			break;
		}

		case 'audio': {
			// Lazy MediaBunny setup once we know the audio config.
			await setupOutput(msg.numberOfChannels, msg.sampleRate);

			if (audioSource && msg.numberOfChannels > 0 && msg.data.length > 0) {
				// Raw f32-planar PCM — no Web Audio API needed.
				const sample = new AudioSample({
					data: msg.data,
					format: 'f32-planar',
					numberOfChannels: msg.numberOfChannels,
					sampleRate: msg.sampleRate,
					timestamp: 0,
				});
				await audioSource.add(sample);
				sample.close();
			}
			audioSource?.close();
			break;
		}

		case 'frame': {
			if (aborted) {
				msg.bitmap.close();
				return;
			}
			if (!outputStarted) throw new Error('frame received before audio/setup');

			// ImageBitmap was rasterised on the main thread (SVG decode
			// requires DOM) and transferred here zero-copy.
			ctx.drawImage(msg.bitmap, 0, 0, canvas.width, canvas.height);
			msg.bitmap.close();

			await videoSource.add(msg.timestamp, msg.duration);
			_self.postMessage({ type: 'frameEncoded' });
			break;
		}

		case 'finalize': {
			if (!outputStarted) throw new Error('finalize received before setup');
			videoSource.close();
			await output.finalize();
			const buffer = (output.target as BufferTarget).buffer!;
			_self.postMessage({ type: 'done', buffer }, [buffer]);
			break;
		}

		case 'abort': {
			aborted = true;
			break;
		}
	}
}
