# VideoFlow

An open-source TypeScript library for generating videos programmatically. Define videos with a fluent API, compile to a portable JSON format, and render to MP4 — in the browser or on the server.

## Features

- **Fluent API** — build videos with a sequential, chainable TypeScript interface
- **JSON video format** — compile to a portable JSON model that any renderer can consume
- **Browser & server rendering** — render to MP4 client-side or server-side
- **Layer types** — Text, Image, Video, Audio, Captions, Shape, Group
- **Groups** — composite multiple layers into a single visual unit; transitions, effects, and animations apply to the whole composite
- **Keyframe animations** — animate any visual/auditory property with multiple easing functions
- **Transitions** — attach built-in (or custom) enter/exit presets to any layer via `transitionIn` / `transitionOut` settings
- **GLSL effects** — apply WebGL shader effects (pixelate, chromatic aberration, vignette, …) to individual layers; effect params are animatable
- **Parallel timelines** — run animation branches simultaneously
- **Flexible time formats** — seconds, `"5s"`, `"2m"`, `"500ms"`, `"120f"`, `"01:30"`, `"hh:mm:ss:ff"`
- **AbortController support** — cancel renders mid-flight
- **Google Fonts** — load and embed web fonts automatically using a bundled registry for reliable URL construction

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
- `$.addShape(properties?, settings?, options?)` — add a shape layer
- `$.group(properties?, settings?, fn?, options?)` — composite a sub-tree of layers as a single unit
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
| `position` | `[x, y]` or `[x, y, z]` | `[0.5, 0.5]` | `x`/`y` normalised 0–1 of the canvas. `[0, 0]` = top-left, `[0.5, 0.5]` = centre. Optional `z` is depth in `em` (1em = 1% of project width) |
| `scale` | `number` or `[x, y]` | `1` | Multiplier. `1` = natural size, `0.5` = half, `2` = double |
| `rotation` | `number` or `[x, y, z]` | `0` | Degrees, clockwise. Use `[x, y, z]` for 3D rotation |
| `anchor` | `[x, y]` | `[0.5, 0.5]` | Normalised 0–1 within the element. Pivot for position, scale, and rotation |
| `opacity` | `number` | `1` | 0 (transparent) to 1 (opaque) |
| `perspective` | `number` | `100` | 3D viewing distance in `em` (1em = 1% of project width) |

### Unit convention

Sizing properties (`fontSize`, `borderWidth`, `boxShadowBlur`, `filterBlur`, `perspective`, …) accept unitless numbers that default to `em`. VideoFlow sets the project root font-size so that **`1em` = 1% of the project width**, so an unstyled `fontSize: 4` resolves to 4% of the canvas width (≈ 77px on 1920, ≈ 51px on 1280) and renders identically at any output resolution. You can still pass `px` (or `%` for `borderRadius`) when you need absolute values.

