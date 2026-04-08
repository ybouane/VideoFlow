# VideoFlow

An open-source TypeScript library for generating videos programmatically. Define videos with a fluent API, compile to a portable JSON format, and render to MP4 — in the browser or on the server.

## Features

- **Fluent API** — build videos with a sequential, chainable TypeScript interface
- **JSON video format** — compile to a portable JSON model that any renderer can consume
- **Browser & server rendering** — render to MP4 client-side or server-side
- **Layer types** — Text, Image, Video, Audio, Captions
- **Keyframe animations** — animate any visual/auditory property with multiple easing functions
- **Parallel timelines** — run animation branches simultaneously
- **Flexible time formats** — seconds, `"5s"`, `"2m"`, `"500ms"`, `"120f"`, `"01:30"`, `"hh:mm:ss:ff"`
- **AbortController support** — cancel renders mid-flight
- **Google Fonts** — load and embed web fonts automatically

## Packages

| Package | Description |
| --- | --- |
| [`@videoflow/core`](https://github.com/ybouane/VideoFlow/tree/main/src/core) | Define and compose videos programmatically using the fluent API |
| [`@videoflow/renderer-dom`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-dom) | Play back and preview VideoFlow videos interactively in the browser |
| [`@videoflow/renderer-browser`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-browser) | Render VideoFlow videos to MP4 files in the browser |
| [`@videoflow/renderer-server`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-server) | Render VideoFlow videos to MP4 files on the server (Node.js) |

## Installation

```bash
npm install @videoflow/core
```

Then install a renderer for your target environment:

```bash
# Render in the browser
npm install @videoflow/renderer-browser

# Preview/play back in the browser
npm install @videoflow/renderer-dom

# Render on the server (Node.js)
npm install @videoflow/renderer-server
npx playwright install chromium
```

## Quick Start

```ts
import VideoFlow from '@videoflow/core';

const $ = new VideoFlow({
  name: 'My Video',
  width: 1920,
  height: 1080,
  fps: 30,
});

const title = $.addText({
  text: 'Hello, VideoFlow!',
  fontSize: 2.5,
  fontWeight: 800,
  color: '#ffffff',
});

title.fadeIn('1s');
$.wait('3s');
title.fadeOut('1s');
$.wait('500ms');

// Auto-detects environment and renders to MP4
await $.renderVideo({
  outputType: 'file',
  output: './output.mp4',
  verbose: true,
});
```

### Compile to JSON

You can compile your video to a portable JSON object without rendering. This JSON can be stored, transferred, and rendered later by any VideoFlow renderer.

```ts
const json = await $.compile();
console.log(JSON.stringify(json, null, 2));
```

### Render with a specific renderer

```ts
// Server
import VideoRenderer from '@videoflow/renderer-server';
const json = await $.compile();
await VideoRenderer.render(json, { outputType: 'file', output: './output.mp4' });

// Browser
import VideoRenderer from '@videoflow/renderer-browser';
const json = await $.compile();
const blob = await VideoRenderer.render(json);
```

## API Overview

### VideoFlow

```ts
const $ = new VideoFlow(settings?: ProjectSettings);
```

**Settings:**
- `name` — project name (default: `'Untitled Video'`)
- `width` / `height` — canvas dimensions (default: `1920` x `1080`)
- `fps` — frames per second (default: `30`)
- `backgroundColor` — background color (default: `'#000000'` black)
- `defaults.easing` — default animation easing (default: `'easeInOut'`)
- `defaults.fontFamily` — default font family (default: `'Noto Sans'`)

**Methods:**
- `$.addText(properties?, settings?, options?)` — add a text layer
- `$.addImage(properties?, settings?, options?)` — add an image layer
- `$.addVideo(properties?, settings?, options?)` — add a video layer
- `$.addAudio(properties?, settings?, options?)` — add an audio layer
- `$.addCaptions(properties?, settings?, options?)` — add a captions layer
- `$.wait(time)` — advance the timeline
- `$.parallel([...fns])` — run animation branches simultaneously
- `$.compile()` — compile to `VideoJSON`
- `$.renderVideo(options?)` — compile and render (auto-detects environment)
- `$.renderFrame(frame)` — compile and render a single frame
- `$.renderAudio()` — compile and render the full audio track

### Layer Methods

Every layer returned by `addText()`, `addImage()`, etc. supports:

- `layer.set({ prop: value })` — set properties at the current time
- `layer.animate(from, to, { duration, easing?, wait? })` — animate between states
- `layer.fadeIn(duration?, easing?, wait?)` — fade in from transparent
- `layer.fadeOut(duration?, easing?, wait?)` — fade out to transparent
- `layer.show()` / `layer.hide()` — toggle visibility
- `layer.remove()` — remove the layer at the current time

### Time Formats

All time parameters accept flexible formats:

| Format | Example | Meaning |
| --- | --- | --- |
| Number | `5` | 5 seconds |
| Seconds | `"5s"` | 5 seconds |
| Milliseconds | `"500ms"` | 500 milliseconds |
| Minutes | `"2m"` | 2 minutes |
| Hours | `"1h"` | 1 hour |
| Frames | `"120f"` | 120 frames |
| mm:ss | `"01:30"` | 1 min 30 sec |
| hh:mm:ss | `"01:02:30"` | 1 hr 2 min 30 sec |
| hh:mm:ss:ff | `"01:02:30:15"` | with frame offset |

### Easing Functions

`'step'`, `'linear'`, `'easeIn'`, `'easeOut'`, `'easeInOut'`

### Visual Properties

All visual layers (text, image, video, captions) share these transform properties:

| Property | Type | Default | Description |
| --- | --- | --- | --- |
| `position` | `[x, y]` | `[0.5, 0.5]` | Normalized 0–1. `[0, 0]` = top-left, `[0.5, 0.5]` = center, `[1, 1]` = bottom-right |
| `scale` | `number` or `[x, y]` | `1` | Multiplier. `1` = natural size, `0.5` = half, `2` = double |
| `rotation` | `number` or `[x, y, z]` | `0` | Degrees, clockwise. Use `[x, y, z]` for 3D rotation |
| `anchor` | `[x, y]` | `[0.5, 0.5]` | Normalized 0–1 within the element. Point around which position, scale, and rotation are applied |
| `opacity` | `number` | `1` | 0 (transparent) to 1 (opaque) |
| `perspective` | `number` | `2000` | Distance in pixels for 3D transforms |

See [`@videoflow/core` README](https://github.com/ybouane/VideoFlow/tree/main/src/core) for the full list of visual properties (filters, borders, shadows, etc.).

## Layer Types

### Text

```ts
const text = $.addText({
  text: 'Hello!',
  fontSize: 2,
  fontWeight: 700,
  color: '#fff',
  fontFamily: 'Inter',
  textAlign: 'center',
});
```

### Image

```ts
const img = $.addImage(
  { fit: 'cover', opacity: 1 },
  { source: 'https://example.com/photo.jpg' },
);
```

### Video

```ts
// `compile()` probes the source's intrinsic length automatically
// (autoDetectDurations is on by default), so you can rely on
// `waitFor: 'finish'` without supplying a `sourceDuration` manually.
const vid = $.addVideo(
  { fit: 'cover', volume: 0.8 },
  { source: './clip.mp4', sourceStart: '1s', sourceEnd: '2s' },
  { waitFor: 'finish' },
);
```

### Audio

```ts
const audio = $.addAudio(
  { volume: 0.5 },
  { source: './music.mp3' }, // duration auto-detected at compile time
);
```

### Captions

```ts
const caps = $.addCaptions(
  { fontSize: 2, color: '#fff', position: [0.5, 0.85] },
  {
    captions: [
      { caption: 'First line.',  startTime: 0, endTime: 2.5 },
      { caption: 'Second line.', startTime: 2.5, endTime: 5 },
    ],
    sourceDuration: '5s',
  },
);
```

### Time Properties

Every layer accepts these timing settings:

| Setting | Description |
| --- | --- |
| `startTime` | When the layer begins on the timeline. Default: `0`. |
| `sourceDuration` | How long the layer plays, in source seconds. Defaults to the source's intrinsic length (video/audio) or until the timeline advances. |
| `sourceStart` | Skip the first N seconds of the source. Default: `0`. |
| `sourceEnd` | Trim N seconds off the end of the source (video/audio). Default: `0`. |
| `mediaDuration` | Intrinsic length of the source. Auto-detected for video/audio. |
| `speed` | Playback speed multiplier. `2` plays twice as fast, `-1` plays in reverse. Default: `1`. |

Layers also expose two read-only getters:

- `timelineDuration` — how long the layer occupies on the timeline (`sourceDuration / |speed|`).
- `endTime` — `startTime + timelineDuration`.

## Examples

See the [examples/](https://github.com/ybouane/VideoFlow/tree/main/examples) folder:

| Example | Description |
| --- | --- |
| [01-basic-text.ts](https://github.com/ybouane/VideoFlow/tree/main/examples/01-basic-text.ts) | Simple text with fade in/out animation |
| [02-image-background.ts](https://github.com/ybouane/VideoFlow/tree/main/examples/02-image-background.ts) | Background image with blur animation |
| [03-video-with-audio.ts](https://github.com/ybouane/VideoFlow/tree/main/examples/03-video-with-audio.ts) | Video layer with background music ducking |
| [04-captions.ts](https://github.com/ybouane/VideoFlow/tree/main/examples/04-captions.ts) | Time-coded captions overlay |
| [05-parallel-animations.ts](https://github.com/ybouane/VideoFlow/tree/main/examples/05-parallel-animations.ts) | Staggered parallel animations |
| [06-render-frame-and-audio.ts](https://github.com/ybouane/VideoFlow/tree/main/examples/06-render-frame-and-audio.ts) | Render a single frame or audio track |
| [07-abort-controller.ts](https://github.com/ybouane/VideoFlow/tree/main/examples/07-abort-controller.ts) | Cancelling a render with AbortController |

Run any example with:

```bash
npx tsx examples/01-basic-text.ts
```

## Building from Source

```bash
git clone https://github.com/ybouane/VideoFlow.git
cd VideoFlow
npm install
npm run build
```

## License

Apache-2.0
