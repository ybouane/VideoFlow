# @videoflow/renderer-browser

Render [VideoFlow](https://github.com/ybouane/VideoFlow) videos to MP4 files directly in the browser. Generate real video files from VideoFlow's JSON format entirely client-side — no server required.

## Installation

```bash
npm install @videoflow/core @videoflow/renderer-browser
```

## Quick Start

```typescript
import VideoFlow from '@videoflow/core';
import VideoRenderer from '@videoflow/renderer-browser';

// Define a video
const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30 });
const title = $.addText({ text: 'Hello!', fontSize: 3, color: '#fff' });
title.fadeIn('1s');
$.wait('3s');
title.fadeOut('1s');

// Compile to JSON and render to MP4
const json = await $.compile();
const blob = await VideoRenderer.render(json);

// Download the video
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'video.mp4';
a.click();
URL.revokeObjectURL(url);
```

## Why Use This Package?

- **Generate real MP4 files in the browser** — no server, no backend setup
- **Client-side rendering** — video data never leaves the user's device
- **Works with any VideoFlow JSON** — same format used by all VideoFlow renderers
- **Per-layer caching** — static layers are rasterized once and reused across frames
- **Layer groups** — composite a sub-tree of layers as one, with shared transitions / effects / animations applied to the whole composite
- **WebGL effects** — registered GLSL effects run only for layers that need them; zero overhead for the rest

## API

### VideoRenderer.render

Render a compiled VideoFlow JSON to an MP4 blob.

```typescript
import VideoRenderer from '@videoflow/renderer-browser';

const blob = await VideoRenderer.render(videoJSON);
```

**Returns:** `Blob` — an MP4 video file

### VideoRenderer.renderFrame

Render a single frame.

```typescript
const imageData = await VideoRenderer.renderFrame(videoJSON, frameNumber);
```

### VideoRenderer.renderAudio

Render the full audio track.

```typescript
const audioBuffer = await VideoRenderer.renderAudio(videoJSON);
```

---

## Transitions

Transition presets are registered globally and referenced by name in the layer's settings. Built-in presets are auto-registered on import.

### The signed `p` contract

Every preset receives a **signed** progress value `p ∈ [-1, +1]`:

- `p = -1` — start of the `transitionIn` window
- `p =  0` — layer at rest (original properties; preset must be a no-op)
- `p = +1` — end of the `transitionOut` window

`p` is pre-eased by the renderer (per-direction easing), so preset bodies stay linear in their math. Presets must multiply / add onto the incoming property values so they compose with keyframed animation.

Most presets read `t = stage(p) = 1 - |p|` so the same body produces a symmetric mirror exit on its own. Continuous-motion legacy presets (`rise`, `fall`, `driftLeft`, `driftRight`, `riseFade`) use the signed `p` to travel through rest without reversing.

### Built-in presets

There are 27+ built-in transitions plus a handful of legacy aliases. See the [core package README](../core/README.md#transitions) for the full categorised table. A short representative sample:

| Preset | Category | Effect |
| --- | --- | --- |
| `fadeIn` | `all` | Opacity (visual) and volume (audio) → 0 |
| `slideUp` / `slideDown` / `slideLeft` / `slideRight` | `visual` | Position slide-in with optional fade |
| `zoomIn` | `visual` | Scale up from `from` to `1` |
| `blurResolve` | `visual` (injects effect) | Gaussian blur resolves to sharp |
| `motionBlurSlide` | `visual` (injects effect) | Slide with directional motion blur |
| `typewriter` | `textual` | Reveals text one character at a time |
| `numberCountUp` | `textual` | Counts numbers in the text up to their final value |

### Custom transitions

Register a custom preset with `BrowserRenderer.registerTransition`. The same registry is shared with `DomRenderer`, so a transition registered here also works in live preview.

```typescript
import BrowserRenderer from '@videoflow/renderer-browser';

// Symmetric: spin back to rest on enter and exit
BrowserRenderer.registerTransition('spin', (p, properties, params) => {
  const t = 1 - Math.abs(p);
  properties.rotation = (properties.rotation ?? 0) + (1 - t) * (params.angle ?? 360);
  properties.opacity  = (properties.opacity  ?? 1) * t;
  return properties;
}, { defaultEasing: 'easeOut', layerCategory: 'visual' });
```

The function receives:
- `p` — signed progress in `[-1, +1]`, already eased. `-1` is the start of `transitionIn`, `0` is rest, `+1` is the end of `transitionOut`.
- `properties` — the layer's resolved properties at this frame. Mutate in place or return a new object.
- `params` — values from the layer's `transitionIn.params` / `transitionOut.params`.
- `context` — `{ seed, frame, fps, projectWidth, projectHeight }` for deterministic per-layer randomness and aspect-aware geometry.

Options:
- `defaultEasing` — easing applied to `p` when the layer doesn't specify one. Default `'linear'`.
- `layerCategory` — one of `'all' | 'visual' | 'audio' | 'textual'`. Default `'visual'`. Editors filter the picker by this against the target layer class's `static category`.
- `injectsEffects` — set `true` if the preset pushes WebGL effect entries onto `properties.__effects`; the renderer keeps the effect overlay mounted across the layer's lifetime.
- `fieldsConfig` — UI metadata for each `params` key (used by editors only).

---

## GLSL Effects

Shader effects are registered globally and referenced by name in the layer's `effects` property. Built-in effects (`chromaticAberration`, `pixelate`, `vignette`, `rgbSplit`, `invert`) are auto-registered on import.

### Built-in effects

| Effect | Description | Params |
| --- | --- | --- |
| `chromaticAberration` | Horizontal RGB channel split | `amount` (default `0.005`) |
| `pixelate` | Pixel mosaic | `size` (pixels, default `8`) |
| `vignette` | Darkened border | `strength` (default `0.6`), `radius` (default `0.8`) |
| `rgbSplit` | Directional chromatic aberration | `angle` (degrees, default `0`), `amount` (default `0.005`) |
| `invert` | Colour inversion | `amount` (0–1, default `1`) |

All params are animatable via dot-path property keys (e.g. `'effects.pixelate.size'`).

### Custom effects

```typescript
import BrowserRenderer from '@videoflow/renderer-browser';

BrowserRenderer.registerEffect(
  'glitch',
  `
vec4 effect(sampler2D tex, vec2 uv, vec2 resolution) {
  vec2 shifted = uv + vec2(u_amount * sin(uv.y * 40.0), 0.0);
  return texture2D(tex, shifted);
}
`,
  {
    amount: { type: 'float', default: 0.02, min: 0, max: 0.1, animatable: true },
  },
);
```

The GLSL snippet defines a single `vec4 effect(sampler2D tex, vec2 uv, vec2 resolution)` function. Each declared param becomes a `u_<name>` uniform. The compositor wraps the snippet with boilerplate (precision, uniforms, varying `v_uv`, `main`) at registration time.

**Param types:** `'float'`, `'int'`, `'bool'`, `'vec2'`, `'vec3'`, `'vec4'`, `'color'` (CSS colour string, converted to `vec4`).

---

## Example: Export Button with Effects

```html
<button id="exportBtn">Export Video</button>

<script type="module">
  import VideoFlow from '@videoflow/core';
  import VideoRenderer from '@videoflow/renderer-browser';

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const $ = new VideoFlow({ width: 1280, height: 720, fps: 30 });

    const img = $.addImage(
      {
        fit: 'cover',
        effects: [
          { effect: 'vignette', params: { strength: 0.6 } },
          { effect: 'chromaticAberration', params: { amount: 0.003 } },
        ],
      },
      { source: './photo.jpg', sourceDuration: '5s' },
    );

    const title = $.addText(
      { text: 'Made with VideoFlow', fontSize: 3 },
      {
        startTime: '0.5s',
        sourceDuration: '4s',
        transitionIn:  { transition: 'slideUp', duration: '600ms' },
        transitionOut: { transition: 'fadeIn',  duration: '500ms' },
      },
    );
    $.wait('5s');

    const json = await $.compile();
    const blob = await VideoRenderer.render(json);

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'export.mp4';
    a.click();
    URL.revokeObjectURL(url);
  });
</script>
```

## See Also

- [`@videoflow/core`](https://github.com/ybouane/VideoFlow/tree/main/src/core) — Define and compose videos programmatically
- [`@videoflow/renderer-dom`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-dom) — Play back and preview VideoFlow videos in the browser
- [`@videoflow/renderer-server`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-server) — Render VideoFlow videos to MP4 on the server

## License

Apache License 2.0
