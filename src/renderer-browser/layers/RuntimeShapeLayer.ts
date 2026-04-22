/**
 * RuntimeShapeLayer — runtime class for vector shape layers.
 *
 * The `$element` is a `<div>` wrapping an inline `<svg>` that draws the
 * silhouette (`<rect>`, `<ellipse>`, `<polygon>`). Keeping the root as an
 * `HTMLElement` (not an `SVGSVGElement`) lets the shape flow through the
 * same CSS transform / filter / shadow pipeline as every other visual
 * layer; the SVG inside handles the actual drawing.
 *
 * The whole layer rasterizes through the tier-3 `foreignObject` path. The
 * per-layer cache still shortcuts frames where the resolved properties do
 * not change, so static shapes cost one rasterization total.
 *
 * `stroke` is implicit: whenever `strokeWidth > 0` a stroke is drawn. We
 * inset the path by `strokeWidth/2` so the *outer* edge of the stroke sits
 * on the shape's box boundary (matches CSS `box-sizing: border-box`).
 *
 * All sizes are project-relative — `em` resolves via `--vw`, `%` uses the
 * corresponding project axis, `vmin` / `vmax` the respective min/max — so
 * scaling the project up or down leaves shapes visually identical.
 */

import RuntimeVisualLayer from './RuntimeVisualLayer.js';

type SizeAxis = 'width' | 'height' | 'min';

const SVG_NS = 'http://www.w3.org/2000/svg';

const SHAPE_DRAW_KEYS = new Set([
	'width', 'height', 'fill', 'strokeColor', 'strokeWidth',
	'cornerRadius', 'sides', 'innerRadius',
]);

export default class RuntimeShapeLayer extends RuntimeVisualLayer {
	private $svg: SVGSVGElement | null = null;
	private $shape: SVGElement | null = null;
	/** Last drawing key — identical key = DOM already reflects this state. */
	private lastDrawKey = '';

	get shapeType(): string {
		return (this.json.settings as any).shapeType ?? 'rectangle';
	}

	async generateElement(): Promise<HTMLElement | null> {
		if (this.$element) return this.$element;

		const wrapper = document.createElement('div');
		wrapper.setAttribute('data-element', 'shape');
		wrapper.setAttribute('data-shape-type', this.shapeType);
		wrapper.setAttribute('data-id', this.json.id);
		(wrapper as any).layerObject = this;

		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('xmlns', SVG_NS);
		svg.setAttribute('preserveAspectRatio', 'none');
		svg.style.display = 'block';
		svg.style.width = '100%';
		svg.style.height = '100%';
		svg.style.overflow = 'visible';
		wrapper.appendChild(svg);

		this.$element = wrapper;
		this.$svg = svg;
		return wrapper;
	}

	/**
	 * Intercept the shape-specific properties and draw them into the SVG,
	 * then hand the remaining props to the normal CSS pipeline (opacity,
	 * transform, filter, border, shadow, …).
	 */
	async applyProperties(props: Record<string, any>): Promise<void> {
		const pw = this.projectWidth;
		const ph = this.projectHeight;
		const shapeType = this.shapeType;

		const sizeW = this.resolveToPx(props.width, pw, ph, 'width')
			?? (shapeType === 'rectangle' ? pw : Math.min(pw, ph));
		const sizeH = this.resolveToPx(props.height, pw, ph, 'height')
			?? (shapeType === 'rectangle' ? ph : Math.min(pw, ph));

		const fill = (props.fill ?? '#ffffff') as string;
		const strokeColor = (props.strokeColor ?? '#000000') as string;
		const strokeWidthPx = this.resolveToPx(props.strokeWidth, pw, ph, 'min') ?? 0;
		const cornerRadiusPx = this.resolveToPx(props.cornerRadius, sizeW, sizeH, 'min') ?? 0;
		const sides = Math.max(3, Math.round(Number(props.sides ?? 6)));
		const innerRadius = Math.max(0, Math.min(1, Number(props.innerRadius ?? 0.5)));

		this.drawShape(sizeW, sizeH, fill, strokeColor, strokeWidthPx, cornerRadiusPx, sides, innerRadius);

		// Strip shape-specific props so the CSS pipeline ignores them.
		for (const k of SHAPE_DRAW_KEYS) delete props[k];

		return super.applyProperties(props);
	}

	/**
	 * Resolve a dimension value to pixels, respecting the unit. Returns
	 * `null` when the value is unset so the caller can pick a default.
	 *
	 * `axis` controls how `%` resolves:
	 * - `'width'` → percent of `refW`
	 * - `'height'` → percent of `refH`
	 * - `'min'` → percent of `min(refW, refH)`
	 */
	private resolveToPx(v: any, refW: number, refH: number, axis: SizeAxis): number | null {
		if (v == null || v === '') return null;
		const s = String(v);
		const m = s.match(/^(-?[0-9.]+)([a-z%]*)$/i);
		if (!m) return null;
		const n = parseFloat(m[1]);
		const unit = (m[2] || 'em').toLowerCase();
		const pw = this.projectWidth;
		const ph = this.projectHeight;
		switch (unit) {
			case 'em':   return n * 0.01 * pw;              // em = --vw = 1% project width
			case 'px':   return n;
			case '%':    return n * 0.01 * (
				axis === 'height' ? refH :
				axis === 'min'    ? Math.min(refW, refH) :
				refW
			);
			case 'vw':   return n * 0.01 * pw;
			case 'vh':   return n * 0.01 * ph;
			case 'vmin': return n * 0.01 * Math.min(pw, ph);
			case 'vmax': return n * 0.01 * Math.max(pw, ph);
			default:     return n;
		}
	}

