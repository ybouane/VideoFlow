# VideoFlow

An open-source TypeScript library for building and rendering videos programmatically. Define videos as structured JSON and render them in the browser or on the server.

## Features

- **Flow API** — build videos with a sequential, fluent TypeScript interface
- **JSON model** — compile to a portable JSON format that any renderer can consume
- **Browser rendering** — render entirely client-side using SVG foreignObject + Canvas + MediaBunny
- **Server rendering** — render on Node.js with Playwright + ffmpeg
- **Layer types** — Text, Image, Video, Audio, Captions
- **Keyframe animations** — animate any visual/auditory property with multiple easing functions
- **Parallel timelines** — run animation branches simultaneously
- **Flexible time formats** — seconds, `"5s"`, `"2m"`, `"500ms"`, `"120f"`, `"01:30"`, `"hh:mm:ss:ff"`
- **AbortController support** — cancel renders mid-flight
- **Google Fonts** — load and embed web fonts automatically

## Packages

VideoFlow is a monorepo with three packages:

| Package | Description |
| --- | --- |
| `@videoflow/core` | Flow API, layer classes, JSON compiler, utilities |
| `@videoflow/renderer-browser` | Browser-side renderer (SVG + Canvas + MediaBunny) |
| `@videoflow/renderer-server` | Server-side renderer (Playwright + ffmpeg) |

## Installation

```bash
npm install @videoflow/core
```

For rendering:

```bash
# Browser rendering (client-side)
npm install @videoflow/renderer-browser

# Server rendering (Node.js)
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

// Auto-detects environment (browser vs Node.js) and renders
await $.renderVideo({
  outputType: 'file',
  output: './output.mp4',
  verbose: true,
});
```

### Compile to JSON only

```ts
const json = await $.compile();
console.log(JSON.stringify(json, null, 2));
```

### Render with explicit renderer

```ts
// Server-side (Playwright + ffmpeg)
import VideoRenderer, { closeSharedBrowser } from '@videoflow/renderer-server';
const json = await $.compile();
await VideoRenderer.render(json, { outputType: 'file', output: './output.mp4' });
await closeSharedBrowser();

// Browser-side (SVG + Canvas + MediaBunny)
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
const vid = $.addVideo(
  { fit: 'cover', volume: 0.8 },
  { source: './clip.mp4', duration: '10s' },
  { waitFor: 'finish' },
);
```

### Audio

```ts
const audio = $.addAudio(
  { volume: 0.5 },
  { source: './music.mp3' },
);
```

### Captions

```ts
const caps = $.addCaptions(
  { fontSize: 2, color: '#fff', position: [50, 85] },
  {
    captions: [
      { caption: 'First line.',  startTime: 0, endTime: 2.5 },
      { caption: 'Second line.', startTime: 2.5, endTime: 5 },
    ],
    duration: '5s',
  },
);
```

## Examples

See the [examples/](examples/) folder:

| Example | Description |
| --- | --- |
| [01-basic-text.ts](examples/01-basic-text.ts) | Simple text with fade in/out animation |
| [02-image-background.ts](examples/02-image-background.ts) | Background image with blur animation |
| [03-video-with-audio.ts](examples/03-video-with-audio.ts) | Video layer with background music ducking |
| [04-captions.ts](examples/04-captions.ts) | Time-coded captions overlay |
| [05-parallel-animations.ts](examples/05-parallel-animations.ts) | Staggered parallel animations |
| [06-server-render.ts](examples/06-server-render.ts) | Server-side rendering to MP4 |
| [07-abort-controller.ts](examples/07-abort-controller.ts) | Cancelling a render with AbortController |

Run any example with:

```bash
npx tsx examples/01-basic-text.ts
```

## Building from Source

```bash
git clone <repo-url>
cd VideoFlow
npm install
npm run build
```

## License

Apache-2.0
