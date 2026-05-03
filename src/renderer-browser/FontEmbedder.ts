/**
 * FontEmbedder — converts Google Font CSS rules to self-contained
 * `@font-face` blocks with base64-encoded data URIs.
 *
 * Used by both BrowserRenderer and DomRenderer to ensure the SVG
 * `<foreignObject>` rasterization path (used for per-layer capture and
 * effect layers) can render text with the correct typeface — SVG data
 * URIs can't load external network resources, so fonts must be inlined.
 *
 * Caches aggressively:
 * - `perFontCache` — keyed by font name. Once we've embedded a font's
 *   `@font-face` rules into a single CSS string we never need to do it
 *   again, even across frames.
 * - `frameCache`   — memoises the combined CSS for one frame so multiple
 *   layers in the same frame don't trigger redundant work.
 *
 * Earlier versions filtered the embedded rules by what was in
 * `performance.getEntriesByType('resource')` to keep the SVG small. That
 * filter raced against `document.fonts.load()` for non-default weights:
 * the FontFace would resolve before the gstatic resource entry appeared,
 * so the SVG was rasterized with no `@font-face` and the text fell back
 * to the system default. We now embed every rule for fonts the renderer
 * has actually been asked to load — robust at the cost of a slightly
 * larger per-layer SVG, which is well worth the trade-off.
 */

import type RuntimeBaseLayer from './layers/RuntimeBaseLayer.js';

export default class FontEmbedder {
	/** Per-font merged `@font-face` CSS, with all `url()` references inlined as data URIs. */
	private perFontCache: Record<string, string> = {};
	/** In-flight build promise per font, so concurrent callers share one fetch+embed pass. */
	private inflight: Record<string, Promise<string>> = {};
	/** Combined CSS for the current frame (cleared at frame boundaries). */
	private frameCache: string | null = null;

	constructor(
		/** Live reference to the renderer's loadedFonts registry. */
		private loadedFonts: Record<string, string>,
	) {}

	/** Call at the start of each new frame to allow the cache to refresh. */
	invalidateFrame(): void {
		this.frameCache = null;
	}

	/**
	 * Return `@font-face` CSS for all currently loaded fonts, with every
	 * `url()` replaced by a base64 data URI. Memoised per frame and per font.
	 */
	async buildFrameFontCSS(): Promise<string> {
		if (this.frameCache !== null) return this.frameCache;

		const parts = await Promise.all(
			Object.keys(this.loadedFonts).map(name => this.buildFontCSS(name)),
		);
		this.frameCache = parts.join('');
		return this.frameCache;
	}

	/**
	 * Return `@font-face` CSS relevant to a single layer. Non-text layers
	 * get an empty string (big savings when most layers are media).
	 */
	async buildFontCSSForLayer(layer: RuntimeBaseLayer): Promise<string> {
		const t = layer.json.type;
		if (t !== 'text' && t !== 'captions') return '';
		return this.buildFrameFontCSS();
	}

	/** Build (or reuse the cached build of) the embedded CSS for one font name. */
	private buildFontCSS(fontName: string): Promise<string> {
		const cached = this.perFontCache[fontName];
		if (cached !== undefined) return Promise.resolve(cached);
		const inflight = this.inflight[fontName];
		if (inflight) return inflight;

		const href = this.loadedFonts[fontName];
		if (!href) return Promise.resolve('');

		const job = (async () => {
			let fontSheet = '';
			try {
				fontSheet = await (await fetch(href, { cache: 'force-cache' })).text();
			} catch {
				this.perFontCache[fontName] = '';
				return '';
			}

			const sheet = new CSSStyleSheet();
			await sheet.replace(fontSheet);

			const embeds = await Promise.all(
				[...sheet.cssRules].map(async rule => {
					if (rule.type !== CSSRule.FONT_FACE_RULE) return '';
					return await this.embedFontUrl(rule.cssText);
				}),
			);

			const combined = embeds.join('');
			this.perFontCache[fontName] = combined;
			return combined;
		})();

		this.inflight[fontName] = job;
		job.finally(() => { delete this.inflight[fontName]; });
		return job;
	}

	/**
	 * Replace the first `url(...)` inside an `@font-face` rule with an inline
	 * `data:` URI. Returns the original cssText unchanged if the fetch fails
	 * (better than dropping the rule outright — the browser may have it
	 * cached even if our `fetch` can't reach it).
	 */
	private async embedFontUrl(cssText: string): Promise<string> {
		const url = cssText.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, '');
		if (!url) return cssText;
		try {
			const blob = await (await fetch(url, { cache: 'force-cache' })).blob();
			const base64 = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
				reader.onerror = reject;
				reader.readAsDataURL(blob);
			});
			return cssText.replace(url, `data:${blob.type || 'font/woff2'};base64,${base64}`);
		} catch {
			return cssText;
		}
	}
}
