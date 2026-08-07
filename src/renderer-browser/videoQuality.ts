/**
 * Video-encoding quality resolution, shared by the main-thread export path
 * (`BrowserRenderer.exportVideoMainThread`) and the worker export path
 * (`BrowserRenderer.worker.ts`). It lives in its own module because the worker
 * is bundled separately by `bundle-worker.ts` and cannot import the renderer.
 */

import type { RenderOptions } from '@videoflow/core/types';
import { QUALITY_MEDIUM, QUALITY_HIGH, QUALITY_VERY_HIGH, type Quality } from 'mediabunny';

/**
 * Resolve `RenderOptions.videoQuality` / `videoBitrate` into the `bitrate`
 * field of a MediaBunny `VideoEncodingConfig`.
 *
 * The default is `QUALITY_VERY_HIGH` (12 Mbps at 1080p / H.264), not the
 * `QUALITY_HIGH` (6 Mbps) this used to hardcode. Motion graphics are the worst
 * case for a rate-controlled codec — flat gradients band and slow type smears
 * where camera grain would have hidden both — and MediaBunny's ladder is
 * calibrated off a 3 Mbps 1080p reference that assumes photographic content.
 *
 * ## Why the pixel format stays 4:2:0, and what it would take to change
 *
 * The encoder is Chrome's WebCodecs `VideoEncoder`. Its H.264 encoder only
 * ships 4:2:0 profiles — measured with `isConfigSupported` in the same
 * headless Chrome the server renderer launches:
 *
 *   avc High       (avc1.640028, 4:2:0)   supported
 *   avc High 10    (avc1.6e0028)          NOT supported
 *   avc High 4:2:2 (avc1.7a0028)          NOT supported
 *   avc High 4:4:4 (avc1.f40028)          NOT supported
 *   vp9 profile 1 / 3 (4:4:4)             NOT supported
 *   av1 High       (av01.1.08M.08)        supported — decodes back as I444
 *
 * So `fullCodecString` cannot buy 4:4:4 here: there is no H.264 route to it in
 * the browser at all. The only 4:4:4 route is moving the whole track to AV1,
 * which trades chroma fidelity for player compatibility (AV1-in-MP4 is not
 * universally playable) — a deliverable-level decision rather than an encoder
 * tweak. Bitrate is the lever that is actually available, and it helps the
 * saturated-text case too, since the chroma planes are rate-controlled
 * alongside luma.
 */
export function resolveVideoBitrate(options: RenderOptions): number | Quality {
	if (typeof options.videoBitrate === 'number' && options.videoBitrate > 0) {
		return Math.round(options.videoBitrate);
	}
	switch (options.videoQuality) {
		case 'medium': return QUALITY_MEDIUM;
		case 'high': return QUALITY_HIGH;
		case 'veryHigh': return QUALITY_VERY_HIGH;
		default: return QUALITY_VERY_HIGH;
	}
}
