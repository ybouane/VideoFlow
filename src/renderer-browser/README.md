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

## Example: Export Button

```html
<button id="exportBtn">Export Video</button>

<script type="module">
  import VideoFlow from '@videoflow/core';
  import VideoRenderer from '@videoflow/renderer-browser';

  document.getElementById('exportBtn').addEventListener('click', async () => {
    const $ = new VideoFlow({ width: 1280, height: 720, fps: 30 });

    const title = $.addText({ text: 'Made with VideoFlow', fontSize: 3 });
    title.fadeIn('1s');
    $.wait('3s');
    title.fadeOut('1s');

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
