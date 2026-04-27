/**
 * GroupLayer — a container that nests other layers and treats them as one.
 *
 * A group is a regular {@link VisualLayer} with no source content of its own.
 * Children added inside `$.group(...)`'s callback render onto the group's
 * private project-sized surface; that surface is then composited as if the
 * group were a single layer — so the group's own `position`, `scale`,
 * `rotation`, `opacity`, `filter*`, `borderRadius`, `boxShadow`,
 * `transitionIn` / `transitionOut`, and `effects` all apply to the entire
 * sub-tree at once.
 *
 * Timing model (v1):
 * - Inside the `$.group(...)` callback the flow's time pointer starts at `0`,
 *   relative to the group's start. Children may use `wait`, `animate`,
 *   `parallel`, etc. exactly as in the top-level flow — a `wait('1s')` inside
 *   a group at `startTime: 5s` lands the next child at `6s` of project time.
 * - At compile time those relative offsets are resolved into absolute
 *   timeline seconds on each child's `settings.startTime`, so renderers see
 *   children identically to top-level layers.
 * - The group's own footprint defaults to `[startTime, max(child.endTime)]`,
 *   so the group as a whole stays alive until its last child ends. This can
 *   be overridden by passing an explicit `sourceDuration` in the group's
 *   settings.
 *
 * Coordinate space (v1):
 * - The group's surface is project-sized; children continue to use
 *   project-relative `position` ([0..1] of project axes). The group's
 *   `position`, `scale`, `rotation` then transform the whole composite.
 * - Per-group width/height (a private coordinate space) is intentionally not
 *   in v1 — children stay in the same coordinate space they would use at the
 *   top level, which keeps grouping a non-disruptive editor operation.
 *
 * The class is a thin extension of {@link VisualLayer}: groups have no
 * type-specific properties of their own, so the entire visual property set
 * (transform, filters, borders, …) is inherited as-is.
 */

import VisualLayer, { VisualLayerProperties, VisualLayerSettings } from './VisualLayer.js';

export type GroupLayerSettings = VisualLayerSettings;
export type GroupLayerProperties = VisualLayerProperties;

export default class GroupLayer extends VisualLayer {
	static type = 'group';
	declare properties: GroupLayerProperties;
	declare settings: GroupLayerSettings;

	constructor(parent: any, properties: GroupLayerProperties = {}, settings: GroupLayerSettings = {}) {
		super(parent, properties, settings);
	}
}
