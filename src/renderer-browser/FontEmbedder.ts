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
 * - `perFontCache` — keyed by font name, rebuilt only when a new font loads.
 * - `frameCache`   — memoises the combined CSS for one frame so multiple
 *   layers in the same frame don't trigger redundant work.
 */

import type RuntimeBaseLayer from './layers/RuntimeBaseLayer.js';

export default class FontEmbedder {
	/** Outer map: fontName → inner map of fontUrl → embedded CSS rule. */
	private perFontCache: Record<string, Record<string, string>> = {};
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
	 * Return `@font-face` CSS for all currently loaded fonts, with font
	 * file URLs replaced by base64 data URIs. Result is memoised until
	 * `invalidateFrame()` is called.
	 */
	async buildFrameFontCSS(): Promise<string> {
		if (this.frameCache !== null) return this.frameCache;

		const usedFontUrls = performance.getEntriesByType('resource')
			.filter(f => f.name.startsWith('https://fonts.gstatic.com/'))
			.map(f => f.name);

		let fontCss = '';
		for (const fontName of Object.keys(this.loadedFonts)) {
			if (!this.perFontCache[fontName]) {
				const href = this.loadedFonts[fontName];
				let fontSheet = '';
				try {
					fontSheet = await (await fetch(href, { cache: 'force-cache' })).text();
				} catch {
					continue;
				}
				this.perFontCache[fontName] = {};

				const styleSheet = new CSSStyleSheet();
				await styleSheet.replace(fontSheet);

				await Promise.all([...styleSheet.cssRules].map(async rule => {
					if (rule.type !== CSSRule.FONT_FACE_RULE) return;
					const url = rule.cssText.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, '');
					if (!url) return;
					if (usedFontUrls.includes(url)) {
						const embedded = await this.embedFontUrl(rule.cssText);
						if (embedded) this.perFontCache[fontName][url] = embedded;
					} else {
						this.perFontCache[fontName][url] = rule.cssText;
					}
				}));
			}

			for (const [url, cssText] of Object.entries(this.perFontCache[fontName])) {
				if (usedFontUrls.includes(url)) {
					if (cssText.includes(url)) {
						const embedded = await this.embedFontUrl(cssText);
						if (embedded) {
							this.perFontCache[fontName][url] = embedded;
							fontCss += embedded;
						}
					} else {
						fontCss += cssText;
					}
				}
			}
		}

		this.frameCache = fontCss;
		return fontCss;
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

	/** Replace a remote font URL inside a `@font-face` rule with a data URI. */
	private async embedFontUrl(cssText: string): Promise<string | null> {
		const url = cssText.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, '');
		if (!url) return null;
		try {
			const blob = await (await fetch(url)).blob();
			const base64 = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
				reader.onerror = reject;
				reader.readAsDataURL(blob);
			});
			return cssText.replace(url, `data:${blob.type};base64,${base64}`);
		} catch {
			return cssText;
		}
	}
}
