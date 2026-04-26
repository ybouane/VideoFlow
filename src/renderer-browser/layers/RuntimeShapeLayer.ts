/**
 * RuntimeShapeLayer — runtime class for vector shape layers.
 *
 * The element is a div wrapping an inline svg that draws the silhouette
 * (rect, ellipse, polygon). Keeping the root as an HTMLElement (not an
 * SVGSVGElement) lets the shape flow through the same CSS transform /
 * filter / shadow pipeline as every other visual layer; the SVG inside
 * handles the actual drawing.
 *
 * The whole layer rasterizes through the tier-3 foreignObject path. The
 * per-layer cache still shortcuts frames where the resolved properties do
 * not change, so static shapes cost one rasterization total.
 *
 * Stroke is implicit: whenever strokeWidth > 0 a stroke is drawn. Fill and
 * stroke are emitted as two separate SVG primitives so stroke alignment
 * (inner / center / outer) can move the stroke independently of the fill,
 * which always sits at the layer's box size.
 *
 * All sizes are project-relative. The shape layer's em unit resolves to
 * min(projectWidth, projectHeight) / 100 — so 100em always spans the
 * project's shorter axis. At width: 100em, height: 100em an ellipse is
 * a circle and a rectangle is a square inscribed in the project's shorter
 * side, regardless of the project's aspect ratio. Scaling the project up
 * or down leaves shapes visually identical.
 */

import RuntimeVisualLayer from './RuntimeVisualLayer.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

const SHAPE_DRAW_KEYS = new Set([
	'width', 'height', 'fill', 'strokeColor', 'strokeWidth', 'strokeAlignment',
	'strokeDash', 'strokeGap', 'strokeLinejoin',
	'cornerRadius', 'sides', 'innerRadius',
]);

type StrokeAlignment = 'inner' | 'center' | 'outer';
type StrokeLinejoin = 'miter' | 'round' | 'bevel';

type ShapeDrawState = {
	/** Raw em values — used for CSS calc() so the wrapper scales with --vmin. */
	emW: number; emH: number;
	/** Intrinsic user-space pixels (em * vmin-in-project-px). Used for viewBox and inner SVG coordinates. */
	w: number; h: number;
	fill: string; strokeColor: string; strokeWidth: number;
	cornerRadius: number; sides: number; innerRadius: number;
	strokeAlignment: StrokeAlignment;
	strokeDash: number; strokeGap: number;
	strokeLinejoin: StrokeLinejoin;
};

export default class RuntimeShapeLayer extends RuntimeVisualLayer {
	private $svg: SVGSVGElement | null = null;
	/** Last drawing key — identical key = SVG primitives already reflect this state. */
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
		// Allow outer-aligned strokes to render past the viewBox edge.
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
		const emW = this.emNumber(props.width);
		const emH = this.emNumber(props.height);
		const state: ShapeDrawState = {
			emW, emH,
			w: this.emToPx(emW),
			h: this.emToPx(emH),
			fill: (props.fill ?? '#ffffff') as string,
			strokeColor: (props.strokeColor ?? '#000000') as string,
			strokeWidth: this.emToPx(this.emNumber(props.strokeWidth)),
			cornerRadius: this.emToPx(this.emNumber(props.cornerRadius)),
			sides: Math.max(3, Math.round(Number(props.sides ?? 6))),
			innerRadius: Math.max(0, Math.min(1, Number(props.innerRadius ?? 0.5))),
			strokeAlignment: ((props.strokeAlignment ?? 'inner') as StrokeAlignment),
			strokeDash: this.emToPx(this.emNumber(props.strokeDash)),
			strokeGap: this.emToPx(this.emNumber(props.strokeGap)),
			strokeLinejoin: ((props.strokeLinejoin ?? 'miter') as StrokeLinejoin),
		};

		// Strip shape-specific props so the CSS pipeline ignores them.
		for (const k of SHAPE_DRAW_KEYS) delete props[k];

		// Run the base CSS pipeline first — it resets cssText on the wrapper,
		// so width/height must be (re)applied after it runs.
		await super.applyProperties(props);

