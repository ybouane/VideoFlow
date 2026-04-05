# @videoflow/renderer-server

Render [VideoFlow](https://github.com/ybouane/VideoFlow) videos to MP4 files on the server. Generate videos from VideoFlow's JSON format in Node.js — ideal for APIs, batch processing, and background jobs.

## Installation

```bash
npm install @videoflow/core @videoflow/renderer-server
npx playwright install chromium
```

**Requirements:**
- Node.js 18+
- ffmpeg 4.4+

### Installing ffmpeg

```bash
# macOS
brew install ffmpeg

# Linux
sudo apt-get install ffmpeg

# Windows (with Chocolatey)
choco install ffmpeg
```

## Quick Start

```typescript
import VideoFlow from '@videoflow/core';

const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30 });

const title = $.addText({ text: 'Hello!', fontSize: 3, color: '#fff' });
title.fadeIn('1s');
$.wait('3s');
title.fadeOut('1s');

await $.renderVideo({
  outputType: 'file',
  output: './output.mp4',
  verbose: true,
});
```

## Why Use This Package?

- **Generate videos from an API** — accept JSON, return MP4
- **Batch processing** — render hundreds of videos in a pipeline
- **Background jobs** — offload rendering to worker processes
- **High-quality output** — leverages ffmpeg for optimized encoding

## API

### ServerRenderer.render

Render a compiled VideoFlow JSON to MP4.

```typescript
import VideoRenderer from '@videoflow/renderer-server';

const json = await $.compile();

// Render to file
await VideoRenderer.render(json, {
  outputType: 'file',
  output: './video.mp4',
  verbose: true,
});

// Render to buffer
const buffer = await VideoRenderer.render(json);
```

**Options:**
- `outputType` — `'file'` or `'buffer'` (default: `'buffer'`)
- `output` — output file path (required when `outputType` is `'file'`)
- `verbose` — log progress to console
- `signal` — `AbortSignal` for cancellation

### Instance Methods

For fine-grained control, create a `ServerRenderer` instance:

```typescript
import { ServerRenderer } from '@videoflow/renderer-server';

const json = await $.compile();
const renderer = new ServerRenderer(json);

// Render a single frame to JPEG
const frameBuffer = await renderer.renderFrame(30);
fs.writeFileSync('frame.jpg', frameBuffer);

// Render the full audio track to WAV
const audioBuffer = await renderer.renderAudio();
if (audioBuffer) {
  fs.writeFileSync('audio.wav', audioBuffer);
}

// Always clean up when done
await renderer.cleanup();
```

## Example: Video Generation API

```typescript
import express from 'express';
import VideoFlow from '@videoflow/core';

const app = express();
app.use(express.json());

app.post('/api/generate-video', async (req, res) => {
  const { title, subtitle } = req.body;

  const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30 });

  const titleLayer = $.addText({ text: title, fontSize: 3, color: '#fff' });
  titleLayer.fadeIn('1s');
  $.wait('2s');

  const subtitleLayer = $.addText({ text: subtitle, fontSize: 1.5, color: '#ccc' });
  subtitleLayer.fadeIn('500ms');
  $.wait('3s');

  const outputPath = `./videos/${Date.now()}.mp4`;
  await $.renderVideo({
    outputType: 'file',
    output: outputPath,
  });

  res.json({ video: outputPath });
});

app.listen(3000);
```

## Example: Batch Video Generation

```typescript
import VideoFlow from '@videoflow/core';

const items = [
  { text: 'Slide 1', color: '#ff0000' },
  { text: 'Slide 2', color: '#00ff00' },
  { text: 'Slide 3', color: '#0000ff' },
];

for (const [i, item] of items.entries()) {
  const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30 });
  $.addText({ text: item.text, fontSize: 3, color: item.color });
  $.wait('3s');

  await $.renderVideo({
    outputType: 'file',
    output: `./output/slide-${i + 1}.mp4`,
    verbose: true,
  });

  console.log(`Rendered slide ${i + 1}`);
}
```

## See Also

- [`@videoflow/core`](https://github.com/ybouane/VideoFlow/tree/main/src/core) — Define and compose videos programmatically
- [`@videoflow/renderer-dom`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-dom) — Play back and preview VideoFlow videos in the browser
- [`@videoflow/renderer-browser`](https://github.com/ybouane/VideoFlow/tree/main/src/renderer-browser) — Render VideoFlow videos to MP4 in the browser

## License

Apache License 2.0
