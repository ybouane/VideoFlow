/**
 * @videoflow/core — public entry point.
 *
 * Re-exports the VideoFlow builder class, all layer types, utility functions,
 * and shared type definitions so consumers can import everything from a
 * single package:
 *
 * ```ts
 * import VideoFlow from '@videoflow/core';
 * import { TextLayer, parseTime } from '@videoflow/core';
 * ```
 */

export { default } from './VideoFlow.js';
export { default as VideoFlow } from './VideoFlow.js';

// Layer classes
export {
	BaseLayer,
	VisualLayer,
	TextualLayer,
	TextLayer,
	CaptionsLayer,
	MediaLayer,
	ImageLayer,
	VideoLayer,
	AuditoryLayer,
	AudioLayer,
} from './layers/index.js';

// Layer setting / property types
export type {
	BaseLayerSettings, BaseLayerProperties,
	VisualLayerSettings, VisualLayerProperties,
	TextualLayerSettings, TextualLayerProperties,
	TextLayerSettings, TextLayerProperties,
	CaptionsLayerSettings, CaptionsLayerProperties, CaptionEntry,
	MediaLayerSettings, MediaLayerProperties,
	ImageLayerSettings, ImageLayerProperties,
	VideoLayerSettings, VideoLayerProperties,
	AuditoryLayerSettings, AuditoryLayerProperties,
	AudioLayerSettings, AudioLayerProperties,
} from './layers/index.js';

// Core types
export type {
	Time, Id, Easing, Keyframe, Animation,
	Action, AddLayerOptions,
	VideoJSON, LayerJSON, LayerSettingsJSON, LayerTransitionJSON, LayerEffectJSON,
	PropertyDefinition, RenderOptions, ProjectSettings,
} from './types.js';

// Utilities
export {
	parseTime, timeToFrames, framesToTime, formatTime,
	audioBufferToWav, createDeferred, delay,
} from './utils.js';

// Global media cache (refcounted, time-evicted)
export { MediaCache, loadedMedia } from './MediaCache.js';
export type { MediaEntry } from './MediaCache.js';
