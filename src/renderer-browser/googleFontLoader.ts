/**
 * Google Font URL builder.
 *
 * Constructs a valid `fonts.googleapis.com/css2` URL for any font in the
 * bundled registry. The registry carries variable-font axis ranges and
 * static weight variants, which allows the URL to be built precisely —
 * avoiding the 400 errors that come from requesting axis combinations the
 * font doesn't support.
 *
 * Algorithm ported from the Scrptly renderer.
 */

import allFonts from './googlefonts.json';

type FontAxis = { tag: string; start: number; end: number };
type FontEntry = {
	family: string;
	variants: string[];
	subsets: string[];
	axes?: FontAxis[];
};

const fontList = (allFonts as unknown as { items: FontEntry[] }).items;

/**
 * Build the Google Fonts CSS2 URL for `fontName`.
 *
 * Returns `null` if the font is not in the registry (caller can fall
 * back to a naive URL or skip loading).
 */
export function buildFontUrl(fontName: string): string | null {
	const fontObj = fontList.find(
		f => f.family.toLowerCase() === fontName.toLowerCase()
	);
	if (!fontObj) return null;

	const encoded = fontName.replace(/ /g, '+');
	const isVariable = Array.isArray(fontObj.axes) && fontObj.axes.length > 0;

	// Collect axes we'll encode into the family parameter.
	type AxisSpec = { axis: string; value: string | string[] };
	const axes: AxisSpec[] = [];

	// Variable font axes (e.g. wght 100..900, wdth 75..125).
	if (isVariable) {
		for (const ax of fontObj.axes!) {
			axes.push({ axis: ax.tag, value: `${ax.start}..${ax.end}` });
		}
	}

	// Italic support adds an `ital` axis with discrete values 0 and 1.
	const hasItalic = fontObj.variants.some(v => v.includes('italic'));
	if (hasItalic) {
		axes.push({ axis: 'ital', value: ['0', '1'] });
	}

	// Static font: enumerate discrete weight values from the variants list.
	if (!isVariable && fontObj.variants?.includes('regular')) {
		const weights = [
			...new Set(
				fontObj.variants.map(v => {
					if (v === 'regular') return 400;
					const m = v.match(/^(\d+)(italic)?$/);
					return m ? parseInt(m[1], 10) : null;
				}).filter((w): w is number => w !== null)
			),
		];
		axes.push({ axis: 'wght', value: weights.map(String) });
	}

	// Drop any axis with an empty / null value.
	const validAxes = axes.filter(
		ax => ax.value != null && (typeof ax.value === 'string' ? ax.value.length > 0 : ax.value.length > 0)
	);

	// Sort alphabetically, lower-case axes first (Google's required ordering).
	validAxes.sort((a, b) => {
		const al = a.axis.toLowerCase();
		const bl = b.axis.toLowerCase();
		const aIsLower = a.axis === al;
		const bIsLower = b.axis === bl;
		if (aIsLower && !bIsLower) return -1;
		if (!aIsLower && bIsLower) return 1;
		return al < bl ? -1 : al > bl ? 1 : 0;
	});

	// Build the `family=…` query segment.
	let familyQuery: string;
	if (validAxes.length > 1) {
		const tags = validAxes.map(ax => ax.axis).join(',');
		const valueArrays = validAxes.map(ax =>
			Array.isArray(ax.value) ? ax.value : [ax.value]
		);
		// Cartesian product of all axis value lists.
		const cartesian = (arrays: string[][]): string[][] =>
			arrays.reduce<string[][]>(
				(acc, vals) => acc.flatMap(combo => vals.map(v => [...combo, v])),
				[[]]
			);
		const combos = cartesian(valueArrays)
			.map(combo => combo.join(','));
		familyQuery = `family=${encoded}:${tags}@${combos.join(';')}`;
	} else if (validAxes.length === 1) {
		const ax = validAxes[0];
		const val = Array.isArray(ax.value) ? ax.value.join(';') : ax.value;
		familyQuery = `family=${encoded}:${ax.axis}@${val}`;
	} else {
		familyQuery = `family=${encoded}`;
	}

	// Append subset query for completeness (helps with CJK/Cyrillic fonts).
	const subsetQuery = fontObj.subsets?.length
		? `&subset=${fontObj.subsets.join(',')}`
		: '';

	return `https://fonts.googleapis.com/css2?${familyQuery}${subsetQuery}&display=swap`;
}