		this.drawShape(state);
	}

	/** Parse a raw em number off a prop value (accepts numbers and "Nem" strings). */
	private emNumber(v: any): number {
		const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
		return Number.isFinite(n) ? n : 0;
	}

	/**
	 * Resolve an em number to intrinsic project pixels. `1em` equals
	 * `min(projectWidth, projectHeight) / 100` — so 100em spans the
	 * shorter axis. These pixels drive the SVG's user-space (viewBox and
	 * inner coordinates); the outer wrapper uses CSS `calc(V * var(--vmin))`
	 * so the shape scales with the renderer root in DOM preview.
	 */
	private emToPx(n: number): number {
		const axis = Math.min(this.projectWidth, this.projectHeight);
		return n * 0.01 * axis;
	}

	/**
	 * Update the SVG to reflect the current shape state. Wrapper size and
	 * viewBox are always reapplied (the base pipeline wiped cssText); the
	 * SVG primitive rebuild is skipped if nothing else changed.
	 */
	private drawShape(s: ShapeDrawState): void {
		const wrapper = this.$element;
		const svg = this.$svg;
		if (!wrapper || !svg) return;

		// Wrapper box drives layout. Size via CSS calc() so it scales with
		// the renderer root (DomRenderer scales --vmin to fit the container;
		// BrowserRenderer uses intrinsic project pixels — same expression
		// produces the right value in both).
		wrapper.style.width = `calc(${s.emW} * var(--vmin))`;
		wrapper.style.height = `calc(${s.emH} * var(--vmin))`;
		svg.setAttribute('viewBox', `0 0 ${Math.max(1, s.w)} ${Math.max(1, s.h)}`);

		const key = JSON.stringify([this.shapeType, s]);
		if (key === this.lastDrawKey) return;
		this.lastDrawKey = key;

		const sw = s.strokeWidth > 0 ? s.strokeWidth : 0;
		const hasFill = !!s.fill && s.fill !== 'transparent' && s.fill !== 'none';
		const hasStroke = sw > 0 && !!s.strokeColor && s.strokeColor !== 'transparent' && s.strokeColor !== 'none';

		// Stroke alignment shifts the stroke path relative to the fill box.
		// Positive inset = stroke moves inward (inner alignment).
		// Negative inset = stroke moves outward (outer alignment).
		let strokeInset = 0;
		if (hasStroke) {
			if (s.strokeAlignment === 'inner') strokeInset = sw / 2;
			else if (s.strokeAlignment === 'outer') strokeInset = -sw / 2;
		}

		while (svg.firstChild) svg.removeChild(svg.firstChild);

		if (hasFill) {
			const fillEl = this.buildShapeElement(s.w, s.h, s.cornerRadius, s.sides, s.innerRadius);
			fillEl.setAttribute('fill', s.fill);
			fillEl.setAttribute('stroke', 'none');
			svg.appendChild(fillEl);
		}

		if (hasStroke) {
			const strokeW = Math.max(0, s.w - 2 * strokeInset);
			const strokeH = Math.max(0, s.h - 2 * strokeInset);
			// Adjust corner radius so the visible outer/inner edge keeps the user-set radius.
			const strokeR = Math.max(0, s.cornerRadius - strokeInset);
			const strokeEl = this.buildShapeElement(strokeW, strokeH, strokeR, s.sides, s.innerRadius);
			strokeEl.setAttribute('transform', `translate(${strokeInset} ${strokeInset})`);
			strokeEl.setAttribute('fill', 'none');
			strokeEl.setAttribute('stroke', s.strokeColor);
			strokeEl.setAttribute('stroke-width', String(sw));
			strokeEl.setAttribute('stroke-linejoin', s.strokeLinejoin);
			if (s.strokeLinejoin === 'miter') strokeEl.setAttribute('stroke-miterlimit', '4');
			if (s.strokeDash > 0) {
				const gap = s.strokeGap > 0 ? s.strokeGap : s.strokeDash;
				strokeEl.setAttribute('stroke-dasharray', `${s.strokeDash} ${gap}`);
				strokeEl.setAttribute('stroke-linecap', 'butt');
			}
			svg.appendChild(strokeEl);
		}
	}

	/** Build the SVG primitive for the current shapeType at the given size. */
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
