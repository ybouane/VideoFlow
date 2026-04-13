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
//  State
// ---------------------------------------------------------------------------

let canvas: OffscreenCanvas;
let ctx: OffscreenCanvasRenderingContext2D;
let output: Output;
let videoSource: CanvasSource;
let audioSource: AudioSampleSource;
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
//  Handlers
// ---------------------------------------------------------------------------

async function handle(msg: InMsg) {
	switch (msg.type) {
		case 'init': {
			canvas = new OffscreenCanvas(msg.width, msg.height);
			ctx = canvas.getContext('2d')!;

			output = new Output({
				format: new Mp4OutputFormat(),
				target: new BufferTarget(),
			});

			videoSource = new CanvasSource(canvas, {
				codec: 'avc',
				bitrate: QUALITY_HIGH,
			});
			output.addVideoTrack(videoSource, { frameRate: msg.fps });

			audioSource = new AudioSampleSource({
				codec: 'aac',
				bitrate: 192_000,
			});
			output.addAudioTrack(audioSource);

			await output.start();
			_self.postMessage({ type: 'ready' });
			break;
		}

		case 'audio': {
			if (msg.numberOfChannels > 0 && msg.data.length > 0) {
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
			audioSource.close();
			break;
		}

		case 'frame': {
			if (aborted) return;

			// ImageBitmap was rasterised on the main thread (SVG decode
			// requires DOM) and transferred here zero-copy.
			ctx.drawImage(msg.bitmap, 0, 0, canvas.width, canvas.height);
			msg.bitmap.close();

			await videoSource.add(msg.timestamp, msg.duration);
			_self.postMessage({ type: 'frameEncoded' });
			break;
		}

		case 'finalize': {
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
