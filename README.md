<a href="https://videoflow.dev/">
  <img src="https://videoflow.dev/images/banner.png" alt="VideoFlow — programmatic video for the web" />
</a>

# VideoFlow

[![npm](https://img.shields.io/npm/v/@videoflow/core.svg?label=%40videoflow%2Fcore)](https://www.npmjs.com/package/@videoflow/core)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**Programmatic video for the web.** Define videos with a fluent TypeScript API, compile them to a portable JSON format, and render to MP4 — in the browser, on the server, or play them back live with full scrubbing controls.

> **Try it live:** [videoflow.dev/playground](https://videoflow.dev/playground) · **Docs:** [videoflow.dev](https://videoflow.dev/)

---

## Why VideoFlow?

- **Code your video like a script.** A flow-style API where `wait`, `parallel`, and per-layer `animate` advance a timeline you can read top-to-bottom.
- **One JSON, three renderers.** Compile once, render anywhere — server-side MP4, browser-side MP4, or live DOM playback for editors.
- **Built-in transitions and shader effects.** 25+ enter/exit presets (`slideUp`, `blurResolve`, `glitchResolve`, `typewriter`, `numberCountUp`, …) and a WebGL effect pipeline (`bloom`, `chromaticAberration`, `colorCorrection`, …) — animate any param.
- **Resolution-independent units.** Sizes default to `em` where `1em = 1% of the project width`, so a layout written for 1920×1080 renders identically at 720p or 4K.
- **Editor-ready.** The same JSON model powers a [drop-in React video editor](https://videoflow.dev/react-video-editor) — your code-built videos and your editor scenes share the same format.

---

## Packages

This monorepo publishes four npm packages — install only what you need.

| Package | What it does | Docs |
| --- | --- | --- |
| [`@videoflow/core`](src/core) | Define and compose videos with the fluent API · compile to portable JSON | [Core docs](https://videoflow.dev/core) |
| [`@videoflow/renderer-dom`](src/renderer-dom) | Live preview / scrubbable playback in the browser | [Renderers docs](https://videoflow.dev/renderers) |
| [`@videoflow/renderer-browser`](src/renderer-browser) | Render to MP4 entirely client-side (WebCodecs + MediaBunny) | [Renderers docs](https://videoflow.dev/renderers) |
| [`@videoflow/renderer-server`](src/renderer-server) | Render to MP4 on Node.js via headless Chromium | [Renderers docs](https://videoflow.dev/renderers) |

There's also a separate React component for building visual editors on top of this format → [VideoFlow React Video Editor](https://videoflow.dev/react-video-editor).

---

## Installation

```bash
# Core (always required)
npm install @videoflow/core

# Pick a renderer for your environment:
npm install @videoflow/renderer-server          # Node.js → MP4
npx playwright install chromium                 #   one-time browser download

# or
npm install @videoflow/renderer-browser         # Browser → MP4
npm install @videoflow/renderer-dom             # Browser → live preview
```

`renderVideo()` auto-detects the environment and dynamically imports the matching renderer, so you usually only need to install one alongside `@videoflow/core`.

---

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
  fontSize: 7,
  fontWeight: 800,
  color: '#ffffff',
});

title.animate(
  { opacity: 0, scale: 0.8 },
  { opacity: 1, scale: 1 },
  { duration: '0.8s' },
);
$.wait('1.5s');
title.animate(
  { opacity: 1, scale: 1 },
  { opacity: 0, scale: 1.2 },
  { duration: '0.8s' },
);

// Auto-detects environment and renders to MP4
await $.renderVideo({
  outputType: 'file',
  output: './hello.mp4',
  verbose: true,
});
```

Run it with:

```bash
npx tsx hello.ts
```

### Compile once, render later

`$.compile()` produces a fully self-describing `VideoJSON` you can store, send over the wire, or hand to any VideoFlow renderer:

```ts
const json = await $.compile();
// → { width, height, fps, duration, layers, ... }
```

### Pick a specific renderer

```ts
// Server (Node.js)
import VideoRenderer from '@videoflow/renderer-server';
await VideoRenderer.render(json, { outputType: 'file', output: './out.mp4' });

// Browser (MP4 export)
import VideoRenderer from '@videoflow/renderer-browser';
const blob = await VideoRenderer.render(json);

// Browser (live preview)
import DomRenderer from '@videoflow/renderer-dom';
const player = new DomRenderer(document.getElementById('player'));
await player.loadVideo(json);
await player.play();
```

---

## A taste of the API

```ts
const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30, backgroundColor: '#0a0d18' });

// Background image with a colour-correction sweep
$.addImage(
  {
    fit: 'cover',
    effects: [{ effect: 'colorCorrection', params: { saturation: 1.2, contrast: 1.1 } }],
  },
  { source: './hero.jpg' },
);

// Two text lines that slide in in parallel, hold, then fade out together
const heading = $.addText(
  { text: 'Built with VideoFlow', fontSize: 6, fontWeight: 800 },
  { transitionIn: { transition: 'slideUp', duration: '500ms' } },
);
const sub = $.addText(
  { text: 'Code → JSON → MP4', fontSize: 3, position: [0.5, 0.6], color: '#94a3b8' },
  { transitionIn: { transition: 'slideUp', duration: '500ms' }, startTime: '0.15s' },
);

$.wait('3s');
$.parallel([
  () => heading.fadeOut('500ms'),
  () => sub.fadeOut('500ms'),
]);

await $.renderVideo({ outputType: 'file', output: './out.mp4' });
```

### Group layers

Composite a sub-tree as a single unit. Transitions, animations, and effects on the group apply to the whole composite — child timings are relative to the group's start.

```ts
$.group(
  { position: [0.5, 0.5], scale: 1 },
  { transitionIn: { transition: 'zoom', duration: '600ms' } },
  () => {
    $.addShape({ width: 30, height: 18, fill: '#0e1524', cornerRadius: 2 }, { shapeType: 'rectangle' });
    $.addText({ text: 'CARD', fontSize: 4, fontWeight: 800 });
  },
);
```

### Visual properties at a glance

All visual layers (text, image, video, captions, shape, group) share the same transform / styling vocabulary:

| Property | Type | Default | Notes |
| --- | --- | --- | --- |
| `position` | `[x, y]` or `[x, y, z]` | `[0.5, 0.5]` | Normalised 0–1 of the canvas; `z` adds depth in `em` |
| `scale` | `number` or `[x, y]` | `1` | Uniform or per-axis multiplier |
| `rotation` | `number` or `[x, y, z]` | `0` | Degrees, clockwise. `[x, y, z]` for 3D |
| `anchor` | `[x, y]` | `[0.5, 0.5]` | Normalised pivot inside the element |
| `opacity` | `0–1` | `1` | Animatable |
| `blendMode` | CSS `mix-blend-mode` | `'normal'` | `'multiply'`, `'screen'`, `'difference'`, … |
| `perspective` | `number` (em) | `100` | 3D viewing distance |
| `effects` | `EffectSpec[]` | `[]` | WebGL pipeline; each param animatable via dot-paths |

See [`@videoflow/core`](src/core) for the complete property list (filters, borders, shadows, text styling, audio …) plus the full transition + effect catalogue.

### Time formats

Anywhere a duration or time appears (`startTime`, `duration`, `wait`, `sourceDuration`, …) you can pass a number (seconds) or one of:

| Form | Example | Meaning |
| --- | --- | --- |
| Seconds | `'5s'` | 5 seconds |
| Milliseconds | `'500ms'` | 500 ms |
| Minutes / hours | `'2m'`, `'1h'` | 2 minutes / 1 hour |
| Frames | `'120f'` | 120 frames at the project's fps |
| Timecode | `'01:30'`, `'01:02:30'`, `'01:02:30:15'` | mm:ss / hh:mm:ss / hh:mm:ss:ff |

---

## Examples

The [`examples/`](examples) folder contains 11 runnable scripts that double as a feature tour. Each compiles a project and renders an MP4.

| Example | What it shows |
| --- | --- |
| [01-basic-text.ts](examples/01-basic-text.ts) | `addText` with a fade + scale animation |
| [02-image-background.ts](examples/02-image-background.ts) | Image background with an animated blur |
| [03-video-with-audio.ts](examples/03-video-with-audio.ts) | Video layer + parallel music track |
| [04-captions.ts](examples/04-captions.ts) | Time-coded `addCaptions` overlay |
| [05-parallel-animations.ts](examples/05-parallel-animations.ts) | `$.parallel` with staggered children |
| [06-render-frame-and-audio.ts](examples/06-render-frame-and-audio.ts) | Render a single frame or just the audio |
| [07-abort-controller.ts](examples/07-abort-controller.ts) | Cancel a render mid-flight via `AbortController` |
| [08-transitions.ts](examples/08-transitions.ts) | Built-in transition presets showcase |
| [09-effects.ts](examples/09-effects.ts) | WebGL effects (`bloom`, glitch, frosted glass) |
| [10-groups.ts](examples/10-groups.ts) | Composing sub-trees with shared transitions |
| [11-keyframe-animations.ts](examples/11-keyframe-animations.ts) | Keyframe-driven scale / position / rotation / blur |

```bash
npx tsx examples/01-basic-text.ts
```

---

## Building from source

```bash
git clone https://github.com/ybouane/VideoFlow.git
cd VideoFlow
npm install
npm run build
```

## Resources

- **Website:** [videoflow.dev](https://videoflow.dev/)
- **Live playground:** [videoflow.dev/playground](https://videoflow.dev/playground)
- **Core library docs:** [videoflow.dev/core](https://videoflow.dev/core)
- **Renderers docs:** [videoflow.dev/renderers](https://videoflow.dev/renderers)
- **React Video Editor:** [videoflow.dev/react-video-editor](https://videoflow.dev/react-video-editor)

## License

[Apache-2.0](LICENSE)
