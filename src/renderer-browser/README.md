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

Presets fall into two flavours:

- **Symmetric** — use `|p|` to behave identically on enter and exit (`fade`, `zoom`, `blur`, all `slideFrom*`).
- **Asymmetric / continuous** — use signed `p` to travel in one direction across the entire layer lifetime (`rise`, `fall`, `driftLeft`, `driftRight`, `riseFade`).

### Built-in presets

| Preset | Kind | Effect | Params |
| --- | --- | --- | --- |
| `fade` | symmetric | Fades opacity in and out | — |
| `zoom` | symmetric | Scales in/out from `from` factor | `from?: number` (default `0.8`) |
| `blur` | symmetric | Gaussian blur sweep | `amount?: number` (peak blur in `em`, default `4`) |
| `rise` | continuous | Travels upward through rest | `distance?: number` (default `0.15`) |
| `fall` | continuous | Travels downward through rest | `distance?: number` |
| `driftLeft` | continuous | Drifts left through rest | `distance?: number` |
| `driftRight` | continuous | Drifts right through rest | `distance?: number` |
| `slideFromTop` | symmetric | Enters & exits off the top | `distance?: number` (default `0.15`) |
| `slideFromBottom` | symmetric | Enters & exits off the bottom | `distance?: number` |
| `slideFromLeft` | symmetric | Enters & exits off the left | `distance?: number` |
| `slideFromRight` | symmetric | Enters & exits off the right | `distance?: number` |
| `riseFade` | continuous | Continuous upward motion + symmetric fade | `distance?: number` (default `0.08`) |

### Custom transitions

Register a custom preset with `BrowserRenderer.registerTransition`. The same registry is shared with `DomRenderer`, so a transition registered here also works in live preview.

```typescript
import BrowserRenderer from '@videoflow/renderer-browser';

// Symmetric: spin back to rest on enter and exit
BrowserRenderer.registerTransition('spin', (p, properties, params) => {
  properties.rotation = (properties.rotation ?? 0) + Math.abs(p) * (params.angle ?? 360);
  properties.opacity  = (properties.opacity  ?? 1) * (1 - Math.abs(p));
  return properties;
}, { defaultEasing: 'easeOut' });
```

The function receives:
- `p` — signed progress in `[-1, +1]`, already eased. `-1` is the start of `transitionIn`, `0` is rest, `+1` is the end of `transitionOut`.
- `properties` — the layer's resolved properties at this frame. Mutate in place or return a new object.
- `params` — values from the layer's `transitionIn.params` / `transitionOut.params`.

`options.defaultEasing` sets the easing applied to `|p|` when the layer doesn't specify one. Layers can always override via the `easing` field on their transition spec.

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
        transitionIn:  { transition: 'riseFade', duration: '600ms' },
        transitionOut: { transition: 'fade',     duration: '500ms' },
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
