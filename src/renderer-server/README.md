<a href="https://videoflow.dev/renderers">
  <img src="https://videoflow.dev/images/banner-renderers.png" alt="VideoFlow Renderers" />
</a>

# @videoflow/renderer-server

[![npm](https://img.shields.io/npm/v/@videoflow/renderer-server.svg)](https://www.npmjs.com/package/@videoflow/renderer-server)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](../../LICENSE)

Render [VideoFlow](https://videoflow.dev/) videos to MP4 on **Node.js**. Drives a headless Chromium via Playwright so the server reuses the exact same rendering pipeline as the browser — pixel-for-pixel identical output to `@videoflow/renderer-browser` and `@videoflow/renderer-dom`.

> **Renderers docs:** [videoflow.dev/renderers](https://videoflow.dev/renderers) · **Live playground:** [videoflow.dev/playground](https://videoflow.dev/playground)

---

## Why use this package?

- **Server-side video generation.** Accept a `VideoJSON` payload, return an MP4 — perfect for APIs, batch jobs, and background workers.
- **WebCodecs-accelerated by default.** The headless browser encodes the entire video in-process via `BrowserRenderer.exportVideo()`; the finished MP4 is POSTed back to Node — no per-frame screenshot, no JPEG re-encode. Significantly faster than pipelining through ffmpeg.
- **ffmpeg fallback.** When you need ffmpeg-specific flags downstream, switch to the alternative pipeline with `{ ffmpeg: true }` — VideoFlow renders frames as JPEG and pipes them to `ffmpeg` for x264 + AAC encoding.
- **Same pixels as the browser.** Both pipelines run inside a real Chromium, so transitions, GLSL effects, fonts, and `mix-blend-mode` blends look identical to what your users see in `@videoflow/renderer-dom`.
- **Cancellable + observable.** Every render accepts an `AbortSignal` and an `onProgress` callback.

---

## Installation

```bash
npm install @videoflow/core @videoflow/renderer-server
npx playwright install chromium
```

**Requirements**

- **Node.js 18+**
- **Chromium** (installed by `npx playwright install chromium` above)
- **ffmpeg 4.4+** — *only required if you opt into the ffmpeg pipeline (`{ ffmpeg: true }`).* The default pipeline does everything inside Chromium.

### Installing ffmpeg (optional fallback)

```bash
# macOS
brew install ffmpeg
# Linux
sudo apt-get install ffmpeg
# Windows (Chocolatey)
choco install ffmpeg
```

---

## Quick Start

```ts
import VideoFlow from '@videoflow/core';

const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30 });

const title = $.addText({ text: 'Hello!', fontSize: 6, color: '#fff' });
title.fadeIn('1s');
$.wait('3s');
title.fadeOut('1s');

await $.renderVideo({
  outputType: 'file',
  output: './output.mp4',
  verbose: true,
});
```

`$.renderVideo()` auto-detects Node.js and dispatches to `@videoflow/renderer-server`. You can also import the renderer directly:

```ts
import VideoRenderer from '@videoflow/renderer-server';

const json = await $.compile();
await VideoRenderer.render(json, {
  outputType: 'file',
  output: './output.mp4',
});
```

---

## Encoding pipelines

| Mode | When to use | Encoder | Per-frame screenshot? |
| --- | --- | --- | --- |
| `ffmpeg: false` (default) | The fast path | WebCodecs + MediaBunny inside Chromium | No |
| `ffmpeg: true` | When you need ffmpeg flags or a non-MP4 container in the same pipeline | `ffmpeg` (libx264 + AAC) | Yes (JPEG via Playwright) |

The default pipeline is typically several times faster: it skips the per-frame `page.screenshot()` round-trip and the JPEG → H.264 re-encode. The ffmpeg pipeline remains available for projects that already build on it or that want to apply ffmpeg-specific filters.

```ts
// Force the ffmpeg pipeline (e.g. to use a non-default encoder preset downstream)
await VideoRenderer.render(json, {
  outputType: 'file',
  output: './out.mp4',
  ffmpeg: true,
});
```

---

## API

### `VideoRenderer.render(videoJSON, options?)`

One-shot static API — boots a Chromium, runs the render, cleans up.

```ts
import VideoRenderer from '@videoflow/renderer-server';

await VideoRenderer.render(videoJSON, {
  outputType: 'file',                    // 'file' | 'buffer' (default 'buffer')
  output: './video.mp4',                 // required when outputType: 'file'
  verbose: true,                         // log progress to stdout
  signal: controller.signal,             // AbortSignal — cancel mid-render
  onProgress: (p) => console.log(p),     // 0..1
  ffmpeg: false,                         // default; set true to use the ffmpeg fallback
});
```

**Options**

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `outputType` | `'file'` \| `'buffer'` | `'buffer'` | Where the rendered MP4 ends up |
| `output` | `string` | — | File path; required when `outputType: 'file'` |
| `verbose` | `boolean` | `false` | Print progress / pipeline info to stdout |
| `signal` | `AbortSignal` | — | Cancel the in-flight render |
| `onProgress` | `(p: number) => void` | — | Called with `0..1` |
| `ffmpeg` | `boolean` | `false` | Pick the ffmpeg fallback instead of the default browser-export path |

**Returns:** `Buffer` (when `outputType: 'buffer'`) or the absolute output path (when `outputType: 'file'`).

### Instance API

For long-running services or pipelines that re-use the same Chromium across multiple operations, construct a `ServerRenderer`:

```ts
import { ServerRenderer } from '@videoflow/renderer-server';

const json = await $.compile();
const renderer = new ServerRenderer(json);

try {
  // Render a single frame to JPEG
  const jpeg = await renderer.renderFrame(30);
  fs.writeFileSync('frame.jpg', jpeg);

  // Render the audio track to a WAV Buffer
  const wav = await renderer.renderAudio();
  if (wav) fs.writeFileSync('audio.wav', wav);
} finally {
  await renderer.cleanup();
}
```

| Method | Returns |
| --- | --- |
| `renderer.renderFrame(frame)` | `Buffer` (JPEG) |
| `renderer.renderAudio()` | `Buffer \| null` (WAV bytes, or `null` if the project has no audio) |
| `renderer.cleanup()` | Tears down the Chromium page and any ffmpeg subprocess |

---

## Example: video-generation API

```ts
import express from 'express';
import VideoFlow from '@videoflow/core';

const app = express();
app.use(express.json());

app.post('/api/generate-video', async (req, res, next) => {
  try {
    const { title, subtitle } = req.body;

    const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30 });

    const t = $.addText({ text: title, fontSize: 6, color: '#fff' });
    t.fadeIn('1s'); $.wait('1.5s');

    const s = $.addText({ text: subtitle, fontSize: 3, color: '#94a3b8', position: [0.5, 0.6] });
    s.fadeIn('500ms'); $.wait('3s');

    $.parallel([() => t.fadeOut('500ms'), () => s.fadeOut('500ms')]);

    const buffer = await $.renderVideo();   // outputType defaults to 'buffer'

    res.set('Content-Type', 'video/mp4').send(buffer);
  } catch (err) {
    next(err);
  }
});

app.listen(3000);
```

## Example: batch generation with progress

```ts
import VideoFlow from '@videoflow/core';

const items = [
  { text: 'Slide 1', color: '#ef4444' },
  { text: 'Slide 2', color: '#10b981' },
  { text: 'Slide 3', color: '#3b82f6' },
];

for (const [i, item] of items.entries()) {
  const $ = new VideoFlow({ width: 1920, height: 1080, fps: 30 });
  const t = $.addText({ text: item.text, fontSize: 6, color: item.color });
  t.fadeIn('500ms'); $.wait('2s'); t.fadeOut('500ms');

  await $.renderVideo({
    outputType: 'file',
    output: `./output/slide-${i + 1}.mp4`,
    onProgress: (p) => process.stdout.write(`\rslide ${i + 1}: ${(p * 100).toFixed(0)}%`),
  });
  console.log(`  ✓ slide ${i + 1}`);
}
```

## Example: cancelling a render

```ts
import VideoFlow from '@videoflow/core';

const $ = new VideoFlow({ width: 1280, height: 720, fps: 30 });
$.addVideo({}, { source: './long-clip.mp4' }, { waitFor: 'finish' });

const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);   // cancel after 5s

try {
  await $.renderVideo({
    outputType: 'file',
    output: './out.mp4',
    signal: controller.signal,
  });
} catch (err) {
  if (err.name === 'AbortError') console.log('cancelled');
  else throw err;
}
```

---

## Notes

- **`renderVideo()` cleans up after itself.** The static `render(...)` API (and `$.renderVideo(...)` underneath) tears down the Chromium page on completion or abort. Long-running services should use the instance API + `cleanup()` to share one browser across requests instead of spawning one per call.
- **Asset URLs.** When the project references HTTP(S) URLs, the headless browser fetches them itself, so anything reachable from the server works — including blob URLs you create from in-memory buffers via Playwright's `route` API.
- **Fonts.** Google Font names referenced via `fontFamily` are auto-resolved through a bundled registry — no setup needed.

## Related packages

- [`@videoflow/core`](../core) — Define and compose videos programmatically
- [`@videoflow/renderer-browser`](../renderer-browser) — Render to MP4 in the browser
- [`@videoflow/renderer-dom`](../renderer-dom) — Live preview / scrubbable playback in the browser

## Resources

- [Renderers docs](https://videoflow.dev/renderers)
- [Live playground](https://videoflow.dev/playground)
- [React Video Editor](https://videoflow.dev/react-video-editor)

## License

[Apache-2.0](../../LICENSE)