	/** Update the SVG to reflect the current shape state. Skips work if nothing changed. */
	private drawShape(
		w: number, h: number,
		fill: string, strokeColor: string, strokeWidthPx: number,
		cornerRadiusPx: number, sides: number, innerRadius: number,
	): void {
		const wrapper = this.$element;
		const svg = this.$svg;
		if (!wrapper || !svg) return;

		const key = [
			this.shapeType, w, h,
			fill, strokeColor, strokeWidthPx,
			cornerRadiusPx, sides, innerRadius,
		].join('|');
		if (key === this.lastDrawKey) return;
		this.lastDrawKey = key;

		// Wrapper box drives layout; the SVG fills it and uses a viewBox
		// matching the same size so user-space coordinates are in px.
		wrapper.style.width = `${w}px`;
		wrapper.style.height = `${h}px`;
		svg.setAttribute('viewBox', `0 0 ${Math.max(1, w)} ${Math.max(1, h)}`);

		// Inset so the outer edge of the stroke sits on the box boundary.
		const sw = strokeWidthPx > 0 ? strokeWidthPx : 0;
		const inset = sw / 2;
		const innerW = Math.max(0, w - sw);
		const innerH = Math.max(0, h - sw);

		const shape = this.buildShapeElement(innerW, innerH, cornerRadiusPx, sides, innerRadius);
		shape.setAttribute('transform', `translate(${inset} ${inset})`);

		const hasFill = fill && fill !== 'transparent' && fill !== 'none';
		shape.setAttribute('fill', hasFill ? fill : 'none');

		const hasStroke = sw > 0 && strokeColor && strokeColor !== 'transparent' && strokeColor !== 'none';
		if (hasStroke) {
			shape.setAttribute('stroke', strokeColor);
			shape.setAttribute('stroke-width', String(sw));
			shape.setAttribute('stroke-linejoin', 'miter');
			shape.setAttribute('stroke-miterlimit', '4');
		} else {
			shape.setAttribute('stroke', 'none');
		}

		// Replace the previous shape element wholesale — cheaper and safer
		// than mutating attributes across shape-type changes.
		if (this.$shape) this.$shape.remove();
		svg.appendChild(shape);
		this.$shape = shape;
	}

	/** Build the SVG primitive for the current shapeType at the given inner size. */
	private buildShapeElement(w: number, h: number, cornerRadius: number, sides: number, innerRatio: number): SVGElement {
		switch (this.shapeType) {
			case 'ellipse': {
				const el = document.createElementNS(SVG_NS, 'ellipse');
				el.setAttribute('cx', String(w / 2));
				el.setAttribute('cy', String(h / 2));
				el.setAttribute('rx', String(Math.max(0, w / 2)));
				el.setAttribute('ry', String(Math.max(0, h / 2)));
				return el;
			}
			case 'polygon': {
				const el = document.createElementNS(SVG_NS, 'polygon');
				el.setAttribute('points', polygonPoints(w, h, sides));
				return el;
			}
			case 'star': {
				const el = document.createElementNS(SVG_NS, 'polygon');
				el.setAttribute('points', starPoints(w, h, sides, innerRatio));
				return el;
			}
			case 'rectangle':
			default: {
				const el = document.createElementNS(SVG_NS, 'rect');
				el.setAttribute('x', '0');
				el.setAttribute('y', '0');
				el.setAttribute('width', String(Math.max(0, w)));
				el.setAttribute('height', String(Math.max(0, h)));
				const r = Math.max(0, Math.min(cornerRadius, Math.min(w, h) / 2));
				if (r > 0) {
					el.setAttribute('rx', String(r));
					el.setAttribute('ry', String(r));
				}
				return el;
			}
		}
	}
}

function polygonPoints(w: number, h: number, sides: number): string {
	const cx = w / 2, cy = h / 2, rx = w / 2, ry = h / 2;
	const out: string[] = [];
	for (let i = 0; i < sides; i++) {
		const a = -Math.PI / 2 + (2 * Math.PI * i) / sides;
		out.push(`${cx + rx * Math.cos(a)},${cy + ry * Math.sin(a)}`);
	}
	return out.join(' ');
}

function starPoints(w: number, h: number, sides: number, innerRatio: number): string {
	const cx = w / 2, cy = h / 2, rxO = w / 2, ryO = h / 2;
	const rxI = rxO * innerRatio, ryI = ryO * innerRatio;
	const total = sides * 2;
	const out: string[] = [];
	for (let i = 0; i < total; i++) {
		const useOuter = i % 2 === 0;
		const rx = useOuter ? rxO : rxI;
		const ry = useOuter ? ryO : ryI;
		const a = -Math.PI / 2 + (Math.PI * i) / sides;
		out.push(`${cx + rx * Math.cos(a)},${cy + ry * Math.sin(a)}`);
	}
	return out.join(' ');
}
