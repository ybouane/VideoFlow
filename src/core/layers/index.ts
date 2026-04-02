/**
 * Re-exports for all VideoFlow layer types.
 *
 * The layer hierarchy mirrors Scrptly:
 *
 *   BaseLayer
 *   ├─ VisualLayer
 *   │  ├─ TextualLayer
 *   │  │  ├─ TextLayer
 *   │  │  └─ CaptionsLayer
 *   │  └─ MediaLayer
 *   │     ├─ ImageLayer
 *   │     └─ VideoLayer  (also has auditory properties)
 *   └─ AuditoryLayer
 *      └─ AudioLayer
 */

export { default as BaseLayer } from './BaseLayer.js';
export type { BaseLayerSettings, BaseLayerProperties } from './BaseLayer.js';

export { default as VisualLayer } from './VisualLayer.js';
export type { VisualLayerSettings, VisualLayerProperties } from './VisualLayer.js';

export { default as TextualLayer } from './TextualLayer.js';
export type { TextualLayerSettings, TextualLayerProperties } from './TextualLayer.js';

export { default as TextLayer } from './TextLayer.js';
export type { TextLayerSettings, TextLayerProperties } from './TextLayer.js';

export { default as CaptionsLayer } from './CaptionsLayer.js';
export type { CaptionsLayerSettings, CaptionsLayerProperties, CaptionEntry } from './CaptionsLayer.js';

export { default as MediaLayer } from './MediaLayer.js';
export type { MediaLayerSettings, MediaLayerProperties } from './MediaLayer.js';

export { default as ImageLayer } from './ImageLayer.js';
export type { ImageLayerSettings, ImageLayerProperties } from './ImageLayer.js';

export { default as VideoLayer } from './VideoLayer.js';
export type { VideoLayerSettings, VideoLayerProperties } from './VideoLayer.js';

export { default as AuditoryLayer } from './AuditoryLayer.js';
export type { AuditoryLayerSettings, AuditoryLayerProperties } from './AuditoryLayer.js';

export { default as AudioLayer } from './AudioLayer.js';
export type { AudioLayerSettings, AudioLayerProperties } from './AudioLayer.js';