See [`@videoflow/core` README](https://github.com/ybouane/VideoFlow/tree/main/src/core) for the full list of visual properties (filters, borders, shadows, etc.).

## Transitions

Attach an enter and/or exit animation to any layer using `transitionIn` and `transitionOut` in the layer's settings. No manual keyframing required.

```ts
const title = $.addText(
  { text: 'Hello!', fontSize: 3, color: '#fff' },
  {
    sourceDuration: '3s',
    transitionIn:  { transition: 'riseFade', duration: '500ms' },
    transitionOut: { transition: 'blur',     duration: '500ms', params: { amount: 8 } },
  },
);
```

The `duration` defaults to `200ms` and accepts any [Time format](#time-formats). If `transitionIn.duration + transitionOut.duration` would exceed the layer's own duration, both are scaled proportionally. Each spec also accepts an `easing` field (e.g. `'easeInOut'`) to override the preset's default curve for that direction only.

### How `p` works

Presets receive a signed progress parameter `p ∈ [-1, +1]`:

- `p = -1` — start of the `transitionIn` window (layer fully "transitioned in")
- `p =  0` — layer at rest, original properties
- `p = +1` — end of the `transitionOut` window (layer fully "transitioned out")

`p` is continuous across the layer's life, which gives you two useful modes:

- **Symmetric** presets use `|p|` — the layer does the same thing on enter and exit (`fade`: `opacity *= (1 - |p|)`).
- **Asymmetric** presets use the sign of `p` — the layer moves *through* rest without reversing. `rise` starts below its resting position, rises through rest, and keeps rising above rest on exit: one pattern, no snap-back.

### Built-in transition presets

| Name | Kind | Effect | Params |
| --- | --- | --- | --- |
| `fade` | symmetric | Opacity `0` at `|p| = 1`, `1` at rest | — |
| `zoom` | symmetric | Scale through rest from `from` at `|p| = 1` | `from?: number` (default `0.8`) |
| `blur` | symmetric | Gaussian blur peaks at `|p| = 1` | `amount?: number` (peak blur in `em`, default `4`) |
| `rise` | continuous | Continuously moves upward through rest | `distance?: number` (fraction of canvas, default `0.15`) |
| `fall` | continuous | Continuously moves downward through rest | `distance?: number` |
| `driftLeft` | continuous | Continuously moves leftward through rest | `distance?: number` |
| `driftRight` | continuous | Continuously moves rightward through rest | `distance?: number` |
| `slideFromTop` | symmetric | Enters from and exits to the top | `distance?: number` (default `0.15`) |
| `slideFromBottom` | symmetric | Enters from and exits to the bottom | `distance?: number` |
| `slideFromLeft` | symmetric | Enters from and exits to the left | `distance?: number` |
| `slideFromRight` | symmetric | Enters from and exits to the right | `distance?: number` |
| `riseFade` | composite | `rise` + `fade` — rises continuously while fading | `distance?: number` (default `0.08`) |

Transitions work in both `BrowserRenderer` (export) and `DomRenderer` (live preview). Custom presets can be registered with `BrowserRenderer.registerTransition(name, fn)`.

## Groups

Wrap any sub-tree of layers in `$.group(...)` to composite them as a single visual unit. The group itself is a layer — it accepts the same visual properties (position, scale, rotation, opacity, filters), the same `transitionIn` / `transitionOut`, and the same `effects` array as a normal layer. Anything declared inside the group's builder callback becomes a child of the group; their flow timing is **relative to the group's start**.

```ts
const card = $.group(
  { position: [0.5, 0.5], scale: 1 },
  {
    transitionIn:  { transition: 'riseFade', duration: '500ms' },
    transitionOut: { transition: 'fade',     duration: '500ms' },
  },
  (group) => {
    // Child timings are relative to the group's start, so this image
    // begins at the start of the group, not project time 0.
    $.addImage({ fit: 'cover', opacity: 0.6 }, { source: './bg.jpg', sourceDuration: '3s' });
    $.addText({ text: 'Hello', fontSize: 4 }, { sourceDuration: '3s' });

    // Animate the group itself — children come along for the ride.
    group.animate({ scale: 1 }, { scale: 1.04 }, { duration: '3s', wait: false });
  },
);
```

How groups behave:

- **Auto timing** — like every other layer, the group's `startTime` defaults to the current flow time, and its `sourceDuration` defaults to the latest child's end (so a group whose last child finishes at +5s lasts 5s). Pass `startTime` / `sourceDuration` explicitly only if you need to override.
- **Composite as one** — children are rendered into a project-sized off-screen surface, then the surface is drawn onto the final canvas with the group's transform / opacity / filters / transitions / effects applied as a single pass.
- **Relative timing** — `$.wait('400ms')` *inside* the builder advances the group's local timeline, not the project timeline.
- **Group-level transitions and effects** — `transitionIn` / `transitionOut` and `effects` on the group apply to the whole composite (e.g. one fade for the whole card), not to each child individually. Children may also have their own transitions and effects, which run before the group's pass.
- **Flow advance** — `$.group(...)` advances the outer flow pointer to the group's end, the same way `$.parallel()` advances to the longest branch. The next layer added after a group starts when the group ends — no `$.wait()` needed in between.
- **Nesting is supported** — groups can contain other groups; each level composites independently.
- **DOM preview** — in `DomRenderer`, groups render to a `<canvas>` element at the top of the rendered DOM. Child layers live in a hidden virtual root and never appear in the visible DOM tree.

## GLSL Effects

Attach one or more WebGL shader effects to a layer via the `effects` property. Effects run in array order, each pass reading from the previous result (ping-pong framebuffers), before the layer is composited.

```ts
const img = $.addImage(
  {
    fit: 'cover',
    effects: [
      { effect: 'pixelate',            params: { size: 48 } },
      { effect: 'chromaticAberration', params: { amount: 0.004 } },
      { effect: 'vignette',            params: { strength: 0.7, radius: 0.75 } },
    ],
  },
  { source: './photo.jpg', sourceDuration: '4s' },
);

// Animate an effect param with dot-path notation
img.animate(
  { 'effects.pixelate.size': 48 },
  { 'effects.pixelate.size': 1 },
  { duration: '2s' },
);
```

When the same effect appears more than once, use an index to target a specific occurrence:
`'effects.pixelate[1].size'` targets the second `pixelate` entry.

### Built-in effect presets

| Name | Effect | Params |
| --- | --- | --- |
| `chromaticAberration` | RGB channel split | `amount` (default `0.005`) |
| `pixelate` | Pixel mosaic | `size` (pixels, default `8`) |
| `vignette` | Darkened border vignette | `strength` (default `0.6`), `radius` (default `0.8`) |
| `rgbSplit` | Directional chromatic aberration | `angle` (degrees), `amount` (default `0.005`) |
| `invert` | Colour inversion | `amount` (0–1, default `1`) |

All params listed above are animatable. Effects work in both `BrowserRenderer` and `DomRenderer`. Custom effects can be registered with `BrowserRenderer.registerEffect(name, glsl, params)`.

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
| [08-transitions.ts](https://github.com/ybouane/VideoFlow/tree/main/examples/08-transitions.ts) | Built-in transition presets (fade, zoom, blur, rise/fall, driftLeft/Right, slideFromX, riseFade) |
| [09-effects.ts](https://github.com/ybouane/VideoFlow/tree/main/examples/09-effects.ts) | GLSL effects with animated params (pixelate, chromatic aberration, vignette) |
| [10-groups.ts](https://github.com/ybouane/VideoFlow/tree/main/examples/10-groups.ts) | Layer groups — composite layers as one with shared transitions, animations, and nested groups |

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
