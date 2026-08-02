/**
 * Per-renderer layer-type registry.
 *
 * Every renderer instance (`BrowserRenderer`, `DomRenderer`) owns one of
 * these. It maps a `LayerJSON.type` string onto the runtime class that
 * renders it plus the property definitions that drive keyframe
 * interpolation, unit handling and CSS mapping for that type.
 *
 * There is deliberately **no process-global registry**: two renderers in the
 * same page can register different implementations for the same type name
 * without interfering with each other, which is what makes external layer
 * types safe to use in an editor that hosts several previews at once.
 *
 * ```ts
 * const renderer = new BrowserRenderer(videoJSON);
 * renderer.registerLayerType('custom', {
 *   runtime: RuntimeCustomLayer,
 *   propertiesDefinition: CustomLayer.propertiesDefinition,
 * });
 * await renderer.exportVideo();
 * ```
 */

import type { LayerJSON, PropertyDefinition } from '@videoflow/core/types';
import type RuntimeBaseLayer from './RuntimeBaseLayer.js';
import type { ILayerRenderer } from './RuntimeBaseLayer.js';

/**
 * Constructor signature every runtime layer class must satisfy.
 *
 * External layer types typically extend one of the exported runtime base
 * classes (`RuntimeBaseLayer`, `RuntimeVisualLayer`, `RuntimeTextualLayer`,
 * `RuntimeMediaLayer`) rather than implementing this from scratch.
 */
export type RuntimeLayerConstructor = new (
	json: LayerJSON,
	fps: number,
	width: number,
	height: number,
	renderer: ILayerRenderer,
) => RuntimeBaseLayer;

/**
 * Everything a renderer needs to know about one layer type.
 *
 * `runtime` and `propertiesDefinition` are always registered together so a
 * type can never end up with one renderer's runtime class and another's
 * property table — overriding a registration replaces both.
 */
export type LayerTypeDescriptor = {
	/** Runtime class instantiated for layers of this type. */
	runtime: RuntimeLayerConstructor;
	/**
	 * Property definitions for this type, in the same shape as a core layer
	 * class's static `propertiesDefinition`. Drives interpolation, unit
	 * suffixing, CSS mapping and defaults.
	 */
	propertiesDefinition: Record<string, PropertyDefinition>;
};

/**
 * A mutable, renderer-scoped map of layer type → {@link LayerTypeDescriptor}.
 *
 * Instances are normally created through
 * {@link createBuiltinLayerTypeRegistry} so they start out seeded with the
 * built-in types, then extended via `renderer.registerLayerType()`.
 */
export class LayerTypeRegistry {
	private types: Map<string, LayerTypeDescriptor> = new Map();

	/**
	 * @param owner - Human-readable name of the owning renderer (e.g.
	 *                `'BrowserRenderer'`). Used to make error messages point
	 *                at the specific renderer whose registry was consulted.
	 */
	constructor(public readonly owner: string) {}

	/**
	 * Register (or replace) a layer type.
	 *
	 * Re-registering an existing type — built-in or external — silently
	 * replaces the previous descriptor rather than throwing, which is what
	 * makes it possible to override a built-in type on one specific renderer.
	 */
	register(type: string, descriptor: LayerTypeDescriptor): void {
		if (typeof type !== 'string' || type.length === 0) {
			throw new Error(`${this.owner}.registerLayerType: "type" must be a non-empty string.`);
		}
		if (!descriptor || typeof descriptor.runtime !== 'function') {
			throw new Error(
				`${this.owner}.registerLayerType("${type}"): descriptor.runtime must be a runtime layer class.`,
			);
		}
		if (!descriptor.propertiesDefinition || typeof descriptor.propertiesDefinition !== 'object') {
			throw new Error(
				`${this.owner}.registerLayerType("${type}"): descriptor.propertiesDefinition must be an object.`,
			);
		}
		this.types.set(type, {
			runtime: descriptor.runtime,
			propertiesDefinition: descriptor.propertiesDefinition,
		});
	}

	/** The descriptor registered for `type`, or `undefined` when unknown. */
	get(type: string): LayerTypeDescriptor | undefined {
		return this.types.get(type);
	}

	/** Whether `type` is registered on this renderer. */
	has(type: string): boolean {
		return this.types.has(type);
	}

	/** Every registered type name, in registration order. */
	list(): string[] {
		return [...this.types.keys()];
	}

	/**
	 * Like {@link get}, but throws a descriptive error naming the unknown type
	 * and the renderer whose registry was consulted.
	 */
	require(type: string): LayerTypeDescriptor {
		const descriptor = this.types.get(type);
		if (!descriptor) {
			throw new Error(
				`${this.owner}: unknown layer type "${type}". Registered types: ${this.list().join(', ') || '(none)'}. ` +
				`Register it with renderer.registerLayerType("${type}", { runtime, propertiesDefinition }) ` +
				`before the renderer creates its runtime layers.`,
			);
		}
		return descriptor;
	}

	/**
	 * Property definitions for `type`, or a single property's definition when
	 * `prop` is given. Returns `undefined` for unknown types / properties —
	 * lookups are on the hot per-frame path and must not throw.
	 */
	getPropertyDefinition(type: string): Record<string, PropertyDefinition> | undefined;
	getPropertyDefinition(type: string, prop: string): PropertyDefinition | undefined;
	getPropertyDefinition(
		type: string,
		prop?: string,
	): Record<string, PropertyDefinition> | PropertyDefinition | undefined {
		const defs = this.types.get(type)?.propertiesDefinition;
		if (prop !== undefined) return defs?.[prop];
		return defs;
	}

	/**
	 * Instantiate the runtime layer registered for `json.type`.
	 *
	 * Throws for unregistered types — a silent fallback would render the layer
	 * as an invisible no-op, which is far harder to diagnose than a typo in a
	 * type name.
	 */
	createRuntimeLayer(
		json: LayerJSON,
		fps: number,
		width: number,
		height: number,
		renderer: ILayerRenderer,
	): RuntimeBaseLayer {
		const { runtime: Runtime } = this.require(json.type);
		return new Runtime(json, fps, width, height, renderer);
	}
}
