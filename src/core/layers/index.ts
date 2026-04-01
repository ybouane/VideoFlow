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

export { default as BaseLayer } from './BaseLayer';
export type { BaseLayerSettings, BaseLayerProperties } from './BaseLayer';

export { default as VisualLayer } from './VisualLayer';
export type { VisualLayerSettings, VisualLayerProperties } from './VisualLayer';

export { default as TextualLayer } from './TextualLayer';
export type { TextualLayerSettings, TextualLayerProperties } from './TextualLayer';

export { default as TextLayer } from './TextLayer';
export type { TextLayerSettings, TextLayerProperties } from './TextLayer';

export { default as CaptionsLayer } from './CaptionsLayer';
export type { CaptionsLayerSettings, CaptionsLayerProperties, CaptionEntry } from './CaptionsLayer';

export { default as MediaLayer } from './MediaLayer';
export type { MediaLayerSettings, MediaLayerProperties } from './MediaLayer';

export { default as ImageLayer } from './ImageLayer';
export type { ImageLayerSettings, ImageLayerProperties } from './ImageLayer';

export { default as VideoLayer } from './VideoLayer';
export type { VideoLayerSettings, VideoLayerProperties } from './VideoLayer';

export { default as AuditoryLayer } from './AuditoryLayer';
export type { AuditoryLayerSettings, AuditoryLayerProperties } from './AuditoryLayer';

export { default as AudioLayer } from './AudioLayer';
export type { AudioLayerSettings, AudioLayerProperties } from './AudioLayer';
