<a href="https://videoflow.dev/renderers">
  <img src="https://videoflow.dev/images/banner-renderers.png" alt="VideoFlow Renderers" />
</a>

# @videoflow/renderer-dom

[![npm](https://img.shields.io/npm/v/@videoflow/renderer-dom.svg)](https://www.npmjs.com/package/@videoflow/renderer-dom)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)

Live, scrubbable preview of [VideoFlow](https://videoflow.dev/) videos directly in the DOM. Mount a `DomRenderer` into any element, hand it a compiled `VideoJSON`, and you get a player with frame-accurate seek, audio sync, and incremental editing primitives — perfect for previews and as the rendering core of a video editor.

> **Live demo:** [videoflow.dev/playground](https://videoflow.dev/playground) · **Renderers docs:** [videoflow.dev/renderers](https://videoflow.dev/renderers)

If you're building a visual timeline editor, see also [VideoFlow React Video Editor](https://videoflow.dev/react-video-editor) — a drop-in React UI built on top of this renderer.

---

## Why use this package?

- **Real-time DOM playback.** Layers render as native DOM elements (text via `<textual-layer>`, media via `<video>` / `<canvas>`, shapes via SVG, …) inside a Shadow DOM for full style isolation.
- **Frame-accurate seek + audio sync.** `seek(frame)` jumps anywhere instantly. `play()` runs a `requestAnimationFrame` loop with audio mixed via `OfflineAudioContext` and played back through an `<audio>` element synced to the visual frame index.
- **Incremental editing primitives.** `addLayer`, `removeLayer`, `updateLayer`, `reorderLayers`, `updateVideo` mutate a single layer and re-render only the current frame — no `loadVideo()` round-trip, no flicker.
- **Same transition + effect engine as export.** Built-in transitions, `mix-blend-mode`, GLSL effects, and groups all work identically here and in [`@videoflow/renderer-browser`](../renderer-browser). Live preview matches the exported MP4 pixel-for-pixel for every common case.
- **Editor-friendly hit testing.** Effect layers split into a `[data-effect-layer]` source (kept invisible but pointer-targetable for selection) and a `[data-effect-overlay]` canvas (visible but `pointer-events: none`) — clicks always land on the layer's actual bounding box, not the full-screen overlay.

---

## Installation

```bash
npm install @videoflow/core @videoflow/renderer-dom
```

## Quick Start

```ts
import VideoFlow from '@videoflow/core';
import DomRenderer from '@videoflow/renderer-dom';

// 1. Build a video
const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30 });
const title = $.addText({ text: 'Hello!', fontSize: 6, color: '#fff' });
title.fadeIn('1s');
$.wait('3s');
title.fadeOut('1s');

// 2. Compile and play it back
const json = await $.compile();
const player = new DomRenderer(document.getElementById('player'));
await player.loadVideo(json);
await player.play();
```

The `<div id="player">` is the host element — `DomRenderer` attaches a Shadow DOM inside it and scales the rendered video to fit using container queries.

---

## Player API

### Construction & lifecycle

```ts
const player = new DomRenderer(hostElement);

await player.loadVideo(videoJSON);   // load (or hot-swap) a project
player.destroy();                    // clean up Shadow DOM, GL contexts, audio
```

### Playback

```ts
await player.play({
  fpsCallback: (fps) => console.log(fps.toFixed(1)),  // optional render-fps HUD
});
player.stop();
```

### Seek / scrub

```ts
await player.seek(150);                  // jump to frame 150
player.currentTime = 4.2;                // setter — same as seek(round(t * fps))
console.log(player.currentTime);         // getter — current time in seconds
await player.renderFrame(150);           // render one frame without starting playback
```

### Public properties

```ts
player.playing        // boolean — is playback active?
player.currentFrame   // number  — current frame index
player.currentTime    // number  — current time in seconds (get/set)
player.totalFrames    // number  — duration * fps
player.duration       // number  — duration in seconds
player.fps            // number  — frames per second
```

### `onFrame` callback

Assign a function to be notified every time a new frame paints — during `play()` or after a `seek` / `renderFrame` call. Ideal for keeping a seek bar / time label in sync.

```ts
player.onFrame = (frame) => {
  timeline.value = String((frame / player.totalFrames) * 100);
  timeLabel.textContent = (frame / player.fps).toFixed(2) + 's';
};
// Clear it:
player.onFrame = null;
```

---

## Editing API

These methods mutate the loaded project and re-render only the current frame — much cheaper than calling `loadVideo()` again. All are asynchronous and serialised through an internal mutation queue, so you can safely fire them in quick succession from a UI.

### `updateLayer(id, patch)`

Patch a layer's settings, properties, animations, transitions, or effects.

```ts
await player.updateLayer('title', {
  properties: { color: '#ff5a1f', fontSize: 8 },
});

await player.updateLayer('title', {
  settings: { startTime: 1, sourceDuration: 5 },
  transitionIn: { transition: 'slideUp', duration: '500ms' },
});
```

### `addLayer(layerJSON, index?)`

```ts
await player.addLayer({
  id: 'caption',
  type: 'text',
  properties: { text: 'New caption', fontSize: 3, position: [0.5, 0.85] },
  settings: { startTime: 2, sourceDuration: 3 },
  animations: [],
});
```

### `removeLayer(id)` / `reorderLayers(orderedIds)`

```ts
await player.removeLayer('caption');
await player.reorderLayers(['bg', 'title', 'caption']);
```

### `updateVideo(patch)`

Top-level project properties that can be patched without a full reload (`width`, `height`, `backgroundColor`, `name`, `duration`). Changing `fps` requires `loadVideo()`.

```ts
await player.updateVideo({ width: 1080, height: 1080, backgroundColor: '#0a0d18' });
```

---

## Transitions

`DomRenderer` fully supports `transitionIn` / `transitionOut` declared on layers. All built-in presets (`slideUp`, `zoom`, `overshootPop`, `blurResolve`, `glitchResolve`, `motionBlurSlide`, `noiseDissolve`, `wipeReveal`, `typewriter`, `numberCountUp`, …) animate automatically — no extra setup. See the [core README → Transitions](https://github.com/ybouane/VideoFlow/tree/main/src/core#transitions) for the full table and the signed-`p` contract.

### Custom transitions

`DomRenderer.registerTransition()` writes to a registry **shared with `BrowserRenderer`**, so a preset registered here also runs at export time:

```ts
import DomRenderer from '@videoflow/renderer-dom';

DomRenderer.registerTransition('spinIn', (p, properties, params, ctx) => {
  const t = 1 - Math.abs(p);            // 0 at edges, 1 at rest
  properties.rotation = (properties.rotation ?? 0) + (1 - t) * (params.angle ?? 360);
  properties.opacity  = (properties.opacity  ?? 1) * t;
  return properties;
}, {
  defaultEasing: 'easeOut',
  layerCategory: 'visual',
});
```

---

## GLSL effects

Layers with an `effects` array (or transition presets that inject effects via `injectsEffects: true`) are rendered through a project-sized `<canvas data-effect-overlay>` per layer. Each frame, the layer is rasterized off-screen and piped through the shared WebGL compositor, then painted onto the overlay. Non-effect layers stay on the fast DOM-mutation path, so there's zero overhead for the common case.

Effects flow through groups too: an `effects` array on a `$.group(...)` runs against the group's composited surface, so a single shader pass can apply to a whole sub-tree.

### Custom effects

```ts
import DomRenderer from '@videoflow/renderer-dom';

DomRenderer.registerEffect(
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

The same registry is used by `@videoflow/renderer-browser`, so effects you register live also export correctly.

---

## How it works

1. **Shadow DOM mount.** Each layer becomes a real DOM element inside the host's Shadow Root. CSS handles the entire visual pipeline — transforms, blend modes, filters, shadows, font loading, fit modes — and `[data-renderer]` carries `isolation: isolate` so blend modes stay scoped to the project.
2. **Per-frame property pass.** On every `seek` / `renderFrame` / animation tick, each layer's interpolated properties at the target frame are written as inline CSS / custom properties — so the browser re-renders incrementally instead of rebuilding the DOM.
3. **Effect overlays.** Layers with effects render an off-screen rasterized bitmap into a sibling overlay canvas. The overlay is `pointer-events: none` (clicks fall through to the source), and `mix-blend-mode` is mirrored from the layer so it composites correctly.
4. **Audio sync.** On `play()`, the project audio is rendered to a single `AudioBuffer` via `OfflineAudioContext` (recursing through groups, honouring `volume`/`pan`/`pitch`/`mute` and audio-side transitions like `fade`). The buffer is wrapped in an `<audio>` element; the rAF loop nudges its `playbackRate` to keep audio and visual frame index in sync.
5. **Group sub-mixes.** Group children live in an off-screen `virtualRoot` (so `getComputedStyle` and Web Animations resolve correctly), and the renderer's `compositeLayerInto` flattens them into the group's `<canvas>` each frame — the only group artefact in the visible DOM tree.

---

## End-to-end example: a video player with controls

```html
<div id="player" style="aspect-ratio: 16/9; background: #000;"></div>
<div>
  <button id="playBtn">Play</button>
  <button id="stopBtn">Stop</button>
  <input type="range" id="timeline" min="0" max="100" value="0">
  <span id="time">0:00</span>
</div>

<script type="module">
  import VideoFlow from '@videoflow/core';
  import DomRenderer from '@videoflow/renderer-dom';

  // Build the video
  const $ = new VideoFlow({ width: 1280, height: 720, fps: 30 });
  $.addText(
    { text: 'VideoFlow Preview', fontSize: 5, fontWeight: 800 },
    {
      sourceDuration: '5s',
      transitionIn:  { transition: 'slideUp', duration: '500ms' },
      transitionOut: { transition: 'fade',    duration: '400ms' },
    },
  );
  $.wait('5s');

  // Mount the player
  const json = await $.compile();
  const player = new DomRenderer(document.getElementById('player'));
  await player.loadVideo(json);

  // Wire up controls
  document.getElementById('playBtn').onclick = () => player.play();
  document.getElementById('stopBtn').onclick = () => player.stop();

  player.onFrame = (frame) => {
    timeline.value = String((frame / player.totalFrames) * 100);
    time.textContent = (frame / player.fps).toFixed(2) + 's';
  };

  document.getElementById('timeline').addEventListener('input', (e) => {
    const frame = Math.floor((e.target.value / 100) * player.totalFrames);
    player.seek(frame);
  });
</script>
```

---

## Notes & requirements

- **Modern browsers only.** Uses Shadow DOM, container queries, `OffscreenCanvas`, and (for `effects`) WebGL.
- **CORS.** Image / video / audio sources must be CORS-readable for `decode()` and `decodeAudioData()` to succeed.
- **Hit-testing.** When listening to clicks/pointer events on the host, walk `event.composedPath()` and pick up `data-id` to identify the targeted layer — effect overlays already pass clicks through to the source layer.

## Related packages

- [`@videoflow/core`](../core) — Define and compose videos programmatically
- [`@videoflow/renderer-browser`](../renderer-browser) — Render to MP4 in the browser
- [`@videoflow/renderer-server`](../renderer-server) — Render to MP4 on Node.js

## Resources

- [Renderers docs](https://videoflow.dev/renderers)
- [Live playground](https://videoflow.dev/playground)
- [React Video Editor](https://videoflow.dev/react-video-editor)

## License

[Apache-2.0](../../LICENSE)
