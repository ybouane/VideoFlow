# @videoflow/core

The core package of [VideoFlow](https://github.com/ybouane/VideoFlow) — define and compose videos programmatically using a fluent TypeScript API, then compile to a portable JSON format.

This is the foundation of VideoFlow. Use it to build your video's layers, animations, and timeline, then hand off the compiled JSON to a renderer.

## Installation

```bash
npm install @videoflow/core
```

## Quick Start

```typescript
import VideoFlow from '@videoflow/core';

// Create a video project
const $ = new VideoFlow({
  width: 1920,
  height: 1080,
  fps: 30,
  name: 'My Video',
});

// Add layers and animate them
const title = $.addText({
  text: 'Hello, VideoFlow!',
  fontSize: 2.5,
  fontWeight: 800,
  color: '#ffffff',
});

title.fadeIn('1s');
$.wait('2s');
title.fadeOut('1s');

// Compile to portable JSON
const videoJSON = await $.compile();

// Or render directly to MP4 (auto-detects environment)
await $.renderVideo({
  outputType: 'file',
  output: './output.mp4',
});
```

## VideoFlow Class

Main entry point for creating videos.

```typescript
const $ = new VideoFlow(options?: {
  name?: string;           // Default: 'Untitled Video'
  width?: number;           // Default: 1920
  height?: number;          // Default: 1080
  fps?: number;             // Default: 30
  backgroundColor?: string; // Default: '#000000'
  autoDetectDurations?: boolean; // Probe video/audio sources at compile() to fill in their duration. Default: true
  verbose?: boolean;        // Default: false
});
```

## Layer Hierarchy

Layers inherit their properties and settings through a class hierarchy. When you use `addText`, `addImage`, etc., your layer gets everything from every parent class:

```
BaseLayer              → id, timing (startTime, sourceDuration, speed, sourceStart), enabled
 ├── VisualLayer       → opacity, position, scale, rotation, anchor, borders, filters, shadows, perspective
 │    ├── MediaLayer   → source, fit
 │    │    ├── ImageLayer
 │    │    └── VideoLayer (+ volume, pan, pitch, mute)
 │    ├── ShapeLayer   → shape, width, height, fill, stroke, strokeWidth, borderRadius
 │    ├── GroupLayer   → children[] — composites a sub-tree of layers as one
 │    └── TextualLayer → font*, color, text stroke / shadow, letterSpacing, lineHeight, …
 │         ├── TextLayer     (+ text)
 │         └── CaptionsLayer (+ captions[], maxCharsPerLine, maxLines)
 └── AuditoryLayer     → volume, pan, pitch, mute
      └── AudioLayer   → source
```

The samples below list **every** property and setting available on each layer type (including inherited ones), with defaults and inline comments.

### Common Settings (all layers)

These settings are accepted by every `add*` call:

```typescript
{
  name?: string,           // Human-readable name, optional
  enabled?: boolean,       // Whether the layer renders at all. Default: true
  startTime?: Time,        // When the layer begins on the timeline. Default: 0
  sourceDuration?: Time,   // How long the layer plays, in source seconds. Default: until end of timeline (or end of source for video/audio)
  sourceStart?: Time,      // Skip the first N seconds of the source. Default: 0
  sourceEnd?: Time,        // Trim N seconds off the end of the source (video/audio only). Default: 0
  mediaDuration?: Time,    // Intrinsic length of the source (video/audio only). Auto-detected when omitted.
  speed?: number,          // Playback speed multiplier. 2 = twice as fast, -1 = reverse. Default: 1
  transitionIn?: {         // Enter transition. Duration defaults to 200ms.
    transition: string,    // Preset name (e.g. 'fade', 'zoom', 'riseFade')
    duration?: Time,       // Transition window. Default: '200ms'
    params?: Record<string, any>, // Preset-specific parameters
  },
  transitionOut?: {        // Exit transition, same shape as transitionIn
    transition: string,
    duration?: Time,
    params?: Record<string, any>,
  },
}
```

Layers also expose two read-only getters:

- `timelineDuration` — how long the layer occupies on the timeline (`sourceDuration / |speed|`).
- `endTime` — `startTime + timelineDuration`.

For `addVideo` / `addAudio`, `mediaDuration` is auto-detected at compile time
(set `autoDetectDurations: false` on the project to opt out). You can also pass
it manually to skip the probe.


`Time` accepts numbers (seconds) or strings like `'2s'`, `'500ms'`, `'60f'`, `'01:30'`. See [Time Format](#time-format).

### addLayer options

All `add*` methods take an optional third argument:

```typescript
{
  waitFor?: Time | 'finish',  // After adding, advance the flow pointer by this much.
                              // 'finish' = wait for the layer's full duration.
  index?: number,             // Insert position in the layer stack (z-order).
}
```

---

### addText — text layer

Renders animated text. Inherits from `TextualLayer` → `VisualLayer` → `BaseLayer`.

```typescript
const title = $.addText(
  {
    // --- TextLayer ---
    text: 'Hello, VideoFlow!',   // Text content. Default: 'Type your text here'

    // --- TextualLayer (typography) ---
    // Sizing defaults to `em`. At the project root, 1em = 1% of project width.
    fontSize: 4,                 // Unitless = em (4em = 4% of project width). Default: 4
    fontFamily: 'Noto Sans',     // Google Font name, auto-loaded. Default: 'Noto Sans'
    fontWeight: 600,             // 100–900 or string. Default: 600
    fontStyle: 'normal',         // 'normal' | 'italic'. Default: 'normal'
    fontStretch: 100,            // In %. Default: 100
    color: '#FFFFFF',            // Text color. Default: '#FFFFFF'
    textAlign: 'center',         // 'left' | 'right' | 'center' | 'justify'. Default: 'center'
    verticalAlign: 'middle',     // 'top' | 'middle' | 'bottom'. Default: 'middle'
    padding: 0,                  // Unitless = em, or [top, right, bottom, left]. Default: 0

    textStroke: false,           // Enable stroke outline around glyphs. Default: false
    textStrokeWidth: 0,          // Stroke width (unitless = em). Default: 0
    textStrokeColor: '#000000',  // Stroke color. Default: '#000000'

    textShadow: false,           // Enable text shadow. Default: false
    textShadowColor: '#000000',  // Shadow color. Default: '#000000'
    textShadowOffset: [0, 0],    // [x, y] (unitless = em). Default: [0, 0]
    textShadowBlur: 0,           // Blur radius (unitless = em). Default: 0

    letterSpacing: '0em',        // In em or px. Default: '0em'
    lineHeight: 1,               // Unitless multiplier of font-size, or em/px. Default: 1
    wordSpacing: 0,              // In em or px. Default: 0
    textIndent: 0,               // First-line indent. Default: 0
    textTransform: 'none',       // 'none' | 'capitalize' | 'uppercase' | 'lowercase'. Default: 'none'
    textDecoration: 'none',      // 'none' | 'underline' | 'overline' | 'line-through'. Default: 'none'
    direction: 'ltr',            // 'ltr' | 'rtl'. Default: 'ltr'

    // --- VisualLayer (see "Visual Properties" below for full list) ---
    visible: true,               // Default: true
    opacity: 1,                  // 0–1. Default: 1
    position: [0.5, 0.5],        // Normalized [x, y]. Default: [0.5, 0.5] (centered)
    scale: 1,                    // Default: 1
    rotation: 0,                 // Degrees. Default: 0
    anchor: [0.5, 0.5],          // Normalized anchor point. Default: [0.5, 0.5]
    // …plus backgroundColor, border*, boxShadow*, outline*, filter*, perspective, effects

    // --- GLSL effects (see "GLSL Effects" section) ---
    effects: [
      { effect: 'pixelate', params: { size: 8 } },
    ],
  },
  {
    // --- Common settings (see above) ---
    startTime: 0,                // Default: 0
    sourceDuration: '3s',        // Default: undefined (runs to end)
    enabled: true,               // Default: true
    transitionIn:  { transition: 'fadeIn', duration: '300ms' },
    transitionOut: { transition: 'fadeIn', duration: '300ms' },
  }
);
```

---

### addImage — image layer

Displays a static image. Inherits from `MediaLayer` → `VisualLayer` → `BaseLayer`.

```typescript
const photo = $.addImage(
  {
    // --- MediaLayer ---
    fit: 'contain',              // 'contain' | 'cover'. Default: 'contain'

    // --- VisualLayer (inherited) ---
    visible: true,               // Default: true
    opacity: 1,                  // 0–1. Default: 1
    position: [0.5, 0.5],        // Normalized [x, y]. Default: centered
    scale: 1,                    // Default: 1
    rotation: 0,                 // Degrees. Default: 0
    anchor: [0.5, 0.5],          // Default: centered
    // …plus backgroundColor, border*, boxShadow*, outline*, filter*, perspective, effects
  },
  {
    source: 'https://example.com/image.jpg', // REQUIRED: URL or file path
    startTime: 0,                // Default: 0
    sourceDuration: '5s',        // Default: undefined
  }
);
```

---

### addVideo — video layer

Plays a video clip with synced audio. Inherits from `MediaLayer` → `VisualLayer` plus auditory properties (`volume`, `pan`, `pitch`, `mute`).

```typescript
const clip = $.addVideo(
  {
    // --- MediaLayer ---
    fit: 'cover',                // 'contain' | 'cover'. Default for video: 'cover'

    // --- Auditory properties ---
    volume: 1,                   // 0 = silent, 1 = full. Default: 1
    pan: 0,                      // -1 = left, 0 = center, 1 = right. Default: 0
    pitch: 1,                    // Pitch multiplier. Default: 1
    mute: false,                 // Silence without affecting volume value. Default: false

    // --- VisualLayer (inherited) ---
    visible: true,               // Default: true
    opacity: 1,                  // Default: 1
    position: [0.5, 0.5],        // Default: centered
    scale: 1,                    // Default: 1
    rotation: 0,                 // Default: 0
    anchor: [0.5, 0.5],          // Default: centered
    // …plus backgroundColor, border*, boxShadow*, outline*, filter*, perspective, effects
  },
  {
    source: './clip.mp4',        // REQUIRED: URL or file path
    startTime: 0,                // Default: 0
    sourceDuration: '10s',       // Default: undefined (plays to end of source)
    sourceStart: 0,              // Skip first N seconds of source. Default: 0
    speed: 1,                    // Default: 1
  },
  {
    waitFor: 'finish',           // Advance flow pointer by the full clip duration
  }
);
```

---

### addAudio — audio layer

Plays an audio track. No visual output. Inherits from `AuditoryLayer` → `BaseLayer`.

```typescript
const music = $.addAudio(
  {
    volume: 1,                   // 0–1. Default: 1
    pan: 0,                      // -1 to 1. Default: 0
    pitch: 1,                    // Pitch multiplier. Default: 1
    mute: false,                 // Default: false
  },
  {
    source: './music.mp3',       // REQUIRED: URL or file path
    startTime: 0,                // Default: 0
    sourceDuration: '30s',       // Default: undefined (plays to end of source)
    sourceStart: 0,              // Default: 0
    speed: 1,                    // Default: 1
  }
);
```

---

### addCaptions — captions / subtitles layer

Displays timed caption entries from a pre-built array. Inherits from `TextualLayer` → `VisualLayer` → `BaseLayer`, so **all** typography and visual properties from `addText` also apply here.

```typescript
const subs = $.addCaptions(
  {
    // --- Typography (same as addText, see TextualLayer properties above) ---
    fontSize: 3,                 // 3em = 3% of project width
    fontFamily: 'Inter',
    fontWeight: 700,
    color: '#FFFFFF',
    textStroke: true,            // Common for readable captions
    textStrokeWidth: 0.15,       // 0.15em — scales with text
    textStrokeColor: '#000000',

    // --- Visual / transform ---
    position: [0.5, 0.85],       // Centered horizontally, near bottom
    // …plus everything from VisualLayer
  },
  {
    // --- CaptionsLayer-specific settings ---
    captions: [
      { caption: 'Hello world',   startTime: 0,   endTime: 2 },
      { caption: 'From VideoFlow', startTime: 2,   endTime: 4 },
    ],                           // REQUIRED. Times are in seconds.
    maxCharsPerLine: 32,         // Wrap captions at this width. Default: 32
    maxLines: 2,                 // Max simultaneous lines. Default: 2

    // --- Common settings ---
    startTime: 0,                // Default: 0
    sourceDuration: '4s',        // Default: undefined
  }
);
```

---

### addShape — vector shape layer

Renders a vector silhouette (rectangle, ellipse, polygon, or star). Inherits from `VisualLayer` → `BaseLayer`.

The choice of silhouette is a **setting** (`shapeType`, fixed for the layer's lifetime). All size/colour/stroke parameters are properties and therefore animatable.

```typescript
const card = $.addShape(
  {
    // --- Shape box (sized in em — `1em = 1% of project width` at root) ---
    width: 50,                   // Default: 100
    height: 30,                  // Default: 100

    // --- Fill / stroke ---
    fill: '#1c2233',             // Default: '#ffffff'. Use 'transparent' for outline-only.
    strokeColor: '#3a4257',      // Default: '#000000'
    strokeWidth: 0.2,            // Default: 0 (no stroke). Animatable.
    strokeAlignment: 'inner',    // 'inner' | 'center' | 'outer'. Default: 'inner'
    strokeDash: 0,               // Dash length in em. 0 = solid. Default: 0
    strokeGap: 0,                // Gap length in em (defaults to strokeDash if 0). Default: 0
    strokeLinejoin: 'miter',     // 'miter' | 'round' | 'bevel'. Default: 'miter'

    // --- Shape-specific ---
    cornerRadius: 1.5,           // Rectangles only. In em. Default: 0
    sides: 6,                    // polygon / star. Integer ≥ 3. Default: 6
    innerRadius: 0.5,            // Stars only. Inner/outer ratio (0..1). Default: 0.5

    // --- VisualLayer (inherited) ---
    position: [0.5, 0.5],
    rotation: 0,
    opacity: 1,
    // …plus border*, boxShadow*, outline*, filter*, perspective, effects
  },
  {
    shapeType: 'rectangle',      // 'rectangle' | 'ellipse' | 'polygon' | 'star'. Default: 'rectangle'
    startTime: 0,
    sourceDuration: '3s',
  }
);
```

---

### $.group — composite a sub-tree as one

Wraps a builder callback whose layers are nested **inside** the returned group. The group itself is a regular visual layer — it has its own `position`, `scale`, `rotation`, `opacity`, `transitionIn`/`transitionOut`, and `effects` — and at render time the group's children are first composited onto a private project-sized surface, then that surface is drawn onto the parent canvas with the group's transform / transitions / effects applied as a single pass.

```typescript
$.group(
  // --- Group properties (same set as VisualLayer: position, scale,
  //     rotation, opacity, filter*, border*, boxShadow*, perspective, effects)
  { position: [0.5, 0.5], scale: 1 },
  // --- Group settings. `startTime` and `sourceDuration` are auto-derived
  //     from the flow position and the children's end times — you typically
  //     do NOT pass them. Override only if you need to.
  {
    transitionIn:  { transition: 'riseFade', duration: '500ms' },
    transitionOut: { transition: 'fadeIn',     duration: '500ms' },
  },
  // --- Builder callback. The flow's time pointer resets to 0 inside,
  //     so child timings are relative to the group's start. The argument
  //     is the group layer itself, so animations attached to the group
  //     as a whole live alongside its children.
  (group) => {
    $.addImage({ fit: 'cover' }, { source: './bg.jpg', sourceDuration: '3s' });
    $.addText({ text: 'Hello' }, { sourceDuration: '3s' });

    $.wait('400ms');                    // 400ms relative to the group's start
    $.addText({ text: 'world' }, { sourceDuration: '2.6s' });

    // Animate the group itself — children come along for the ride.
    group.animate({ scale: 1 }, { scale: 1.04 }, { duration: '3s', wait: false });
  },
  // --- AddLayer options. `waitFor` defaults to 'finish' on groups, so the
  //     next layer added after this call starts when the group ends. Pass a
  //     Time (e.g. '500ms') to add a fixed delay instead.
);
```

Key semantics:

- **Auto timing.** A group's `startTime` defaults to the flow's current time when `$.group(...)` is called, and `sourceDuration` defaults to the end of its latest child. So a group whose last child finishes at +5s lasts 5s — no manual bookkeeping. Pass them explicitly only to override.
- **`waitFor` defaults to `'finish'`.** Unlike `$.addText` / `$.addImage` (which leave the flow pointer where it was), `$.group(...)` advances the outer flow pointer to the group's end. The next layer added after a group call starts when the group ends — `$.wait()` between groups is normally not needed.
- **Relative timing inside the group.** A `wait('1s')` inside the callback advances the **group-local** timeline, not the project timeline. At compile time, child `startTime`s are resolved into absolute project seconds.
- **Group-level transitions and effects.** `transitionIn`, `transitionOut`, and `effects` on the group apply to the composited sub-tree as a whole. Children may also declare their own — those run before the group's pass.
- **Nested groups.** Groups can contain other groups. Each level composites independently; transitions/effects stack outward.
- **DOM preview.** In `DomRenderer`, a group renders as a single `<canvas>` element — children live in a hidden virtual root and never appear in the visible DOM tree.

---

## Visual Properties Reference

Every visual layer (text, image, video, captions) inherits the following from `VisualLayer`. All of these can be passed at creation or via `.set()` / `.animate()`. Most are animatable.

### Unit convention

Sizing properties default to the `em` unit so videos render identically at any
output resolution. VideoFlow sets the project root font-size so that **`1em`
= 1% of the project width** — an unstyled `fontSize: 4` resolves to 4% of the
canvas width (≈ 77px on 1920, ≈ 51px on 1280). Inside a text layer, `em`
follows the standard CSS cascade (relative to that layer's `fontSize`), which
is typically what you want for padding/stroke/shadow *around* text.

Size inputs also accept explicit `px` strings, and `borderRadius` additionally
accepts `%`. Rotations and `filterHueRotate` are in `deg`. Colours are any CSS
colour string. Unitless ratios (opacity, scale, filter multipliers) stay
unitless.

### Transform — position, scale, rotation, anchor

Transforms use **normalized 0–1 coordinates** — not pixels. `[0.5, 0.5]` is always the center.

```typescript
layer.set({
  // Position of the anchor point within the canvas.
  // [0, 0] = top-left, [0.5, 0.5] = center, [1, 1] = bottom-right.
  // Third value (z) is depth in em (1em = 1% of project width). Animatable.
  position: [0.5, 0.5],        // Default: [0.5, 0.5]

  // Scale multiplier relative to the element's natural size.
  // Can be a number (uniform) or [x, y] / [x, y, z]. Animatable.
  scale: 1,                    // Default: 1

  // Rotation in degrees, clockwise. Can be [x, y, z] for 3D rotation. Animatable.
  rotation: 0,                 // Default: 0

  // Which point on the element maps to `position`.
  // [0, 0] = top-left of element, [0.5, 0.5] = center, [1, 1] = bottom-right. Animatable.
  anchor: [0.5, 0.5],          // Default: [0.5, 0.5]

  // 3D perspective distance (unitless = em; 100em = one project-width). Animatable.
  perspective: 100,            // Default: 100
});
```

**Position examples:**

```typescript
layer.set({ position: [0.5, 0.5] });   // Centered
layer.set({ position: [0, 0] });       // Top-left corner
layer.set({ position: [1, 1] });       // Bottom-right corner
layer.set({ position: [0.5, 0.85] });  // Bottom-center (good for captions)
```

### Opacity & visibility

```typescript
layer.animate(
  { opacity: 0, visible: true },
  { opacity: 1 },
  { duration: '1s' }
);
// opacity: 0–1, default 1, animatable
// visible: boolean, default true, NOT animatable (flips instantly)
```

### Blend mode

```typescript
layer.set({
  blendMode: 'multiply', // Any CSS mix-blend-mode value. Default: 'normal'. NOT animatable.
});
// 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten' |
// 'color-dodge' | 'color-burn' | 'hard-light' | 'soft-light' | 'difference' |
// 'exclusion' | 'hue' | 'saturation' | 'color' | 'luminosity'
```

`blendMode` controls how the layer composites against the layers beneath it. The renderer container has `isolation: isolate` so blending stays inside the project canvas.

### Background, border, border-radius

```typescript
layer.set({
  backgroundColor: 'transparent', // Default: 'transparent'. Animatable.
  borderWidth: 0,                 // Unitless = em, or [top, right, bottom, left]. Default: 0. Animatable.
  borderStyle: 'solid',           // 'none'|'solid'|'dashed'|'dotted'|'double'|'groove'|'ridge'|'inset'|'outset'. Default: 'solid'
  borderColor: '#000000',         // Default: '#000000'. Animatable.
  innerBorder: false,             // Draw border inside the layer box (box-sizing: border-box). Default: false
  borderRadius: 0,                // Unitless = em, or '%', or 4-corner array. Default: 0. Animatable.
});
```

### Box shadow

```typescript
layer.set({
  boxShadow: true,                // Must be true to render shadow. Default: false
  boxShadowColor: '#000000',      // Default: '#000000'. Animatable.
  boxShadowOffset: [0, 0],        // [x, y], unitless = em. Default: [0, 0]. Animatable.
  boxShadowBlur: 0,               // Unitless = em. Default: 0. Animatable.
  boxShadowSpread: 0,             // Unitless = em. Default: 0. Animatable.
});
```

### Outline

```typescript
layer.set({
  outlineWidth: 0,                // Unitless = em. Default: 0. Animatable.
  outlineStyle: 'none',           // Same enum as borderStyle. Default: 'none'
  outlineColor: '#000000',        // Default: '#000000'. Animatable.
  outlineOffset: 0,               // Unitless = em. Default: 0. Animatable.
});
```

### Filters (CSS filter functions)

All filters are animatable:

```typescript
layer.animate({ filterBlur: 0 }, { filterBlur: 1 }, { duration: '2s' });

// filterBlur:       unitless = em,   default 0  (1em = 1% of project width at root)
// filterBrightness: multiplier,      default 1  (>1 brighter, <1 darker)
// filterContrast:   multiplier,      default 1
// filterGrayscale:  0–1,             default 0
// filterSepia:      0–1,             default 0
// filterInvert:     0–1,             default 0
// filterHueRotate:  degrees,         default 0
// filterSaturate:   multiplier,      default 1
```

---

## Transitions

Attach an enter and/or exit animation to any layer via `transitionIn` / `transitionOut` in the layer's settings. Transitions modify the layer's resolved properties during a bounded window at the layer's start or end — no manual keyframing required.

```typescript
const title = $.addText(
  { text: 'Hello!', fontSize: 3 },
  {
    sourceDuration: '4s',
    transitionIn:  { transition: 'slideUp',     duration: '600ms', params: { distance: 0.1 } },
    transitionOut: { transition: 'blurResolve', duration: '500ms', params: { amount: 2 } },
  },
);
```

`duration` defaults to `200ms` and accepts any [Time format](#time-format). If the combined in+out duration would exceed the layer's own duration, both are scaled proportionally. Each spec also accepts an `easing` field ([Easing](#easing)) applied to the progress magnitude.

### How `p` works

A transition preset is a pure function that receives a **signed** progress `p ∈ [-1, +1]`:

- `p = -1` — start of the `transitionIn` window (layer fully "transitioned in")
- `p =  0` — layer at rest, original properties (no transition applied)
- `p = +1` — end of the `transitionOut` window (layer fully "transitioned out")

Most presets read `t = stage(p) = 1 - |p|` so the same body produces a symmetric mirror exit on its own. Continuous-motion legacy aliases (`rise`, `riseFade`, `driftLeft`/`driftRight`) use the signed `p` to travel through rest without reversing.

Presets must multiply / add onto incoming property values so they compose with keyframed animation, and must be a no-op at `p = 0`.

### Layer category

Each preset is tagged with a `layerCategory` (`'all' | 'visual' | 'audio' | 'textual'`) so editors can filter the picker by what kind of layer the user is editing. Layer classes carry a matching `static category` value (`VisualLayer.category = 'visual'`, `AuditoryLayer.category = 'audio'`, `TextualLayer.category = 'textual'`).

### Built-in transition presets

**Universal** (`layerCategory: 'all'`)

| Preset | Effect | Params |
| --- | --- | --- |
| `fadeIn` | Multiplies opacity (visual) and volume (audio) by `t`. Works on any layer kind. | — |

**Visual — position / opacity / scale (CSS-only)**

| Preset | Effect | Notable params |
| --- | --- | --- |
| `slideUp` | Enters from below, slides up to rest | `distance?: 0.10`, `fade?: true` |
| `slideDown` | Enters from above, slides down to rest | `distance?: 0.10`, `fade?: true` |
| `slideLeft` | Enters from the right, slides left to rest | `distance?: 0.12`, `fade?: true` |
| `slideRight` | Enters from the left, slides right to rest | `distance?: 0.12`, `fade?: true` |
| `zoomIn` | Scales from `from` up to `1` | `from?: 0.85`, `fade?: true` |
| `overshootPop` | Springy scale-in past 1, settles to 1 | `from?: 0.4`, `overshoot?: 1.7`, `tilt?: 6`, `fade?: true` |
| `rotate3dY` | Y-axis swing into rest | `angle?: 75`, `fade?: true` |
| `tilt3dUp` | X-axis tilt forward into rest | `angle?: 60`, `lift?: 0.04`, `fade?: true` |
| `spinIn` | Spin around Z while scaling up | `angle?: 360`, `from?: 0.2`, `direction?`, `fade?: true` |

**Visual — WebGL-effect-injecting**

These presets push synthetic entries onto `properties.__effects` and the renderer keeps the per-layer effect overlay mounted across the layer's lifetime.

| Preset | Effect | Notable params |
| --- | --- | --- |
| `blurResolve` | Heavy Gaussian blur resolves to sharp | `amount?: 1.5em`, `fade?: true` |
| `motionBlurSlide` | Slide-in with directional motion blur matching velocity | `distance?: 0.18`, `blur?: 4.5em`, `angle?: 0`, `fade?: true` |
| `radialZoom` | Radial zoom blur from a centre | `amount?: 0.4`, `centerX?: 0.5`, `centerY?: 0.5`, `mode?: 'in'\|'out'`, `fade?: true` |
| `glitchResolve` | Digital block + RGB split glitch | `intensity?: 1`, `blockSize?: 1.25em`, `fade?: true` |
| `rgbSplitSnap` | Strong RGB split that snaps to clean | `amount?: 0.04`, `axis?`, `fade?: true` |
| `sliceAssemble` | Layer assembles from offset slices | `sliceCount?: 30`, `offset?: 0.18`, `axis?`, `fade?: true` |
| `noiseDissolve` | Fbm-noise dissolve reveal | `noiseScale?: 8`, `edgeWidth?: 0.04`, `softness?: 0.04`, `edgeColor?` |
| `burnDissolve` | Fiery dissolve with hot embers and ash | `noiseScale?: 6`, `ashAmount?: 0.4`, `burnColor?`, `hotColor?` |
| `wipeReveal` | Linear wipe along an angle | `angle?: 0`, `softness?: 0.03`, `edgeWidth?: 0.02`, `edgeColor?` |
| `scanReveal` | Directional scanner reveal with edge glow + jitter | `angle?: 0`, `bandWidth?: 0.05`, `edgeGlow?: 1.2` |
| `lightSweepReveal` | Wipe with a glossy light band sweeping ahead | `angle?: 30`, `bandWidth?: 0.18`, `sweepColor?`, `intensity?: 1.4` |
| `lensSnap` | Fisheye bulge that settles to flat | `strength?: 0.9`, `radius?: 0.5`, `zoom?: 1`, `fade?: true` |

**Textual — modify the rendered text**

| Preset | Effect | Notable params |
| --- | --- | --- |
| `typewriter` | Reveals one character at a time | `cursorStyle?: 'bar'\|'block'\|'underscore'\|'none'` |
| `trackingExpand` | Text starts compressed and expands into final spacing | `startTracking?: -0.12em`, `finalTracking?: 0`, `startOpacity?: 0`, `blur?: 0.3em` |
| `trackingContract` | Text starts wide and contracts into final spacing | `startTracking?: 0.3em`, others as above |
| `scrambleDecode` | Random characters resolve into final text | `refreshRate?: 15`, `order?`, `charset?`, `preserveSpaces?: true` |
| `numberCountUp` | Detects numbers in the text and counts them up | `startValue?: 0`, `mode?`, `formatMode?`, `rounding?` |

**Legacy aliases** still registered for backward compatibility: `slideUpFade` / `slideLeftFade` / `zoomInFade` (rename), `blur` (CSS-only), `riseFade`, `rise` / `fall` / `driftLeft` / `driftRight` (continuous-motion).

Registering a custom preset: `BrowserRenderer.registerTransition(name, fn, { defaultEasing, layerCategory, injectsEffects, fieldsConfig })` (also available on `DomRenderer`). The registry is shared, so preview and export always agree.

---

## GLSL Effects

Attach one or more WebGL shader effects to a layer via the first-argument `effects` property. Effects run in array order, each pass reading from the previous output (ping-pong framebuffers), before the layer is composited.

```typescript
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
```

The `effects` array is set at creation time and cannot be animated. Individual params, however, **are** animatable via dot-path property keys:

```typescript
// Animate the 'size' param of the first 'pixelate' effect
img.animate(
  { 'effects.pixelate.size': 48 },
  { 'effects.pixelate.size': 1 },
  { duration: '2s' },
);

// When the same effect appears more than once, use an index:
img.animate({}, { 'effects.pixelate[1].size': 4 }, { duration: '1s' });
```

### Built-in effect presets

| Effect | Description | Params |
| --- | --- | --- |
| `chromaticAberration` | Splits RGB channels horizontally | `amount` (default `0.005`) |
| `pixelate` | Pixel mosaic | `size` (pixels, default `8`) |
| `vignette` | Darkened border | `strength` (default `0.6`), `radius` (default `0.8`) |
| `rgbSplit` | Directional chromatic aberration | `angle` (degrees, default `0`), `amount` (default `0.005`) |
| `invert` | Colour inversion | `amount` (0–1, default `1`) |

All params are animatable. Effects are supported in both `BrowserRenderer` (export) and `DomRenderer` (live preview).

---

## Timeline Methods

### wait

Advance the timeline by a duration.

```typescript
$.wait('2s');
$.wait('500ms');
$.wait('60f');  // 60 frames
```

### parallel

Run multiple animation branches simultaneously.

```typescript
$.parallel([
  () => layer1.animate({ opacity: 0 }, { opacity: 1 }, { duration: '1s' }),
  () => layer2.fadeOut('1s'),
  () => { /* custom code */ },
]);
```

### animate

Animate layer properties over time.

```typescript
layer.animate(
  { opacity: 0, scale: 0.8 },      // Start state
  { opacity: 1, scale: 1 },        // End state
  {
    duration: '1.5s',
    easing?: 'easeOut',
    delay?: '500ms',
  }
);
```

### set

Set properties at the current timeline position (no animation).

```typescript
layer.set({
  opacity: 0.5,
  scale: 1.2,
});
```

### fadeIn / fadeOut

Animate opacity to/from 0.

```typescript
layer.fadeIn('1s', 'easeOut');
layer.fadeOut('1s', 'easeOut');
```

### show / hide / remove

Visibility shortcuts.

```typescript
layer.show();   // opacity 1
layer.hide();   // opacity 0
layer.remove(); // Remove at current time
layer.remove({ in: '2s' }); // Remove 2s from now without waiting
```

## Time Format

All time parameters accept flexible formats:

| Format | Example | Result |
|--------|---------|--------|
| Seconds | `'5s'` | 5 seconds |
| Milliseconds | `'500ms'` | 500ms |
| Minutes | `'2m'` | 2 minutes |
| Hours | `'1h'` | 1 hour |
| Frames | `'60f'` | 60 frames at current FPS |
| Timecode | `'01:30'` | 1 min 30 sec |
| Full timecode | `'01:02:30'` | 1 hr 2 min 30 sec |

## Compilation & Rendering

### compile

Convert the video to a portable VideoJSON object. This JSON can be stored, transferred, and rendered later by any VideoFlow renderer.

```typescript
const videoJSON = await $.compile();
// Result: { width, height, fps, duration, layers, ... }
```

### renderVideo

Render the video to MP4 (auto-detects environment).

```typescript
await $.renderVideo({
  outputType: 'file',
  output: './video.mp4',
  verbose?: boolean,
});
```

### renderFrame

Render a single frame.

```typescript
const imageData = await $.renderFrame(0); // Frame 0
```

### renderAudio

Render the full audio track.

```typescript
const audioBuffer = await $.renderAudio();
```

## Examples

See the [`examples/`](https://github.com/ybouane/VideoFlow/tree/main/examples) folder for complete, runnable examples.

## See Also

- [`@videoflow/renderer-dom`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-dom) — Play back and preview VideoFlow videos in the browser
- [`@videoflow/renderer-browser`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-browser) — Render VideoFlow videos to MP4 in the browser
- [`@videoflow/renderer-server`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-server) — Render VideoFlow videos to MP4 on the server

## License

Apache License 2.0
