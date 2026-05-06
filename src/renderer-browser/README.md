<a href="https://videoflow.dev/renderers">
  <img src="https://videoflow.dev/images/banner-renderers.png" alt="VideoFlow Renderers" />
</a>

# @videoflow/renderer-browser

[![npm](https://img.shields.io/npm/v/@videoflow/renderer-browser.svg)](https://www.npmjs.com/package/@videoflow/renderer-browser)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)

Render [VideoFlow](https://videoflow.dev/) videos to MP4 **entirely in the browser** — no server, no upload, no backend. Built on WebCodecs, MediaBunny, and a per-layer rasterization pipeline that pushes encoding to a Web Worker so the page stays responsive.

> **Live demo:** [videoflow.dev/playground](https://videoflow.dev/playground) · **Renderers docs:** [videoflow.dev/renderers](https://videoflow.dev/renderers)

---

## Why use this package?

- **Real MP4 files generated client-side** — H.264 video + AAC (or Opus) audio, muxed by [MediaBunny](https://www.npmjs.com/package/mediabunny).
- **Zero server cost.** The user's device does the work; you keep their footage on-device.
- **Worker-based encoding.** Frame rasterization stays on the main thread (SVG `<foreignObject>` decode requires DOM), but encoding/muxing run in a dedicated Worker — UI stays smooth.
- **Tier-based per-layer rasterization.** Static / simple-transform layers paint with a direct `drawImage` fast path; complex layers go through a cached SVG rasterizer.
- **WebGL effect compositor.** Layers with `effects` are piped through a ping-pong shader pipeline.
- **Audio sub-mixes for groups.** A `$.group(...)` whose children produce audio is rendered as its own buffer first, then placed on the parent timeline — group-level `volume` / `pan` / `pitch` / `mute` / fade transitions apply to the sub-mix as a whole.

This is the **export** renderer. For interactive playback / scrubbing in the same browser, pair it with [`@videoflow/renderer-dom`](../renderer-dom) — they share the same transition + effect registries, so live preview and exported MP4 always agree.

---

## Installation

```bash
npm install @videoflow/core @videoflow/renderer-browser
```

## Quick Start

```ts
import VideoFlow from '@videoflow/core';
import VideoRenderer from '@videoflow/renderer-browser';

// 1. Define a video
const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30 });
const title = $.addText({ text: 'Hello!', fontSize: 6, color: '#fff' });
title.fadeIn('1s');
$.wait('3s');
title.fadeOut('1s');

// 2. Compile to JSON, render to an MP4 Blob
const json = await $.compile();
const blob = await VideoRenderer.render(json);

// 3. Download
const a = document.createElement('a');
a.href = URL.createObjectURL(blob);
a.download = 'hello.mp4';
a.click();
URL.revokeObjectURL(a.href);
```

You can also bypass `compile()` and let VideoFlow auto-detect the environment:

```ts
const blob = await $.renderVideo();   // → Blob in the browser
```

---

## API

### `VideoRenderer.render(videoJSON, options?)`

Static one-shot — creates a renderer, exports an MP4, and tears everything down.

```ts
const blob = await VideoRenderer.render(videoJSON, {
  signal: controller.signal,            // AbortSignal — cancel mid-encode
  onProgress: (p) => console.log((p * 100).toFixed(1) + '%'),
  worker: true,                         // default; pass false to encode on the main thread
});
```

**Options**

| Option | Type | Description |
| --- | --- | --- |
| `signal` | `AbortSignal` | Cancel the encode mid-flight |
| `onProgress` | `(p: number) => void` | Called with `0..1` during encode |
| `worker` | `boolean` | Encode in a dedicated Worker (default `true`). Set `false` for environments without Worker support |

**Returns:** `Blob` (`video/mp4`).

### `VideoRenderer.renderFrame(videoJSON, frame)`

```ts
const canvas = await VideoRenderer.renderFrame(videoJSON, 30);  // OffscreenCanvas
```

### `VideoRenderer.renderAudio(videoJSON)`

```ts
const audioBuffer = await VideoRenderer.renderAudio(videoJSON); // AudioBuffer | null
```

Returns `null` when the project has no audio layers.

### Instance API

For long-lived previews (re-rendering many frames, sharing one rasterizer cache, …) use the constructor + `captureFrame()` / `exportVideo()`:

```ts
import BrowserRenderer from '@videoflow/renderer-browser';

const renderer = new BrowserRenderer(videoJSON);
try {
  for (let f = 0; f < total; f++) {
    const offscreen = await renderer.captureFrame(f);
    // …consume the OffscreenCanvas…
  }
} finally {
  renderer.destroy();
}
```

---

## How it works

1. **Layer mounting.** Each layer becomes a DOM element in an off-screen `[data-renderer]` container. CSS handles transforms, filters, blend modes, fonts, and `mix-blend-mode` blending.
2. **Per-frame property pass.** Every layer's interpolated properties at the current frame are written as inline CSS / custom properties.
3. **Tier-based rasterization** ([`LayerRasterizer`](LayerRasterizer.ts)):
   - **Tier 1** — simple transform + no filters/borders/shadows → straight `drawImage` from the layer's source bitmap onto the destination canvas.
   - **Tier 3** — anything else (rotation, 3D, filters, text, shapes, effects-bearing layers) → rasterized through an SVG `<foreignObject>`, cached per layer until the resolved props change.
4. **Effect pipeline.** Layers with `effects` are piped through a [`WebGLEffectCompositor`](WebGLEffectCompositor.ts) (ping-pong FBOs) before composite.
5. **Composite onto the final canvas.** Layers paint in sorted track order with their `blendMode` applied via `globalCompositeOperation`. Groups composite their children onto a private project-sized surface first, then drop that surface onto the parent.
6. **Audio mix.** An `OfflineAudioContext` mixes every audio-bearing layer (recursing through groups). `volume`/`pan` keyframes drive AudioParam automation; `pitch` is decoupled from `speed` via an offline granular pitch shifter; `mute` short-circuits the source.
7. **Encode + mux.** Frames and audio are fed into a Worker-resident MediaBunny pipeline (WebCodecs `VideoEncoder` / `AudioEncoder`), which produces the final MP4 buffer.

---

## Transitions

Built-in transition presets (the same library used by `@videoflow/renderer-dom`) auto-register on import. See the [core README → Transitions](https://github.com/ybouane/VideoFlow/tree/main/src/core#transitions) for the full categorised table and the signed-`p` contract.

### Custom transitions

`BrowserRenderer.registerTransition()` writes to a registry **shared with `DomRenderer`** — register once, works in both export and live preview.

```ts
import BrowserRenderer from '@videoflow/renderer-browser';

BrowserRenderer.registerTransition('spinIn', (p, properties, params, ctx) => {
  const t = 1 - Math.abs(p);                     // 0 at edges, 1 at rest
  properties.rotation = (properties.rotation ?? 0) + (1 - t) * (params.angle ?? 360);
  properties.opacity  = (properties.opacity  ?? 1) * t;
  return properties;
}, {
  defaultEasing: 'easeOut',
  layerCategory: 'visual',                       // 'all' | 'visual' | 'audio' | 'textual'
});
```

The function receives:

- `p` — signed progress in `[-1, +1]`, already eased per the layer's `easing`. `-1` is the start of `transitionIn`, `0` is rest, `+1` is the end of `transitionOut`.
- `properties` — the layer's resolved properties at this frame. Mutate in place or return a new object.
- `params` — values from the layer's `transitionIn.params` / `transitionOut.params`.
- `ctx` — `{ seed, frame, fps, projectWidth, projectHeight }` for deterministic per-layer randomness and aspect-aware geometry.

Set `injectsEffects: true` if your preset pushes synthetic effects onto `properties.__effects` — the renderer keeps the effect overlay mounted across the layer's lifetime so the WebGL pipeline always engages.

---

## GLSL effects

Built-in effects (`chromaticAberration`, `pixelate`, `vignette`, `rgbSplit`, `invert`, `bloom`, `colorCorrection`, `frostedGlass`, `lightSweep`, `gaussianBlur`, `motionBlur`, `noiseDissolve`, …) are auto-registered on import. Reference them by name from a layer's `effects` property; animate any param via a dot-path key.

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

The GLSL snippet defines a single `vec4 effect(sampler2D tex, vec2 uv, vec2 resolution)`. Each declared param becomes a `u_<name>` uniform. The compositor wraps the snippet with the precision/uniform/varying boilerplate at registration time.

Param types: `'float'`, `'int'`, `'bool'`, `'vec2'`, `'vec3'`, `'vec4'`, `'color'` (CSS colour string → `vec4`).

---

## End-to-end example: an export button

```html
<button id="exportBtn">Export Video</button>
<progress id="prog" max="1" value="0"></progress>

<script type="module">
  import VideoFlow from '@videoflow/core';
  import VideoRenderer from '@videoflow/renderer-browser';

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const $ = new VideoFlow({ width: 1280, height: 720, fps: 30 });

    $.addImage(
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
      { text: 'Made with VideoFlow', fontSize: 5, fontWeight: 800 },
      {
        startTime: '0.5s',
        sourceDuration: '4s',
        transitionIn:  { transition: 'slideUp', duration: '600ms' },
        transitionOut: { transition: 'fade',    duration: '500ms' },
      },
    );
    $.wait('5s');

    const json = await $.compile();
    const blob = await VideoRenderer.render(json, {
      onProgress: (p) => { document.getElementById('prog').value = p; },
    });

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'export.mp4';
    a.click();
    URL.revokeObjectURL(a.href);
  });
</script>
```

---

## Notes & requirements

- **WebCodecs.** Required for video encoding. Available in Chrome / Edge / recent Firefox / Safari 17+. The library probes for AAC support and falls back to Opus when AAC isn't available (notably on Linux Chrome). If neither is available the audio track is dropped and a warning is emitted — the video still encodes.
- **Cross-origin sources.** Video / image / audio sources must be CORS-readable for `decode()` / `decodeAudioData()` to succeed. Same-origin or blob-URL sources always work.
- **Bundlers.** The encoder Worker is bundled inline as a Blob URL, so no special bundler config is needed (esbuild / Vite / webpack all just work).

## Related packages

- [`@videoflow/core`](../core) — Define and compose videos programmatically
- [`@videoflow/renderer-dom`](../renderer-dom) — Live preview / scrubbable playback in the browser
- [`@videoflow/renderer-server`](../renderer-server) — Render to MP4 on Node.js

## Resources

- [Renderers docs](https://videoflow.dev/renderers)
- [Live playground](https://videoflow.dev/playground)
- [React Video Editor](https://videoflow.dev/react-video-editor)

## License

[Apache-2.0](../../LICENSE)
