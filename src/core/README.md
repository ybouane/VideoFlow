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

## Layer Methods

### addText

Create a text layer.

```typescript
$.addText(
  properties: {
    text: string;          // Text content (default: 'Type your text here')
    fontSize?: number;     // In em or px (default: 1.0)
    fontFamily?: string;   // Font name (default: 'Noto Sans')
    fontWeight?: number;   // Weight (default: 600)
    fontStyle?: 'normal' | 'italic'; // (default: 'normal')
    color?: string;        // Hex color (default: '#FFFFFF')
    textAlign?: 'left' | 'right' | 'center' | 'justify'; // (default: 'center')
    verticalAlign?: 'top' | 'middle' | 'bottom'; // (default: 'middle')
    // Plus all visual properties (position, scale, opacity, etc.)
  },
  settings?: {
    // Layer timing
    startTime?: number;
    duration?: number;
    speed?: number;
    trimStart?: number;
    enabled?: boolean;
  }
);
```

### addImage

Create an image layer.

```typescript
$.addImage(
  properties: {
    fit?: 'contain' | 'cover'; // (default: 'contain')
    // Plus all visual properties (position, scale, opacity, etc.)
  },
  settings: {
    source: string; // Image URL or path (required)
    // Plus common layer settings
  }
);
```

### addVideo

Create a video layer.

```typescript
$.addVideo(
  properties: {
    fit?: 'contain' | 'cover'; // (default: 'contain')
    volume?: number; // 0-1 (default: 1)
    // Plus all visual properties
  },
  settings: {
    source: string;  // Video URL (required)
    duration?: string; // Max duration
    // Plus common layer settings
  },
  options?: {
    waitFor?: 'finish' | 'none'; // Wait for video to end before continuing timeline
  }
);
```

### addAudio

Create an audio layer.

```typescript
$.addAudio(
  properties: {
    volume?: number; // 0-1 (default: 1)
    pan?: number;    // -1 to 1 (default: 0)
  },
  settings: {
    source: string; // Audio URL (required)
    // Plus common layer settings
  }
);
```

### addCaptions

Create a captions/subtitles layer.

```typescript
$.addCaptions(
  properties: {
    fontSize?: number;
    fontFamily?: string;
    color?: string;
    // Plus all visual properties
  },
  settings: {
    captions: Array<{
      caption: string;    // Text content
      startTime: number;  // Start time in seconds
      endTime: number;    // End time in seconds
    }>;
    maxCharsPerLine?: number; // Word wrap length
    maxLines?: number; // Max lines per caption
    duration?: string;
    // Plus common layer settings
  }
);
```

## Visual Properties (All Layers)

Available on all visual layers (text, image, video, captions):

### Position, Scale, Rotation & Anchor

These are the core transform properties. They use **normalized coordinates** — values from `0` to `1` represent relative positions within the canvas or element.

```typescript
layer.set({
  // Position — [x, y] normalized to the canvas dimensions
  // [0, 0] = top-left corner, [0.5, 0.5] = center, [1, 1] = bottom-right
  position: [0.5, 0.5],  // default: centered

  // Scale — multiplier relative to the element's natural size
  // For images/videos: 1 = sized to fill the canvas width (respecting fit mode)
  // For text: 1 = normal size, 2 = double size
  // Can also be [x, y] or [x, y, z] for per-axis scaling
  scale: 1,              // default: 1

  // Rotation — in degrees, clockwise
  // Can also be [x, y, z] for 3D rotation (rotateX, rotateY, rotateZ)
  rotation: 0,           // default: 0

  // Anchor — [x, y] normalized to the element's own dimensions
  // Determines the point around which the element is positioned, scaled, and rotated
  // [0, 0] = top-left of element, [0.5, 0.5] = center, [1, 1] = bottom-right
  anchor: [0.5, 0.5],   // default: centered

  // Perspective — distance from the viewer for 3D transforms, in pixels
  perspective: 2000,     // default: 2000 (px)
});
```

**Position examples:**

```typescript
layer.set({ position: [0.5, 0.5] });   // Centered (default)
layer.set({ position: [0, 0] });       // Top-left corner
layer.set({ position: [1, 1] });       // Bottom-right corner
layer.set({ position: [0.5, 0.85] });  // Centered horizontally, near bottom (good for captions)
layer.set({ position: [0.25, 0.5] });  // Left quarter, vertically centered
```

**Scale examples:**

```typescript
layer.set({ scale: 1 });               // Normal size (default)
layer.set({ scale: 0.5 });             // Half size
layer.set({ scale: 2 });               // Double size
layer.set({ scale: [1.5, 1] });        // Stretched horizontally
```

### Other Visual Properties

```typescript
layer.animate({
  // Opacity & Visibility
  opacity?: number;             // 0–1, default 1
  visible?: boolean;            // default true

  // Background
  backgroundColor?: string;     // Hex color, default 'transparent'

  // Border
  borderWidth?: number;         // Pixels, default 0
  borderStyle?: string;         // CSS border style, default 'solid'
  borderColor?: string;         // Hex color, default '#000000'
  borderRadius?: number;        // Pixels (or %), default 0

  // Box Shadow
  boxShadow?: boolean;          // Enable/disable shadow
  boxShadowColor?: string;      // Hex color, default '#000000'
  boxShadowOffset?: [number, number]; // [x, y] in pixels, default [0, 0]
  boxShadowBlur?: number;       // Pixels, default 0
  boxShadowSpread?: number;     // Pixels, default 0

  // Filters
  filterBlur?: number;          // Pixels, default 0
  filterBrightness?: number;    // Multiplier (1 = normal), default 1
  filterContrast?: number;      // Multiplier (1 = normal), default 1
  filterGrayscale?: number;     // 0–1, default 0
  filterSepia?: number;         // 0–1, default 0
  filterInvert?: number;        // 0–1, default 0
  filterHueRotate?: number;     // Degrees, default 0
  filterSaturate?: number;      // Multiplier (1 = normal), default 1
}, {
  duration: '1s',
  easing?: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step',
});
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
