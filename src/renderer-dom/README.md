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

Start playback.

```typescript
await player.play();
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
  const title = $.addText({ text: 'VideoFlow Preview', fontSize: 3 });
  title.fadeIn('1s');
  $.wait('4s');
  title.fadeOut('1s');

  // Set up the player
  const json = await $.compile();
  const player = new DomRenderer(document.getElementById('player'));
  await player.loadVideo(json);

  // Wire up controls
  document.getElementById('playBtn').onclick = () => player.play();
  document.getElementById('stopBtn').onclick = () => player.stop();

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
