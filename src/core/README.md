<a href="https://videoflow.dev/core">
  <img src="https://videoflow.dev/images/banner.png" alt="VideoFlow Core" />
</a>

# @videoflow/core

[![npm](https://img.shields.io/npm/v/@videoflow/core.svg)](https://www.npmjs.com/package/@videoflow/core)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)

Programmatic video model for [VideoFlow](https://videoflow.dev/). `@videoflow/core` is the foundation everything else is built on:

- A fluent **flow API** (`addText`, `addImage`, `addVideo`, `wait`, `parallel`, `group`, `animate`, …) for describing a video as TypeScript code.
- A portable **JSON video format** (`VideoJSON`) that any VideoFlow renderer can consume.
- A **layer hierarchy** with full property/animation/transition/effect schemas.
- Helpers like time parsing (`'2s'`, `'500ms'`, `'120f'`, `'01:30'`), media probing (auto-detect intrinsic durations), and layer-tree utilities.

> **Live playground:** [videoflow.dev/playground](https://videoflow.dev/playground) · **Full docs:** [videoflow.dev/core](https://videoflow.dev/core)

This package does **not** ship a renderer. Pair it with one of:

- [`@videoflow/renderer-server`](../renderer-server) — Node.js → MP4
- [`@videoflow/renderer-browser`](../renderer-browser) — Browser → MP4
- [`@videoflow/renderer-dom`](../renderer-dom) — Browser → live preview

---

## Installation

```bash
npm install @videoflow/core
```

## Quick Start

```ts
import VideoFlow from '@videoflow/core';

const $ = new VideoFlow({
  width: 1920,
  height: 1080,
  fps: 30,
  name: 'My Video',
});

const title = $.addText({
  text: 'Hello, VideoFlow!',
  fontSize: 7,
  fontWeight: 800,
  color: '#ffffff',
});

title.fadeIn('1s');
$.wait('2s');
title.fadeOut('1s');

// Compile to portable JSON …
const json = await $.compile();

// … or render directly to MP4 (auto-detects environment)
await $.renderVideo({
  outputType: 'file',
  output: './output.mp4',
});
```

---

## How it works

A `VideoFlow` project keeps an internal **flow time pointer**. Every `add*()` call drops a layer onto the timeline at the current pointer. Helpers like `$.wait()` and `$.parallel()` advance it. `$.compile()` walks the project, resolves every relative time (and any auto-detected media durations) into absolute seconds, and emits a self-describing `VideoJSON`:

```
$.addText(...)     ← starts at flow time = 0
$.wait('2s')       ← flow time = 2s
$.addImage(...)    ← starts at flow time = 2s
$.parallel([
  () => layer1.fadeIn('1s'),
  () => layer2.animate(..., { duration: '0.8s' }),
])                ← flow time advances by max(child durations) = 1s
```

The compiled JSON is identical regardless of which renderer you use — code-built videos and editor-built videos share one source of truth.

---

## VideoFlow class

```ts
const $ = new VideoFlow(options?: {
  name?: string;             // Default: 'Untitled Video'
  width?: number;            // Default: 1920
  height?: number;           // Default: 1080
  fps?: number;              // Default: 30
  backgroundColor?: string;  // Default: '#000000'
  autoDetectDurations?: boolean; // Probe video/audio at compile() time. Default: true
  defaults?: {
    easing?: 'step' | 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'; // Default: 'easeInOut'
    fontFamily?: string;     // Default: 'Noto Sans' (auto-loaded from Google Fonts)
  };
  verbose?: boolean;
});
```

### Top-level methods

| Method | Purpose |
| --- | --- |
| `$.addText(props?, settings?, options?)` | Add a text layer |
| `$.addImage(props?, settings?, options?)` | Add an image layer |
| `$.addVideo(props?, settings?, options?)` | Add a video layer (visual + audio) |
| `$.addAudio(props?, settings?, options?)` | Add an audio-only layer |
| `$.addCaptions(props?, settings?, options?)` | Add a timed captions/subtitles layer |
| `$.addShape(props?, settings?, options?)` | Add a vector shape layer (rect / ellipse / polygon / star) |
| `$.group(props?, settings?, builder?, options?)` | Composite a sub-tree as one |
| `$.wait(time)` | Advance the flow pointer |
| `$.parallel([...fns])` | Run animation branches simultaneously |
| `$.compile()` | Compile to `VideoJSON` |
| `$.renderVideo(options?)` | Compile and render (auto-detects environment) |
| `$.renderFrame(frame)` | Compile and render a single frame |
| `$.renderAudio()` | Compile and render the audio track |

### Layer methods

Every layer returned from an `add*()` call exposes:

| Method | Purpose |
| --- | --- |
| `layer.set({ prop: value })` | Set properties at the current flow time |
| `layer.animate(from, to, { duration, easing?, wait?, delay? })` | Tween between two states |
| `layer.fadeIn(duration?, easing?, wait?)` | Animate `opacity` 0 → 1 |
| `layer.fadeOut(duration?, easing?, wait?)` | Animate `opacity` 1 → 0 |
| `layer.show()` / `layer.hide()` | Toggle visibility |
| `layer.remove(options?)` | Remove the layer at the current time, or `{ in: '2s' }` from now |

`{ wait: false }` on `animate()` runs the animation in parallel with the rest of the flow — handy for ambient motion (slow drifts, idle sways) that shouldn't block the timeline.

### `addLayer` options

Every `add*()` accepts an optional third argument:

```ts
{
  waitFor?: Time | 'finish';  // After adding, advance the flow pointer.
                              // 'finish' = the layer's full timeline duration.
  index?: number;             // Position in the layer stack (z-order).
}
```

`$.group(...)` defaults `waitFor` to `'finish'`, so the next call after a group starts when the group ends.

---

## Layer hierarchy

Layers inherit properties through a class hierarchy. Anything declared on a parent applies to every descendant.

```
BaseLayer              → id, timing (startTime, sourceDuration, sourceStart, speed), enabled
 ├── VisualLayer       → opacity, position, scale, rotation, anchor, blendMode,
 │    │                  borders, shadows, filters, perspective, backgroundColor, effects[]
 │    ├── MediaLayer   → source, fit
 │    │    ├── ImageLayer
 │    │    └── VideoLayer (+ volume, pan, pitch, mute)
 │    ├── ShapeLayer   → shapeType, width, height, fill, stroke*, cornerRadius, sides, …
 │    ├── GroupLayer   → children[] (composites a sub-tree as one)
 │    └── TextualLayer → font*, color, textStroke*, textShadow*, letterSpacing, lineHeight, …
 │         ├── TextLayer     (+ text)
 │         └── CaptionsLayer (+ captions[], maxCharsPerLine, maxLines)
 └── AuditoryLayer     → volume, pan, pitch, mute
      └── AudioLayer   → source
```

Common settings accepted by every `add*()`:

```ts
{
  name?: string;
  enabled?: boolean;       // Default: true
  startTime?: Time;        // Default: current flow time
  sourceDuration?: Time;   // Default: source's intrinsic length / until end of timeline
  sourceStart?: Time;      // Skip the first N seconds of the source. Default: 0
  sourceEnd?: Time;        // Trim N seconds off the end (video/audio). Default: 0
  mediaDuration?: Time;    // Auto-detected for video/audio when omitted
  speed?: number;          // Playback speed; -1 plays in reverse. Default: 1
  transitionIn?:  { transition: string; duration?: Time; easing?: Easing; params?: object };
  transitionOut?: { transition: string; duration?: Time; easing?: Easing; params?: object };
}
```

Layers also expose two read-only getters: `timelineDuration` (`sourceDuration / |speed|`) and `endTime` (`startTime + timelineDuration`).

---

## Layer types

### Text

```ts
$.addText(
  {
    text: 'Hello, VideoFlow!',
    fontSize: 6,                 // unitless = em ≈ 6 % of project width
    fontWeight: 800,
    color: '#ffffff',
    fontFamily: 'Inter',         // auto-loaded from Google Fonts
    textAlign: 'center',
    textStroke: true,
    textStrokeWidth: 0.15,
    textStrokeColor: '#000',
  },
  { sourceDuration: '3s' },
);
```

### Image

```ts
$.addImage(
  { fit: 'cover', opacity: 1 },
  { source: 'https://example.com/photo.jpg', sourceDuration: '4s' },
);
```

### Video

```ts
// `mediaDuration` is auto-detected at compile time — `waitFor: 'finish'` works
// without any manual bookkeeping.
$.addVideo(
  { fit: 'cover', volume: 0.8 },
  { source: './clip.mp4', sourceStart: '1s' },
  { waitFor: 'finish' },
);
```

### Audio

```ts
$.addAudio(
  { volume: 0.5 },
  { source: './music.mp3' },     // duration auto-detected
);
```

### Captions

```ts
$.addCaptions(
  {
    fontSize: 3, fontWeight: 700, color: '#fff',
    textStroke: true, textStrokeWidth: 0.15, textStrokeColor: '#000',
    position: [0.5, 0.85],
  },
  {
    captions: [
      { caption: 'First line.',  startTime: 0,    endTime: 2.5 },
      { caption: 'Second line.', startTime: 2.5,  endTime: 5   },
    ],
    sourceDuration: '5s',
  },
);
```

### Shape

```ts
$.addShape(
  {
    width: 30, height: 30,
    fill: '#0e1524',
    strokeColor: '#ff5a1f', strokeWidth: 0.2,
    cornerRadius: 3,
  },
  { shapeType: 'rectangle' },     // or 'ellipse' | 'polygon' | 'star'
);
```

### Group

Composite a sub-tree as one. Group-level `transitionIn` / `transitionOut` / `effects` apply to the whole composite. Child timings are relative to the group's start.

```ts
$.group(
  { position: [0.5, 0.5], perspective: 20 },
  {
    transitionIn:  { transition: 'zoom', duration: '600ms' },
    transitionOut: { transition: 'fade', duration: '500ms' },
  },
  () => {
    $.addShape({ width: 30, height: 30, fill: '#0e1524', cornerRadius: 3 }, { shapeType: 'rectangle' });
    $.addText({ text: '24', fontSize: 8, fontWeight: 900 });
    $.addText({ text: 'BOOKS READ', fontSize: 1.8, position: [0.5, 0.42] });
  },
);
```

`$.group(...)` advances the flow pointer to the group's end (defaults to `waitFor: 'finish'`), so you don't need a `$.wait()` after it. Groups can nest — each level composites independently.

---

## Visual properties

All `VisualLayer` descendants share a unified property vocabulary. **Every property listed below is animatable** unless noted otherwise.

### Sizing convention

Sizing inputs default to `em` and the project root font-size is set so that **`1em = 1% of the project width`**. A layout written with `fontSize: 4` and `borderWidth: 0.2` renders identically at any output resolution. Pass `'24px'` (or `'%'` for `borderRadius`) for absolute units. Rotations are in `deg`, ratios (opacity, scale, multipliers) are unitless.

### Transform

```ts
{
  position: [0.5, 0.5],   // [x, y] or [x, y, z] — normalised 0–1; z is depth in em
  scale:    1,            // number or [x, y] / [x, y, z]
  rotation: 0,            // degrees, or [rx, ry, rz] for 3D
  anchor:   [0.5, 0.5],   // pivot inside the element
  perspective: 100,       // 3D viewing distance, em
}
```

### Opacity / blend / visibility

```ts
{
  opacity: 1,                // 0–1
  visible: true,             // not animatable; flips instantly
  blendMode: 'normal',       // CSS mix-blend-mode; not animatable
  // 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' | 'color-dodge' |
  // 'color-burn' | 'hard-light' | 'soft-light' | 'difference' | 'exclusion' |
  // 'hue' | 'saturation' | 'color' | 'luminosity'
}
```

### Background / border / radius

```ts
{
  backgroundColor: 'transparent',
  borderWidth: 0,           // unitless = em, or [t, r, b, l]
  borderStyle: 'solid',     // 'none'|'solid'|'dashed'|'dotted'|'double'|'groove'|'ridge'|'inset'|'outset'
  borderColor: '#000',
  innerBorder: false,       // box-sizing: border-box for the border
  borderRadius: 0,          // em / '%' / 4-corner array
}
```

### Box shadow / outline

```ts
{
  boxShadow: true,                // toggle to render
  boxShadowColor: '#000',
  boxShadowOffset: [0, 0],
  boxShadowBlur: 0,
  boxShadowSpread: 0,

  outlineWidth: 0,
  outlineStyle: 'none',
  outlineColor: '#000',
  outlineOffset: 0,
}
```

### Filters

CSS filter functions, all animatable:

```ts
{
  filterBlur:       0,   // em
  filterBrightness: 1,
  filterContrast:   1,
  filterGrayscale:  0,   // 0–1
  filterSepia:      0,   // 0–1
  filterInvert:     0,   // 0–1
  filterHueRotate:  0,   // deg
  filterSaturate:   1,
}
```

### Audio properties (`AuditoryLayer` + `VideoLayer`)

```ts
{
  volume: 1,    // 0 = silent, 1 = full
  pan: 0,       // -1 = full left, 1 = full right
  pitch: 1,     // independent from `speed` — 1.5 raises pitch without changing duration
  mute: false,  // not animatable
}
```

---

## Transitions

Attach an enter and/or exit animation to any layer via `transitionIn` / `transitionOut`. The renderer modifies the layer's resolved properties during a bounded window — no manual keyframing. If `transitionIn.duration + transitionOut.duration` exceeds the layer's duration, both are scaled proportionally.

```ts
$.addText(
  { text: 'Hello!', fontSize: 4 },
  {
    sourceDuration: '4s',
    transitionIn:  { transition: 'slideUp',     duration: '600ms', params: { distance: 0.1 } },
    transitionOut: { transition: 'blurResolve', duration: '500ms', params: { amount: 2 } },
  },
);
```

### The signed `p` contract

A preset receives a signed progress value `p ∈ [-1, +1]`:

- `p = -1` — start of the `transitionIn` window
- `p =  0` — layer at rest (preset must be a no-op)
- `p = +1` — end of the `transitionOut` window

Most presets compute `t = 1 - |p|` so the same body produces a symmetric mirror exit. Presets must multiply / add onto incoming property values so they compose with keyframed animation.

### Built-in presets

Each preset is tagged with a `layerCategory` (`'all' | 'visual' | 'audio' | 'textual'`) so editors can filter the picker.

**Universal** (`layerCategory: 'all'`)

| Preset | Effect |
| --- | --- |
| `fade` | Multiplies opacity (visual) and volume (audio) by `t` |

**Visual — CSS-only**

| Preset | Effect | Notable params |
| --- | --- | --- |
| `slideUp` / `slideDown` / `slideLeft` / `slideRight` | Position slide-in with optional fade | `distance?`, `fade?: true` |
| `zoom` | Symmetric scale from `from` → 1 | `from?: 0.85`, `fade?: true` |
| `overshootPop` | Springy scale-in past 1, settles to 1 | `from?: 0.4`, `overshoot?: 1.7`, `tilt?: 6` |
| `rotate3dY` / `tilt3dUp` | 3D swing / tilt into rest | `angle?`, `lift?`, `fade?` |
| `spin` | Spin around Z while scaling | `angle?: 360`, `from?: 0.2`, `direction?` |

**Visual — WebGL-effect-injecting** (preset pushes synthetic effect entries; renderer keeps the per-layer effect overlay mounted)

| Preset | Effect |
| --- | --- |
| `blurResolve` | Heavy Gaussian blur resolves to sharp |
| `motionBlurSlide` | Slide-in with directional motion blur matching velocity |
| `radialZoom` | Radial zoom blur from a centre |
| `glitchResolve` | Digital block + RGB-split glitch |
| `rgbSplitSnap` | Strong RGB split that snaps clean |
| `sliceAssemble` | Layer assembles from offset slices |
| `noiseDissolve` / `burnDissolve` | Noise / fiery dissolve reveal |
| `wipeReveal` / `scanReveal` / `lightSweepReveal` | Linear / scanner / glossy wipes |
| `lensSnap` | Fisheye bulge that settles to flat |

**Textual**

| Preset | Effect | Notable params |
| --- | --- | --- |
| `typewriter` | Reveals one character at a time | `cursorStyle?: 'bar'\|'block'\|'underscore'\|'none'` |
| `trackingExpand` / `trackingContract` | Letter-spacing animates from compressed/expanded into rest | `startTracking?`, `finalTracking?` |
| `scrambleDecode` | Random characters resolve into the final text | `refreshRate?`, `charset?`, `order?` |
| `numberCountUp` | Detects numbers in the text and counts them up | `startValue?`, `formatMode?` |

### Custom presets

```ts
import BrowserRenderer from '@videoflow/renderer-browser';
// (DomRenderer.registerTransition writes to the same shared registry.)

BrowserRenderer.registerTransition('spinIn', (p, properties, params, ctx) => {
  const t = 1 - Math.abs(p);
  properties.rotation = (properties.rotation ?? 0) + (1 - t) * (params.angle ?? 360);
  properties.opacity  = (properties.opacity  ?? 1) * t;
  return properties;
}, { defaultEasing: 'easeOut', layerCategory: 'visual' });
```

---

## GLSL effects

Attach one or more WebGL shader effects to a layer via the `effects` property. Effects run in array order (ping-pong framebuffers), then the layer is composited.

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

// Animate effect params with dot-path keys
img.animate(
  { 'effects.pixelate.size': 48 },
  { 'effects.pixelate.size': 1 },
  { duration: '2s' },
);
```

When the same effect appears more than once, target a specific occurrence with an index: `'effects.pixelate[1].size'`.

### Built-in effects

| Effect | Params |
| --- | --- |
| `chromaticAberration` | `amount` |
| `pixelate` | `size` (px) |
| `vignette` | `strength`, `radius` |
| `rgbSplit` | `angle`, `amount` |
| `invert` | `amount` (0–1) |
| `bloom` | `threshold`, `intensity`, `radius` |
| `colorCorrection` | `exposure`, `contrast`, `saturation`, `temperature`, `tint`, `gamma` |
| `frostedGlass` | `blurRadius`, `distortion`, `frostAmount` |
| `lightSweep` | `progress`, `angle`, `width`, `intensity` |

### Custom effects

```ts
import BrowserRenderer from '@videoflow/renderer-browser';

BrowserRenderer.registerEffect(
  'glitchShift',
  `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
  vec2 shifted = uv + vec2(u_amount * sin(uv.y * 40.0), 0.0);
  return texture2D(tex, shifted);
}`,
  {
    amount: { type: 'float', default: 0.02, min: 0, max: 0.1, animatable: true },
  },
);
```

---

## Animation API

### `animate`

```ts
layer.animate(
  { opacity: 0, scale: 0.8 },     // from
  { opacity: 1, scale: 1   },     // to
  {
    duration: '1s',
    easing?: 'easeOut',
    delay?: '500ms',              // hold the `from` state for this long first
    wait?: true,                  // false = run in parallel with the flow
  },
);
```

### `set` / `fadeIn` / `fadeOut` / `show` / `hide` / `remove`

```ts
layer.set({ opacity: 0.5, scale: 1.2 });
layer.fadeIn('1s', 'easeOut');
layer.fadeOut('1s');
layer.show();
layer.hide();
layer.remove();              // remove at current flow time
layer.remove({ in: '2s' });  // schedule removal 2s from now (no flow advance)
```

### `wait` / `parallel`

```ts
$.wait('2s');
$.wait('60f');           // 60 frames at the project's fps

$.parallel([
  () => layer1.animate({ opacity: 0 }, { opacity: 1 }, { duration: '1s' }),
  () => layer2.fadeOut('1s'),
]);
// Flow advances by max(branch durations).
```

---

## Time formats

Anywhere a time appears (`startTime`, `duration`, `wait(...)`, `sourceDuration`, `kf.time`, …):

| Form | Example | Meaning |
| --- | --- | --- |
| Number | `5` | 5 seconds |
| Seconds | `'5s'` | 5 seconds |
| Milliseconds | `'500ms'` | 500 ms |
| Minutes / hours | `'2m'`, `'1h'` | minutes / hours |
| Frames | `'60f'` | 60 frames at the project's fps |
| Timecode | `'01:30'`, `'01:02:30'`, `'01:02:30:15'` | mm:ss / hh:mm:ss / hh:mm:ss:ff |

Easings: `'step'`, `'linear'`, `'easeIn'`, `'easeOut'`, `'easeInOut'`.

---

## Compile & render

### `compile()`

```ts
const json = await $.compile();
// → { name, width, height, fps, duration, backgroundColor, layers, ... }
```

The result is JSON-serialisable. Pass it to any renderer, save it, or send it over the wire.

### `renderVideo(options?)`

```ts
await $.renderVideo({
  outputType: 'file',        // 'file' | 'buffer' (server) / Blob is returned in browser
  output: './video.mp4',
  verbose: true,
  signal: controller.signal, // AbortSignal — cancel mid-flight
  onProgress: (p) => console.log((p * 100).toFixed(1) + '%'),
});
```

Auto-detects the environment and dynamically imports `@videoflow/renderer-browser` (in the browser) or `@videoflow/renderer-server` (in Node.js). The matching renderer must be installed.

### `renderFrame(frame)` / `renderAudio()`

```ts
const imageData = await $.renderFrame(0);   // Frame 0 → OffscreenCanvas / JPEG Buffer
const audio     = await $.renderAudio();    // AudioBuffer / WAV Buffer (or null)
```

---

## Examples

See [examples/](https://github.com/ybouane/VideoFlow/tree/main/examples) for runnable scripts covering text, media, captions, parallel animations, transitions, effects, groups, and keyframe animations.

```bash
npx tsx examples/01-basic-text.ts
```

## Resources

- [Core docs](https://videoflow.dev/core)
- [Renderers docs](https://videoflow.dev/renderers)
- [Live playground](https://videoflow.dev/playground)
- [React Video Editor](https://videoflow.dev/react-video-editor)

## License

[Apache-2.0](../../LICENSE)
