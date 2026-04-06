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
});
```

## Layer Hierarchy

Layers inherit their properties and settings through a class hierarchy. When you use `addText`, `addImage`, etc., your layer gets everything from every parent class:

```
BaseLayer              → id, timing (startTime, duration, speed, trimStart), enabled
 ├── VisualLayer       → opacity, position, scale, rotation, anchor, borders, filters, shadows, perspective
 │    ├── MediaLayer   → source, fit
 │    │    ├── ImageLayer
 │    │    └── VideoLayer (+ volume, pan, pitch, mute)
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
  name?: string,          // Human-readable name, optional (not persisted if unset)
  enabled?: boolean,      // Whether the layer renders at all. Default: true
  startTime?: Time,       // When the layer enters the timeline. Default: 0
  duration?: Time,        // How long it stays. Default: undefined (runs to end of timeline)
  speed?: number,         // Playback rate multiplier (media layers). Default: 1
  trimStart?: Time,       // Offset into the source before playback starts. Default: 0
}
```

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
    fontSize: 1.0,               // In em (relative to canvas) or px. Default: 1.0
    fontFamily: 'Noto Sans',     // Google Font name, auto-loaded. Default: 'Noto Sans'
    fontWeight: 600,             // 100–900 or string. Default: 600
    fontStyle: 'normal',         // 'normal' | 'italic'. Default: 'normal'
    fontStretch: 100,            // In %. Default: 100
    color: '#FFFFFF',            // Text color. Default: '#FFFFFF'
    textAlign: 'center',         // 'left' | 'right' | 'center' | 'justify'. Default: 'center'
    verticalAlign: 'middle',     // 'top' | 'middle' | 'bottom'. Default: 'middle'
    padding: 0,                  // In px, or [top, right, bottom, left]. Default: 0

    textStroke: false,           // Enable stroke outline around glyphs. Default: false
    textStrokeWidth: 0,          // Stroke width in px. Default: 0
    textStrokeColor: '#000000',  // Stroke color. Default: '#000000'

    textShadow: false,           // Enable text shadow. Default: false
    textShadowColor: '#000000',  // Shadow color. Default: '#000000'
    textShadowOffset: [0, 0],    // [x, y] in px. Default: [0, 0]
    textShadowBlur: 0,           // Blur radius in px. Default: 0

    letterSpacing: '0em',        // In em or px. Default: '0em'
    lineHeight: 1,               // Unitless multiplier, or em/px. Default: 1
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
    // …plus backgroundColor, border*, boxShadow*, outline*, filter*, perspective
  },
  {
    // --- Common settings (see above) ---
    startTime: 0,                // Default: 0
    duration: '3s',              // Default: undefined (runs to end)
    enabled: true,               // Default: true
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
    // …plus backgroundColor, border*, boxShadow*, outline*, filter*, perspective
  },
  {
    source: 'https://example.com/image.jpg', // REQUIRED: URL or file path
    startTime: 0,                // Default: 0
    duration: '5s',              // Default: undefined
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
    // …plus backgroundColor, border*, boxShadow*, outline*, filter*, perspective
  },
  {
    source: './clip.mp4',        // REQUIRED: URL or file path
    startTime: 0,                // Default: 0
    duration: '10s',             // Default: undefined (plays to end of video)
    speed: 1,                    // Playback rate. Default: 1
    trimStart: 0,                // Skip first N seconds of source. Default: 0
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
    duration: '30s',             // Default: undefined
    speed: 1,                    // Default: 1
    trimStart: 0,                // Default: 0
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
    fontSize: 1.2,
    fontFamily: 'Inter',
    fontWeight: 700,
    color: '#FFFFFF',
    textStroke: true,            // Common for readable captions
    textStrokeWidth: 4,
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
    duration: '4s',              // Default: undefined
  }
);
```

---

## Visual Properties Reference

Every visual layer (text, image, video, captions) inherits the following from `VisualLayer`. All of these can be passed at creation or via `.set()` / `.animate()`. Most are animatable.

### Transform — position, scale, rotation, anchor

Transforms use **normalized 0–1 coordinates** — not pixels. `[0.5, 0.5]` is always the center.

```typescript
layer.set({
  // Position of the anchor point within the canvas.
  // [0, 0] = top-left, [0.5, 0.5] = center, [1, 1] = bottom-right.
  // Third value (z) is in px for 3D depth. Animatable.
  position: [0.5, 0.5],        // Default: [0.5, 0.5]

  // Scale multiplier relative to the element's natural size.
  // Can be a number (uniform) or [x, y] / [x, y, z]. Animatable.
  scale: 1,                    // Default: 1

  // Rotation in degrees, clockwise. Can be [x, y, z] for 3D rotation. Animatable.
  rotation: 0,                 // Default: 0

  // Which point on the element maps to `position`.
  // [0, 0] = top-left of element, [0.5, 0.5] = center, [1, 1] = bottom-right. Animatable.
  anchor: [0.5, 0.5],          // Default: [0.5, 0.5]

  // 3D perspective distance in px (how strong 3D rotations look). Animatable.
  perspective: 2000,           // Default: 2000
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

### Background, border, border-radius

```typescript
layer.set({
  backgroundColor: 'transparent', // Default: 'transparent'. Animatable.
  borderWidth: 0,                 // In px, or [top, right, bottom, left]. Default: 0. Animatable.
  borderStyle: 'solid',           // 'none'|'solid'|'dashed'|'dotted'|'double'|'groove'|'ridge'|'inset'|'outset'. Default: 'solid'
  borderColor: '#000000',         // Default: '#000000'. Animatable.
  outerBorder: false,             // Draw border outside instead of inside. Default: false
  borderRadius: 0,                // In px or %, or 4-corner array. Default: 0. Animatable.
});
```

### Box shadow

```typescript
layer.set({
  boxShadow: true,                // Must be true to render shadow. Default: false
  boxShadowColor: '#000000',      // Default: '#000000'. Animatable.
  boxShadowOffset: [0, 0],        // [x, y] in px. Default: [0, 0]. Animatable.
  boxShadowBlur: 0,               // In px. Default: 0. Animatable.
  boxShadowSpread: 0,             // In px. Default: 0. Animatable.
});
```

### Outline

```typescript
layer.set({
  outlineWidth: 0,                // In px. Default: 0. Animatable.
  outlineStyle: 'none',           // Same enum as borderStyle. Default: 'none'
  outlineColor: '#000000',        // Default: '#000000'. Animatable.
  outlineOffset: 0,               // In px. Default: 0. Animatable.
});
```

### Filters (CSS filter functions)

All filters are animatable:

```typescript
layer.animate({ filterBlur: 0 }, { filterBlur: 20 }, { duration: '2s' });

// filterBlur:       px,              default 0
// filterBrightness: multiplier,      default 1 (>1 brighter, <1 darker)
// filterContrast:   multiplier,      default 1
// filterGrayscale:  0–1,             default 0
// filterSepia:      0–1,             default 0
// filterInvert:     0–1,             default 0
// filterHueRotate:  degrees,         default 0
// filterSaturate:   multiplier,      default 1
```

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
