# @videoflow/renderer-dom

Play back and preview [VideoFlow](https://github.com/ybouane/VideoFlow) videos interactively in the browser. Load a compiled VideoFlow JSON into a DOM element and get full playback controls — play, pause, seek, and frame-by-frame scrubbing with audio sync.

## Installation

```bash
npm install @videoflow/core @videoflow/renderer-dom
```

## Quick Start

```typescript
import VideoFlow from '@videoflow/core';
import DomRenderer from '@videoflow/renderer-dom';

// Define a video
const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30 });
const title = $.addText({ text: 'Hello!', fontSize: 3, color: '#fff' });
title.fadeIn('1s');
$.wait('3s');
title.fadeOut('1s');

// Compile and play it back
const json = await $.compile();
const player = new DomRenderer(document.getElementById('player'));
await player.loadVideo(json);
await player.play();
```

## Why Use This Package?

- **Preview VideoFlow videos in real-time** — test animations and timing before exporting
- **Build custom video editors** — seek to any frame, scrub the timeline, inspect layers
- **Interactive playback with audio sync** — play, pause, and seek with frame-accurate audio
- **Full transition & effect support** — layers with `transitionIn`/`transitionOut` animate in live preview; `effects` layers are rendered via WebGL on a per-layer overlay canvas

## API

### Constructor

```typescript
const player = new DomRenderer(containerElement);
```

Mounts the video renderer inside the provided DOM element using Shadow DOM for style isolation.

### loadVideo

Load a compiled VideoFlow JSON for playback.

```typescript
await player.loadVideo(videoJSON);
```

### play

Start playback. Optionally accepts a `fpsCallback` for diagnostics:

```typescript
await player.play();

// Or with an FPS HUD:
await player.play({
  fpsCallback: (fps) => console.log('render fps:', fps.toFixed(1)),
});
```

### onFrame

Public property — assign a function to be notified every time a new frame is
rendered (during playback **or** after a seek/`renderFrame` call). Useful for
keeping a UI (seek bar, time label, …) in sync with playback:

```typescript
player.onFrame = (frame) => {
  timeline.value = String((frame / player.totalFrames) * 100);
  timeLabel.textContent = (frame / player.fps).toFixed(2) + 's';
};

// Clear it later by assigning null:
player.onFrame = null;
```

### stop

Stop playback.

```typescript
player.stop();
```

### seek

Jump to a specific frame.

```typescript
await player.seek(frameNumber);
```

### renderFrame

Render a specific frame without starting playback.

```typescript
await player.renderFrame(frameNumber);
```

### destroy

Clean up all resources.

```typescript
player.destroy();
```

### Properties

```typescript
player.playing          // boolean — is playback active?
player.currentFrame     // number — current frame index
player.currentTime      // number — current time in seconds (get/set)
player.totalFrames      // number — total frame count
player.duration         // number — total duration in seconds
player.fps              // number — frames per second
```

---

## Transitions

`DomRenderer` fully supports transitions declared on layers. Built-in presets (`fade`, `zoom`, `blur`, `slideLeft`, `slideRight`, `slideUp`, `slideDown`, `riseFade`) animate automatically in live preview — no extra setup needed.

Custom presets can be registered with `DomRenderer.registerTransition`, which writes to the same shared registry as `BrowserRenderer.registerTransition`:

```typescript
import DomRenderer from '@videoflow/renderer-dom';

DomRenderer.registerTransition('spin', (p, properties, params) => {
  properties.rotation = (properties.rotation ?? 0) + (1 - p) * (params.angle ?? 360);
  properties.opacity = (properties.opacity ?? 1) * p;
  return properties;
});
```

---

## GLSL Effects

`DomRenderer` also supports `effects` layers. When a layer declares effects, the renderer substitutes a project-sized `<canvas>` overlay for that layer's normal DOM output. Each frame, the layer is rasterized off-screen and piped through the shared WebGL compositor, and the result is painted onto the overlay canvas. Non-effect layers stay on the fast DOM-mutation path, so there is no regression for the common case.

Custom effects can be registered with `DomRenderer.registerEffect`:

```typescript
import DomRenderer from '@videoflow/renderer-dom';

DomRenderer.registerEffect(
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

---

## Example: Video Player with Controls

```html
<div id="player"></div>
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
  const title = $.addText(
    { text: 'VideoFlow Preview', fontSize: 3 },
    {
      sourceDuration: '5s',
      transitionIn:  { transition: 'riseFade', duration: '500ms' },
      transitionOut: { transition: 'fade',     duration: '400ms' },
    },
  );
  $.wait('5s');

  // Set up the player
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

## See Also

- [`@videoflow/core`](https://github.com/ybouane/VideoFlow/tree/main/src/core) — Define and compose videos programmatically
- [`@videoflow/renderer-browser`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-browser) — Render VideoFlow videos to MP4 in the browser
- [`@videoflow/renderer-server`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-server) — Render VideoFlow videos to MP4 on the server

## License

Apache License 2.0
