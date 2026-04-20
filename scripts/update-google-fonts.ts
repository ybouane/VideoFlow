/**
 * Update the bundled Google Fonts registry.
 *
 * Fetches the full font list (including variable-font axis metadata) from
 * the Google Fonts WebFonts API and writes it to
 * src/renderer-browser/googlefonts.json.
 *
 * Usage:
 *   npx tsx scripts/update-google-fonts.ts
 *
 * You will be prompted for your Google Fonts API key. Keys are free and can
 * be created at https://console.cloud.google.com/ — enable the "Web Fonts
 * Developer API" and create a browser API key (no restriction required for
 * local use). Never commit the key to source control.
 */

import { createInterface } from 'readline';
import { writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Prompt for API key ─────────────────────────────────────────────────────

const rl = createInterface({ input: process.stdin, output: process.stdout });

const apiKey = await new Promise<string>(resolve => {
	rl.question('Google Fonts API key: ', key => {
		rl.close();
		resolve(key.trim());
	});
});

if (!apiKey) {
	console.error('No API key provided. Aborting.');
	process.exit(1);
}

// ── Fetch font list ────────────────────────────────────────────────────────

// capability=VF requests the variable-font axis metadata (start/end ranges).
const url = `https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&capability=VF&sort=alpha`;

console.log('Fetching font data from Google Fonts API…');

const response = await fetch(url);
if (!response.ok) {
	const body = await response.text().catch(() => '');
	console.error(`HTTP ${response.status}: ${body}`);
	process.exit(1);
}

const data = await response.json() as { kind: string; items: unknown[] };

// ── Strip fields not needed at runtime to keep bundle size down ────────────

const trimmed = {
	kind: data.kind,
	items: data.items.map((item: any) => {
		// Keep only the fields consumed by googleFontLoader.ts
		const { family, variants, subsets, axes } = item;
		return axes?.length
			? { family, variants, subsets, axes: axes.map(({ tag, start, end }: any) => ({ tag, start, end })) }
			: { family, variants, subsets };
	}),
};

// ── Write output ───────────────────────────────────────────────────────────

const outputPath = join(__dirname, '../src/renderer-browser/googlefonts.json');
await writeFile(outputPath, JSON.stringify(trimmed, null, 2));

console.log(`✓ Saved ${trimmed.items.length} fonts → src/renderer-browser/googlefonts.json`);
console.log('  Rebuild the renderer bundle to pick up the changes:');
console.log('  npm run build -w src/renderer-browser');
console.log('  npx tsx examples/web-player/build.ts');
