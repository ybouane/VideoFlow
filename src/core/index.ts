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

export { default } from './VideoFlow';
export { default as VideoFlow } from './VideoFlow';

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
} from './layers/index';

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
} from './layers/index';

// Core types
export type {
	Time, Id, Easing, Keyframe, Animation,
	Action, AddLayerOptions,
	VideoJSON, LayerJSON, LayerSettingsJSON,
	PropertyDefinition, RenderOptions, ProjectSettings,
} from './types';

// Utilities
export {
	parseTime, timeToFrames, framesToTime, formatTime,
	audioBufferToWav, createDeferred, delay,
} from './utils';
