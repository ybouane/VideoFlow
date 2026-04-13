var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/MediaCache.ts
var MediaCache_exports = {};
__export(MediaCache_exports, {
  MediaCache: () => MediaCache,
  loadedMedia: () => loadedMedia
});
function scheduleUnref(fn, ms) {
  const t = setTimeout(fn, ms);
  if (typeof t.unref === "function") t.unref();
  return t;
}
var MediaCache, loadedMedia;
var init_MediaCache = __esm({
  "src/core/MediaCache.ts"() {
    "use strict";
    MediaCache = class _MediaCache {
      /** Promise-valued so concurrent acquires share the same in-flight fetch. */
      map = /* @__PURE__ */ new Map();
      /** Grace period before an unref'd entry is evicted. */
      static EVICTION_DELAY_MS = 5e3;
      /** Synchronous existence check (does not change refcounts). */
      has(url2) {
        return this.map.has(url2);
      }
      /**
       * Take a reference to a source. Fetches the bytes if the entry is not
       * already in the cache; otherwise returns the existing entry. Cancels any
       * pending eviction timer and increments `refCount`.
       */
      async acquire(url2) {
        let pending = this.map.get(url2);
        if (!pending) {
          pending = this.fetchAndStore(url2);
          this.map.set(url2, pending);
        }
        let entry;
        try {
          entry = await pending;
        } catch (err) {
          if (this.map.get(url2) === pending) this.map.delete(url2);
          throw err;
        }
        if (entry.evictionTimer) {
          clearTimeout(entry.evictionTimer);
          entry.evictionTimer = null;
        }
        entry.refCount++;
        return entry;
      }
      /**
       * Release a reference. When the last reference goes away the entry is
       * scheduled for eviction after `EVICTION_DELAY_MS`. Calling `acquire()`
       * again before the timer fires cancels the eviction.
       */
      release(url2) {
        const pending = this.map.get(url2);
        if (!pending) return;
        pending.then((entry) => {
          if (entry.refCount <= 0) return;
          entry.refCount--;
          if (entry.refCount === 0 && !entry.evictionTimer) {
            entry.evictionTimer = scheduleUnref(() => this.evict(url2), _MediaCache.EVICTION_DELAY_MS);
          }
        }).catch(() => {
        });
      }
      /**
       * Insert bytes the caller already has (e.g. the compile-time probe).
       *
       * - If the entry exists, updates `duration` if a non-zero value is passed
       *   and the entry's duration is still 0. Does NOT touch refCount or any
       *   pending timer.
       * - If the entry does not exist, inserts it with `refCount = 0` and
       *   immediately schedules a 5 s eviction timer. A subsequent `acquire`
       *   cancels the timer and bumps refCount; otherwise the entry is dropped.
       */
      async populate(url2, blob, duration) {
        const existing = this.map.get(url2);
        if (existing) {
          const entry2 = await existing;
          if (duration != null && Number.isFinite(duration) && duration > 0 && !(entry2.duration > 0)) {
            entry2.duration = duration;
          }
          return entry2;
        }
        const entry = {
          blob,
          objectUrl: URL.createObjectURL(blob),
          duration: duration && Number.isFinite(duration) && duration > 0 ? duration : 0,
          dimensions: void 0,
          refCount: 0,
          evictionTimer: null
        };
        entry.evictionTimer = scheduleUnref(() => this.evict(url2), _MediaCache.EVICTION_DELAY_MS);
        this.map.set(url2, Promise.resolve(entry));
        return entry;
      }
      /**
       * Synchronously look up an entry without changing its refcount.
       * Returns undefined if the entry has not finished fetching yet.
       */
      peek(url2) {
        const pending = this.map.get(url2);
        if (!pending) return void 0;
        let result;
        pending.then((e) => {
          result = e;
        });
        return result;
      }
      // ---- internal --------------------------------------------------------
      async fetchAndStore(url2) {
        const response = await fetch(url2, { cache: "default" });
        if (!response.ok) {
          throw new Error(`MediaCache: failed to fetch "${url2}": ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        const entry = {
          blob,
          objectUrl: URL.createObjectURL(blob),
          duration: 0,
          dimensions: void 0,
          refCount: 0,
          evictionTimer: null
        };
        return entry;
      }
      evict(url2) {
        const pending = this.map.get(url2);
        if (!pending) return;
        pending.then((entry) => {
          if (entry.refCount > 0) return;
          try {
            URL.revokeObjectURL(entry.objectUrl);
          } catch {
          }
          if (this.map.get(url2) === pending) this.map.delete(url2);
        }).catch(() => {
          if (this.map.get(url2) === pending) this.map.delete(url2);
        });
      }
    };
    loadedMedia = new MediaCache();
  }
});

// src/core/utils.ts
function parseTime(time, fps = 30) {
  if (typeof time === "number") return time;
  const t = String(time).trim();
  if (/^[\d:]+$/.test(t) && t.includes(":")) {
    const parts = t.split(":").map(Number);
    let hours = 0, minutes = 0, seconds = 0, frames = 0;
    if (parts.length === 2) {
      [minutes, seconds] = parts;
    } else if (parts.length === 3) {
      [hours, minutes, seconds] = parts;
    } else if (parts.length === 4) {
      [hours, minutes, seconds, frames] = parts;
    }
    return hours * 3600 + minutes * 60 + seconds + frames / fps;
  }
  if (t.endsWith("f")) {
    return parseFloat(t.slice(0, -1)) / fps;
  }
  if (t.endsWith("ms")) {
    return parseFloat(t.slice(0, -2)) / 1e3;
  }
  if (t.endsWith("h")) {
    return parseFloat(t.slice(0, -1)) * 3600;
  }
  if (t.endsWith("m")) {
    return parseFloat(t.slice(0, -1)) * 60;
  }
  if (t.endsWith("s")) {
    return parseFloat(t.slice(0, -1));
  }
  if (/^[\d.]+$/.test(t)) {
    return parseFloat(t);
  }
  throw new Error(`Invalid time format: "${time}"`);
}
function timeToFrames(time, fps) {
  return Math.round(parseTime(time, fps) * fps);
}
function audioBufferToWav(buffer, opt) {
  opt = opt || {};
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = opt.float32 ? 3 : 1;
  const bitDepth = format === 3 ? 32 : 16;
  let result;
  if (numChannels === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }
  return encodeWAV(result, format, sampleRate, numChannels, bitDepth);
}
function interleave(inputL, inputR) {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0, inputIndex = 0;
  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}
function encodeWAV(samples, format, sampleRate, numChannels, bitDepth) {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view2 = new DataView(buffer);
  writeString(view2, 0, "RIFF");
  view2.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(view2, 8, "WAVE");
  writeString(view2, 12, "fmt ");
  view2.setUint32(16, 16, true);
  view2.setUint16(20, format, true);
  view2.setUint16(22, numChannels, true);
  view2.setUint32(24, sampleRate, true);
  view2.setUint32(28, sampleRate * blockAlign, true);
  view2.setUint16(32, blockAlign, true);
  view2.setUint16(34, bitDepth, true);
  writeString(view2, 36, "data");
  view2.setUint32(40, samples.length * bytesPerSample, true);
  if (format === 1) {
    floatTo16BitPCM(view2, 44, samples);
  } else {
    writeFloat32(view2, 44, samples);
  }
  return buffer;
}
function writeString(view2, offset, str) {
  for (let i = 0; i < str.length; i++) {
    view2.setUint8(offset + i, str.charCodeAt(i));
  }
}
function writeFloat32(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 4) {
    output.setFloat32(offset, input[i], true);
  }
}
function floatTo16BitPCM(output, offset, input) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
  }
}
async function probeMediaDuration(source, kind) {
  const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
  if (isBrowser) {
    const { loadedMedia: loadedMedia2 } = await Promise.resolve().then(() => (init_MediaCache(), MediaCache_exports));
    const response = await fetch(source, { cache: "default" });
    if (!response.ok) {
      throw new Error(`probeMediaDuration: failed to fetch "${source}": ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const entry = await loadedMedia2.populate(source, blob);
    const duration = await new Promise((resolve, reject) => {
      const el = document.createElement(kind);
      el.preload = "metadata";
      el.muted = true;
      el.playsInline = true;
      const cleanup = () => {
        el.removeAttribute("src");
        try {
          el.load();
        } catch {
        }
      };
      el.onloadedmetadata = () => {
        const d = el.duration;
        cleanup();
        if (Number.isFinite(d) && d > 0) resolve(d);
        else reject(new Error(`probeMediaDuration: invalid duration for "${source}"`));
      };
      el.onerror = () => {
        cleanup();
        reject(new Error(`probeMediaDuration: failed to load "${source}"`));
      };
      el.src = entry.objectUrl;
    });
    await loadedMedia2.populate(source, blob, duration);
    return duration;
  }
  const cpName = ["child", "process"].join("_");
  const { spawn } = await import(
    /* @vite-ignore */
    /* webpackIgnore: true */
    cpName
  );
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let proc;
    try {
      proc = spawn("ffprobe", [
        "-v",
        "error",
        "-of",
        "json",
        "-show_format",
        source
      ]);
    } catch (e) {
      reject(new Error(`probeMediaDuration: failed to spawn ffprobe (${e?.message ?? e})`));
      return;
    }
    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => {
      reject(new Error(`probeMediaDuration: ffprobe error for "${source}": ${err?.message ?? err}`));
    });
    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`probeMediaDuration: ffprobe exited ${code} for "${source}": ${stderr.trim()}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        const d = parseFloat(parsed?.format?.duration);
        if (Number.isFinite(d) && d > 0) resolve(d);
        else reject(new Error(`probeMediaDuration: no duration in ffprobe output for "${source}"`));
      } catch (e) {
        reject(new Error(`probeMediaDuration: failed to parse ffprobe JSON for "${source}": ${e?.message ?? e}`));
      }
    });
  });
}

// src/core/VideoFlow.ts
init_MediaCache();

// src/core/layers/BaseLayer.ts
function createLayerId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `vf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
var BaseLayer = class {
  /** Unique identifier for this layer instance. */
  id;
  /** Machine-readable layer type tag (overridden by subclasses). */
  static type = "base";
  /** Layer settings (timing, enable state, etc.). */
  settings;
  /**
   * Layer properties — the visual/auditory attributes that can be animated.
   *
   * Each property key maps to either a static value or an array of
   * {@link Keyframe} objects describing its animation over time.
   */
  properties;
  /** Reference to the parent VideoFlow builder instance. */
  parent;
  /** Whether {@link remove} has already been called. */
  removed = false;
  /** The project's frames-per-second, cached for convenience. */
  fps;
  constructor(parent, properties = {}, settings = {}) {
    this.parent = parent;
    this.fps = parent?.settings?.fps ?? 30;
    this.id = createLayerId();
    this.settings = {
      ...this.constructor.defaultSettings,
      ...settings
    };
    this.properties = {
      ...this.constructor.defaultProperties,
      ...properties
    };
  }
  // -----------------------------------------------------------------------
  //  Static metadata
  // -----------------------------------------------------------------------
  /** Settings keys to include in the compiled JSON beyond the base keys. */
  static get settingsKeys() {
    return [];
  }
  /** Default settings for this layer type. */
  static get defaultSettings() {
    return {
      enabled: true,
      startTime: 0,
      sourceDuration: void 0,
      speed: 1,
      sourceStart: 0,
      sourceEnd: 0
    };
  }
  /**
   * Default property values derived from the properties definition.
   * Each key gets the `default` from its {@link PropertyDefinition}.
   */
  static get defaultProperties() {
    return Object.fromEntries(
      Object.entries(this.propertiesDefinition).map(([k, v]) => [k, v.default ?? ""])
    );
  }
  /**
   * Property definitions for this layer type.
   *
   * Each entry describes one animatable (or static) property, including its
   * CSS mapping, allowed units, default value, and whether it can be
   * interpolated between keyframes.
   */
  static get propertiesDefinition() {
    return {};
  }
  // -----------------------------------------------------------------------
  //  Time getters — derived values useful for inspection
  // -----------------------------------------------------------------------
  /** Timeline-time (frames) at which the playable segment starts. */
  get startFrame() {
    return timeToFrames(this.settings.startTime ?? 0, this.fps);
  }
  /** Source-time offset (frames) into the source where the segment begins. */
  get sourceStartFrames() {
    return timeToFrames(this.settings.sourceStart ?? 0, this.fps);
  }
  /** Length of the playable segment expressed in source-time frames. */
  get sourceDurationFrames() {
    if (this.settings.sourceDuration != null) {
      return timeToFrames(this.settings.sourceDuration, this.fps);
    }
    return 0;
  }
  /**
   * Length of the layer's footprint on the timeline, in seconds.
   * `timelineDuration = sourceDuration / |speed|`.
   */
  get timelineDuration() {
    const speed = Math.abs(this.settings.speed ?? 1);
    if (speed === 0) return 0;
    const sourceDur = this.settings.sourceDuration != null ? parseTime(this.settings.sourceDuration, this.fps) : 0;
    return sourceDur / speed;
  }
  /** Length of the layer's footprint on the timeline, in frames. */
  get timelineDurationFrames() {
    return Math.round(this.timelineDuration * this.fps);
  }
  /** Timeline-time (frames) at which the layer's footprint ends. */
  get endFrame() {
    return this.startFrame + this.timelineDurationFrames;
  }
  /** Timeline-time (seconds) at which the layer's footprint ends. */
  get endTime() {
    return parseTime(this.settings.startTime ?? 0, this.fps) + this.timelineDuration;
  }
  // -----------------------------------------------------------------------
  //  Flow actions
  // -----------------------------------------------------------------------
  /**
   * Set property values at the current flow position (step keyframe).
   *
   * @param value - An object mapping property names to their new values.
   */
  set(value) {
    this.parent.pushAction({ statement: "set", id: this.id, value });
    return this;
  }
  /**
   * Animate properties from one state to another.
   *
   * @param from     - Starting property values.
   * @param to       - Ending property values.
   * @param settings - Animation timing (duration, easing, wait).
   */
  animate(from, to, {
    duration = "0.25s",
    easing,
    wait
  } = {}) {
    const settings = { duration, easing, wait };
    this.parent.pushAction({ statement: "animate", id: this.id, from, to, settings });
    return this;
  }
  /**
   * Remove this layer at the current flow position.
   *
   * Once removed, calling any further flow method on this layer throws.
   */
  remove() {
    if (this.removed) throw new Error("Layer already removed");
    this.removed = true;
    this.parent.pushAction({ statement: "removeLayer", id: this.id });
    return this;
  }
  // -----------------------------------------------------------------------
  //  Convenience visibility helpers
  // -----------------------------------------------------------------------
  /** Show the layer (set `visible` to `true`). */
  show() {
    return this.set({ visible: true });
  }
  /** Hide the layer (set `visible` to `false`). */
  hide() {
    return this.set({ visible: false });
  }
  /**
   * Fade the layer in from transparent.
   *
   * @param duration - How long the fade takes.
   * @param easing   - Easing function.
   * @param wait     - Whether the flow pointer waits for the fade to finish.
   */
  fadeIn(duration = "300ms", easing, wait) {
    return this.animate({ opacity: 0, visible: true }, { opacity: 1 }, { duration, easing, wait });
  }
  /**
   * Fade the layer out to transparent.
   *
   * @param duration - How long the fade takes.
   * @param easing   - Easing function.
   * @param wait     - Whether the flow pointer waits for the fade to finish.
   */
  fadeOut(duration = "300ms", easing, wait) {
    return this.animate({ opacity: 1 }, { opacity: 0, visible: false }, { duration, easing, wait });
  }
  // -----------------------------------------------------------------------
  //  Serialisation
  // -----------------------------------------------------------------------
  /**
   * Serialise this layer into the VideoFlow JSON model format.
   *
   * Properties stored as keyframe arrays are converted into the
   * `animations` array, while static properties go into `properties`.
   */
  toJSON() {
    const animations = [];
    const staticProps = {};
    for (const [key, value] of Object.entries(this.properties)) {
      if (Array.isArray(value) && value.length > 0 && value[0]?.time !== void 0) {
        animations.push({
          property: key,
          keyframes: value.map((kf) => ({
            time: kf.time,
            value: kf.value,
            ...kf.easing ? { easing: kf.easing } : {}
          }))
        });
      } else if (value?.value !== void 0) {
        staticProps[key] = value.value;
      } else {
        staticProps[key] = value;
      }
    }
    const startTimeSec = parseTime(this.settings.startTime ?? 0, this.fps);
    const sourceDurationSec = this.settings.sourceDuration != null ? parseTime(this.settings.sourceDuration, this.fps) : 0;
    const sourceStartSec = parseTime(this.settings.sourceStart ?? 0, this.fps);
    return {
      id: this.id,
      type: this.constructor.type,
      settings: {
        enabled: this.settings.enabled ?? true,
        startTime: startTimeSec,
        sourceDuration: sourceDurationSec,
        ...this.settings.name ? { name: this.settings.name } : {},
        ...this.settings.speed !== void 0 && this.settings.speed !== 1 ? { speed: this.settings.speed } : {},
        ...sourceStartSec > 0 ? { sourceStart: sourceStartSec } : {}
      },
      properties: staticProps,
      animations
    };
  }
};

// src/core/layers/VisualLayer.ts
var VisualLayer = class extends BaseLayer {
  static type = "visual";
  constructor(parent, properties = {}, settings = {}) {
    super(parent, properties, settings);
  }
  static get defaultSettings() {
    return { ...super.defaultSettings };
  }
  static get defaultProperties() {
    return { ...super.defaultProperties };
  }
  /**
   * Full property definitions for visual layers.
   *
   * Each entry specifies how a property maps to CSS, what units it accepts,
   * its default value, and whether it can be smoothly interpolated between
   * keyframes during animation.
   */
  static get propertiesDefinition() {
    return {
      ...super.propertiesDefinition,
      // --- Visibility & opacity ---
      "visible": { default: true, animatable: false },
      "opacity": { default: 1, animatable: true },
      // --- Transform ---
      "position": { cssProperty: "--position", default: [0.5, 0.5], animatable: true },
      "scale": { cssProperty: "--scale", default: 1, animatable: true },
      "rotation": { cssProperty: "--rotation", units: ["deg"], default: 0, animatable: true },
      "anchor": { cssProperty: "--anchor", default: [0.5, 0.5], animatable: true },
      // --- Background ---
      "backgroundColor": { cssProperty: "background-color", default: "transparent", animatable: true },
      // --- Border ---
      "borderWidth": { cssProperty: "border-width", units: ["px"], default: 0, animatable: true },
      "borderStyle": { cssProperty: "border-style", enum: ["none", "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"], default: "solid", animatable: false },
      "borderColor": { cssProperty: "border-color", default: "#000000", animatable: true },
      "outerBorder": { default: false, animatable: false },
      "borderRadius": { cssProperty: "border-radius", units: ["", "px", "%"], default: 0, animatable: true },
      // --- Box shadow ---
      "boxShadow": { default: false, animatable: false },
      "boxShadowBlur": { cssProperty: "--box-shadow-blur", units: ["px"], default: 0, animatable: true },
      "boxShadowOffset": { cssProperty: "--box-shadow-offset", units: ["px"], default: [0, 0], animatable: true },
      "boxShadowSpread": { cssProperty: "--box-shadow-spread", units: ["px"], default: 0, animatable: true },
      "boxShadowColor": { cssProperty: "--box-shadow-color", default: "#000000", animatable: true },
      // --- Outline ---
      "outlineWidth": { cssProperty: "outline-width", units: ["px"], default: 0, animatable: true },
      "outlineStyle": { cssProperty: "outline-style", enum: ["none", "solid", "dashed", "dotted", "double", "groove", "ridge", "inset", "outset"], default: "none", animatable: false },
      "outlineColor": { cssProperty: "outline-color", default: "#000000", animatable: true },
      "outlineOffset": { cssProperty: "outline-offset", units: ["px"], default: 0, animatable: true },
      // --- Filters (individual CSS filter functions) ---
      "filterBlur": { cssProperty: "--filter-blur", units: ["px"], default: 0, animatable: true },
      "filterBrightness": { cssProperty: "--filter-brightness", default: 1, animatable: true },
      "filterContrast": { cssProperty: "--filter-contrast", default: 1, animatable: true },
      "filterGrayscale": { cssProperty: "--filter-grayscale", default: 0, animatable: true },
      "filterSepia": { cssProperty: "--filter-sepia", default: 0, animatable: true },
      "filterInvert": { cssProperty: "--filter-invert", default: 0, animatable: true },
      "filterHueRotate": { cssProperty: "--filter-hue-rotate", units: ["deg"], default: 0, animatable: true },
      "filterSaturate": { cssProperty: "--filter-saturate", default: 1, animatable: true },
      // --- Blend mode & perspective ---
      //'blendMode': { cssProperty: 'mix-blend-mode', enum: ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'], default: 'normal', animatable: false },
      "perspective": { cssProperty: "--perspective", units: ["px"], default: 2e3, animatable: true }
    };
  }
};

// src/core/layers/TextualLayer.ts
var TextualLayer = class extends VisualLayer {
  static type = "textual";
  constructor(parent, properties = {}, settings = {}) {
    super(parent, properties, settings);
  }
  static get defaultSettings() {
    return { ...super.defaultSettings };
  }
  static get defaultProperties() {
    return { ...super.defaultProperties };
  }
  /**
   * Typography property definitions.
   *
   * These control font rendering, text alignment, strokes, shadows, and
   * spacing.  Most map directly to their CSS counterparts.
   */
  static get propertiesDefinition() {
    return {
      ...super.propertiesDefinition,
      "fontSize": { cssProperty: "font-size", units: ["em", "px"], default: 1, animatable: true },
      "fontFamily": { cssProperty: "font-family", default: "Noto Sans", animatable: false },
      "fontWeight": { cssProperty: "font-weight", default: 600, animatable: true },
      "fontStyle": { cssProperty: "font-style", enum: ["normal", "italic"], default: "normal", animatable: false },
      "fontStretch": { cssProperty: "font-stretch", units: ["%"], default: 100, animatable: true },
      "color": { default: "#FFFFFF", animatable: true },
      "textAlign": { cssProperty: "text-align", enum: ["left", "right", "center", "justify"], default: "center", animatable: false },
      "verticalAlign": { cssProperty: "vertical-align", enum: ["top", "middle", "bottom"], default: "middle", animatable: false },
      "padding": { cssProperty: "padding", units: ["px"], default: 0, animatable: true },
      // Text stroke
      "textStroke": { default: false, animatable: false },
      "textStrokeWidth": { cssProperty: "-webkit-text-stroke-width", units: ["px"], default: 0, animatable: true },
      "textStrokeColor": { cssProperty: "-webkit-text-stroke-color", default: "#000000", animatable: true },
      // Text shadow
      "textShadow": { default: false, animatable: false },
      "textShadowColor": { cssProperty: "--text-shadow-color", default: "#000000", animatable: true },
      "textShadowOffset": { cssProperty: "--text-shadow-offset", units: ["px"], default: [0, 0], animatable: true },
      "textShadowBlur": { cssProperty: "--text-shadow-blur", units: ["px"], default: 0, animatable: true },
      // Spacing & formatting
      "letterSpacing": { cssProperty: "letter-spacing", units: ["em", "px"], default: "0em", animatable: true },
      "lineHeight": { cssProperty: "line-height", units: ["em", "px", ""], default: 1, animatable: true },
      "textTransform": { cssProperty: "text-transform", enum: ["none", "capitalize", "uppercase", "lowercase"], default: "none", animatable: false },
      "textDecoration": { cssProperty: "text-decoration", enum: ["none", "underline", "overline", "line-through"], default: "none", animatable: false },
      "wordSpacing": { cssProperty: "word-spacing", units: ["em", "px"], default: 0, animatable: true },
      "textIndent": { cssProperty: "text-indent", units: ["em", "px"], default: 0, animatable: true },
      "direction": { cssProperty: "direction", enum: ["ltr", "rtl"], default: "ltr", animatable: false }
    };
  }
};

// src/core/layers/TextLayer.ts
var TextLayer = class extends TextualLayer {
  static type = "text";
  constructor(parent, properties = {}, settings = {}) {
    super(parent, properties, settings);
  }
  static get defaultSettings() {
    return { ...super.defaultSettings };
  }
  static get defaultProperties() {
    return { ...super.defaultProperties };
  }
  static get propertiesDefinition() {
    return {
      ...super.propertiesDefinition,
      /** The text content to render.  Not a CSS property — applied via DOM. */
      "text": { cssProperty: false, default: "Type your text here", animatable: false }
    };
  }
};

// src/core/layers/MediaLayer.ts
var MediaLayer = class extends VisualLayer {
  static type = "media";
  constructor(parent, properties = {}, settings) {
    super(parent, properties, settings);
  }
  static get settingsKeys() {
    return [...super.settingsKeys, "source", "mediaDuration", "sourceEnd"];
  }
  static get defaultSettings() {
    return { ...super.defaultSettings };
  }
  static get defaultProperties() {
    return { ...super.defaultProperties };
  }
  static get propertiesDefinition() {
    return {
      ...super.propertiesDefinition,
      "fit": { enum: ["contain", "cover"], default: "contain", animatable: false }
    };
  }
};

// src/core/layers/ImageLayer.ts
var ImageLayer = class extends MediaLayer {
  static type = "image";
  constructor(parent, properties = {}, settings) {
    super(parent, properties, settings);
  }
  static get defaultSettings() {
    return { ...super.defaultSettings };
  }
  static get defaultProperties() {
    return { ...super.defaultProperties };
  }
};

// src/core/layers/VideoLayer.ts
var VideoLayer = class extends MediaLayer {
  static type = "video";
  constructor(parent, properties = {}, settings) {
    super(parent, properties, settings);
  }
  static get defaultSettings() {
    return { ...super.defaultSettings };
  }
  static get defaultProperties() {
    return { ...super.defaultProperties };
  }
  /**
   * Video layers merge visual and auditory property definitions.
   * The default `fit` is overridden to `'cover'`.
   */
  static get propertiesDefinition() {
    const base = super.propertiesDefinition;
    return {
      ...base,
      // Audio properties
      "volume": { default: 1, animatable: true },
      "pan": { default: 0, animatable: true },
      "pitch": { default: 1, animatable: true },
      "mute": { default: false, animatable: false },
      // Override default fit to cover for video
      "fit": { ...base["fit"], default: "cover" }
    };
  }
};

// src/core/layers/AuditoryLayer.ts
var AuditoryLayer = class extends BaseLayer {
  static type = "auditory";
  constructor(parent, properties = {}, settings = {}) {
    super(parent, properties, settings);
  }
  static get defaultSettings() {
    return { ...super.defaultSettings };
  }
  static get defaultProperties() {
    return { ...super.defaultProperties };
  }
  /**
   * Audio property definitions.
   *
   * - **volume** — gain multiplier (0 = silence, 1 = full)
   * - **pan** — stereo panning (−1 = full left, 0 = centre, 1 = full right)
   * - **pitch** — playback rate pitch shift (1 = normal)
   * - **mute** — boolean toggle, silences without affecting volume value
   */
  static get propertiesDefinition() {
    return {
      ...super.propertiesDefinition,
      "volume": { default: 1, animatable: true },
      "pan": { default: 0, animatable: true },
      "pitch": { default: 1, animatable: true },
      "mute": { default: false, animatable: false }
    };
  }
};

// src/core/layers/AudioLayer.ts
var AudioLayer = class extends AuditoryLayer {
  static type = "audio";
  constructor(parent, properties = {}, settings) {
    super(parent, properties, settings);
  }
  static get settingsKeys() {
    return [...super.settingsKeys, "source", "mediaDuration", "sourceEnd"];
  }
  static get defaultSettings() {
    return { ...super.defaultSettings };
  }
  static get defaultProperties() {
    return { ...super.defaultProperties };
  }
};

// src/core/layers/CaptionsLayer.ts
var CaptionsLayer = class extends TextualLayer {
  static type = "captions";
  constructor(parent, properties = {}, settings) {
    super(parent, properties, settings);
  }
  static get settingsKeys() {
    return [...super.settingsKeys, "captions", "maxCharsPerLine", "maxLines"];
  }
  static get defaultSettings() {
    return {
      ...super.defaultSettings,
      captions: [],
      maxCharsPerLine: 32,
      maxLines: 2
    };
  }
  static get defaultProperties() {
    return { ...super.defaultProperties };
  }
  static get propertiesDefinition() {
    return {
      ...super.propertiesDefinition,
      /**
       * The `text` property is overridden to have no default — the caption
       * text is determined at render time from the `captions` setting array.
       */
      "text": { cssProperty: false, default: void 0, animatable: false }
    };
  }
};

// src/core/VideoFlow.ts
var DEFAULT_SETTINGS = {
  name: "Untitled Video",
  width: 1920,
  height: 1080,
  fps: 30,
  backgroundColor: "#000000",
  verbose: false,
  autoDetectDurations: true,
  defaults: {
    easing: "easeInOut",
    fontFamily: "Noto Sans"
  }
};
var VideoFlow = class {
  /** Project settings (dimensions, fps, defaults). */
  settings;
  /**
   * Global, refcounted, time-evicted media cache shared by every VideoFlow
   * instance and every renderer. Use this to look up an already-fetched
   * source, instrument cache behavior in tests, or release entries early.
   *
   * Entries are kept alive for a short grace period (default 5 s) after
   * their refCount drops to zero, which is what makes the compile→render
   * handoff and back-to-back `loadVideo()` reloads avoid re-fetching.
   */
  static get loadedMedia() {
    return loadedMedia;
  }
  /**
   * All layers created through the flow API.
   * Used during compilation to look up layer metadata.
   */
  layers = [];
  /**
   * The sequential list of flow actions.
   * This is the "program" that gets compiled into the video JSON.
   */
  flow = [];
  /** Internal pointer into the flow — changes during `parallel()`. */
  _flowPointer = this.flow;
  constructor(settings = {}) {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      defaults: {
        ...DEFAULT_SETTINGS.defaults,
        ...settings.defaults || {}
      }
    };
  }
  // -----------------------------------------------------------------------
  //  Flow control
  // -----------------------------------------------------------------------
  /**
   * Push a raw action onto the current flow pointer.
   * @internal Used by layers to record their actions.
   */
  pushAction(action) {
    this._flowPointer.push(action);
  }
  /**
   * Pause the timeline for the given duration before the next action.
   *
   * @param time - How long to wait (accepts any {@link Time} format).
   */
  wait(time) {
    this.pushAction({ statement: "wait", duration: time });
    return this;
  }
  /**
   * Execute multiple sequences of actions in parallel.
   *
   * Each function receives its own timeline; the overall flow pointer
   * advances to the end of the longest parallel branch.
   *
   * ```ts
   * $.parallel([
   *   () => { text.animate({opacity:0},{opacity:1},{duration:'1s'}); },
   *   () => { bg.animate({filterBlur:0},{filterBlur:5},{duration:'2s'}); },
   * ]);
   * ```
   */
  parallel(funcs) {
    const initialPointer = this._flowPointer;
    const actions = [];
    for (const fn of funcs) {
      this._flowPointer = [];
      actions.push(this._flowPointer);
      fn();
    }
    this._flowPointer = initialPointer;
    this.pushAction({ statement: "parallel", actions });
    return this;
  }
  // -----------------------------------------------------------------------
  //  Generic addLayer
  // -----------------------------------------------------------------------
  /**
   * Add a layer of the given class to the flow.
   *
   * @typeParam T - The layer class type.
   * @param LayerClass  - Constructor for the layer.
   * @param properties  - Initial property values.
   * @param settings    - Layer settings (timing, source, etc.).
   * @param options     - Flow options (waitFor, index).
   * @returns The created layer instance (can be used for chaining animate/set/remove).
   */
  addLayer(LayerClass, properties = {}, settings = {}, options = {}) {
    const layer = new LayerClass(this, properties, settings);
    this.layers.push(layer);
    this.pushAction({
      statement: "addLayer",
      id: layer.id,
      type: LayerClass.type,
      settings,
      properties,
      options
    });
    return layer;
  }
  // -----------------------------------------------------------------------
  //  Typed convenience methods for each layer type
  // -----------------------------------------------------------------------
  /** Add a text layer. */
  addText(properties, settings, options) {
    return this.addLayer(TextLayer, properties, settings, options);
  }
  /** Add an image layer from a URL or file path. */
  addImage(properties, settings, options) {
    return this.addLayer(ImageLayer, properties, settings, options);
  }
  /** Add a video layer from a URL or file path. */
  addVideo(properties, settings, options) {
    return this.addLayer(VideoLayer, properties, settings, options);
  }
  /** Add an audio layer from a URL or file path. */
  addAudio(properties, settings, options) {
    return this.addLayer(AudioLayer, properties, settings, options);
  }
  /** Add a captions layer with pre-defined timed captions. */
  addCaptions(properties, settings, options) {
    return this.addLayer(CaptionsLayer, properties, settings, options);
  }
  // -----------------------------------------------------------------------
  //  Compilation
  // -----------------------------------------------------------------------
  /**
   * Compile the flow into a {@link VideoJSON} object.
   *
   * This method:
   * 1. Walks the flow actions sequentially, maintaining a time pointer.
   * 2. Converts all time values to frame numbers.
   * 3. Builds keyframe arrays from `set` / `animate` actions.
   * 4. Calculates the total project duration.
   * 5. Returns the complete JSON ready for rendering.
   *
   * Media metadata (image dimensions, video/audio duration) is resolved
   * during compilation so that `waitFor: 'finish'` and auto-duration work
   * correctly.
   */
  async compile() {
    const fps = this.settings.fps;
    const compiled = /* @__PURE__ */ new Map();
    const indexes = {};
    const probePromises = /* @__PURE__ */ new Map();
    const collectMediaActions = (actions) => {
      for (const action of actions) {
        if (action.statement === "parallel") {
          for (const branch of action.actions) collectMediaActions(branch);
        } else if (action.statement === "addLayer") {
          if (action.type !== "video" && action.type !== "audio") continue;
          const s = action.settings || {};
          if (s.sourceDuration != null) continue;
          if (s.mediaDuration != null) continue;
          if (!this.settings.autoDetectDurations) continue;
          const source = s.source;
          if (!source || typeof source !== "string") continue;
          if (probePromises.has(source)) continue;
          if (loadedMedia.has(source)) {
            probePromises.set(source, Promise.resolve(NaN));
            continue;
          }
          const kind = action.type === "audio" ? "audio" : "video";
          probePromises.set(
            source,
            probeMediaDuration(source, kind).catch((err) => {
              if (this.settings.verbose) {
                console.warn(`[VideoFlow] probeMediaDuration failed for "${source}":`, err?.message ?? err);
              }
              return NaN;
            })
          );
        }
      }
    };
    collectMediaActions(this.flow);
    const resolveMediaTimings = async (action) => {
      const isMedia = action.type === "video" || action.type === "audio";
      const s = action.settings || {};
      const sourceStartSec = s.sourceStart != null ? parseTime(s.sourceStart, fps) : 0;
      const sourceEndSec = s.sourceEnd != null ? parseTime(s.sourceEnd, fps) : 0;
      if (s.sourceDuration != null) {
        let mediaDurationSec;
        if (s.mediaDuration != null) {
          mediaDurationSec = parseTime(s.mediaDuration, fps);
        }
        return {
          sourceDurationSec: parseTime(s.sourceDuration, fps),
          mediaDurationSec,
          sourceEndUnresolvedSec: void 0
        };
      }
      if (!isMedia) {
        return { sourceDurationSec: null, mediaDurationSec: void 0, sourceEndUnresolvedSec: void 0 };
      }
      if (s.mediaDuration != null) {
        const dm = parseTime(s.mediaDuration, fps);
        const dur = Math.max(0, dm - sourceStartSec - sourceEndSec);
        return {
          sourceDurationSec: dur,
          mediaDurationSec: dm,
          sourceEndUnresolvedSec: void 0
        };
      }
      const source = typeof s.source === "string" ? s.source : void 0;
      if (source) {
        let probed = NaN;
        const pending = probePromises.get(source);
        if (pending) {
          probed = await pending;
        }
        if (!(Number.isFinite(probed) && probed > 0) && loadedMedia.has(source)) {
          try {
            const entry = await loadedMedia.acquire(source);
            probed = entry.duration;
            loadedMedia.release(source);
          } catch {
          }
        }
        if (Number.isFinite(probed) && probed > 0) {
          const dur = Math.max(0, probed - sourceStartSec - sourceEndSec);
          return {
            sourceDurationSec: dur,
            mediaDurationSec: probed,
            sourceEndUnresolvedSec: void 0
          };
        }
      }
      return {
        sourceDurationSec: null,
        mediaDurationSec: void 0,
        sourceEndUnresolvedSec: s.sourceEnd != null ? sourceEndSec : void 0
      };
    };
    const flowFrameToSourceSec = (comp, t) => {
      const elapsedTimelineSec = (t - comp.startTimeFrames) / fps;
      const speedAbs = Math.abs(comp.speed);
      const elapsedSegmentSec = elapsedTimelineSec * speedAbs;
      if (comp.speed < 0) {
        const sourceDurationSec = comp.endTimeFrames !== false ? (comp.endTimeFrames - comp.startTimeFrames) / fps * speedAbs : 0;
        return comp.sourceStartSec + sourceDurationSec - elapsedSegmentSec;
      }
      return comp.sourceStartSec + elapsedSegmentSec;
    };
    const parseSeries = async (actions, t = 0) => {
      for (const action of actions) {
        switch (action.statement) {
          case "wait": {
            t += timeToFrames(action.duration, fps);
            break;
          }
          case "parallel": {
            const times = await Promise.all(
              action.actions.map((branch) => parseSeries(branch, t))
            );
            t = Math.max(...times);
            break;
          }
          case "addLayer": {
            const layerObj = this.layers.find((l) => l.id === action.id);
            if (!layerObj) throw new Error(`Layer ${action.id} not found`);
            const sourceStartSec = action.settings?.sourceStart != null ? parseTime(action.settings.sourceStart, fps) : 0;
            const speed = action.settings?.speed ?? 1;
            const speedAbs = Math.abs(speed) || 1;
            let startTimeFrames;
            if (action.settings?.startTime != null) {
              startTimeFrames = timeToFrames(action.settings.startTime, fps);
            } else {
              startTimeFrames = t;
            }
            const timings = await resolveMediaTimings(action);
            let endTimeFrames = false;
            if (timings.sourceDurationSec != null) {
              const timelineDurFrames = Math.round(
                timings.sourceDurationSec / speedAbs * fps
              );
              endTimeFrames = startTimeFrames + timelineDurFrames;
            }
            const comp = {
              id: action.id,
              type: action.type,
              startTimeFrames,
              endTimeFrames,
              speed,
              sourceStartSec,
              name: action.settings?.name,
              enabled: action.settings?.enabled ?? true,
              settings: action.settings,
              properties: {},
              index: action.options?.index ?? 0,
              layerObj,
              mediaDurationSec: timings.mediaDurationSec,
              sourceEndUnresolvedSec: timings.sourceEndUnresolvedSec
            };
            compiled.set(action.id, comp);
            indexes[action.id] = action.options?.index ?? 0;
            if (action.properties) {
              for (const [prop, value] of Object.entries(action.properties)) {
                comp.properties[prop] = [{ time: sourceStartSec, value, easing: "step" }];
              }
            }
            if (action.options?.waitFor) {
              if (action.options.waitFor === "finish") {
                if (endTimeFrames !== false) {
                  t = endTimeFrames;
                }
              } else {
                t += timeToFrames(action.options.waitFor, fps);
              }
            }
            break;
          }
          case "removeLayer": {
            const comp = compiled.get(action.id);
            if (!comp) throw new Error(`Layer ${action.id} not found`);
            if (comp.endTimeFrames !== false && comp.endTimeFrames < t) {
              throw new Error(`Layer ${action.id} already ended at frame ${comp.endTimeFrames}`);
            }
            comp.endTimeFrames = t;
            break;
          }
          case "set": {
            const comp = compiled.get(action.id);
            if (!comp) throw new Error(`Layer ${action.id} not found`);
            const sourceTimeSec = flowFrameToSourceSec(comp, t);
            for (const [prop, value] of Object.entries(action.value)) {
              if (!comp.properties[prop]) {
                comp.properties[prop] = [];
              }
              comp.properties[prop] = comp.properties[prop].filter((kf) => kf.time !== sourceTimeSec);
              comp.properties[prop].push({ time: sourceTimeSec, value, easing: "step" });
              comp.properties[prop].sort((a, b) => a.time - b.time);
            }
            break;
          }
          case "animate": {
            const comp = compiled.get(action.id);
            if (!comp) throw new Error(`Layer ${action.id} not found`);
            const startSourceTimeSec = flowFrameToSourceSec(comp, t);
            const animTimelineFrames = timeToFrames(action.settings?.duration ?? "1s", fps);
            const speedAbs = Math.abs(comp.speed) || 1;
            const animSourceSec = animTimelineFrames / fps * speedAbs;
            const easing = action.settings?.easing || this.settings.defaults?.easing || "easeInOut";
            const allProps = [.../* @__PURE__ */ new Set([
              ...Object.keys(action.from),
              ...Object.keys(action.to)
            ])];
            for (const prop of allProps) {
              if (!comp.properties[prop]) {
                comp.properties[prop] = [];
              }
              const fromVal = action.from[prop] ?? this._getLastValue(comp.properties[prop], startSourceTimeSec, prop, comp.layerObj);
              const toVal = action.to[prop] ?? fromVal;
              comp.properties[prop] = comp.properties[prop].filter((kf) => kf.time !== startSourceTimeSec);
              comp.properties[prop].push({ time: startSourceTimeSec, value: fromVal, easing });
              const endSourceTimeSec = comp.speed < 0 ? startSourceTimeSec - animSourceSec : startSourceTimeSec + animSourceSec;
              comp.properties[prop] = comp.properties[prop].filter((kf) => kf.time !== endSourceTimeSec);
              comp.properties[prop].push({ time: endSourceTimeSec, value: toVal, easing: "step" });
              comp.properties[prop].sort((a, b) => a.time - b.time);
            }
            if (action.settings?.wait !== false) {
              t += animTimelineFrames;
            }
            break;
          }
        }
      }
      return t;
    };
    const totalFrames = await parseSeries(this.flow);
    let projectDuration = totalFrames;
    for (const comp of compiled.values()) {
      if (comp.endTimeFrames !== false) {
        projectDuration = Math.max(projectDuration, comp.endTimeFrames);
      }
      if (comp.endTimeFrames === false) {
        comp.endTimeFrames = projectDuration;
      }
    }
    for (const comp of compiled.values()) {
      if (comp.endTimeFrames === false) {
        comp.endTimeFrames = projectDuration;
      }
    }
    const sortedLayers = [...compiled.values()].sort((a, b) => {
      if (a.index !== b.index) return a.index - b.index;
      return 0;
    });
    const layers = sortedLayers.map((comp) => {
      const animations = Object.entries(comp.properties).map(([prop, keyframes]) => ({
        property: prop,
        // Keyframes are already stored in absolute source seconds.
        keyframes: keyframes.map((kf) => ({
          time: kf.time,
          value: kf.value,
          ...kf.easing && kf.easing !== "step" ? { easing: kf.easing } : {}
        }))
      }));
      const startTimeSec = comp.startTimeFrames / fps;
      const endTimeSec = comp.endTimeFrames / fps;
      const timelineDurSec = endTimeSec - startTimeSec;
      const speedAbs = Math.abs(comp.speed) || 1;
      const sourceDurationSec = timelineDurSec * speedAbs;
      return {
        id: comp.id,
        type: comp.type,
        settings: {
          enabled: comp.enabled,
          startTime: startTimeSec,
          sourceDuration: sourceDurationSec,
          ...comp.name ? { name: comp.name } : {},
          ...comp.speed !== 1 ? { speed: comp.speed } : {},
          ...comp.sourceStartSec > 0 ? { sourceStart: comp.sourceStartSec } : {},
          ...comp.mediaDurationSec != null ? { mediaDuration: comp.mediaDurationSec } : {},
          ...comp.sourceEndUnresolvedSec != null ? { sourceEnd: comp.sourceEndUnresolvedSec } : {},
          // Include layer-type-specific settings via settingsKeys
          // (mediaDuration / sourceEnd are handled explicitly above)
          ...Object.fromEntries(
            (comp.layerObj.constructor.settingsKeys ?? []).filter((key) => key !== "mediaDuration" && key !== "sourceEnd").filter((key) => comp.settings?.[key] != null).map((key) => [key, comp.settings[key]])
          )
        },
        properties: {},
        animations
      };
    });
    return {
      name: this.settings.name,
      duration: projectDuration / fps,
      width: this.settings.width,
      height: this.settings.height,
      fps,
      backgroundColor: this.settings.backgroundColor,
      layers
    };
  }
  /**
   * Get the last known value of a property at the given time.
   * Falls back to the layer class's default property value.
   */
  _getLastValue(keyframes, time, prop, layerObj) {
    if (keyframes.length === 0) {
      const def = layerObj.constructor.propertiesDefinition[prop];
      return def?.default;
    }
    let last2 = keyframes[0];
    for (const kf of keyframes) {
      if (kf.time <= time) last2 = kf;
      else break;
    }
    return last2?.value;
  }
  // -----------------------------------------------------------------------
  //  Convenience render method
  // -----------------------------------------------------------------------
  /**
   * Resolve the renderer module for the current environment.
   *
   * @returns The renderer module (with `default` export being the renderer class).
   * @throws If the renderer package is not installed.
   */
  async _resolveRendererModule() {
    const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";
    const pkg = isBrowser ? ["@videoflow", "renderer-browser"].join("/") : ["@videoflow", "renderer-server"].join("/");
    try {
      return await import(
        /* @vite-ignore */
        /* webpackIgnore: true */
        pkg
      );
    } catch {
      throw new Error(
        isBrowser ? "Browser renderer not available. Install @videoflow/renderer-browser." : "Server renderer not available. Install @videoflow/renderer-server."
      );
    }
  }
  /**
   * Compile and render the video in one call.
   *
   * Automatically detects the environment and uses the appropriate renderer:
   * - **Browser** (window/DOM present) → `@videoflow/renderer-browser`
   * - **Node.js** (no DOM, `process.versions.node` exists) → `@videoflow/renderer-server`
   *
   * The renderer package must be installed separately.
   *
   * @param options - Rendering options passed to the renderer.
   * @returns The rendered video output (Buffer, Blob, or file path depending on options).
   */
  async renderVideo(options = {}) {
    const mod = await this._resolveRendererModule();
    const json = await this.compile();
    return await mod.default.render(json, options);
  }
  /**
   * Compile and render a single frame of the video.
   *
   * Automatically detects the environment and uses the appropriate renderer.
   * The renderer package must be installed separately.
   *
   * @param frame - The frame number to render.
   * @returns The rendered frame output — `OffscreenCanvas` (browser) or JPEG `Buffer` (server).
   */
  async renderFrame(frame) {
    const mod = await this._resolveRendererModule();
    const json = await this.compile();
    const renderer2 = new mod.default(json);
    try {
      return await renderer2.renderFrame(frame);
    } finally {
      if (typeof renderer2.destroy === "function") renderer2.destroy();
      if (typeof renderer2.cleanup === "function") await renderer2.cleanup();
    }
  }
  /**
   * Compile and render the full audio track of the video.
   *
   * Automatically detects the environment and uses the appropriate renderer.
   * The renderer package must be installed separately.
   *
   * @returns The rendered audio — `AudioBuffer` (browser) or WAV `Buffer` (server),
   *          or `null` if the video has no audio layers.
   */
  async renderAudio() {
    const mod = await this._resolveRendererModule();
    const json = await this.compile();
    const renderer2 = new mod.default(json);
    try {
      return await renderer2.renderAudio();
    } finally {
      if (typeof renderer2.destroy === "function") renderer2.destroy();
      if (typeof renderer2.cleanup === "function") await renderer2.cleanup();
    }
  }
};

// src/core/index.ts
init_MediaCache();

// src/renderer-browser/renderer.css.ts
var RENDERER_CSS = `
[data-element] {
	--scale: 1;
	--position-0: 0.5;
	--position-1: 0.5;
	--position-2: 0;
	--rotation: 0deg;
	--rotation-1: 0deg;
	--rotation-2: 0deg;
	--anchor-0: 0.5;
	--anchor-1: 0.5;
	--anchor-2: 0;

	--box-shadow-color: #000000;
	--box-shadow-offset-0: 0px;
	--box-shadow-offset-1: 0px;
	--box-shadow-blur: 0px;
	--box-shadow-spread: 0px;

	--filter-blur: 0px;
	--filter-brightness: 1;
	--filter-contrast: 1;
	--filter-grayscale: 0;
	--filter-hue-rotate: 0deg;
	--filter-invert: 0;
	--filter-opacity: 1;
	--filter-saturate: 1;
	--filter-sepia: 0;

	--text-shadow-offset-0:0px;
	--text-shadow-offset-1:0px;
	--text-shadow-blur:0px;
	--text-shadow-color:#000000;
}
[data-renderer] {
	position:relative;
	overflow:hidden;
	display:flex;
	align-items: center;
	justify-content: center;
	font-size:calc(var(--project-width) / 720 * 26px);
	font-weight:600;
	width:calc(var(--project-width) * 1px);
	height:calc(var(--project-height) * 1px);
	perspective: calc(1px * max(var(--project-height), var(--project-width)));
}
[data-element] {
	position:absolute;
	transform:
		translate3d(
			calc((var(--anchor-0) - 0.5) * -100% + (var(--position-0) - 0.5) * var(--project-width) * 1px),
			calc((var(--anchor-1) - 0.5) * -100% + (var(--position-1) - 0.5) * var(--project-height) * 1px),
			calc(var(--position-2) * 1px)
		)
		perspective(var(--perspective, 2000px))
		rotateX(var(--rotation-1)) rotateY(var(--rotation-2)) rotateZ(var(--rotation-0, var(--rotation)))
		scale3d(var(--scale-0, var(--scale)), var(--scale-1, var(--scale)), var(--scale-2, var(--scale)))
	;
	transform-origin: calc(var(--anchor-0) * 100%) calc(var(--anchor-1) * 100%) calc(var(--anchor-2) * 1px);
	will-change: transform;
	border-style:solid;
	border-color:#000000;
	border-width:0px;
	color:#FFFFFF;
}
[data-element="image"], [data-element="video"] {
	--object-actual-width:var(--project-width);
	--object-actual-height:var(--project-height);
	width:calc(1px * var(--object-actual-width));
	height:calc(1px * var(--object-actual-height));
}
[data-element="image"][data-fit="contain"],
[data-element="video"][data-fit="contain"] {
	--object-actual-width:min(var(--project-width), var(--project-height) * var(--object-width) / var(--object-height));
	--object-actual-height:min(var(--project-height), var(--project-width) * var(--object-height) / var(--object-width));
}
[data-element="image"][data-fit="cover"],
[data-element="video"][data-fit="cover"] {
	--object-actual-width:max(var(--project-width), var(--project-height) * var(--object-width) / var(--object-height));
	--object-actual-height:max(var(--project-height), var(--project-width) * var(--object-height) / var(--object-width));
}
textual-layer {
	display:flex;
	align-items: center;
	justify-content: center;
	white-space: pre;
	paint-order: stroke;
	line-height: 1;
}
`;
var renderer_css_default = RENDERER_CSS;

// node_modules/mediabunny/dist/modules/src/misc.js
function assert(x) {
  if (!x) {
    throw new Error("Assertion failed.");
  }
}
var last = (arr) => {
  return arr && arr[arr.length - 1];
};
var isU32 = (value) => {
  return value >= 0 && value < 2 ** 32;
};
var readExpGolomb = (bitstream) => {
  let leadingZeroBits = 0;
  while (bitstream.readBits(1) === 0 && leadingZeroBits < 32) {
    leadingZeroBits++;
  }
  if (leadingZeroBits >= 32) {
    throw new Error("Invalid exponential-Golomb code.");
  }
  const result = (1 << leadingZeroBits) - 1 + bitstream.readBits(leadingZeroBits);
  return result;
};
var readSignedExpGolomb = (bitstream) => {
  const codeNum = readExpGolomb(bitstream);
  return (codeNum & 1) === 0 ? -(codeNum >> 1) : codeNum + 1 >> 1;
};
var toUint8Array = (source) => {
  if (source.constructor === Uint8Array) {
    return source;
  } else if (ArrayBuffer.isView(source)) {
    return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  } else {
    return new Uint8Array(source);
  }
};
var toDataView = (source) => {
  if (source.constructor === DataView) {
    return source;
  } else if (ArrayBuffer.isView(source)) {
    return new DataView(source.buffer, source.byteOffset, source.byteLength);
  } else {
    return new DataView(source);
  }
};
var textEncoder = /* @__PURE__ */ new TextEncoder();
var COLOR_PRIMARIES_MAP = {
  bt709: 1,
  // ITU-R BT.709
  bt470bg: 5,
  // ITU-R BT.470BG
  smpte170m: 6,
  // ITU-R BT.601 525 - SMPTE 170M
  bt2020: 9,
  // ITU-R BT.202
  smpte432: 12
  // SMPTE EG 432-1
};
var TRANSFER_CHARACTERISTICS_MAP = {
  "bt709": 1,
  // ITU-R BT.709
  "smpte170m": 6,
  // SMPTE 170M
  "linear": 8,
  // Linear transfer characteristics
  "iec61966-2-1": 13,
  // IEC 61966-2-1
  "pq": 16,
  // Rec. ITU-R BT.2100-2 perceptual quantization (PQ) system
  "hlg": 18
  // Rec. ITU-R BT.2100-2 hybrid loggamma (HLG) system
};
var MATRIX_COEFFICIENTS_MAP = {
  "rgb": 0,
  // Identity
  "bt709": 1,
  // ITU-R BT.709
  "bt470bg": 5,
  // ITU-R BT.470BG
  "smpte170m": 6,
  // SMPTE 170M
  "bt2020-ncl": 9
  // ITU-R BT.2020-2 (non-constant luminance)
};
var colorSpaceIsComplete = (colorSpace) => {
  return !!colorSpace && !!colorSpace.primaries && !!colorSpace.transfer && !!colorSpace.matrix && colorSpace.fullRange !== void 0;
};
var isAllowSharedBufferSource = (x) => {
  return x instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && x instanceof SharedArrayBuffer || ArrayBuffer.isView(x);
};
var AsyncMutex = class {
  constructor() {
    this.currentPromise = Promise.resolve();
    this.pending = 0;
  }
  async acquire() {
    let resolver;
    const nextPromise = new Promise((resolve) => {
      let resolved = false;
      resolver = () => {
        if (resolved) {
          return;
        }
        resolve();
        this.pending--;
        resolved = true;
      };
    });
    const currentPromiseAlias = this.currentPromise;
    this.currentPromise = nextPromise;
    this.pending++;
    await currentPromiseAlias;
    return resolver;
  }
};
var promiseWithResolvers = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
var assertNever = (x) => {
  throw new Error(`Unexpected value: ${x}`);
};
var setUint24 = (view2, byteOffset, value, littleEndian) => {
  value = value >>> 0;
  value = value & 16777215;
  if (littleEndian) {
    view2.setUint8(byteOffset, value & 255);
    view2.setUint8(byteOffset + 1, value >>> 8 & 255);
    view2.setUint8(byteOffset + 2, value >>> 16 & 255);
  } else {
    view2.setUint8(byteOffset, value >>> 16 & 255);
    view2.setUint8(byteOffset + 1, value >>> 8 & 255);
    view2.setUint8(byteOffset + 2, value & 255);
  }
};
var setInt24 = (view2, byteOffset, value, littleEndian) => {
  value = clamp(value, -8388608, 8388607);
  if (value < 0) {
    value = value + 16777216 & 16777215;
  }
  setUint24(view2, byteOffset, value, littleEndian);
};
var clamp = (value, min, max) => {
  return Math.max(min, Math.min(max, value));
};
var UNDETERMINED_LANGUAGE = "und";
var ISO_639_2_REGEX = /^[a-z]{3}$/;
var isIso639Dash2LanguageCode = (x) => {
  return ISO_639_2_REGEX.test(x);
};
var SECOND_TO_MICROSECOND_FACTOR = 1e6 * (1 + Number.EPSILON);
var computeRationalApproximation = (x, maxDenominator) => {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  let prevNumerator = 0, prevDenominator = 1;
  let currNumerator = 1, currDenominator = 0;
  let remainder = x;
  while (true) {
    const integer = Math.floor(remainder);
    const nextNumerator = integer * currNumerator + prevNumerator;
    const nextDenominator = integer * currDenominator + prevDenominator;
    if (nextDenominator > maxDenominator) {
      return {
        numerator: sign * currNumerator,
        denominator: currDenominator
      };
    }
    prevNumerator = currNumerator;
    prevDenominator = currDenominator;
    currNumerator = nextNumerator;
    currDenominator = nextDenominator;
    remainder = 1 / (remainder - integer);
    if (!isFinite(remainder)) {
      break;
    }
  }
  return {
    numerator: sign * currNumerator,
    denominator: currDenominator
  };
};
var CallSerializer = class {
  constructor() {
    this.currentPromise = Promise.resolve();
  }
  call(fn) {
    return this.currentPromise = this.currentPromise.then(fn);
  }
};
var isWebKitCache = null;
var isWebKit = () => {
  if (isWebKitCache !== null) {
    return isWebKitCache;
  }
  return isWebKitCache = !!(typeof navigator !== "undefined" && (navigator.vendor?.match(/apple/i) || /AppleWebKit/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent) || /\b(iPad|iPhone|iPod)\b/.test(navigator.userAgent)));
};
var isFirefoxCache = null;
var isFirefox = () => {
  if (isFirefoxCache !== null) {
    return isFirefoxCache;
  }
  return isFirefoxCache = typeof navigator !== "undefined" && navigator.userAgent?.includes("Firefox");
};
var keyValueIterator = function* (object) {
  for (const key in object) {
    const value = object[key];
    if (value === void 0) {
      continue;
    }
    yield { key, value };
  }
};
var polyfillSymbolDispose = () => {
  Symbol.dispose ??= Symbol("Symbol.dispose");
};
var simplifyRational = (rational) => {
  assert(rational.den !== 0);
  let a = Math.abs(rational.num);
  let b = Math.abs(rational.den);
  while (b !== 0) {
    const t = a % b;
    a = b;
    b = t;
  }
  const gcd = a || 1;
  return {
    num: rational.num / gcd,
    den: rational.den / gcd
  };
};
var validateRectangle = (rect, propertyPath) => {
  if (typeof rect !== "object" || !rect) {
    throw new TypeError(`${propertyPath} must be an object.`);
  }
  if (!Number.isInteger(rect.left) || rect.left < 0) {
    throw new TypeError(`${propertyPath}.left must be a non-negative integer.`);
  }
  if (!Number.isInteger(rect.top) || rect.top < 0) {
    throw new TypeError(`${propertyPath}.top must be a non-negative integer.`);
  }
  if (!Number.isInteger(rect.width) || rect.width < 0) {
    throw new TypeError(`${propertyPath}.width must be a non-negative integer.`);
  }
  if (!Number.isInteger(rect.height) || rect.height < 0) {
    throw new TypeError(`${propertyPath}.height must be a non-negative integer.`);
  }
};

// node_modules/mediabunny/dist/modules/src/metadata.js
var RichImageData = class {
  /** Creates a new {@link RichImageData}. */
  constructor(data, mimeType) {
    this.data = data;
    this.mimeType = mimeType;
    if (!(data instanceof Uint8Array)) {
      throw new TypeError("data must be a Uint8Array.");
    }
    if (typeof mimeType !== "string") {
      throw new TypeError("mimeType must be a string.");
    }
  }
};
var AttachedFile = class {
  /** Creates a new {@link AttachedFile}. */
  constructor(data, mimeType, name, description) {
    this.data = data;
    this.mimeType = mimeType;
    this.name = name;
    this.description = description;
    if (!(data instanceof Uint8Array)) {
      throw new TypeError("data must be a Uint8Array.");
    }
    if (mimeType !== void 0 && typeof mimeType !== "string") {
      throw new TypeError("mimeType, when provided, must be a string.");
    }
    if (name !== void 0 && typeof name !== "string") {
      throw new TypeError("name, when provided, must be a string.");
    }
    if (description !== void 0 && typeof description !== "string") {
      throw new TypeError("description, when provided, must be a string.");
    }
  }
};
var validateMetadataTags = (tags) => {
  if (!tags || typeof tags !== "object") {
    throw new TypeError("tags must be an object.");
  }
  if (tags.title !== void 0 && typeof tags.title !== "string") {
    throw new TypeError("tags.title, when provided, must be a string.");
  }
  if (tags.description !== void 0 && typeof tags.description !== "string") {
    throw new TypeError("tags.description, when provided, must be a string.");
  }
  if (tags.artist !== void 0 && typeof tags.artist !== "string") {
    throw new TypeError("tags.artist, when provided, must be a string.");
  }
  if (tags.album !== void 0 && typeof tags.album !== "string") {
    throw new TypeError("tags.album, when provided, must be a string.");
  }
  if (tags.albumArtist !== void 0 && typeof tags.albumArtist !== "string") {
    throw new TypeError("tags.albumArtist, when provided, must be a string.");
  }
  if (tags.trackNumber !== void 0 && (!Number.isInteger(tags.trackNumber) || tags.trackNumber <= 0)) {
    throw new TypeError("tags.trackNumber, when provided, must be a positive integer.");
  }
  if (tags.tracksTotal !== void 0 && (!Number.isInteger(tags.tracksTotal) || tags.tracksTotal <= 0)) {
    throw new TypeError("tags.tracksTotal, when provided, must be a positive integer.");
  }
  if (tags.discNumber !== void 0 && (!Number.isInteger(tags.discNumber) || tags.discNumber <= 0)) {
    throw new TypeError("tags.discNumber, when provided, must be a positive integer.");
  }
  if (tags.discsTotal !== void 0 && (!Number.isInteger(tags.discsTotal) || tags.discsTotal <= 0)) {
    throw new TypeError("tags.discsTotal, when provided, must be a positive integer.");
  }
  if (tags.genre !== void 0 && typeof tags.genre !== "string") {
    throw new TypeError("tags.genre, when provided, must be a string.");
  }
  if (tags.date !== void 0 && (!(tags.date instanceof Date) || Number.isNaN(tags.date.getTime()))) {
    throw new TypeError("tags.date, when provided, must be a valid Date.");
  }
  if (tags.lyrics !== void 0 && typeof tags.lyrics !== "string") {
    throw new TypeError("tags.lyrics, when provided, must be a string.");
  }
  if (tags.images !== void 0) {
    if (!Array.isArray(tags.images)) {
      throw new TypeError("tags.images, when provided, must be an array.");
    }
    for (const image of tags.images) {
      if (!image || typeof image !== "object") {
        throw new TypeError("Each image in tags.images must be an object.");
      }
      if (!(image.data instanceof Uint8Array)) {
        throw new TypeError("Each image.data must be a Uint8Array.");
      }
      if (typeof image.mimeType !== "string") {
        throw new TypeError("Each image.mimeType must be a string.");
      }
      if (!["coverFront", "coverBack", "unknown"].includes(image.kind)) {
        throw new TypeError("Each image.kind must be 'coverFront', 'coverBack', or 'unknown'.");
      }
    }
  }
  if (tags.comment !== void 0 && typeof tags.comment !== "string") {
    throw new TypeError("tags.comment, when provided, must be a string.");
  }
  if (tags.raw !== void 0) {
    if (!tags.raw || typeof tags.raw !== "object") {
      throw new TypeError("tags.raw, when provided, must be an object.");
    }
    for (const value of Object.values(tags.raw)) {
      if (value !== null && typeof value !== "string" && !(value instanceof Uint8Array) && !(value instanceof RichImageData) && !(value instanceof AttachedFile)) {
        throw new TypeError("Each value in tags.raw must be a string, Uint8Array, RichImageData, AttachedFile, or null.");
      }
    }
  }
};
var validateTrackDisposition = (disposition) => {
  if (!disposition || typeof disposition !== "object") {
    throw new TypeError("disposition must be an object.");
  }
  if (disposition.default !== void 0 && typeof disposition.default !== "boolean") {
    throw new TypeError("disposition.default must be a boolean.");
  }
  if (disposition.forced !== void 0 && typeof disposition.forced !== "boolean") {
    throw new TypeError("disposition.forced must be a boolean.");
  }
  if (disposition.original !== void 0 && typeof disposition.original !== "boolean") {
    throw new TypeError("disposition.original must be a boolean.");
  }
  if (disposition.commentary !== void 0 && typeof disposition.commentary !== "boolean") {
    throw new TypeError("disposition.commentary must be a boolean.");
  }
  if (disposition.hearingImpaired !== void 0 && typeof disposition.hearingImpaired !== "boolean") {
    throw new TypeError("disposition.hearingImpaired must be a boolean.");
  }
  if (disposition.visuallyImpaired !== void 0 && typeof disposition.visuallyImpaired !== "boolean") {
    throw new TypeError("disposition.visuallyImpaired must be a boolean.");
  }
};

// node_modules/mediabunny/dist/modules/shared/bitstream.js
var Bitstream = class _Bitstream {
  constructor(bytes2) {
    this.bytes = bytes2;
    this.pos = 0;
  }
  seekToByte(byteOffset) {
    this.pos = 8 * byteOffset;
  }
  readBit() {
    const byteIndex = Math.floor(this.pos / 8);
    const byte = this.bytes[byteIndex] ?? 0;
    const bitIndex = 7 - (this.pos & 7);
    const bit = (byte & 1 << bitIndex) >> bitIndex;
    this.pos++;
    return bit;
  }
  readBits(n) {
    if (n === 1) {
      return this.readBit();
    }
    let result = 0;
    for (let i = 0; i < n; i++) {
      result <<= 1;
      result |= this.readBit();
    }
    return result;
  }
  writeBits(n, value) {
    const end = this.pos + n;
    for (let i = this.pos; i < end; i++) {
      const byteIndex = Math.floor(i / 8);
      let byte = this.bytes[byteIndex];
      const bitIndex = 7 - (i & 7);
      byte &= ~(1 << bitIndex);
      byte |= (value & 1 << end - i - 1) >> end - i - 1 << bitIndex;
      this.bytes[byteIndex] = byte;
    }
    this.pos = end;
  }
  readAlignedByte() {
    if (this.pos % 8 !== 0) {
      throw new Error("Bitstream is not byte-aligned.");
    }
    const byteIndex = this.pos / 8;
    const byte = this.bytes[byteIndex] ?? 0;
    this.pos += 8;
    return byte;
  }
  skipBits(n) {
    this.pos += n;
  }
  getBitsLeft() {
    return this.bytes.length * 8 - this.pos;
  }
  clone() {
    const clone = new _Bitstream(this.bytes);
    clone.pos = this.pos;
    return clone;
  }
};

// node_modules/mediabunny/dist/modules/shared/aac-misc.js
var aacFrequencyTable = [
  96e3,
  88200,
  64e3,
  48e3,
  44100,
  32e3,
  24e3,
  22050,
  16e3,
  12e3,
  11025,
  8e3,
  7350
];
var aacChannelMap = [-1, 1, 2, 3, 4, 5, 6, 8];
var parseAacAudioSpecificConfig = (bytes2) => {
  if (!bytes2 || bytes2.byteLength < 2) {
    throw new TypeError("AAC description must be at least 2 bytes long.");
  }
  const bitstream = new Bitstream(bytes2);
  let objectType = bitstream.readBits(5);
  if (objectType === 31) {
    objectType = 32 + bitstream.readBits(6);
  }
  const frequencyIndex = bitstream.readBits(4);
  let sampleRate = null;
  if (frequencyIndex === 15) {
    sampleRate = bitstream.readBits(24);
  } else {
    if (frequencyIndex < aacFrequencyTable.length) {
      sampleRate = aacFrequencyTable[frequencyIndex];
    }
  }
  const channelConfiguration = bitstream.readBits(4);
  let numberOfChannels = null;
  if (channelConfiguration >= 1 && channelConfiguration <= 7) {
    numberOfChannels = aacChannelMap[channelConfiguration];
  }
  return {
    objectType,
    frequencyIndex,
    sampleRate,
    channelConfiguration,
    numberOfChannels
  };
};
var buildAacAudioSpecificConfig = (config) => {
  let frequencyIndex = aacFrequencyTable.indexOf(config.sampleRate);
  let customSampleRate = null;
  if (frequencyIndex === -1) {
    frequencyIndex = 15;
    customSampleRate = config.sampleRate;
  }
  const channelConfiguration = aacChannelMap.indexOf(config.numberOfChannels);
  if (channelConfiguration === -1) {
    throw new TypeError(`Unsupported number of channels: ${config.numberOfChannels}`);
  }
  let bitCount = 5 + 4 + 4;
  if (config.objectType >= 32) {
    bitCount += 6;
  }
  if (frequencyIndex === 15) {
    bitCount += 24;
  }
  const byteCount = Math.ceil(bitCount / 8);
  const bytes2 = new Uint8Array(byteCount);
  const bitstream = new Bitstream(bytes2);
  if (config.objectType < 32) {
    bitstream.writeBits(5, config.objectType);
  } else {
    bitstream.writeBits(5, 31);
    bitstream.writeBits(6, config.objectType - 32);
  }
  bitstream.writeBits(4, frequencyIndex);
  if (frequencyIndex === 15) {
    bitstream.writeBits(24, customSampleRate);
  }
  bitstream.writeBits(4, channelConfiguration);
  return bytes2;
};

// node_modules/mediabunny/dist/modules/src/codec.js
var VIDEO_CODECS = [
  "avc",
  "hevc",
  "vp9",
  "av1",
  "vp8"
];
var PCM_AUDIO_CODECS = [
  "pcm-s16",
  // We don't prefix 'le' so we're compatible with the WebCodecs-registered PCM codec strings
  "pcm-s16be",
  "pcm-s24",
  "pcm-s24be",
  "pcm-s32",
  "pcm-s32be",
  "pcm-f32",
  "pcm-f32be",
  "pcm-f64",
  "pcm-f64be",
  "pcm-u8",
  "pcm-s8",
  "ulaw",
  "alaw"
];
var NON_PCM_AUDIO_CODECS = [
  "aac",
  "opus",
  "mp3",
  "vorbis",
  "flac",
  "ac3",
  "eac3"
];
var AUDIO_CODECS = [
  ...NON_PCM_AUDIO_CODECS,
  ...PCM_AUDIO_CODECS
];
var SUBTITLE_CODECS = [
  "webvtt"
];
var AVC_LEVEL_TABLE = [
  { maxMacroblocks: 99, maxBitrate: 64e3, maxDpbMbs: 396, level: 10 },
  // Level 1
  { maxMacroblocks: 396, maxBitrate: 192e3, maxDpbMbs: 900, level: 11 },
  // Level 1.1
  { maxMacroblocks: 396, maxBitrate: 384e3, maxDpbMbs: 2376, level: 12 },
  // Level 1.2
  { maxMacroblocks: 396, maxBitrate: 768e3, maxDpbMbs: 2376, level: 13 },
  // Level 1.3
  { maxMacroblocks: 396, maxBitrate: 2e6, maxDpbMbs: 2376, level: 20 },
  // Level 2
  { maxMacroblocks: 792, maxBitrate: 4e6, maxDpbMbs: 4752, level: 21 },
  // Level 2.1
  { maxMacroblocks: 1620, maxBitrate: 4e6, maxDpbMbs: 8100, level: 22 },
  // Level 2.2
  { maxMacroblocks: 1620, maxBitrate: 1e7, maxDpbMbs: 8100, level: 30 },
  // Level 3
  { maxMacroblocks: 3600, maxBitrate: 14e6, maxDpbMbs: 18e3, level: 31 },
  // Level 3.1
  { maxMacroblocks: 5120, maxBitrate: 2e7, maxDpbMbs: 20480, level: 32 },
  // Level 3.2
  { maxMacroblocks: 8192, maxBitrate: 2e7, maxDpbMbs: 32768, level: 40 },
  // Level 4
  { maxMacroblocks: 8192, maxBitrate: 5e7, maxDpbMbs: 32768, level: 41 },
  // Level 4.1
  { maxMacroblocks: 8704, maxBitrate: 5e7, maxDpbMbs: 34816, level: 42 },
  // Level 4.2
  { maxMacroblocks: 22080, maxBitrate: 135e6, maxDpbMbs: 110400, level: 50 },
  // Level 5
  { maxMacroblocks: 36864, maxBitrate: 24e7, maxDpbMbs: 184320, level: 51 },
  // Level 5.1
  { maxMacroblocks: 36864, maxBitrate: 24e7, maxDpbMbs: 184320, level: 52 },
  // Level 5.2
  { maxMacroblocks: 139264, maxBitrate: 24e7, maxDpbMbs: 696320, level: 60 },
  // Level 6
  { maxMacroblocks: 139264, maxBitrate: 48e7, maxDpbMbs: 696320, level: 61 },
  // Level 6.1
  { maxMacroblocks: 139264, maxBitrate: 8e8, maxDpbMbs: 696320, level: 62 }
  // Level 6.2
];
var HEVC_LEVEL_TABLE = [
  { maxPictureSize: 36864, maxBitrate: 128e3, tier: "L", level: 30 },
  // Level 1 (Low Tier)
  { maxPictureSize: 122880, maxBitrate: 15e5, tier: "L", level: 60 },
  // Level 2 (Low Tier)
  { maxPictureSize: 245760, maxBitrate: 3e6, tier: "L", level: 63 },
  // Level 2.1 (Low Tier)
  { maxPictureSize: 552960, maxBitrate: 6e6, tier: "L", level: 90 },
  // Level 3 (Low Tier)
  { maxPictureSize: 983040, maxBitrate: 1e7, tier: "L", level: 93 },
  // Level 3.1 (Low Tier)
  { maxPictureSize: 2228224, maxBitrate: 12e6, tier: "L", level: 120 },
  // Level 4 (Low Tier)
  { maxPictureSize: 2228224, maxBitrate: 3e7, tier: "H", level: 120 },
  // Level 4 (High Tier)
  { maxPictureSize: 2228224, maxBitrate: 2e7, tier: "L", level: 123 },
  // Level 4.1 (Low Tier)
  { maxPictureSize: 2228224, maxBitrate: 5e7, tier: "H", level: 123 },
  // Level 4.1 (High Tier)
  { maxPictureSize: 8912896, maxBitrate: 25e6, tier: "L", level: 150 },
  // Level 5 (Low Tier)
  { maxPictureSize: 8912896, maxBitrate: 1e8, tier: "H", level: 150 },
  // Level 5 (High Tier)
  { maxPictureSize: 8912896, maxBitrate: 4e7, tier: "L", level: 153 },
  // Level 5.1 (Low Tier)
  { maxPictureSize: 8912896, maxBitrate: 16e7, tier: "H", level: 153 },
  // Level 5.1 (High Tier)
  { maxPictureSize: 8912896, maxBitrate: 6e7, tier: "L", level: 156 },
  // Level 5.2 (Low Tier)
  { maxPictureSize: 8912896, maxBitrate: 24e7, tier: "H", level: 156 },
  // Level 5.2 (High Tier)
  { maxPictureSize: 35651584, maxBitrate: 6e7, tier: "L", level: 180 },
  // Level 6 (Low Tier)
  { maxPictureSize: 35651584, maxBitrate: 24e7, tier: "H", level: 180 },
  // Level 6 (High Tier)
  { maxPictureSize: 35651584, maxBitrate: 12e7, tier: "L", level: 183 },
  // Level 6.1 (Low Tier)
  { maxPictureSize: 35651584, maxBitrate: 48e7, tier: "H", level: 183 },
  // Level 6.1 (High Tier)
  { maxPictureSize: 35651584, maxBitrate: 24e7, tier: "L", level: 186 },
  // Level 6.2 (Low Tier)
  { maxPictureSize: 35651584, maxBitrate: 8e8, tier: "H", level: 186 }
  // Level 6.2 (High Tier)
];
var VP9_LEVEL_TABLE = [
  { maxPictureSize: 36864, maxBitrate: 2e5, level: 10 },
  // Level 1
  { maxPictureSize: 73728, maxBitrate: 8e5, level: 11 },
  // Level 1.1
  { maxPictureSize: 122880, maxBitrate: 18e5, level: 20 },
  // Level 2
  { maxPictureSize: 245760, maxBitrate: 36e5, level: 21 },
  // Level 2.1
  { maxPictureSize: 552960, maxBitrate: 72e5, level: 30 },
  // Level 3
  { maxPictureSize: 983040, maxBitrate: 12e6, level: 31 },
  // Level 3.1
  { maxPictureSize: 2228224, maxBitrate: 18e6, level: 40 },
  // Level 4
  { maxPictureSize: 2228224, maxBitrate: 3e7, level: 41 },
  // Level 4.1
  { maxPictureSize: 8912896, maxBitrate: 6e7, level: 50 },
  // Level 5
  { maxPictureSize: 8912896, maxBitrate: 12e7, level: 51 },
  // Level 5.1
  { maxPictureSize: 8912896, maxBitrate: 18e7, level: 52 },
  // Level 5.2
  { maxPictureSize: 35651584, maxBitrate: 18e7, level: 60 },
  // Level 6
  { maxPictureSize: 35651584, maxBitrate: 24e7, level: 61 },
  // Level 6.1
  { maxPictureSize: 35651584, maxBitrate: 48e7, level: 62 }
  // Level 6.2
];
var AV1_LEVEL_TABLE = [
  { maxPictureSize: 147456, maxBitrate: 15e5, tier: "M", level: 0 },
  // Level 2.0 (Main Tier)
  { maxPictureSize: 278784, maxBitrate: 3e6, tier: "M", level: 1 },
  // Level 2.1 (Main Tier)
  { maxPictureSize: 665856, maxBitrate: 6e6, tier: "M", level: 4 },
  // Level 3.0 (Main Tier)
  { maxPictureSize: 1065024, maxBitrate: 1e7, tier: "M", level: 5 },
  // Level 3.1 (Main Tier)
  { maxPictureSize: 2359296, maxBitrate: 12e6, tier: "M", level: 8 },
  // Level 4.0 (Main Tier)
  { maxPictureSize: 2359296, maxBitrate: 3e7, tier: "H", level: 8 },
  // Level 4.0 (High Tier)
  { maxPictureSize: 2359296, maxBitrate: 2e7, tier: "M", level: 9 },
  // Level 4.1 (Main Tier)
  { maxPictureSize: 2359296, maxBitrate: 5e7, tier: "H", level: 9 },
  // Level 4.1 (High Tier)
  { maxPictureSize: 8912896, maxBitrate: 3e7, tier: "M", level: 12 },
  // Level 5.0 (Main Tier)
  { maxPictureSize: 8912896, maxBitrate: 1e8, tier: "H", level: 12 },
  // Level 5.0 (High Tier)
  { maxPictureSize: 8912896, maxBitrate: 4e7, tier: "M", level: 13 },
  // Level 5.1 (Main Tier)
  { maxPictureSize: 8912896, maxBitrate: 16e7, tier: "H", level: 13 },
  // Level 5.1 (High Tier)
  { maxPictureSize: 8912896, maxBitrate: 6e7, tier: "M", level: 14 },
  // Level 5.2 (Main Tier)
  { maxPictureSize: 8912896, maxBitrate: 24e7, tier: "H", level: 14 },
  // Level 5.2 (High Tier)
  { maxPictureSize: 35651584, maxBitrate: 6e7, tier: "M", level: 15 },
  // Level 5.3 (Main Tier)
  { maxPictureSize: 35651584, maxBitrate: 24e7, tier: "H", level: 15 },
  // Level 5.3 (High Tier)
  { maxPictureSize: 35651584, maxBitrate: 6e7, tier: "M", level: 16 },
  // Level 6.0 (Main Tier)
  { maxPictureSize: 35651584, maxBitrate: 24e7, tier: "H", level: 16 },
  // Level 6.0 (High Tier)
  { maxPictureSize: 35651584, maxBitrate: 1e8, tier: "M", level: 17 },
  // Level 6.1 (Main Tier)
  { maxPictureSize: 35651584, maxBitrate: 48e7, tier: "H", level: 17 },
  // Level 6.1 (High Tier)
  { maxPictureSize: 35651584, maxBitrate: 16e7, tier: "M", level: 18 },
  // Level 6.2 (Main Tier)
  { maxPictureSize: 35651584, maxBitrate: 8e8, tier: "H", level: 18 },
  // Level 6.2 (High Tier)
  { maxPictureSize: 35651584, maxBitrate: 16e7, tier: "M", level: 19 },
  // Level 6.3 (Main Tier)
  { maxPictureSize: 35651584, maxBitrate: 8e8, tier: "H", level: 19 }
  // Level 6.3 (High Tier)
];
var buildVideoCodecString = (codec, width, height, bitrate) => {
  if (codec === "avc") {
    const profileIndication = 100;
    const totalMacroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
    const levelInfo = AVC_LEVEL_TABLE.find((level) => totalMacroblocks <= level.maxMacroblocks && bitrate <= level.maxBitrate) ?? last(AVC_LEVEL_TABLE);
    const levelIndication = levelInfo ? levelInfo.level : 0;
    const hexProfileIndication = profileIndication.toString(16).padStart(2, "0");
    const hexProfileCompatibility = "00";
    const hexLevelIndication = levelIndication.toString(16).padStart(2, "0");
    return `avc1.${hexProfileIndication}${hexProfileCompatibility}${hexLevelIndication}`;
  } else if (codec === "hevc") {
    const profilePrefix = "";
    const profileIdc = 1;
    const compatibilityFlags = "6";
    const pictureSize = width * height;
    const levelInfo = HEVC_LEVEL_TABLE.find((level) => pictureSize <= level.maxPictureSize && bitrate <= level.maxBitrate) ?? last(HEVC_LEVEL_TABLE);
    const constraintFlags = "B0";
    return `hev1.${profilePrefix}${profileIdc}.${compatibilityFlags}.${levelInfo.tier}${levelInfo.level}.${constraintFlags}`;
  } else if (codec === "vp8") {
    return "vp8";
  } else if (codec === "vp9") {
    const profile = "00";
    const pictureSize = width * height;
    const levelInfo = VP9_LEVEL_TABLE.find((level) => pictureSize <= level.maxPictureSize && bitrate <= level.maxBitrate) ?? last(VP9_LEVEL_TABLE);
    const bitDepth = "08";
    return `vp09.${profile}.${levelInfo.level.toString().padStart(2, "0")}.${bitDepth}`;
  } else if (codec === "av1") {
    const profile = 0;
    const pictureSize = width * height;
    const levelInfo = AV1_LEVEL_TABLE.find((level2) => pictureSize <= level2.maxPictureSize && bitrate <= level2.maxBitrate) ?? last(AV1_LEVEL_TABLE);
    const level = levelInfo.level.toString().padStart(2, "0");
    const bitDepth = "08";
    return `av01.${profile}.${level}${levelInfo.tier}.${bitDepth}`;
  }
  throw new TypeError(`Unhandled codec '${codec}'.`);
};
var generateAv1CodecConfigurationFromCodecString = (codecString) => {
  const parts = codecString.split(".");
  const marker = 1;
  const version = 1;
  const firstByte = (marker << 7) + version;
  const profile = Number(parts[1]);
  const levelAndTier = parts[2];
  const level = Number(levelAndTier.slice(0, -1));
  const secondByte = (profile << 5) + level;
  const tier = levelAndTier.slice(-1) === "H" ? 1 : 0;
  const bitDepth = Number(parts[3]);
  const highBitDepth = bitDepth === 8 ? 0 : 1;
  const twelveBit = 0;
  const monochrome = parts[4] ? Number(parts[4]) : 0;
  const chromaSubsamplingX = parts[5] ? Number(parts[5][0]) : 1;
  const chromaSubsamplingY = parts[5] ? Number(parts[5][1]) : 1;
  const chromaSamplePosition = parts[5] ? Number(parts[5][2]) : 0;
  const thirdByte = (tier << 7) + (highBitDepth << 6) + (twelveBit << 5) + (monochrome << 4) + (chromaSubsamplingX << 3) + (chromaSubsamplingY << 2) + chromaSamplePosition;
  const initialPresentationDelayPresent = 0;
  const fourthByte = initialPresentationDelayPresent;
  return [firstByte, secondByte, thirdByte, fourthByte];
};
var buildAudioCodecString = (codec, numberOfChannels, sampleRate) => {
  if (codec === "aac") {
    if (numberOfChannels >= 2 && sampleRate <= 24e3) {
      return "mp4a.40.29";
    }
    if (sampleRate <= 24e3) {
      return "mp4a.40.5";
    }
    return "mp4a.40.2";
  } else if (codec === "mp3") {
    return "mp3";
  } else if (codec === "opus") {
    return "opus";
  } else if (codec === "vorbis") {
    return "vorbis";
  } else if (codec === "flac") {
    return "flac";
  } else if (codec === "ac3") {
    return "ac-3";
  } else if (codec === "eac3") {
    return "ec-3";
  } else if (PCM_AUDIO_CODECS.includes(codec)) {
    return codec;
  }
  throw new TypeError(`Unhandled codec '${codec}'.`);
};
var PCM_CODEC_REGEX = /^pcm-([usf])(\d+)+(be)?$/;
var parsePcmCodec = (codec) => {
  assert(PCM_AUDIO_CODECS.includes(codec));
  if (codec === "ulaw") {
    return { dataType: "ulaw", sampleSize: 1, littleEndian: true, silentValue: 255 };
  } else if (codec === "alaw") {
    return { dataType: "alaw", sampleSize: 1, littleEndian: true, silentValue: 213 };
  }
  const match = PCM_CODEC_REGEX.exec(codec);
  assert(match);
  let dataType;
  if (match[1] === "u") {
    dataType = "unsigned";
  } else if (match[1] === "s") {
    dataType = "signed";
  } else {
    dataType = "float";
  }
  const sampleSize = Number(match[2]) / 8;
  const littleEndian = match[3] !== "be";
  const silentValue = codec === "pcm-u8" ? 2 ** 7 : 0;
  return { dataType, sampleSize, littleEndian, silentValue };
};
var inferCodecFromCodecString = (codecString) => {
  if (codecString.startsWith("avc1") || codecString.startsWith("avc3")) {
    return "avc";
  } else if (codecString.startsWith("hev1") || codecString.startsWith("hvc1")) {
    return "hevc";
  } else if (codecString === "vp8") {
    return "vp8";
  } else if (codecString.startsWith("vp09")) {
    return "vp9";
  } else if (codecString.startsWith("av01")) {
    return "av1";
  }
  if (codecString.startsWith("mp4a.40") || codecString === "mp4a.67") {
    return "aac";
  } else if (codecString === "mp3" || codecString === "mp4a.69" || codecString === "mp4a.6B" || codecString === "mp4a.6b") {
    return "mp3";
  } else if (codecString === "opus") {
    return "opus";
  } else if (codecString === "vorbis") {
    return "vorbis";
  } else if (codecString === "flac") {
    return "flac";
  } else if (codecString === "ac-3" || codecString === "ac3") {
    return "ac3";
  } else if (codecString === "ec-3" || codecString === "eac3") {
    return "eac3";
  } else if (codecString === "ulaw") {
    return "ulaw";
  } else if (codecString === "alaw") {
    return "alaw";
  } else if (PCM_CODEC_REGEX.test(codecString)) {
    return codecString;
  }
  if (codecString === "webvtt") {
    return "webvtt";
  }
  return null;
};
var getVideoEncoderConfigExtension = (codec) => {
  if (codec === "avc") {
    return {
      avc: {
        format: "avc"
        // Ensure the format is not Annex B
      }
    };
  } else if (codec === "hevc") {
    return {
      hevc: {
        format: "hevc"
        // Ensure the format is not Annex B
      }
    };
  }
  return {};
};
var getAudioEncoderConfigExtension = (codec) => {
  if (codec === "aac") {
    return {
      aac: {
        format: "aac"
        // Ensure the format is not ADTS
      }
    };
  } else if (codec === "opus") {
    return {
      opus: {
        format: "opus"
      }
    };
  }
  return {};
};
var VALID_VIDEO_CODEC_STRING_PREFIXES = ["avc1", "avc3", "hev1", "hvc1", "vp8", "vp09", "av01"];
var AVC_CODEC_STRING_REGEX = /^(avc1|avc3)\.[0-9a-fA-F]{6}$/;
var HEVC_CODEC_STRING_REGEX = /^(hev1|hvc1)\.(?:[ABC]?\d+)\.[0-9a-fA-F]{1,8}\.[LH]\d+(?:\.[0-9a-fA-F]{1,2}){0,6}$/;
var VP9_CODEC_STRING_REGEX = /^vp09(?:\.\d{2}){3}(?:(?:\.\d{2}){5})?$/;
var AV1_CODEC_STRING_REGEX = /^av01\.\d\.\d{2}[MH]\.\d{2}(?:\.\d\.\d{3}\.\d{2}\.\d{2}\.\d{2}\.\d)?$/;
var validateVideoChunkMetadata = (metadata) => {
  if (!metadata) {
    throw new TypeError("Video chunk metadata must be provided.");
  }
  if (typeof metadata !== "object") {
    throw new TypeError("Video chunk metadata must be an object.");
  }
  if (!metadata.decoderConfig) {
    throw new TypeError("Video chunk metadata must include a decoder configuration.");
  }
  if (typeof metadata.decoderConfig !== "object") {
    throw new TypeError("Video chunk metadata decoder configuration must be an object.");
  }
  if (typeof metadata.decoderConfig.codec !== "string") {
    throw new TypeError("Video chunk metadata decoder configuration must specify a codec string.");
  }
  if (!VALID_VIDEO_CODEC_STRING_PREFIXES.some((prefix) => metadata.decoderConfig.codec.startsWith(prefix))) {
    throw new TypeError("Video chunk metadata decoder configuration codec string must be a valid video codec string as specified in the Mediabunny Codec Registry.");
  }
  if (!Number.isInteger(metadata.decoderConfig.codedWidth) || metadata.decoderConfig.codedWidth <= 0) {
    throw new TypeError("Video chunk metadata decoder configuration must specify a valid codedWidth (positive integer).");
  }
  if (!Number.isInteger(metadata.decoderConfig.codedHeight) || metadata.decoderConfig.codedHeight <= 0) {
    throw new TypeError("Video chunk metadata decoder configuration must specify a valid codedHeight (positive integer).");
  }
  if (metadata.decoderConfig.description !== void 0) {
    if (!isAllowSharedBufferSource(metadata.decoderConfig.description)) {
      throw new TypeError("Video chunk metadata decoder configuration description, when defined, must be an ArrayBuffer or an ArrayBuffer view.");
    }
  }
  if (metadata.decoderConfig.colorSpace !== void 0) {
    const { colorSpace } = metadata.decoderConfig;
    if (typeof colorSpace !== "object") {
      throw new TypeError("Video chunk metadata decoder configuration colorSpace, when provided, must be an object.");
    }
    const primariesValues = Object.keys(COLOR_PRIMARIES_MAP);
    if (colorSpace.primaries != null && !primariesValues.includes(colorSpace.primaries)) {
      throw new TypeError(`Video chunk metadata decoder configuration colorSpace primaries, when defined, must be one of ${primariesValues.join(", ")}.`);
    }
    const transferValues = Object.keys(TRANSFER_CHARACTERISTICS_MAP);
    if (colorSpace.transfer != null && !transferValues.includes(colorSpace.transfer)) {
      throw new TypeError(`Video chunk metadata decoder configuration colorSpace transfer, when defined, must be one of ${transferValues.join(", ")}.`);
    }
    const matrixValues = Object.keys(MATRIX_COEFFICIENTS_MAP);
    if (colorSpace.matrix != null && !matrixValues.includes(colorSpace.matrix)) {
      throw new TypeError(`Video chunk metadata decoder configuration colorSpace matrix, when defined, must be one of ${matrixValues.join(", ")}.`);
    }
    if (colorSpace.fullRange != null && typeof colorSpace.fullRange !== "boolean") {
      throw new TypeError("Video chunk metadata decoder configuration colorSpace fullRange, when defined, must be a boolean.");
    }
  }
  if (metadata.decoderConfig.codec.startsWith("avc1") || metadata.decoderConfig.codec.startsWith("avc3")) {
    if (!AVC_CODEC_STRING_REGEX.test(metadata.decoderConfig.codec)) {
      throw new TypeError("Video chunk metadata decoder configuration codec string for AVC must be a valid AVC codec string as specified in Section 3.4 of RFC 6381.");
    }
  } else if (metadata.decoderConfig.codec.startsWith("hev1") || metadata.decoderConfig.codec.startsWith("hvc1")) {
    if (!HEVC_CODEC_STRING_REGEX.test(metadata.decoderConfig.codec)) {
      throw new TypeError("Video chunk metadata decoder configuration codec string for HEVC must be a valid HEVC codec string as specified in Section E.3 of ISO 14496-15.");
    }
  } else if (metadata.decoderConfig.codec.startsWith("vp8")) {
    if (metadata.decoderConfig.codec !== "vp8") {
      throw new TypeError('Video chunk metadata decoder configuration codec string for VP8 must be "vp8".');
    }
  } else if (metadata.decoderConfig.codec.startsWith("vp09")) {
    if (!VP9_CODEC_STRING_REGEX.test(metadata.decoderConfig.codec)) {
      throw new TypeError('Video chunk metadata decoder configuration codec string for VP9 must be a valid VP9 codec string as specified in Section "Codecs Parameter String" of https://www.webmproject.org/vp9/mp4/.');
    }
  } else if (metadata.decoderConfig.codec.startsWith("av01")) {
    if (!AV1_CODEC_STRING_REGEX.test(metadata.decoderConfig.codec)) {
      throw new TypeError('Video chunk metadata decoder configuration codec string for AV1 must be a valid AV1 codec string as specified in Section "Codecs Parameter String" of https://aomediacodec.github.io/av1-isobmff/.');
    }
  }
};
var VALID_AUDIO_CODEC_STRING_PREFIXES = [
  "mp4a",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "ulaw",
  "alaw",
  "pcm",
  "ac-3",
  "ec-3"
];
var validateAudioChunkMetadata = (metadata) => {
  if (!metadata) {
    throw new TypeError("Audio chunk metadata must be provided.");
  }
  if (typeof metadata !== "object") {
    throw new TypeError("Audio chunk metadata must be an object.");
  }
  if (!metadata.decoderConfig) {
    throw new TypeError("Audio chunk metadata must include a decoder configuration.");
  }
  if (typeof metadata.decoderConfig !== "object") {
    throw new TypeError("Audio chunk metadata decoder configuration must be an object.");
  }
  if (typeof metadata.decoderConfig.codec !== "string") {
    throw new TypeError("Audio chunk metadata decoder configuration must specify a codec string.");
  }
  if (!VALID_AUDIO_CODEC_STRING_PREFIXES.some((prefix) => metadata.decoderConfig.codec.startsWith(prefix))) {
    throw new TypeError("Audio chunk metadata decoder configuration codec string must be a valid audio codec string as specified in the Mediabunny Codec Registry.");
  }
  if (!Number.isInteger(metadata.decoderConfig.sampleRate) || metadata.decoderConfig.sampleRate <= 0) {
    throw new TypeError("Audio chunk metadata decoder configuration must specify a valid sampleRate (positive integer).");
  }
  if (!Number.isInteger(metadata.decoderConfig.numberOfChannels) || metadata.decoderConfig.numberOfChannels <= 0) {
    throw new TypeError("Audio chunk metadata decoder configuration must specify a valid numberOfChannels (positive integer).");
  }
  if (metadata.decoderConfig.description !== void 0) {
    if (!isAllowSharedBufferSource(metadata.decoderConfig.description)) {
      throw new TypeError("Audio chunk metadata decoder configuration description, when defined, must be an ArrayBuffer or an ArrayBuffer view.");
    }
  }
  if (metadata.decoderConfig.codec.startsWith("mp4a") && metadata.decoderConfig.codec !== "mp4a.69" && metadata.decoderConfig.codec !== "mp4a.6B" && metadata.decoderConfig.codec !== "mp4a.6b") {
    const validStrings = ["mp4a.40.2", "mp4a.40.02", "mp4a.40.5", "mp4a.40.05", "mp4a.40.29", "mp4a.67"];
    if (!validStrings.includes(metadata.decoderConfig.codec)) {
      throw new TypeError("Audio chunk metadata decoder configuration codec string for AAC must be a valid AAC codec string as specified in https://www.w3.org/TR/webcodecs-aac-codec-registration/.");
    }
  } else if (metadata.decoderConfig.codec.startsWith("mp3") || metadata.decoderConfig.codec.startsWith("mp4a")) {
    if (metadata.decoderConfig.codec !== "mp3" && metadata.decoderConfig.codec !== "mp4a.69" && metadata.decoderConfig.codec !== "mp4a.6B" && metadata.decoderConfig.codec !== "mp4a.6b") {
      throw new TypeError('Audio chunk metadata decoder configuration codec string for MP3 must be "mp3", "mp4a.69" or "mp4a.6B".');
    }
  } else if (metadata.decoderConfig.codec.startsWith("opus")) {
    if (metadata.decoderConfig.codec !== "opus") {
      throw new TypeError('Audio chunk metadata decoder configuration codec string for Opus must be "opus".');
    }
    if (metadata.decoderConfig.description && metadata.decoderConfig.description.byteLength < 18) {
      throw new TypeError("Audio chunk metadata decoder configuration description, when specified, is expected to be an Identification Header as specified in Section 5.1 of RFC 7845.");
    }
  } else if (metadata.decoderConfig.codec.startsWith("vorbis")) {
    if (metadata.decoderConfig.codec !== "vorbis") {
      throw new TypeError('Audio chunk metadata decoder configuration codec string for Vorbis must be "vorbis".');
    }
    if (!metadata.decoderConfig.description) {
      throw new TypeError("Audio chunk metadata decoder configuration for Vorbis must include a description, which is expected to adhere to the format described in https://www.w3.org/TR/webcodecs-vorbis-codec-registration/.");
    }
  } else if (metadata.decoderConfig.codec.startsWith("flac")) {
    if (metadata.decoderConfig.codec !== "flac") {
      throw new TypeError('Audio chunk metadata decoder configuration codec string for FLAC must be "flac".');
    }
    const minDescriptionSize = 4 + 4 + 34;
    if (!metadata.decoderConfig.description || metadata.decoderConfig.description.byteLength < minDescriptionSize) {
      throw new TypeError("Audio chunk metadata decoder configuration for FLAC must include a description, which is expected to adhere to the format described in https://www.w3.org/TR/webcodecs-flac-codec-registration/.");
    }
  } else if (metadata.decoderConfig.codec.startsWith("ac-3") || metadata.decoderConfig.codec.startsWith("ac3")) {
    if (metadata.decoderConfig.codec !== "ac-3") {
      throw new TypeError('Audio chunk metadata decoder configuration codec string for AC-3 must be "ac-3".');
    }
  } else if (metadata.decoderConfig.codec.startsWith("ec-3") || metadata.decoderConfig.codec.startsWith("eac3")) {
    if (metadata.decoderConfig.codec !== "ec-3") {
      throw new TypeError('Audio chunk metadata decoder configuration codec string for EC-3 must be "ec-3".');
    }
  } else if (metadata.decoderConfig.codec.startsWith("pcm") || metadata.decoderConfig.codec.startsWith("ulaw") || metadata.decoderConfig.codec.startsWith("alaw")) {
    if (!PCM_AUDIO_CODECS.includes(metadata.decoderConfig.codec)) {
      throw new TypeError(`Audio chunk metadata decoder configuration codec string for PCM must be one of the supported PCM codecs (${PCM_AUDIO_CODECS.join(", ")}).`);
    }
  }
};
var validateSubtitleMetadata = (metadata) => {
  if (!metadata) {
    throw new TypeError("Subtitle metadata must be provided.");
  }
  if (typeof metadata !== "object") {
    throw new TypeError("Subtitle metadata must be an object.");
  }
  if (!metadata.config) {
    throw new TypeError("Subtitle metadata must include a config object.");
  }
  if (typeof metadata.config !== "object") {
    throw new TypeError("Subtitle metadata config must be an object.");
  }
  if (typeof metadata.config.description !== "string") {
    throw new TypeError("Subtitle metadata config description must be a string.");
  }
};

// node_modules/mediabunny/dist/modules/shared/ac3-misc.js
var AC3_SAMPLE_RATES = [48e3, 44100, 32e3];
var EAC3_REDUCED_SAMPLE_RATES = [24e3, 22050, 16e3];

// node_modules/mediabunny/dist/modules/src/codec-data.js
var AvcNalUnitType;
(function(AvcNalUnitType2) {
  AvcNalUnitType2[AvcNalUnitType2["NON_IDR_SLICE"] = 1] = "NON_IDR_SLICE";
  AvcNalUnitType2[AvcNalUnitType2["SLICE_DPA"] = 2] = "SLICE_DPA";
  AvcNalUnitType2[AvcNalUnitType2["SLICE_DPB"] = 3] = "SLICE_DPB";
  AvcNalUnitType2[AvcNalUnitType2["SLICE_DPC"] = 4] = "SLICE_DPC";
  AvcNalUnitType2[AvcNalUnitType2["IDR"] = 5] = "IDR";
  AvcNalUnitType2[AvcNalUnitType2["SEI"] = 6] = "SEI";
  AvcNalUnitType2[AvcNalUnitType2["SPS"] = 7] = "SPS";
  AvcNalUnitType2[AvcNalUnitType2["PPS"] = 8] = "PPS";
  AvcNalUnitType2[AvcNalUnitType2["AUD"] = 9] = "AUD";
  AvcNalUnitType2[AvcNalUnitType2["SPS_EXT"] = 13] = "SPS_EXT";
})(AvcNalUnitType || (AvcNalUnitType = {}));
var HevcNalUnitType;
(function(HevcNalUnitType2) {
  HevcNalUnitType2[HevcNalUnitType2["RASL_N"] = 8] = "RASL_N";
  HevcNalUnitType2[HevcNalUnitType2["RASL_R"] = 9] = "RASL_R";
  HevcNalUnitType2[HevcNalUnitType2["BLA_W_LP"] = 16] = "BLA_W_LP";
  HevcNalUnitType2[HevcNalUnitType2["RSV_IRAP_VCL23"] = 23] = "RSV_IRAP_VCL23";
  HevcNalUnitType2[HevcNalUnitType2["VPS_NUT"] = 32] = "VPS_NUT";
  HevcNalUnitType2[HevcNalUnitType2["SPS_NUT"] = 33] = "SPS_NUT";
  HevcNalUnitType2[HevcNalUnitType2["PPS_NUT"] = 34] = "PPS_NUT";
  HevcNalUnitType2[HevcNalUnitType2["AUD_NUT"] = 35] = "AUD_NUT";
  HevcNalUnitType2[HevcNalUnitType2["PREFIX_SEI_NUT"] = 39] = "PREFIX_SEI_NUT";
  HevcNalUnitType2[HevcNalUnitType2["SUFFIX_SEI_NUT"] = 40] = "SUFFIX_SEI_NUT";
})(HevcNalUnitType || (HevcNalUnitType = {}));
var iterateNalUnitsInAnnexB = function* (packetData) {
  let i = 0;
  let nalStart = -1;
  while (i < packetData.length - 2) {
    const zeroIndex = packetData.indexOf(0, i);
    if (zeroIndex === -1 || zeroIndex >= packetData.length - 2) {
      break;
    }
    i = zeroIndex;
    let startCodeLength = 0;
    if (i + 3 < packetData.length && packetData[i + 1] === 0 && packetData[i + 2] === 0 && packetData[i + 3] === 1) {
      startCodeLength = 4;
    } else if (packetData[i + 1] === 0 && packetData[i + 2] === 1) {
      startCodeLength = 3;
    }
    if (startCodeLength === 0) {
      i++;
      continue;
    }
    if (nalStart !== -1 && i > nalStart) {
      yield {
        offset: nalStart,
        length: i - nalStart
      };
    }
    nalStart = i + startCodeLength;
    i = nalStart;
  }
  if (nalStart !== -1 && nalStart < packetData.length) {
    yield {
      offset: nalStart,
      length: packetData.length - nalStart
    };
  }
};
var extractNalUnitTypeForAvc = (byte) => {
  return byte & 31;
};
var removeEmulationPreventionBytes = (data) => {
  const result = [];
  const len = data.length;
  for (let i = 0; i < len; i++) {
    if (i + 2 < len && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 3) {
      result.push(0, 0);
      i += 2;
    } else {
      result.push(data[i]);
    }
  }
  return new Uint8Array(result);
};
var ANNEX_B_START_CODE = new Uint8Array([0, 0, 0, 1]);
var concatNalUnitsInLengthPrefixed = (nalUnits, lengthSize) => {
  const totalLength = nalUnits.reduce((a, b) => a + lengthSize + b.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const nalUnit of nalUnits) {
    const dataView = new DataView(result.buffer, result.byteOffset, result.byteLength);
    switch (lengthSize) {
      case 1:
        dataView.setUint8(offset, nalUnit.byteLength);
        break;
      case 2:
        dataView.setUint16(offset, nalUnit.byteLength, false);
        break;
      case 3:
        setUint24(dataView, offset, nalUnit.byteLength, false);
        break;
      case 4:
        dataView.setUint32(offset, nalUnit.byteLength, false);
        break;
    }
    offset += lengthSize;
    result.set(nalUnit, offset);
    offset += nalUnit.byteLength;
  }
  return result;
};
var extractAvcDecoderConfigurationRecord = (packetData) => {
  try {
    const spsUnits = [];
    const ppsUnits = [];
    const spsExtUnits = [];
    for (const loc of iterateNalUnitsInAnnexB(packetData)) {
      const nalUnit = packetData.subarray(loc.offset, loc.offset + loc.length);
      const type = extractNalUnitTypeForAvc(nalUnit[0]);
      if (type === AvcNalUnitType.SPS) {
        spsUnits.push(nalUnit);
      } else if (type === AvcNalUnitType.PPS) {
        ppsUnits.push(nalUnit);
      } else if (type === AvcNalUnitType.SPS_EXT) {
        spsExtUnits.push(nalUnit);
      }
    }
    if (spsUnits.length === 0) {
      return null;
    }
    if (ppsUnits.length === 0) {
      return null;
    }
    const spsData = spsUnits[0];
    const spsInfo = parseAvcSps(spsData);
    assert(spsInfo !== null);
    const hasExtendedData = spsInfo.profileIdc === 100 || spsInfo.profileIdc === 110 || spsInfo.profileIdc === 122 || spsInfo.profileIdc === 144;
    return {
      configurationVersion: 1,
      avcProfileIndication: spsInfo.profileIdc,
      profileCompatibility: spsInfo.constraintFlags,
      avcLevelIndication: spsInfo.levelIdc,
      lengthSizeMinusOne: 3,
      // Typically 4 bytes for length field
      sequenceParameterSets: spsUnits,
      pictureParameterSets: ppsUnits,
      chromaFormat: hasExtendedData ? spsInfo.chromaFormatIdc : null,
      bitDepthLumaMinus8: hasExtendedData ? spsInfo.bitDepthLumaMinus8 : null,
      bitDepthChromaMinus8: hasExtendedData ? spsInfo.bitDepthChromaMinus8 : null,
      sequenceParameterSetExt: hasExtendedData ? spsExtUnits : null
    };
  } catch (error) {
    console.error("Error building AVC Decoder Configuration Record:", error);
    return null;
  }
};
var serializeAvcDecoderConfigurationRecord = (record) => {
  const bytes2 = [];
  bytes2.push(record.configurationVersion);
  bytes2.push(record.avcProfileIndication);
  bytes2.push(record.profileCompatibility);
  bytes2.push(record.avcLevelIndication);
  bytes2.push(252 | record.lengthSizeMinusOne & 3);
  bytes2.push(224 | record.sequenceParameterSets.length & 31);
  for (const sps of record.sequenceParameterSets) {
    const length = sps.byteLength;
    bytes2.push(length >> 8);
    bytes2.push(length & 255);
    for (let i = 0; i < length; i++) {
      bytes2.push(sps[i]);
    }
  }
  bytes2.push(record.pictureParameterSets.length);
  for (const pps of record.pictureParameterSets) {
    const length = pps.byteLength;
    bytes2.push(length >> 8);
    bytes2.push(length & 255);
    for (let i = 0; i < length; i++) {
      bytes2.push(pps[i]);
    }
  }
  if (record.avcProfileIndication === 100 || record.avcProfileIndication === 110 || record.avcProfileIndication === 122 || record.avcProfileIndication === 144) {
    assert(record.chromaFormat !== null);
    assert(record.bitDepthLumaMinus8 !== null);
    assert(record.bitDepthChromaMinus8 !== null);
    assert(record.sequenceParameterSetExt !== null);
    bytes2.push(252 | record.chromaFormat & 3);
    bytes2.push(248 | record.bitDepthLumaMinus8 & 7);
    bytes2.push(248 | record.bitDepthChromaMinus8 & 7);
    bytes2.push(record.sequenceParameterSetExt.length);
    for (const spsExt of record.sequenceParameterSetExt) {
      const length = spsExt.byteLength;
      bytes2.push(length >> 8);
      bytes2.push(length & 255);
      for (let i = 0; i < length; i++) {
        bytes2.push(spsExt[i]);
      }
    }
  }
  return new Uint8Array(bytes2);
};
var AVC_HEVC_ASPECT_RATIO_IDC_TABLE = {
  1: { num: 1, den: 1 },
  2: { num: 12, den: 11 },
  3: { num: 10, den: 11 },
  4: { num: 16, den: 11 },
  5: { num: 40, den: 33 },
  6: { num: 24, den: 11 },
  7: { num: 20, den: 11 },
  8: { num: 32, den: 11 },
  9: { num: 80, den: 33 },
  10: { num: 18, den: 11 },
  11: { num: 15, den: 11 },
  12: { num: 64, den: 33 },
  13: { num: 160, den: 99 },
  14: { num: 4, den: 3 },
  15: { num: 3, den: 2 },
  16: { num: 2, den: 1 }
};
var parseAvcSps = (sps) => {
  try {
    const bitstream = new Bitstream(removeEmulationPreventionBytes(sps));
    bitstream.skipBits(1);
    bitstream.skipBits(2);
    const nalUnitType = bitstream.readBits(5);
    if (nalUnitType !== 7) {
      return null;
    }
    const profileIdc = bitstream.readAlignedByte();
    const constraintFlags = bitstream.readAlignedByte();
    const levelIdc = bitstream.readAlignedByte();
    readExpGolomb(bitstream);
    let chromaFormatIdc = 1;
    let bitDepthLumaMinus8 = 0;
    let bitDepthChromaMinus8 = 0;
    let separateColourPlaneFlag = 0;
    if (profileIdc === 100 || profileIdc === 110 || profileIdc === 122 || profileIdc === 244 || profileIdc === 44 || profileIdc === 83 || profileIdc === 86 || profileIdc === 118 || profileIdc === 128) {
      chromaFormatIdc = readExpGolomb(bitstream);
      if (chromaFormatIdc === 3) {
        separateColourPlaneFlag = bitstream.readBits(1);
      }
      bitDepthLumaMinus8 = readExpGolomb(bitstream);
      bitDepthChromaMinus8 = readExpGolomb(bitstream);
      bitstream.skipBits(1);
      const seqScalingMatrixPresentFlag = bitstream.readBits(1);
      if (seqScalingMatrixPresentFlag) {
        for (let i = 0; i < (chromaFormatIdc !== 3 ? 8 : 12); i++) {
          const seqScalingListPresentFlag = bitstream.readBits(1);
          if (seqScalingListPresentFlag) {
            const sizeOfScalingList = i < 6 ? 16 : 64;
            let lastScale = 8;
            let nextScale = 8;
            for (let j = 0; j < sizeOfScalingList; j++) {
              if (nextScale !== 0) {
                const deltaScale = readSignedExpGolomb(bitstream);
                nextScale = (lastScale + deltaScale + 256) % 256;
              }
              lastScale = nextScale === 0 ? lastScale : nextScale;
            }
          }
        }
      }
    }
    readExpGolomb(bitstream);
    const picOrderCntType = readExpGolomb(bitstream);
    if (picOrderCntType === 0) {
      readExpGolomb(bitstream);
    } else if (picOrderCntType === 1) {
      bitstream.skipBits(1);
      readSignedExpGolomb(bitstream);
      readSignedExpGolomb(bitstream);
      const numRefFramesInPicOrderCntCycle = readExpGolomb(bitstream);
      for (let i = 0; i < numRefFramesInPicOrderCntCycle; i++) {
        readSignedExpGolomb(bitstream);
      }
    }
    readExpGolomb(bitstream);
    bitstream.skipBits(1);
    const picWidthInMbsMinus1 = readExpGolomb(bitstream);
    const picHeightInMapUnitsMinus1 = readExpGolomb(bitstream);
    const codedWidth = 16 * (picWidthInMbsMinus1 + 1);
    const codedHeight = 16 * (picHeightInMapUnitsMinus1 + 1);
    let displayWidth = codedWidth;
    let displayHeight = codedHeight;
    const frameMbsOnlyFlag = bitstream.readBits(1);
    if (!frameMbsOnlyFlag) {
      bitstream.skipBits(1);
    }
    bitstream.skipBits(1);
    const frameCroppingFlag = bitstream.readBits(1);
    if (frameCroppingFlag) {
      const frameCropLeftOffset = readExpGolomb(bitstream);
      const frameCropRightOffset = readExpGolomb(bitstream);
      const frameCropTopOffset = readExpGolomb(bitstream);
      const frameCropBottomOffset = readExpGolomb(bitstream);
      let cropUnitX;
      let cropUnitY;
      const chromaArrayType = separateColourPlaneFlag === 0 ? chromaFormatIdc : 0;
      if (chromaArrayType === 0) {
        cropUnitX = 1;
        cropUnitY = 2 - frameMbsOnlyFlag;
      } else {
        const subWidthC = chromaFormatIdc === 3 ? 1 : 2;
        const subHeightC = chromaFormatIdc === 1 ? 2 : 1;
        cropUnitX = subWidthC;
        cropUnitY = subHeightC * (2 - frameMbsOnlyFlag);
      }
      displayWidth -= cropUnitX * (frameCropLeftOffset + frameCropRightOffset);
      displayHeight -= cropUnitY * (frameCropTopOffset + frameCropBottomOffset);
    }
    let colourPrimaries = 2;
    let transferCharacteristics = 2;
    let matrixCoefficients = 2;
    let fullRangeFlag = 0;
    let pixelAspectRatio = { num: 1, den: 1 };
    let numReorderFrames = null;
    let maxDecFrameBuffering = null;
    const vuiParametersPresentFlag = bitstream.readBits(1);
    if (vuiParametersPresentFlag) {
      const aspectRatioInfoPresentFlag = bitstream.readBits(1);
      if (aspectRatioInfoPresentFlag) {
        const aspectRatioIdc = bitstream.readBits(8);
        if (aspectRatioIdc === 255) {
          pixelAspectRatio = {
            num: bitstream.readBits(16),
            den: bitstream.readBits(16)
          };
        } else {
          const aspectRatio = AVC_HEVC_ASPECT_RATIO_IDC_TABLE[aspectRatioIdc];
          if (aspectRatio) {
            pixelAspectRatio = aspectRatio;
          }
        }
      }
      const overscanInfoPresentFlag = bitstream.readBits(1);
      if (overscanInfoPresentFlag) {
        bitstream.skipBits(1);
      }
      const videoSignalTypePresentFlag = bitstream.readBits(1);
      if (videoSignalTypePresentFlag) {
        bitstream.skipBits(3);
        fullRangeFlag = bitstream.readBits(1);
        const colourDescriptionPresentFlag = bitstream.readBits(1);
        if (colourDescriptionPresentFlag) {
          colourPrimaries = bitstream.readBits(8);
          transferCharacteristics = bitstream.readBits(8);
          matrixCoefficients = bitstream.readBits(8);
        }
      }
      const chromaLocInfoPresentFlag = bitstream.readBits(1);
      if (chromaLocInfoPresentFlag) {
        readExpGolomb(bitstream);
        readExpGolomb(bitstream);
      }
      const timingInfoPresentFlag = bitstream.readBits(1);
      if (timingInfoPresentFlag) {
        bitstream.skipBits(32);
        bitstream.skipBits(32);
        bitstream.skipBits(1);
      }
      const nalHrdParametersPresentFlag = bitstream.readBits(1);
      if (nalHrdParametersPresentFlag) {
        skipAvcHrdParameters(bitstream);
      }
      const vclHrdParametersPresentFlag = bitstream.readBits(1);
      if (vclHrdParametersPresentFlag) {
        skipAvcHrdParameters(bitstream);
      }
      if (nalHrdParametersPresentFlag || vclHrdParametersPresentFlag) {
        bitstream.skipBits(1);
      }
      bitstream.skipBits(1);
      const bitstreamRestrictionFlag = bitstream.readBits(1);
      if (bitstreamRestrictionFlag) {
        bitstream.skipBits(1);
        readExpGolomb(bitstream);
        readExpGolomb(bitstream);
        readExpGolomb(bitstream);
        readExpGolomb(bitstream);
        numReorderFrames = readExpGolomb(bitstream);
        maxDecFrameBuffering = readExpGolomb(bitstream);
      }
    }
    if (numReorderFrames === null) {
      assert(maxDecFrameBuffering === null);
      const constraintSet3Flag = constraintFlags & 16;
      if ((profileIdc === 44 || profileIdc === 86 || profileIdc === 100 || profileIdc === 110 || profileIdc === 122 || profileIdc === 244) && constraintSet3Flag) {
        numReorderFrames = 0;
        maxDecFrameBuffering = 0;
      } else {
        const picWidthInMbs = picWidthInMbsMinus1 + 1;
        const picHeightInMapUnits = picHeightInMapUnitsMinus1 + 1;
        const frameHeightInMbs = (2 - frameMbsOnlyFlag) * picHeightInMapUnits;
        const levelInfo = AVC_LEVEL_TABLE.find((x) => x.level >= levelIdc) ?? last(AVC_LEVEL_TABLE);
        const maxDpbFrames = Math.min(Math.floor(levelInfo.maxDpbMbs / (picWidthInMbs * frameHeightInMbs)), 16);
        numReorderFrames = maxDpbFrames;
        maxDecFrameBuffering = maxDpbFrames;
      }
    }
    assert(maxDecFrameBuffering !== null);
    return {
      profileIdc,
      constraintFlags,
      levelIdc,
      frameMbsOnlyFlag,
      chromaFormatIdc,
      bitDepthLumaMinus8,
      bitDepthChromaMinus8,
      codedWidth,
      codedHeight,
      displayWidth,
      displayHeight,
      pixelAspectRatio,
      colourPrimaries,
      matrixCoefficients,
      transferCharacteristics,
      fullRangeFlag,
      numReorderFrames,
      maxDecFrameBuffering
    };
  } catch (error) {
    console.error("Error parsing AVC SPS:", error);
    return null;
  }
};
var skipAvcHrdParameters = (bitstream) => {
  const cpb_cnt_minus1 = readExpGolomb(bitstream);
  bitstream.skipBits(4);
  bitstream.skipBits(4);
  for (let i = 0; i <= cpb_cnt_minus1; i++) {
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    bitstream.skipBits(1);
  }
  bitstream.skipBits(5);
  bitstream.skipBits(5);
  bitstream.skipBits(5);
  bitstream.skipBits(5);
};
var extractNalUnitTypeForHevc = (byte) => {
  return byte >> 1 & 63;
};
var parseHevcSps = (sps) => {
  try {
    const bitstream = new Bitstream(removeEmulationPreventionBytes(sps));
    bitstream.skipBits(16);
    bitstream.readBits(4);
    const spsMaxSubLayersMinus1 = bitstream.readBits(3);
    const spsTemporalIdNestingFlag = bitstream.readBits(1);
    const { general_profile_space, general_tier_flag, general_profile_idc, general_profile_compatibility_flags, general_constraint_indicator_flags, general_level_idc } = parseProfileTierLevel(bitstream, spsMaxSubLayersMinus1);
    readExpGolomb(bitstream);
    const chromaFormatIdc = readExpGolomb(bitstream);
    let separateColourPlaneFlag = 0;
    if (chromaFormatIdc === 3) {
      separateColourPlaneFlag = bitstream.readBits(1);
    }
    const picWidthInLumaSamples = readExpGolomb(bitstream);
    const picHeightInLumaSamples = readExpGolomb(bitstream);
    let displayWidth = picWidthInLumaSamples;
    let displayHeight = picHeightInLumaSamples;
    if (bitstream.readBits(1)) {
      const confWinLeftOffset = readExpGolomb(bitstream);
      const confWinRightOffset = readExpGolomb(bitstream);
      const confWinTopOffset = readExpGolomb(bitstream);
      const confWinBottomOffset = readExpGolomb(bitstream);
      let subWidthC = 1;
      let subHeightC = 1;
      const chromaArrayType = separateColourPlaneFlag === 0 ? chromaFormatIdc : 0;
      if (chromaArrayType === 1) {
        subWidthC = 2;
        subHeightC = 2;
      } else if (chromaArrayType === 2) {
        subWidthC = 2;
        subHeightC = 1;
      }
      displayWidth -= (confWinLeftOffset + confWinRightOffset) * subWidthC;
      displayHeight -= (confWinTopOffset + confWinBottomOffset) * subHeightC;
    }
    const bitDepthLumaMinus8 = readExpGolomb(bitstream);
    const bitDepthChromaMinus8 = readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    const spsSubLayerOrderingInfoPresentFlag = bitstream.readBits(1);
    const startI = spsSubLayerOrderingInfoPresentFlag ? 0 : spsMaxSubLayersMinus1;
    let spsMaxNumReorderPics = 0;
    for (let i = startI; i <= spsMaxSubLayersMinus1; i++) {
      readExpGolomb(bitstream);
      spsMaxNumReorderPics = readExpGolomb(bitstream);
      readExpGolomb(bitstream);
    }
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    if (bitstream.readBits(1)) {
      if (bitstream.readBits(1)) {
        skipScalingListData(bitstream);
      }
    }
    bitstream.skipBits(1);
    bitstream.skipBits(1);
    if (bitstream.readBits(1)) {
      bitstream.skipBits(4);
      bitstream.skipBits(4);
      readExpGolomb(bitstream);
      readExpGolomb(bitstream);
      bitstream.skipBits(1);
    }
    const numShortTermRefPicSets = readExpGolomb(bitstream);
    skipAllStRefPicSets(bitstream, numShortTermRefPicSets);
    if (bitstream.readBits(1)) {
      const numLongTermRefPicsSps = readExpGolomb(bitstream);
      for (let i = 0; i < numLongTermRefPicsSps; i++) {
        readExpGolomb(bitstream);
        bitstream.skipBits(1);
      }
    }
    bitstream.skipBits(1);
    bitstream.skipBits(1);
    let colourPrimaries = 2;
    let transferCharacteristics = 2;
    let matrixCoefficients = 2;
    let fullRangeFlag = 0;
    let minSpatialSegmentationIdc = 0;
    let pixelAspectRatio = { num: 1, den: 1 };
    if (bitstream.readBits(1)) {
      const vui = parseHevcVui(bitstream, spsMaxSubLayersMinus1);
      pixelAspectRatio = vui.pixelAspectRatio;
      colourPrimaries = vui.colourPrimaries;
      transferCharacteristics = vui.transferCharacteristics;
      matrixCoefficients = vui.matrixCoefficients;
      fullRangeFlag = vui.fullRangeFlag;
      minSpatialSegmentationIdc = vui.minSpatialSegmentationIdc;
    }
    return {
      displayWidth,
      displayHeight,
      pixelAspectRatio,
      colourPrimaries,
      transferCharacteristics,
      matrixCoefficients,
      fullRangeFlag,
      maxDecFrameBuffering: spsMaxNumReorderPics + 1,
      spsMaxSubLayersMinus1,
      spsTemporalIdNestingFlag,
      generalProfileSpace: general_profile_space,
      generalTierFlag: general_tier_flag,
      generalProfileIdc: general_profile_idc,
      generalProfileCompatibilityFlags: general_profile_compatibility_flags,
      generalConstraintIndicatorFlags: general_constraint_indicator_flags,
      generalLevelIdc: general_level_idc,
      chromaFormatIdc,
      bitDepthLumaMinus8,
      bitDepthChromaMinus8,
      minSpatialSegmentationIdc
    };
  } catch (error) {
    console.error("Error parsing HEVC SPS:", error);
    return null;
  }
};
var extractHevcDecoderConfigurationRecord = (packetData) => {
  try {
    const vpsUnits = [];
    const spsUnits = [];
    const ppsUnits = [];
    const seiUnits = [];
    for (const loc of iterateNalUnitsInAnnexB(packetData)) {
      const nalUnit = packetData.subarray(loc.offset, loc.offset + loc.length);
      const type = extractNalUnitTypeForHevc(nalUnit[0]);
      if (type === HevcNalUnitType.VPS_NUT) {
        vpsUnits.push(nalUnit);
      } else if (type === HevcNalUnitType.SPS_NUT) {
        spsUnits.push(nalUnit);
      } else if (type === HevcNalUnitType.PPS_NUT) {
        ppsUnits.push(nalUnit);
      } else if (type === HevcNalUnitType.PREFIX_SEI_NUT || type === HevcNalUnitType.SUFFIX_SEI_NUT) {
        seiUnits.push(nalUnit);
      }
    }
    if (spsUnits.length === 0 || ppsUnits.length === 0)
      return null;
    const spsInfo = parseHevcSps(spsUnits[0]);
    if (!spsInfo)
      return null;
    let parallelismType = 0;
    if (ppsUnits.length > 0) {
      const pps = ppsUnits[0];
      const ppsBitstream = new Bitstream(removeEmulationPreventionBytes(pps));
      ppsBitstream.skipBits(16);
      readExpGolomb(ppsBitstream);
      readExpGolomb(ppsBitstream);
      ppsBitstream.skipBits(1);
      ppsBitstream.skipBits(1);
      ppsBitstream.skipBits(3);
      ppsBitstream.skipBits(1);
      ppsBitstream.skipBits(1);
      readExpGolomb(ppsBitstream);
      readExpGolomb(ppsBitstream);
      readSignedExpGolomb(ppsBitstream);
      ppsBitstream.skipBits(1);
      ppsBitstream.skipBits(1);
      if (ppsBitstream.readBits(1)) {
        readExpGolomb(ppsBitstream);
      }
      readSignedExpGolomb(ppsBitstream);
      readSignedExpGolomb(ppsBitstream);
      ppsBitstream.skipBits(1);
      ppsBitstream.skipBits(1);
      ppsBitstream.skipBits(1);
      ppsBitstream.skipBits(1);
      const tiles_enabled_flag = ppsBitstream.readBits(1);
      const entropy_coding_sync_enabled_flag = ppsBitstream.readBits(1);
      if (!tiles_enabled_flag && !entropy_coding_sync_enabled_flag)
        parallelismType = 0;
      else if (tiles_enabled_flag && !entropy_coding_sync_enabled_flag)
        parallelismType = 2;
      else if (!tiles_enabled_flag && entropy_coding_sync_enabled_flag)
        parallelismType = 3;
      else
        parallelismType = 0;
    }
    const arrays = [
      ...vpsUnits.length ? [
        {
          arrayCompleteness: 1,
          nalUnitType: HevcNalUnitType.VPS_NUT,
          nalUnits: vpsUnits
        }
      ] : [],
      ...spsUnits.length ? [
        {
          arrayCompleteness: 1,
          nalUnitType: HevcNalUnitType.SPS_NUT,
          nalUnits: spsUnits
        }
      ] : [],
      ...ppsUnits.length ? [
        {
          arrayCompleteness: 1,
          nalUnitType: HevcNalUnitType.PPS_NUT,
          nalUnits: ppsUnits
        }
      ] : [],
      ...seiUnits.length ? [
        {
          arrayCompleteness: 1,
          nalUnitType: extractNalUnitTypeForHevc(seiUnits[0][0]),
          nalUnits: seiUnits
        }
      ] : []
    ];
    const record = {
      configurationVersion: 1,
      generalProfileSpace: spsInfo.generalProfileSpace,
      generalTierFlag: spsInfo.generalTierFlag,
      generalProfileIdc: spsInfo.generalProfileIdc,
      generalProfileCompatibilityFlags: spsInfo.generalProfileCompatibilityFlags,
      generalConstraintIndicatorFlags: spsInfo.generalConstraintIndicatorFlags,
      generalLevelIdc: spsInfo.generalLevelIdc,
      minSpatialSegmentationIdc: spsInfo.minSpatialSegmentationIdc,
      parallelismType,
      chromaFormatIdc: spsInfo.chromaFormatIdc,
      bitDepthLumaMinus8: spsInfo.bitDepthLumaMinus8,
      bitDepthChromaMinus8: spsInfo.bitDepthChromaMinus8,
      avgFrameRate: 0,
      constantFrameRate: 0,
      numTemporalLayers: spsInfo.spsMaxSubLayersMinus1 + 1,
      temporalIdNested: spsInfo.spsTemporalIdNestingFlag,
      lengthSizeMinusOne: 3,
      arrays
    };
    return record;
  } catch (error) {
    console.error("Error building HEVC Decoder Configuration Record:", error);
    return null;
  }
};
var parseProfileTierLevel = (bitstream, maxNumSubLayersMinus1) => {
  const general_profile_space = bitstream.readBits(2);
  const general_tier_flag = bitstream.readBits(1);
  const general_profile_idc = bitstream.readBits(5);
  let general_profile_compatibility_flags = 0;
  for (let i = 0; i < 32; i++) {
    general_profile_compatibility_flags = general_profile_compatibility_flags << 1 | bitstream.readBits(1);
  }
  const general_constraint_indicator_flags = new Uint8Array(6);
  for (let i = 0; i < 6; i++) {
    general_constraint_indicator_flags[i] = bitstream.readBits(8);
  }
  const general_level_idc = bitstream.readBits(8);
  const sub_layer_profile_present_flag = [];
  const sub_layer_level_present_flag = [];
  for (let i = 0; i < maxNumSubLayersMinus1; i++) {
    sub_layer_profile_present_flag.push(bitstream.readBits(1));
    sub_layer_level_present_flag.push(bitstream.readBits(1));
  }
  if (maxNumSubLayersMinus1 > 0) {
    for (let i = maxNumSubLayersMinus1; i < 8; i++) {
      bitstream.skipBits(2);
    }
  }
  for (let i = 0; i < maxNumSubLayersMinus1; i++) {
    if (sub_layer_profile_present_flag[i])
      bitstream.skipBits(88);
    if (sub_layer_level_present_flag[i])
      bitstream.skipBits(8);
  }
  return {
    general_profile_space,
    general_tier_flag,
    general_profile_idc,
    general_profile_compatibility_flags,
    general_constraint_indicator_flags,
    general_level_idc
  };
};
var skipScalingListData = (bitstream) => {
  for (let sizeId = 0; sizeId < 4; sizeId++) {
    for (let matrixId = 0; matrixId < (sizeId === 3 ? 2 : 6); matrixId++) {
      const scaling_list_pred_mode_flag = bitstream.readBits(1);
      if (!scaling_list_pred_mode_flag) {
        readExpGolomb(bitstream);
      } else {
        const coefNum = Math.min(64, 1 << 4 + (sizeId << 1));
        if (sizeId > 1) {
          readSignedExpGolomb(bitstream);
        }
        for (let i = 0; i < coefNum; i++) {
          readSignedExpGolomb(bitstream);
        }
      }
    }
  }
};
var skipAllStRefPicSets = (bitstream, num_short_term_ref_pic_sets) => {
  const NumDeltaPocs = [];
  for (let stRpsIdx = 0; stRpsIdx < num_short_term_ref_pic_sets; stRpsIdx++) {
    NumDeltaPocs[stRpsIdx] = skipStRefPicSet(bitstream, stRpsIdx, num_short_term_ref_pic_sets, NumDeltaPocs);
  }
};
var skipStRefPicSet = (bitstream, stRpsIdx, num_short_term_ref_pic_sets, NumDeltaPocs) => {
  let NumDeltaPocsThis = 0;
  let inter_ref_pic_set_prediction_flag = 0;
  let RefRpsIdx = 0;
  if (stRpsIdx !== 0) {
    inter_ref_pic_set_prediction_flag = bitstream.readBits(1);
  }
  if (inter_ref_pic_set_prediction_flag) {
    if (stRpsIdx === num_short_term_ref_pic_sets) {
      const delta_idx_minus1 = readExpGolomb(bitstream);
      RefRpsIdx = stRpsIdx - (delta_idx_minus1 + 1);
    } else {
      RefRpsIdx = stRpsIdx - 1;
    }
    bitstream.readBits(1);
    readExpGolomb(bitstream);
    const numDelta = NumDeltaPocs[RefRpsIdx] ?? 0;
    for (let j = 0; j <= numDelta; j++) {
      const used_by_curr_pic_flag = bitstream.readBits(1);
      if (!used_by_curr_pic_flag) {
        bitstream.readBits(1);
      }
    }
    NumDeltaPocsThis = NumDeltaPocs[RefRpsIdx];
  } else {
    const num_negative_pics = readExpGolomb(bitstream);
    const num_positive_pics = readExpGolomb(bitstream);
    for (let i = 0; i < num_negative_pics; i++) {
      readExpGolomb(bitstream);
      bitstream.readBits(1);
    }
    for (let i = 0; i < num_positive_pics; i++) {
      readExpGolomb(bitstream);
      bitstream.readBits(1);
    }
    NumDeltaPocsThis = num_negative_pics + num_positive_pics;
  }
  return NumDeltaPocsThis;
};
var parseHevcVui = (bitstream, sps_max_sub_layers_minus1) => {
  let colourPrimaries = 2;
  let transferCharacteristics = 2;
  let matrixCoefficients = 2;
  let fullRangeFlag = 0;
  let minSpatialSegmentationIdc = 0;
  let pixelAspectRatio = { num: 1, den: 1 };
  if (bitstream.readBits(1)) {
    const aspect_ratio_idc = bitstream.readBits(8);
    if (aspect_ratio_idc === 255) {
      pixelAspectRatio = {
        num: bitstream.readBits(16),
        den: bitstream.readBits(16)
      };
    } else {
      const aspectRatio = AVC_HEVC_ASPECT_RATIO_IDC_TABLE[aspect_ratio_idc];
      if (aspectRatio) {
        pixelAspectRatio = aspectRatio;
      }
    }
  }
  if (bitstream.readBits(1)) {
    bitstream.readBits(1);
  }
  if (bitstream.readBits(1)) {
    bitstream.readBits(3);
    fullRangeFlag = bitstream.readBits(1);
    if (bitstream.readBits(1)) {
      colourPrimaries = bitstream.readBits(8);
      transferCharacteristics = bitstream.readBits(8);
      matrixCoefficients = bitstream.readBits(8);
    }
  }
  if (bitstream.readBits(1)) {
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
  }
  bitstream.readBits(1);
  bitstream.readBits(1);
  bitstream.readBits(1);
  if (bitstream.readBits(1)) {
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
  }
  if (bitstream.readBits(1)) {
    bitstream.readBits(32);
    bitstream.readBits(32);
    if (bitstream.readBits(1)) {
      readExpGolomb(bitstream);
    }
    if (bitstream.readBits(1)) {
      skipHevcHrdParameters(bitstream, true, sps_max_sub_layers_minus1);
    }
  }
  if (bitstream.readBits(1)) {
    bitstream.readBits(1);
    bitstream.readBits(1);
    bitstream.readBits(1);
    minSpatialSegmentationIdc = readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
  }
  return {
    pixelAspectRatio,
    colourPrimaries,
    transferCharacteristics,
    matrixCoefficients,
    fullRangeFlag,
    minSpatialSegmentationIdc
  };
};
var skipHevcHrdParameters = (bitstream, commonInfPresentFlag, maxNumSubLayersMinus1) => {
  let nal_hrd_parameters_present_flag = false;
  let vcl_hrd_parameters_present_flag = false;
  let sub_pic_hrd_params_present_flag = false;
  if (commonInfPresentFlag) {
    nal_hrd_parameters_present_flag = bitstream.readBits(1) === 1;
    vcl_hrd_parameters_present_flag = bitstream.readBits(1) === 1;
    if (nal_hrd_parameters_present_flag || vcl_hrd_parameters_present_flag) {
      sub_pic_hrd_params_present_flag = bitstream.readBits(1) === 1;
      if (sub_pic_hrd_params_present_flag) {
        bitstream.readBits(8);
        bitstream.readBits(5);
        bitstream.readBits(1);
        bitstream.readBits(5);
      }
      bitstream.readBits(4);
      bitstream.readBits(4);
      if (sub_pic_hrd_params_present_flag) {
        bitstream.readBits(4);
      }
      bitstream.readBits(5);
      bitstream.readBits(5);
      bitstream.readBits(5);
    }
  }
  for (let i = 0; i <= maxNumSubLayersMinus1; i++) {
    const fixed_pic_rate_general_flag = bitstream.readBits(1) === 1;
    let fixed_pic_rate_within_cvs_flag = true;
    if (!fixed_pic_rate_general_flag) {
      fixed_pic_rate_within_cvs_flag = bitstream.readBits(1) === 1;
    }
    let low_delay_hrd_flag = false;
    if (fixed_pic_rate_within_cvs_flag) {
      readExpGolomb(bitstream);
    } else {
      low_delay_hrd_flag = bitstream.readBits(1) === 1;
    }
    let CpbCnt = 1;
    if (!low_delay_hrd_flag) {
      const cpb_cnt_minus1 = readExpGolomb(bitstream);
      CpbCnt = cpb_cnt_minus1 + 1;
    }
    if (nal_hrd_parameters_present_flag) {
      skipSubLayerHrdParameters(bitstream, CpbCnt, sub_pic_hrd_params_present_flag);
    }
    if (vcl_hrd_parameters_present_flag) {
      skipSubLayerHrdParameters(bitstream, CpbCnt, sub_pic_hrd_params_present_flag);
    }
  }
};
var skipSubLayerHrdParameters = (bitstream, CpbCnt, sub_pic_hrd_params_present_flag) => {
  for (let i = 0; i < CpbCnt; i++) {
    readExpGolomb(bitstream);
    readExpGolomb(bitstream);
    if (sub_pic_hrd_params_present_flag) {
      readExpGolomb(bitstream);
      readExpGolomb(bitstream);
    }
    bitstream.readBits(1);
  }
};
var serializeHevcDecoderConfigurationRecord = (record) => {
  const bytes2 = [];
  bytes2.push(record.configurationVersion);
  bytes2.push((record.generalProfileSpace & 3) << 6 | (record.generalTierFlag & 1) << 5 | record.generalProfileIdc & 31);
  bytes2.push(record.generalProfileCompatibilityFlags >>> 24 & 255);
  bytes2.push(record.generalProfileCompatibilityFlags >>> 16 & 255);
  bytes2.push(record.generalProfileCompatibilityFlags >>> 8 & 255);
  bytes2.push(record.generalProfileCompatibilityFlags & 255);
  bytes2.push(...record.generalConstraintIndicatorFlags);
  bytes2.push(record.generalLevelIdc & 255);
  bytes2.push(240 | record.minSpatialSegmentationIdc >> 8 & 15);
  bytes2.push(record.minSpatialSegmentationIdc & 255);
  bytes2.push(252 | record.parallelismType & 3);
  bytes2.push(252 | record.chromaFormatIdc & 3);
  bytes2.push(248 | record.bitDepthLumaMinus8 & 7);
  bytes2.push(248 | record.bitDepthChromaMinus8 & 7);
  bytes2.push(record.avgFrameRate >> 8 & 255);
  bytes2.push(record.avgFrameRate & 255);
  bytes2.push((record.constantFrameRate & 3) << 6 | (record.numTemporalLayers & 7) << 3 | (record.temporalIdNested & 1) << 2 | record.lengthSizeMinusOne & 3);
  bytes2.push(record.arrays.length & 255);
  for (const arr of record.arrays) {
    bytes2.push((arr.arrayCompleteness & 1) << 7 | 0 << 6 | arr.nalUnitType & 63);
    bytes2.push(arr.nalUnits.length >> 8 & 255);
    bytes2.push(arr.nalUnits.length & 255);
    for (const nal of arr.nalUnits) {
      bytes2.push(nal.length >> 8 & 255);
      bytes2.push(nal.length & 255);
      for (let i = 0; i < nal.length; i++) {
        bytes2.push(nal[i]);
      }
    }
  }
  return new Uint8Array(bytes2);
};
var parseOpusIdentificationHeader = (bytes2) => {
  const view2 = toDataView(bytes2);
  const outputChannelCount = view2.getUint8(9);
  const preSkip = view2.getUint16(10, true);
  const inputSampleRate = view2.getUint32(12, true);
  const outputGain = view2.getInt16(16, true);
  const channelMappingFamily = view2.getUint8(18);
  let channelMappingTable = null;
  if (channelMappingFamily) {
    channelMappingTable = bytes2.subarray(19, 19 + 2 + outputChannelCount);
  }
  return {
    outputChannelCount,
    preSkip,
    inputSampleRate,
    outputGain,
    channelMappingFamily,
    channelMappingTable
  };
};
var FlacBlockType;
(function(FlacBlockType2) {
  FlacBlockType2[FlacBlockType2["STREAMINFO"] = 0] = "STREAMINFO";
  FlacBlockType2[FlacBlockType2["VORBIS_COMMENT"] = 4] = "VORBIS_COMMENT";
  FlacBlockType2[FlacBlockType2["PICTURE"] = 6] = "PICTURE";
})(FlacBlockType || (FlacBlockType = {}));
var parseAc3SyncFrame = (data) => {
  if (data.length < 7) {
    return null;
  }
  if (data[0] !== 11 || data[1] !== 119) {
    return null;
  }
  const bitstream = new Bitstream(data);
  bitstream.skipBits(16);
  bitstream.skipBits(16);
  const fscod = bitstream.readBits(2);
  if (fscod === 3) {
    return null;
  }
  const frmsizecod = bitstream.readBits(6);
  const bsid = bitstream.readBits(5);
  if (bsid > 8) {
    return null;
  }
  const bsmod = bitstream.readBits(3);
  const acmod = bitstream.readBits(3);
  if ((acmod & 1) !== 0 && acmod !== 1) {
    bitstream.skipBits(2);
  }
  if ((acmod & 4) !== 0) {
    bitstream.skipBits(2);
  }
  if (acmod === 2) {
    bitstream.skipBits(2);
  }
  const lfeon = bitstream.readBits(1);
  const bitRateCode = Math.floor(frmsizecod / 2);
  return { fscod, bsid, bsmod, acmod, lfeon, bitRateCode };
};
var AC3_FRAME_SIZES = [
  // frmsizecod, [48kHz, 44.1kHz, 32kHz] in bytes
  64 * 2,
  69 * 2,
  96 * 2,
  64 * 2,
  70 * 2,
  96 * 2,
  80 * 2,
  87 * 2,
  120 * 2,
  80 * 2,
  88 * 2,
  120 * 2,
  96 * 2,
  104 * 2,
  144 * 2,
  96 * 2,
  105 * 2,
  144 * 2,
  112 * 2,
  121 * 2,
  168 * 2,
  112 * 2,
  122 * 2,
  168 * 2,
  128 * 2,
  139 * 2,
  192 * 2,
  128 * 2,
  140 * 2,
  192 * 2,
  160 * 2,
  174 * 2,
  240 * 2,
  160 * 2,
  175 * 2,
  240 * 2,
  192 * 2,
  208 * 2,
  288 * 2,
  192 * 2,
  209 * 2,
  288 * 2,
  224 * 2,
  243 * 2,
  336 * 2,
  224 * 2,
  244 * 2,
  336 * 2,
  256 * 2,
  278 * 2,
  384 * 2,
  256 * 2,
  279 * 2,
  384 * 2,
  320 * 2,
  348 * 2,
  480 * 2,
  320 * 2,
  349 * 2,
  480 * 2,
  384 * 2,
  417 * 2,
  576 * 2,
  384 * 2,
  418 * 2,
  576 * 2,
  448 * 2,
  487 * 2,
  672 * 2,
  448 * 2,
  488 * 2,
  672 * 2,
  512 * 2,
  557 * 2,
  768 * 2,
  512 * 2,
  558 * 2,
  768 * 2,
  640 * 2,
  696 * 2,
  960 * 2,
  640 * 2,
  697 * 2,
  960 * 2,
  768 * 2,
  835 * 2,
  1152 * 2,
  768 * 2,
  836 * 2,
  1152 * 2,
  896 * 2,
  975 * 2,
  1344 * 2,
  896 * 2,
  976 * 2,
  1344 * 2,
  1024 * 2,
  1114 * 2,
  1536 * 2,
  1024 * 2,
  1115 * 2,
  1536 * 2,
  1152 * 2,
  1253 * 2,
  1728 * 2,
  1152 * 2,
  1254 * 2,
  1728 * 2,
  1280 * 2,
  1393 * 2,
  1920 * 2,
  1280 * 2,
  1394 * 2,
  1920 * 2
];
var AC3_REGISTRATION_DESCRIPTOR = new Uint8Array([5, 4, 65, 67, 45, 51]);
var EAC3_REGISTRATION_DESCRIPTOR = new Uint8Array([5, 4, 69, 65, 67, 51]);
var EAC3_NUMBLKS_TABLE = [1, 2, 3, 6];
var parseEac3SyncFrame = (data) => {
  if (data.length < 6) {
    return null;
  }
  if (data[0] !== 11 || data[1] !== 119) {
    return null;
  }
  const bitstream = new Bitstream(data);
  bitstream.skipBits(16);
  const strmtyp = bitstream.readBits(2);
  bitstream.skipBits(3);
  if (strmtyp !== 0 && strmtyp !== 2) {
    return null;
  }
  const frmsiz = bitstream.readBits(11);
  const fscod = bitstream.readBits(2);
  let fscod2 = 0;
  let numblkscod;
  if (fscod === 3) {
    fscod2 = bitstream.readBits(2);
    numblkscod = 3;
  } else {
    numblkscod = bitstream.readBits(2);
  }
  const acmod = bitstream.readBits(3);
  const lfeon = bitstream.readBits(1);
  const bsid = bitstream.readBits(5);
  if (bsid < 11 || bsid > 16) {
    return null;
  }
  const numblks = EAC3_NUMBLKS_TABLE[numblkscod];
  let fs;
  if (fscod < 3) {
    fs = AC3_SAMPLE_RATES[fscod] / 1e3;
  } else {
    fs = EAC3_REDUCED_SAMPLE_RATES[fscod2] / 1e3;
  }
  const dataRate = Math.round((frmsiz + 1) * fs / (numblks * 16));
  const bsmod = 0;
  const numDepSub = 0;
  const chanLoc = 0;
  const substream = {
    fscod,
    fscod2,
    bsid,
    bsmod,
    acmod,
    lfeon,
    numDepSub,
    chanLoc
  };
  return {
    dataRate,
    substreams: [substream]
  };
};

// node_modules/mediabunny/dist/modules/src/custom-coder.js
var customVideoEncoders = [];
var customAudioEncoders = [];

// node_modules/mediabunny/dist/modules/src/packet.js
var PLACEHOLDER_DATA = /* @__PURE__ */ new Uint8Array(0);
var EncodedPacket = class _EncodedPacket {
  /** Creates a new {@link EncodedPacket} from raw bytes and timing information. */
  constructor(data, type, timestamp, duration, sequenceNumber = -1, byteLength, sideData) {
    this.data = data;
    this.type = type;
    this.timestamp = timestamp;
    this.duration = duration;
    this.sequenceNumber = sequenceNumber;
    if (data === PLACEHOLDER_DATA && byteLength === void 0) {
      throw new Error("Internal error: byteLength must be explicitly provided when constructing metadata-only packets.");
    }
    if (byteLength === void 0) {
      byteLength = data.byteLength;
    }
    if (!(data instanceof Uint8Array)) {
      throw new TypeError("data must be a Uint8Array.");
    }
    if (type !== "key" && type !== "delta") {
      throw new TypeError('type must be either "key" or "delta".');
    }
    if (!Number.isFinite(timestamp)) {
      throw new TypeError("timestamp must be a number.");
    }
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError("duration must be a non-negative number.");
    }
    if (!Number.isFinite(sequenceNumber)) {
      throw new TypeError("sequenceNumber must be a number.");
    }
    if (!Number.isInteger(byteLength) || byteLength < 0) {
      throw new TypeError("byteLength must be a non-negative integer.");
    }
    if (sideData !== void 0 && (typeof sideData !== "object" || !sideData)) {
      throw new TypeError("sideData, when provided, must be an object.");
    }
    if (sideData?.alpha !== void 0 && !(sideData.alpha instanceof Uint8Array)) {
      throw new TypeError("sideData.alpha, when provided, must be a Uint8Array.");
    }
    if (sideData?.alphaByteLength !== void 0 && (!Number.isInteger(sideData.alphaByteLength) || sideData.alphaByteLength < 0)) {
      throw new TypeError("sideData.alphaByteLength, when provided, must be a non-negative integer.");
    }
    this.byteLength = byteLength;
    this.sideData = sideData ?? {};
    if (this.sideData.alpha && this.sideData.alphaByteLength === void 0) {
      this.sideData.alphaByteLength = this.sideData.alpha.byteLength;
    }
  }
  /**
   * If this packet is a metadata-only packet. Metadata-only packets don't contain their packet data. They are the
   * result of retrieving packets with {@link PacketRetrievalOptions.metadataOnly} set to `true`.
   */
  get isMetadataOnly() {
    return this.data === PLACEHOLDER_DATA;
  }
  /** The timestamp of this packet in microseconds. */
  get microsecondTimestamp() {
    return Math.trunc(SECOND_TO_MICROSECOND_FACTOR * this.timestamp);
  }
  /** The duration of this packet in microseconds. */
  get microsecondDuration() {
    return Math.trunc(SECOND_TO_MICROSECOND_FACTOR * this.duration);
  }
  /** Converts this packet to an
   * [`EncodedVideoChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk) for use with the
   * WebCodecs API. */
  toEncodedVideoChunk() {
    if (this.isMetadataOnly) {
      throw new TypeError("Metadata-only packets cannot be converted to a video chunk.");
    }
    if (typeof EncodedVideoChunk === "undefined") {
      throw new Error("Your browser does not support EncodedVideoChunk.");
    }
    return new EncodedVideoChunk({
      data: this.data,
      type: this.type,
      timestamp: this.microsecondTimestamp,
      duration: this.microsecondDuration
    });
  }
  /**
   * Converts this packet to an
   * [`EncodedVideoChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk) for use with the
   * WebCodecs API, using the alpha side data instead of the color data. Throws if no alpha side data is defined.
   */
  alphaToEncodedVideoChunk(type = this.type) {
    if (!this.sideData.alpha) {
      throw new TypeError("This packet does not contain alpha side data.");
    }
    if (this.isMetadataOnly) {
      throw new TypeError("Metadata-only packets cannot be converted to a video chunk.");
    }
    if (typeof EncodedVideoChunk === "undefined") {
      throw new Error("Your browser does not support EncodedVideoChunk.");
    }
    return new EncodedVideoChunk({
      data: this.sideData.alpha,
      type,
      timestamp: this.microsecondTimestamp,
      duration: this.microsecondDuration
    });
  }
  /** Converts this packet to an
   * [`EncodedAudioChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedAudioChunk) for use with the
   * WebCodecs API. */
  toEncodedAudioChunk() {
    if (this.isMetadataOnly) {
      throw new TypeError("Metadata-only packets cannot be converted to an audio chunk.");
    }
    if (typeof EncodedAudioChunk === "undefined") {
      throw new Error("Your browser does not support EncodedAudioChunk.");
    }
    return new EncodedAudioChunk({
      data: this.data,
      type: this.type,
      timestamp: this.microsecondTimestamp,
      duration: this.microsecondDuration
    });
  }
  /**
   * Creates an {@link EncodedPacket} from an
   * [`EncodedVideoChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedVideoChunk) or
   * [`EncodedAudioChunk`](https://developer.mozilla.org/en-US/docs/Web/API/EncodedAudioChunk). This method is useful
   * for converting chunks from the WebCodecs API to `EncodedPacket` instances.
   */
  static fromEncodedChunk(chunk, sideData) {
    if (!(chunk instanceof EncodedVideoChunk || chunk instanceof EncodedAudioChunk)) {
      throw new TypeError("chunk must be an EncodedVideoChunk or EncodedAudioChunk.");
    }
    const data = new Uint8Array(chunk.byteLength);
    chunk.copyTo(data);
    return new _EncodedPacket(data, chunk.type, chunk.timestamp / 1e6, (chunk.duration ?? 0) / 1e6, void 0, void 0, sideData);
  }
  /** Clones this packet while optionally modifying the new packet's data. */
  clone(options) {
    if (options !== void 0 && (typeof options !== "object" || options === null)) {
      throw new TypeError("options, when provided, must be an object.");
    }
    if (options?.data !== void 0 && !(options.data instanceof Uint8Array)) {
      throw new TypeError("options.data, when provided, must be a Uint8Array.");
    }
    if (options?.type !== void 0 && options.type !== "key" && options.type !== "delta") {
      throw new TypeError('options.type, when provided, must be either "key" or "delta".');
    }
    if (options?.timestamp !== void 0 && !Number.isFinite(options.timestamp)) {
      throw new TypeError("options.timestamp, when provided, must be a number.");
    }
    if (options?.duration !== void 0 && !Number.isFinite(options.duration)) {
      throw new TypeError("options.duration, when provided, must be a number.");
    }
    if (options?.sequenceNumber !== void 0 && !Number.isFinite(options.sequenceNumber)) {
      throw new TypeError("options.sequenceNumber, when provided, must be a number.");
    }
    if (options?.sideData !== void 0 && (typeof options.sideData !== "object" || options.sideData === null)) {
      throw new TypeError("options.sideData, when provided, must be an object.");
    }
    return new _EncodedPacket(options?.data ?? this.data, options?.type ?? this.type, options?.timestamp ?? this.timestamp, options?.duration ?? this.duration, options?.sequenceNumber ?? this.sequenceNumber, this.byteLength, options?.sideData ?? this.sideData);
  }
};

// node_modules/mediabunny/dist/modules/src/pcm.js
var toUlaw = (s16) => {
  const MULAW_MAX = 8191;
  const MULAW_BIAS = 33;
  let number = s16;
  let mask = 4096;
  let sign = 0;
  let position = 12;
  let lsb = 0;
  if (number < 0) {
    number = -number;
    sign = 128;
  }
  number += MULAW_BIAS;
  if (number > MULAW_MAX) {
    number = MULAW_MAX;
  }
  while ((number & mask) !== mask && position >= 5) {
    mask >>= 1;
    position--;
  }
  lsb = number >> position - 4 & 15;
  return ~(sign | position - 5 << 4 | lsb) & 255;
};
var toAlaw = (s16) => {
  const ALAW_MAX = 4095;
  let mask = 2048;
  let sign = 0;
  let position = 11;
  let lsb = 0;
  let number = s16;
  if (number < 0) {
    number = -number;
    sign = 128;
  }
  if (number > ALAW_MAX) {
    number = ALAW_MAX;
  }
  while ((number & mask) !== mask && position >= 5) {
    mask >>= 1;
    position--;
  }
  lsb = number >> (position === 4 ? 1 : position - 4) & 15;
  return (sign | position - 4 << 4 | lsb) ^ 85;
};

// node_modules/mediabunny/dist/modules/src/sample.js
polyfillSymbolDispose();
var lastVideoGcErrorLog = -Infinity;
var lastAudioGcErrorLog = -Infinity;
var finalizationRegistry = null;
if (typeof FinalizationRegistry !== "undefined") {
  finalizationRegistry = new FinalizationRegistry((value) => {
    const now = Date.now();
    if (value.type === "video") {
      if (now - lastVideoGcErrorLog >= 1e3) {
        console.error(`A VideoSample was garbage collected without first being closed. For proper resource management, make sure to call close() on all your VideoSamples as soon as you're done using them.`);
        lastVideoGcErrorLog = now;
      }
      if (typeof VideoFrame !== "undefined" && value.data instanceof VideoFrame) {
        value.data.close();
      }
    } else {
      if (now - lastAudioGcErrorLog >= 1e3) {
        console.error(`An AudioSample was garbage collected without first being closed. For proper resource management, make sure to call close() on all your AudioSamples as soon as you're done using them.`);
        lastAudioGcErrorLog = now;
      }
      if (typeof AudioData !== "undefined" && value.data instanceof AudioData) {
        value.data.close();
      }
    }
  });
}
var VIDEO_SAMPLE_PIXEL_FORMATS = [
  // 4:2:0 Y, U, V
  "I420",
  "I420P10",
  "I420P12",
  // 4:2:0 Y, U, V, A
  "I420A",
  "I420AP10",
  "I420AP12",
  // 4:2:2 Y, U, V
  "I422",
  "I422P10",
  "I422P12",
  // 4:2:2 Y, U, V, A
  "I422A",
  "I422AP10",
  "I422AP12",
  // 4:4:4 Y, U, V
  "I444",
  "I444P10",
  "I444P12",
  // 4:4:4 Y, U, V, A
  "I444A",
  "I444AP10",
  "I444AP12",
  // 4:2:0 Y, UV
  "NV12",
  // 4:4:4 RGBA
  "RGBA",
  // 4:4:4 RGBX (opaque)
  "RGBX",
  // 4:4:4 BGRA
  "BGRA",
  // 4:4:4 BGRX (opaque)
  "BGRX"
];
var VIDEO_SAMPLE_PIXEL_FORMATS_SET = new Set(VIDEO_SAMPLE_PIXEL_FORMATS);
var VideoSample = class _VideoSample {
  /** The width of the frame in pixels. */
  get codedWidth() {
    return this.visibleRect.width;
  }
  /** The height of the frame in pixels. */
  get codedHeight() {
    return this.visibleRect.height;
  }
  /** The display width of the frame in pixels, after aspect ratio adjustment and rotation. */
  get displayWidth() {
    return this.rotation % 180 === 0 ? this.squarePixelWidth : this.squarePixelHeight;
  }
  /** The display height of the frame in pixels, after aspect ratio adjustment and rotation. */
  get displayHeight() {
    return this.rotation % 180 === 0 ? this.squarePixelHeight : this.squarePixelWidth;
  }
  /** The presentation timestamp of the frame in microseconds. */
  get microsecondTimestamp() {
    return Math.trunc(SECOND_TO_MICROSECOND_FACTOR * this.timestamp);
  }
  /** The duration of the frame in microseconds. */
  get microsecondDuration() {
    return Math.trunc(SECOND_TO_MICROSECOND_FACTOR * this.duration);
  }
  /**
   * Whether this sample uses a pixel format that can hold transparency data. Note that this doesn't necessarily mean
   * that the sample is transparent.
   */
  get hasAlpha() {
    return this.format && this.format.includes("A");
  }
  constructor(data, init) {
    this._closed = false;
    if (data instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && data instanceof SharedArrayBuffer || ArrayBuffer.isView(data)) {
      if (!init || typeof init !== "object") {
        throw new TypeError("init must be an object.");
      }
      if (init.format === void 0 || !VIDEO_SAMPLE_PIXEL_FORMATS_SET.has(init.format)) {
        throw new TypeError("init.format must be one of: " + VIDEO_SAMPLE_PIXEL_FORMATS.join(", "));
      }
      if (!Number.isInteger(init.codedWidth) || init.codedWidth <= 0) {
        throw new TypeError("init.codedWidth must be a positive integer.");
      }
      if (!Number.isInteger(init.codedHeight) || init.codedHeight <= 0) {
        throw new TypeError("init.codedHeight must be a positive integer.");
      }
      if (init.rotation !== void 0 && ![0, 90, 180, 270].includes(init.rotation)) {
        throw new TypeError("init.rotation, when provided, must be 0, 90, 180, or 270.");
      }
      if (!Number.isFinite(init.timestamp)) {
        throw new TypeError("init.timestamp must be a number.");
      }
      if (init.duration !== void 0 && (!Number.isFinite(init.duration) || init.duration < 0)) {
        throw new TypeError("init.duration, when provided, must be a non-negative number.");
      }
      if (init.layout !== void 0) {
        if (!Array.isArray(init.layout)) {
          throw new TypeError("init.layout, when provided, must be an array.");
        }
        for (const plane of init.layout) {
          if (!plane || typeof plane !== "object" || Array.isArray(plane)) {
            throw new TypeError("Each entry in init.layout must be an object.");
          }
          if (!Number.isInteger(plane.offset) || plane.offset < 0) {
            throw new TypeError("plane.offset must be a non-negative integer.");
          }
          if (!Number.isInteger(plane.stride) || plane.stride < 0) {
            throw new TypeError("plane.stride must be a non-negative integer.");
          }
        }
      }
      if (init.visibleRect !== void 0) {
        validateRectangle(init.visibleRect, "init.visibleRect");
      }
      if (init.displayWidth !== void 0 && (!Number.isInteger(init.displayWidth) || init.displayWidth <= 0)) {
        throw new TypeError("init.displayWidth, when provided, must be a positive integer.");
      }
      if (init.displayHeight !== void 0 && (!Number.isInteger(init.displayHeight) || init.displayHeight <= 0)) {
        throw new TypeError("init.displayHeight, when provided, must be a positive integer.");
      }
      if (init.displayWidth !== void 0 !== (init.displayHeight !== void 0)) {
        throw new TypeError("init.displayWidth and init.displayHeight must be either both provided or both omitted.");
      }
      this._data = toUint8Array(data).slice();
      this._layout = init.layout ?? createDefaultPlaneLayout(init.format, init.codedWidth, init.codedHeight);
      this.format = init.format;
      this.rotation = init.rotation ?? 0;
      this.timestamp = init.timestamp;
      this.duration = init.duration ?? 0;
      this.colorSpace = new VideoSampleColorSpace(init.colorSpace);
      this.visibleRect = {
        left: init.visibleRect?.left ?? 0,
        top: init.visibleRect?.top ?? 0,
        width: init.visibleRect?.width ?? init.codedWidth,
        height: init.visibleRect?.height ?? init.codedHeight
      };
      if (init.displayWidth !== void 0) {
        this.squarePixelWidth = this.rotation % 180 === 0 ? init.displayWidth : init.displayHeight;
        this.squarePixelHeight = this.rotation % 180 === 0 ? init.displayHeight : init.displayWidth;
      } else {
        this.squarePixelWidth = this.codedWidth;
        this.squarePixelHeight = this.codedHeight;
      }
    } else if (typeof VideoFrame !== "undefined" && data instanceof VideoFrame) {
      if (init?.rotation !== void 0 && ![0, 90, 180, 270].includes(init.rotation)) {
        throw new TypeError("init.rotation, when provided, must be 0, 90, 180, or 270.");
      }
      if (init?.timestamp !== void 0 && !Number.isFinite(init?.timestamp)) {
        throw new TypeError("init.timestamp, when provided, must be a number.");
      }
      if (init?.duration !== void 0 && (!Number.isFinite(init.duration) || init.duration < 0)) {
        throw new TypeError("init.duration, when provided, must be a non-negative number.");
      }
      if (init?.visibleRect !== void 0) {
        validateRectangle(init.visibleRect, "init.visibleRect");
      }
      this._data = data;
      this._layout = null;
      this.format = data.format;
      this.visibleRect = {
        left: data.visibleRect?.x ?? 0,
        top: data.visibleRect?.y ?? 0,
        width: data.visibleRect?.width ?? data.codedWidth,
        height: data.visibleRect?.height ?? data.codedHeight
      };
      this.rotation = init?.rotation ?? 0;
      this.squarePixelWidth = data.displayWidth;
      this.squarePixelHeight = data.displayHeight;
      this.timestamp = init?.timestamp ?? data.timestamp / 1e6;
      this.duration = init?.duration ?? (data.duration ?? 0) / 1e6;
      this.colorSpace = new VideoSampleColorSpace(data.colorSpace);
    } else if (typeof HTMLImageElement !== "undefined" && data instanceof HTMLImageElement || typeof SVGImageElement !== "undefined" && data instanceof SVGImageElement || typeof ImageBitmap !== "undefined" && data instanceof ImageBitmap || typeof HTMLVideoElement !== "undefined" && data instanceof HTMLVideoElement || typeof HTMLCanvasElement !== "undefined" && data instanceof HTMLCanvasElement || typeof OffscreenCanvas !== "undefined" && data instanceof OffscreenCanvas) {
      if (!init || typeof init !== "object") {
        throw new TypeError("init must be an object.");
      }
      if (init.rotation !== void 0 && ![0, 90, 180, 270].includes(init.rotation)) {
        throw new TypeError("init.rotation, when provided, must be 0, 90, 180, or 270.");
      }
      if (!Number.isFinite(init.timestamp)) {
        throw new TypeError("init.timestamp must be a number.");
      }
      if (init.duration !== void 0 && (!Number.isFinite(init.duration) || init.duration < 0)) {
        throw new TypeError("init.duration, when provided, must be a non-negative number.");
      }
      if (typeof VideoFrame !== "undefined") {
        return new _VideoSample(new VideoFrame(data, {
          timestamp: Math.trunc(init.timestamp * SECOND_TO_MICROSECOND_FACTOR),
          // Drag 0 to undefined
          duration: Math.trunc((init.duration ?? 0) * SECOND_TO_MICROSECOND_FACTOR) || void 0
        }), init);
      }
      let width = 0;
      let height = 0;
      if ("naturalWidth" in data) {
        width = data.naturalWidth;
        height = data.naturalHeight;
      } else if ("videoWidth" in data) {
        width = data.videoWidth;
        height = data.videoHeight;
      } else if ("width" in data) {
        width = Number(data.width);
        height = Number(data.height);
      }
      if (!width || !height) {
        throw new TypeError("Could not determine dimensions.");
      }
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext("2d", {
        alpha: isFirefox(),
        // Firefox has VideoFrame glitches with opaque canvases
        willReadFrequently: true
      });
      assert(context);
      context.drawImage(data, 0, 0);
      this._data = canvas;
      this._layout = null;
      this.format = "RGBX";
      this.visibleRect = { left: 0, top: 0, width, height };
      this.squarePixelWidth = width;
      this.squarePixelHeight = height;
      this.rotation = init.rotation ?? 0;
      this.timestamp = init.timestamp;
      this.duration = init.duration ?? 0;
      this.colorSpace = new VideoSampleColorSpace({
        matrix: "rgb",
        primaries: "bt709",
        transfer: "iec61966-2-1",
        fullRange: true
      });
    } else {
      throw new TypeError("Invalid data type: Must be a BufferSource or CanvasImageSource.");
    }
    this.pixelAspectRatio = simplifyRational({
      num: this.squarePixelWidth * this.codedHeight,
      den: this.squarePixelHeight * this.codedWidth
    });
    finalizationRegistry?.register(this, { type: "video", data: this._data }, this);
  }
  /** Clones this video sample. */
  clone() {
    if (this._closed) {
      throw new Error("VideoSample is closed.");
    }
    assert(this._data !== null);
    if (isVideoFrame(this._data)) {
      return new _VideoSample(this._data.clone(), {
        timestamp: this.timestamp,
        duration: this.duration,
        rotation: this.rotation
      });
    } else if (this._data instanceof Uint8Array) {
      assert(this._layout);
      return new _VideoSample(this._data, {
        format: this.format,
        layout: this._layout,
        codedWidth: this.codedWidth,
        codedHeight: this.codedHeight,
        timestamp: this.timestamp,
        duration: this.duration,
        colorSpace: this.colorSpace,
        rotation: this.rotation,
        visibleRect: this.visibleRect,
        displayWidth: this.displayWidth,
        displayHeight: this.displayHeight
      });
    } else {
      return new _VideoSample(this._data, {
        format: this.format,
        codedWidth: this.codedWidth,
        codedHeight: this.codedHeight,
        timestamp: this.timestamp,
        duration: this.duration,
        colorSpace: this.colorSpace,
        rotation: this.rotation,
        visibleRect: this.visibleRect,
        displayWidth: this.displayWidth,
        displayHeight: this.displayHeight
      });
    }
  }
  /**
   * Closes this video sample, releasing held resources. Video samples should be closed as soon as they are not
   * needed anymore.
   */
  close() {
    if (this._closed) {
      return;
    }
    finalizationRegistry?.unregister(this);
    if (isVideoFrame(this._data)) {
      this._data.close();
    } else {
      this._data = null;
    }
    this._closed = true;
  }
  /**
   * Returns the number of bytes required to hold this video sample's pixel data. Throws if `format` is `null`.
   */
  allocationSize(options = {}) {
    validateVideoFrameCopyToOptions(options);
    if (this._closed) {
      throw new Error("VideoSample is closed.");
    }
    if (this.format === null) {
      throw new Error("Cannot get allocation size when format is null. Sorry!");
    }
    assert(this._data !== null);
    if (!isVideoFrame(this._data)) {
      if (options.colorSpace || options.format && options.format !== this.format || options.layout || options.rect) {
        const videoFrame = this.toVideoFrame();
        const size = videoFrame.allocationSize(options);
        videoFrame.close();
        return size;
      }
    }
    if (isVideoFrame(this._data)) {
      return this._data.allocationSize(options);
    } else if (this._data instanceof Uint8Array) {
      return this._data.byteLength;
    } else {
      return this.codedWidth * this.codedHeight * 4;
    }
  }
  /**
   * Copies this video sample's pixel data to an ArrayBuffer or ArrayBufferView. Throws if `format` is `null`.
   * @returns The byte layout of the planes of the copied data.
   */
  async copyTo(destination, options = {}) {
    if (!isAllowSharedBufferSource(destination)) {
      throw new TypeError("destination must be an ArrayBuffer or an ArrayBuffer view.");
    }
    validateVideoFrameCopyToOptions(options);
    if (this._closed) {
      throw new Error("VideoSample is closed.");
    }
    if (this.format === null) {
      throw new Error("Cannot copy video sample data when format is null. Sorry!");
    }
    assert(this._data !== null);
    if (!isVideoFrame(this._data)) {
      if (options.colorSpace || options.format && options.format !== this.format || options.layout || options.rect) {
        const videoFrame = this.toVideoFrame();
        const layout = await videoFrame.copyTo(destination, options);
        videoFrame.close();
        return layout;
      }
    }
    if (isVideoFrame(this._data)) {
      return this._data.copyTo(destination, options);
    } else if (this._data instanceof Uint8Array) {
      assert(this._layout);
      const dest = toUint8Array(destination);
      dest.set(this._data);
      return this._layout;
    } else {
      const canvas = this._data;
      const context = canvas.getContext("2d");
      assert(context);
      const imageData = context.getImageData(0, 0, this.codedWidth, this.codedHeight);
      const dest = toUint8Array(destination);
      dest.set(imageData.data);
      return [{
        offset: 0,
        stride: 4 * this.codedWidth
      }];
    }
  }
  /**
   * Converts this video sample to a VideoFrame for use with the WebCodecs API. The VideoFrame returned by this
   * method *must* be closed separately from this video sample.
   */
  toVideoFrame() {
    if (this._closed) {
      throw new Error("VideoSample is closed.");
    }
    assert(this._data !== null);
    if (isVideoFrame(this._data)) {
      return new VideoFrame(this._data, {
        timestamp: this.microsecondTimestamp,
        duration: this.microsecondDuration || void 0
        // Drag 0 duration to undefined, glitches some codecs
      });
    } else if (this._data instanceof Uint8Array) {
      return new VideoFrame(this._data, {
        format: this.format,
        codedWidth: this.codedWidth,
        codedHeight: this.codedHeight,
        timestamp: this.microsecondTimestamp,
        duration: this.microsecondDuration || void 0,
        colorSpace: this.colorSpace
      });
    } else {
      return new VideoFrame(this._data, {
        timestamp: this.microsecondTimestamp,
        duration: this.microsecondDuration || void 0
      });
    }
  }
  draw(context, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8) {
    let sx = 0;
    let sy = 0;
    let sWidth = this.displayWidth;
    let sHeight = this.displayHeight;
    let dx = 0;
    let dy = 0;
    let dWidth = this.displayWidth;
    let dHeight = this.displayHeight;
    if (arg5 !== void 0) {
      sx = arg1;
      sy = arg2;
      sWidth = arg3;
      sHeight = arg4;
      dx = arg5;
      dy = arg6;
      if (arg7 !== void 0) {
        dWidth = arg7;
        dHeight = arg8;
      } else {
        dWidth = sWidth;
        dHeight = sHeight;
      }
    } else {
      dx = arg1;
      dy = arg2;
      if (arg3 !== void 0) {
        dWidth = arg3;
        dHeight = arg4;
      }
    }
    if (!(typeof CanvasRenderingContext2D !== "undefined" && context instanceof CanvasRenderingContext2D || typeof OffscreenCanvasRenderingContext2D !== "undefined" && context instanceof OffscreenCanvasRenderingContext2D)) {
      throw new TypeError("context must be a CanvasRenderingContext2D or OffscreenCanvasRenderingContext2D.");
    }
    if (!Number.isFinite(sx)) {
      throw new TypeError("sx must be a number.");
    }
    if (!Number.isFinite(sy)) {
      throw new TypeError("sy must be a number.");
    }
    if (!Number.isFinite(sWidth) || sWidth < 0) {
      throw new TypeError("sWidth must be a non-negative number.");
    }
    if (!Number.isFinite(sHeight) || sHeight < 0) {
      throw new TypeError("sHeight must be a non-negative number.");
    }
    if (!Number.isFinite(dx)) {
      throw new TypeError("dx must be a number.");
    }
    if (!Number.isFinite(dy)) {
      throw new TypeError("dy must be a number.");
    }
    if (!Number.isFinite(dWidth) || dWidth < 0) {
      throw new TypeError("dWidth must be a non-negative number.");
    }
    if (!Number.isFinite(dHeight) || dHeight < 0) {
      throw new TypeError("dHeight must be a non-negative number.");
    }
    if (this._closed) {
      throw new Error("VideoSample is closed.");
    }
    ({ sx, sy, sWidth, sHeight } = this._rotateSourceRegion(sx, sy, sWidth, sHeight, this.rotation));
    const source = this.toCanvasImageSource();
    context.save();
    const centerX = dx + dWidth / 2;
    const centerY = dy + dHeight / 2;
    context.translate(centerX, centerY);
    context.rotate(this.rotation * Math.PI / 180);
    const aspectRatioChange = this.rotation % 180 === 0 ? 1 : dWidth / dHeight;
    context.scale(1 / aspectRatioChange, aspectRatioChange);
    context.drawImage(source, sx, sy, sWidth, sHeight, -dWidth / 2, -dHeight / 2, dWidth, dHeight);
    context.restore();
  }
  /**
   * Draws the sample in the middle of the canvas corresponding to the context with the specified fit behavior.
   */
  drawWithFit(context, options) {
    if (!(typeof CanvasRenderingContext2D !== "undefined" && context instanceof CanvasRenderingContext2D || typeof OffscreenCanvasRenderingContext2D !== "undefined" && context instanceof OffscreenCanvasRenderingContext2D)) {
      throw new TypeError("context must be a CanvasRenderingContext2D or OffscreenCanvasRenderingContext2D.");
    }
    if (!options || typeof options !== "object") {
      throw new TypeError("options must be an object.");
    }
    if (!["fill", "contain", "cover"].includes(options.fit)) {
      throw new TypeError("options.fit must be 'fill', 'contain', or 'cover'.");
    }
    if (options.rotation !== void 0 && ![0, 90, 180, 270].includes(options.rotation)) {
      throw new TypeError("options.rotation, when provided, must be 0, 90, 180, or 270.");
    }
    if (options.crop !== void 0) {
      validateCropRectangle(options.crop, "options.");
    }
    const canvasWidth = context.canvas.width;
    const canvasHeight = context.canvas.height;
    const rotation = options.rotation ?? this.rotation;
    const [rotatedWidth, rotatedHeight] = rotation % 180 === 0 ? [this.squarePixelWidth, this.squarePixelHeight] : [this.squarePixelHeight, this.squarePixelWidth];
    if (options.crop) {
      clampCropRectangle(options.crop, rotatedWidth, rotatedHeight);
    }
    let dx;
    let dy;
    let newWidth;
    let newHeight;
    const { sx, sy, sWidth, sHeight } = this._rotateSourceRegion(options.crop?.left ?? 0, options.crop?.top ?? 0, options.crop?.width ?? rotatedWidth, options.crop?.height ?? rotatedHeight, rotation);
    if (options.fit === "fill") {
      dx = 0;
      dy = 0;
      newWidth = canvasWidth;
      newHeight = canvasHeight;
    } else {
      const [sampleWidth, sampleHeight] = options.crop ? [options.crop.width, options.crop.height] : [rotatedWidth, rotatedHeight];
      const scale = options.fit === "contain" ? Math.min(canvasWidth / sampleWidth, canvasHeight / sampleHeight) : Math.max(canvasWidth / sampleWidth, canvasHeight / sampleHeight);
      newWidth = sampleWidth * scale;
      newHeight = sampleHeight * scale;
      dx = (canvasWidth - newWidth) / 2;
      dy = (canvasHeight - newHeight) / 2;
    }
    context.save();
    const aspectRatioChange = rotation % 180 === 0 ? 1 : newWidth / newHeight;
    context.translate(canvasWidth / 2, canvasHeight / 2);
    context.rotate(rotation * Math.PI / 180);
    context.scale(1 / aspectRatioChange, aspectRatioChange);
    context.translate(-canvasWidth / 2, -canvasHeight / 2);
    context.drawImage(this.toCanvasImageSource(), sx, sy, sWidth, sHeight, dx, dy, newWidth, newHeight);
    context.restore();
  }
  /** @internal */
  _rotateSourceRegion(sx, sy, sWidth, sHeight, rotation) {
    if (rotation === 90) {
      [sx, sy, sWidth, sHeight] = [
        sy,
        this.squarePixelHeight - sx - sWidth,
        sHeight,
        sWidth
      ];
    } else if (rotation === 180) {
      [sx, sy] = [
        this.squarePixelWidth - sx - sWidth,
        this.squarePixelHeight - sy - sHeight
      ];
    } else if (rotation === 270) {
      [sx, sy, sWidth, sHeight] = [
        this.squarePixelWidth - sy - sHeight,
        sx,
        sHeight,
        sWidth
      ];
    }
    return { sx, sy, sWidth, sHeight };
  }
  /**
   * Converts this video sample to a
   * [`CanvasImageSource`](https://udn.realityripple.com/docs/Web/API/CanvasImageSource) for drawing to a canvas.
   *
   * You must use the value returned by this method immediately, as any VideoFrame created internally will
   * automatically be closed in the next microtask.
   */
  toCanvasImageSource() {
    if (this._closed) {
      throw new Error("VideoSample is closed.");
    }
    assert(this._data !== null);
    if (this._data instanceof Uint8Array) {
      const videoFrame = this.toVideoFrame();
      queueMicrotask(() => videoFrame.close());
      return videoFrame;
    } else {
      return this._data;
    }
  }
  /** Sets the rotation metadata of this video sample. */
  setRotation(newRotation) {
    if (![0, 90, 180, 270].includes(newRotation)) {
      throw new TypeError("newRotation must be 0, 90, 180, or 270.");
    }
    this.rotation = newRotation;
  }
  /** Sets the presentation timestamp of this video sample, in seconds. */
  setTimestamp(newTimestamp) {
    if (!Number.isFinite(newTimestamp)) {
      throw new TypeError("newTimestamp must be a number.");
    }
    this.timestamp = newTimestamp;
  }
  /** Sets the duration of this video sample, in seconds. */
  setDuration(newDuration) {
    if (!Number.isFinite(newDuration) || newDuration < 0) {
      throw new TypeError("newDuration must be a non-negative number.");
    }
    this.duration = newDuration;
  }
  /** Calls `.close()`. */
  [Symbol.dispose]() {
    this.close();
  }
};
var VideoSampleColorSpace = class {
  /** Creates a new VideoSampleColorSpace. */
  constructor(init) {
    if (init !== void 0) {
      if (!init || typeof init !== "object") {
        throw new TypeError("init.colorSpace, when provided, must be an object.");
      }
      const primariesValues = Object.keys(COLOR_PRIMARIES_MAP);
      if (init.primaries != null && !primariesValues.includes(init.primaries)) {
        throw new TypeError(`init.colorSpace.primaries, when provided, must be one of ${primariesValues.join(", ")}.`);
      }
      const transferValues = Object.keys(TRANSFER_CHARACTERISTICS_MAP);
      if (init.transfer != null && !transferValues.includes(init.transfer)) {
        throw new TypeError(`init.colorSpace.transfer, when provided, must be one of ${transferValues.join(", ")}.`);
      }
      const matrixValues = Object.keys(MATRIX_COEFFICIENTS_MAP);
      if (init.matrix != null && !matrixValues.includes(init.matrix)) {
        throw new TypeError(`init.colorSpace.matrix, when provided, must be one of ${matrixValues.join(", ")}.`);
      }
      if (init.fullRange != null && typeof init.fullRange !== "boolean") {
        throw new TypeError("init.colorSpace.fullRange, when provided, must be a boolean.");
      }
    }
    this.primaries = init?.primaries ?? null;
    this.transfer = init?.transfer ?? null;
    this.matrix = init?.matrix ?? null;
    this.fullRange = init?.fullRange ?? null;
  }
  /** Serializes the color space to a JSON object. */
  toJSON() {
    return {
      primaries: this.primaries,
      transfer: this.transfer,
      matrix: this.matrix,
      fullRange: this.fullRange
    };
  }
};
var isVideoFrame = (x) => {
  return typeof VideoFrame !== "undefined" && x instanceof VideoFrame;
};
var clampCropRectangle = (crop, outerWidth, outerHeight) => {
  crop.left = Math.min(crop.left, outerWidth);
  crop.top = Math.min(crop.top, outerHeight);
  crop.width = Math.min(crop.width, outerWidth - crop.left);
  crop.height = Math.min(crop.height, outerHeight - crop.top);
  assert(crop.width >= 0);
  assert(crop.height >= 0);
};
var validateCropRectangle = (crop, prefix) => {
  if (!crop || typeof crop !== "object") {
    throw new TypeError(prefix + "crop, when provided, must be an object.");
  }
  if (!Number.isInteger(crop.left) || crop.left < 0) {
    throw new TypeError(prefix + "crop.left must be a non-negative integer.");
  }
  if (!Number.isInteger(crop.top) || crop.top < 0) {
    throw new TypeError(prefix + "crop.top must be a non-negative integer.");
  }
  if (!Number.isInteger(crop.width) || crop.width < 0) {
    throw new TypeError(prefix + "crop.width must be a non-negative integer.");
  }
  if (!Number.isInteger(crop.height) || crop.height < 0) {
    throw new TypeError(prefix + "crop.height must be a non-negative integer.");
  }
};
var validateVideoFrameCopyToOptions = (options) => {
  if (!options || typeof options !== "object") {
    throw new TypeError("options must be an object.");
  }
  if (options.colorSpace !== void 0 && !["display-p3", "srgb"].includes(options.colorSpace)) {
    throw new TypeError("options.colorSpace, when provided, must be 'display-p3' or 'srgb'.");
  }
  if (options.format !== void 0 && typeof options.format !== "string") {
    throw new TypeError("options.format, when provided, must be a string.");
  }
  if (options.layout !== void 0) {
    if (!Array.isArray(options.layout)) {
      throw new TypeError("options.layout, when provided, must be an array.");
    }
    for (const plane of options.layout) {
      if (!plane || typeof plane !== "object") {
        throw new TypeError("Each entry in options.layout must be an object.");
      }
      if (!Number.isInteger(plane.offset) || plane.offset < 0) {
        throw new TypeError("plane.offset must be a non-negative integer.");
      }
      if (!Number.isInteger(plane.stride) || plane.stride < 0) {
        throw new TypeError("plane.stride must be a non-negative integer.");
      }
    }
  }
  if (options.rect !== void 0) {
    if (!options.rect || typeof options.rect !== "object") {
      throw new TypeError("options.rect, when provided, must be an object.");
    }
    if (options.rect.x !== void 0 && (!Number.isInteger(options.rect.x) || options.rect.x < 0)) {
      throw new TypeError("options.rect.x, when provided, must be a non-negative integer.");
    }
    if (options.rect.y !== void 0 && (!Number.isInteger(options.rect.y) || options.rect.y < 0)) {
      throw new TypeError("options.rect.y, when provided, must be a non-negative integer.");
    }
    if (options.rect.width !== void 0 && (!Number.isInteger(options.rect.width) || options.rect.width < 0)) {
      throw new TypeError("options.rect.width, when provided, must be a non-negative integer.");
    }
    if (options.rect.height !== void 0 && (!Number.isInteger(options.rect.height) || options.rect.height < 0)) {
      throw new TypeError("options.rect.height, when provided, must be a non-negative integer.");
    }
  }
};
var createDefaultPlaneLayout = (format, codedWidth, codedHeight) => {
  const planes = getPlaneConfigs(format);
  const layouts = [];
  let currentOffset = 0;
  for (const plane of planes) {
    const planeWidth = Math.ceil(codedWidth / plane.widthDivisor);
    const planeHeight = Math.ceil(codedHeight / plane.heightDivisor);
    const stride = planeWidth * plane.sampleBytes;
    const planeSize = stride * planeHeight;
    layouts.push({
      offset: currentOffset,
      stride
    });
    currentOffset += planeSize;
  }
  return layouts;
};
var getPlaneConfigs = (format) => {
  const yuv = (yBytes, uvBytes, subX, subY, hasAlpha) => {
    const configs = [
      { sampleBytes: yBytes, widthDivisor: 1, heightDivisor: 1 },
      { sampleBytes: uvBytes, widthDivisor: subX, heightDivisor: subY },
      { sampleBytes: uvBytes, widthDivisor: subX, heightDivisor: subY }
    ];
    if (hasAlpha) {
      configs.push({ sampleBytes: yBytes, widthDivisor: 1, heightDivisor: 1 });
    }
    return configs;
  };
  switch (format) {
    case "I420":
      return yuv(1, 1, 2, 2, false);
    case "I420P10":
    case "I420P12":
      return yuv(2, 2, 2, 2, false);
    case "I420A":
      return yuv(1, 1, 2, 2, true);
    case "I420AP10":
    case "I420AP12":
      return yuv(2, 2, 2, 2, true);
    case "I422":
      return yuv(1, 1, 2, 1, false);
    case "I422P10":
    case "I422P12":
      return yuv(2, 2, 2, 1, false);
    case "I422A":
      return yuv(1, 1, 2, 1, true);
    case "I422AP10":
    case "I422AP12":
      return yuv(2, 2, 2, 1, true);
    case "I444":
      return yuv(1, 1, 1, 1, false);
    case "I444P10":
    case "I444P12":
      return yuv(2, 2, 1, 1, false);
    case "I444A":
      return yuv(1, 1, 1, 1, true);
    case "I444AP10":
    case "I444AP12":
      return yuv(2, 2, 1, 1, true);
    case "NV12":
      return [
        { sampleBytes: 1, widthDivisor: 1, heightDivisor: 1 },
        { sampleBytes: 2, widthDivisor: 2, heightDivisor: 2 }
        // Interleaved U and V
      ];
    case "RGBA":
    case "RGBX":
    case "BGRA":
    case "BGRX":
      return [
        { sampleBytes: 4, widthDivisor: 1, heightDivisor: 1 }
      ];
    default:
      assertNever(format);
      assert(false);
  }
};
var AUDIO_SAMPLE_FORMATS = /* @__PURE__ */ new Set(["f32", "f32-planar", "s16", "s16-planar", "s32", "s32-planar", "u8", "u8-planar"]);
var AudioSample = class _AudioSample {
  /** The presentation timestamp of the sample in microseconds. */
  get microsecondTimestamp() {
    return Math.trunc(SECOND_TO_MICROSECOND_FACTOR * this.timestamp);
  }
  /** The duration of the sample in microseconds. */
  get microsecondDuration() {
    return Math.trunc(SECOND_TO_MICROSECOND_FACTOR * this.duration);
  }
  /**
   * Creates a new {@link AudioSample}, either from an existing
   * [`AudioData`](https://developer.mozilla.org/en-US/docs/Web/API/AudioData) or from raw bytes specified in
   * {@link AudioSampleInit}.
   */
  constructor(init) {
    this._closed = false;
    if (isAudioData(init)) {
      if (init.format === null) {
        throw new TypeError("AudioData with null format is not supported.");
      }
      this._data = init;
      this.format = init.format;
      this.sampleRate = init.sampleRate;
      this.numberOfFrames = init.numberOfFrames;
      this.numberOfChannels = init.numberOfChannels;
      this.timestamp = init.timestamp / 1e6;
      this.duration = init.numberOfFrames / init.sampleRate;
    } else {
      if (!init || typeof init !== "object") {
        throw new TypeError("Invalid AudioDataInit: must be an object.");
      }
      if (!AUDIO_SAMPLE_FORMATS.has(init.format)) {
        throw new TypeError("Invalid AudioDataInit: invalid format.");
      }
      if (!Number.isFinite(init.sampleRate) || init.sampleRate <= 0) {
        throw new TypeError("Invalid AudioDataInit: sampleRate must be > 0.");
      }
      if (!Number.isInteger(init.numberOfChannels) || init.numberOfChannels === 0) {
        throw new TypeError("Invalid AudioDataInit: numberOfChannels must be an integer > 0.");
      }
      if (!Number.isFinite(init?.timestamp)) {
        throw new TypeError("init.timestamp must be a number.");
      }
      const numberOfFrames = init.data.byteLength / (getBytesPerSample(init.format) * init.numberOfChannels);
      if (!Number.isInteger(numberOfFrames)) {
        throw new TypeError("Invalid AudioDataInit: data size is not a multiple of frame size.");
      }
      this.format = init.format;
      this.sampleRate = init.sampleRate;
      this.numberOfFrames = numberOfFrames;
      this.numberOfChannels = init.numberOfChannels;
      this.timestamp = init.timestamp;
      this.duration = numberOfFrames / init.sampleRate;
      let dataBuffer;
      if (init.data instanceof ArrayBuffer) {
        dataBuffer = new Uint8Array(init.data);
      } else if (ArrayBuffer.isView(init.data)) {
        dataBuffer = new Uint8Array(init.data.buffer, init.data.byteOffset, init.data.byteLength);
      } else {
        throw new TypeError("Invalid AudioDataInit: data is not a BufferSource.");
      }
      const expectedSize = this.numberOfFrames * this.numberOfChannels * getBytesPerSample(this.format);
      if (dataBuffer.byteLength < expectedSize) {
        throw new TypeError("Invalid AudioDataInit: insufficient data size.");
      }
      this._data = dataBuffer;
    }
    finalizationRegistry?.register(this, { type: "audio", data: this._data }, this);
  }
  /** Returns the number of bytes required to hold the audio sample's data as specified by the given options. */
  allocationSize(options) {
    if (!options || typeof options !== "object") {
      throw new TypeError("options must be an object.");
    }
    if (!Number.isInteger(options.planeIndex) || options.planeIndex < 0) {
      throw new TypeError("planeIndex must be a non-negative integer.");
    }
    if (options.format !== void 0 && !AUDIO_SAMPLE_FORMATS.has(options.format)) {
      throw new TypeError("Invalid format.");
    }
    if (options.frameOffset !== void 0 && (!Number.isInteger(options.frameOffset) || options.frameOffset < 0)) {
      throw new TypeError("frameOffset must be a non-negative integer.");
    }
    if (options.frameCount !== void 0 && (!Number.isInteger(options.frameCount) || options.frameCount < 0)) {
      throw new TypeError("frameCount must be a non-negative integer.");
    }
    if (this._closed) {
      throw new Error("AudioSample is closed.");
    }
    const destFormat = options.format ?? this.format;
    const frameOffset = options.frameOffset ?? 0;
    if (frameOffset >= this.numberOfFrames) {
      throw new RangeError("frameOffset out of range");
    }
    const copyFrameCount = options.frameCount !== void 0 ? options.frameCount : this.numberOfFrames - frameOffset;
    if (copyFrameCount > this.numberOfFrames - frameOffset) {
      throw new RangeError("frameCount out of range");
    }
    const bytesPerSample = getBytesPerSample(destFormat);
    const isPlanar = formatIsPlanar(destFormat);
    if (isPlanar && options.planeIndex >= this.numberOfChannels) {
      throw new RangeError("planeIndex out of range");
    }
    if (!isPlanar && options.planeIndex !== 0) {
      throw new RangeError("planeIndex out of range");
    }
    const elementCount = isPlanar ? copyFrameCount : copyFrameCount * this.numberOfChannels;
    return elementCount * bytesPerSample;
  }
  /** Copies the audio sample's data to an ArrayBuffer or ArrayBufferView as specified by the given options. */
  copyTo(destination, options) {
    if (!isAllowSharedBufferSource(destination)) {
      throw new TypeError("destination must be an ArrayBuffer or an ArrayBuffer view.");
    }
    if (!options || typeof options !== "object") {
      throw new TypeError("options must be an object.");
    }
    if (!Number.isInteger(options.planeIndex) || options.planeIndex < 0) {
      throw new TypeError("planeIndex must be a non-negative integer.");
    }
    if (options.format !== void 0 && !AUDIO_SAMPLE_FORMATS.has(options.format)) {
      throw new TypeError("Invalid format.");
    }
    if (options.frameOffset !== void 0 && (!Number.isInteger(options.frameOffset) || options.frameOffset < 0)) {
      throw new TypeError("frameOffset must be a non-negative integer.");
    }
    if (options.frameCount !== void 0 && (!Number.isInteger(options.frameCount) || options.frameCount < 0)) {
      throw new TypeError("frameCount must be a non-negative integer.");
    }
    if (this._closed) {
      throw new Error("AudioSample is closed.");
    }
    const { planeIndex, format, frameCount: optFrameCount, frameOffset: optFrameOffset } = options;
    const srcFormat = this.format;
    const destFormat = format ?? this.format;
    if (!destFormat)
      throw new Error("Destination format not determined");
    const numFrames = this.numberOfFrames;
    const numChannels = this.numberOfChannels;
    const frameOffset = optFrameOffset ?? 0;
    if (frameOffset >= numFrames) {
      throw new RangeError("frameOffset out of range");
    }
    const copyFrameCount = optFrameCount !== void 0 ? optFrameCount : numFrames - frameOffset;
    if (copyFrameCount > numFrames - frameOffset) {
      throw new RangeError("frameCount out of range");
    }
    const destBytesPerSample = getBytesPerSample(destFormat);
    const destIsPlanar = formatIsPlanar(destFormat);
    if (destIsPlanar && planeIndex >= numChannels) {
      throw new RangeError("planeIndex out of range");
    }
    if (!destIsPlanar && planeIndex !== 0) {
      throw new RangeError("planeIndex out of range");
    }
    const destElementCount = destIsPlanar ? copyFrameCount : copyFrameCount * numChannels;
    const requiredSize = destElementCount * destBytesPerSample;
    if (destination.byteLength < requiredSize) {
      throw new RangeError("Destination buffer is too small");
    }
    const destView = toDataView(destination);
    const writeFn = getWriteFunction(destFormat);
    if (isAudioData(this._data)) {
      if (isWebKit() && numChannels > 2 && destFormat !== srcFormat) {
        doAudioDataCopyToWebKitWorkaround(this._data, destView, srcFormat, destFormat, numChannels, planeIndex, frameOffset, copyFrameCount);
      } else {
        this._data.copyTo(destination, {
          planeIndex,
          frameOffset,
          frameCount: copyFrameCount,
          format: destFormat
        });
      }
    } else {
      const uint8Data = this._data;
      const srcView = toDataView(uint8Data);
      const readFn = getReadFunction(srcFormat);
      const srcBytesPerSample = getBytesPerSample(srcFormat);
      const srcIsPlanar = formatIsPlanar(srcFormat);
      for (let i = 0; i < copyFrameCount; i++) {
        if (destIsPlanar) {
          const destOffset = i * destBytesPerSample;
          let srcOffset;
          if (srcIsPlanar) {
            srcOffset = (planeIndex * numFrames + (i + frameOffset)) * srcBytesPerSample;
          } else {
            srcOffset = ((i + frameOffset) * numChannels + planeIndex) * srcBytesPerSample;
          }
          const normalized = readFn(srcView, srcOffset);
          writeFn(destView, destOffset, normalized);
        } else {
          for (let ch = 0; ch < numChannels; ch++) {
            const destIndex = i * numChannels + ch;
            const destOffset = destIndex * destBytesPerSample;
            let srcOffset;
            if (srcIsPlanar) {
              srcOffset = (ch * numFrames + (i + frameOffset)) * srcBytesPerSample;
            } else {
              srcOffset = ((i + frameOffset) * numChannels + ch) * srcBytesPerSample;
            }
            const normalized = readFn(srcView, srcOffset);
            writeFn(destView, destOffset, normalized);
          }
        }
      }
    }
  }
  /** Clones this audio sample. */
  clone() {
    if (this._closed) {
      throw new Error("AudioSample is closed.");
    }
    if (isAudioData(this._data)) {
      const sample = new _AudioSample(this._data.clone());
      sample.setTimestamp(this.timestamp);
      return sample;
    } else {
      return new _AudioSample({
        format: this.format,
        sampleRate: this.sampleRate,
        numberOfFrames: this.numberOfFrames,
        numberOfChannels: this.numberOfChannels,
        timestamp: this.timestamp,
        data: this._data
      });
    }
  }
  /**
   * Closes this audio sample, releasing held resources. Audio samples should be closed as soon as they are not
   * needed anymore.
   */
  close() {
    if (this._closed) {
      return;
    }
    finalizationRegistry?.unregister(this);
    if (isAudioData(this._data)) {
      this._data.close();
    } else {
      this._data = new Uint8Array(0);
    }
    this._closed = true;
  }
  /**
   * Converts this audio sample to an AudioData for use with the WebCodecs API. The AudioData returned by this
   * method *must* be closed separately from this audio sample.
   */
  toAudioData() {
    if (this._closed) {
      throw new Error("AudioSample is closed.");
    }
    if (isAudioData(this._data)) {
      if (this._data.timestamp === this.microsecondTimestamp) {
        return this._data.clone();
      } else {
        if (formatIsPlanar(this.format)) {
          const size = this.allocationSize({ planeIndex: 0, format: this.format });
          const data = new ArrayBuffer(size * this.numberOfChannels);
          for (let i = 0; i < this.numberOfChannels; i++) {
            this.copyTo(new Uint8Array(data, i * size, size), { planeIndex: i, format: this.format });
          }
          return new AudioData({
            format: this.format,
            sampleRate: this.sampleRate,
            numberOfFrames: this.numberOfFrames,
            numberOfChannels: this.numberOfChannels,
            timestamp: this.microsecondTimestamp,
            data
          });
        } else {
          const data = new ArrayBuffer(this.allocationSize({ planeIndex: 0, format: this.format }));
          this.copyTo(data, { planeIndex: 0, format: this.format });
          return new AudioData({
            format: this.format,
            sampleRate: this.sampleRate,
            numberOfFrames: this.numberOfFrames,
            numberOfChannels: this.numberOfChannels,
            timestamp: this.microsecondTimestamp,
            data
          });
        }
      }
    } else {
      return new AudioData({
        format: this.format,
        sampleRate: this.sampleRate,
        numberOfFrames: this.numberOfFrames,
        numberOfChannels: this.numberOfChannels,
        timestamp: this.microsecondTimestamp,
        data: this._data.buffer instanceof ArrayBuffer ? this._data.buffer : this._data.slice()
        // In the case of SharedArrayBuffer, convert to ArrayBuffer
      });
    }
  }
  /** Convert this audio sample to an AudioBuffer for use with the Web Audio API. */
  toAudioBuffer() {
    if (this._closed) {
      throw new Error("AudioSample is closed.");
    }
    const audioBuffer = new AudioBuffer({
      numberOfChannels: this.numberOfChannels,
      length: this.numberOfFrames,
      sampleRate: this.sampleRate
    });
    const dataBytes = new Float32Array(this.allocationSize({ planeIndex: 0, format: "f32-planar" }) / 4);
    for (let i = 0; i < this.numberOfChannels; i++) {
      this.copyTo(dataBytes, { planeIndex: i, format: "f32-planar" });
      audioBuffer.copyToChannel(dataBytes, i);
    }
    return audioBuffer;
  }
  /** Sets the presentation timestamp of this audio sample, in seconds. */
  setTimestamp(newTimestamp) {
    if (!Number.isFinite(newTimestamp)) {
      throw new TypeError("newTimestamp must be a number.");
    }
    this.timestamp = newTimestamp;
  }
  /** Calls `.close()`. */
  [Symbol.dispose]() {
    this.close();
  }
  /** @internal */
  static *_fromAudioBuffer(audioBuffer, timestamp) {
    if (!(audioBuffer instanceof AudioBuffer)) {
      throw new TypeError("audioBuffer must be an AudioBuffer.");
    }
    const MAX_FLOAT_COUNT = 48e3 * 5;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const totalFrames = audioBuffer.length;
    const maxFramesPerChunk = Math.floor(MAX_FLOAT_COUNT / numberOfChannels);
    let currentRelativeFrame = 0;
    let remainingFrames = totalFrames;
    while (remainingFrames > 0) {
      const framesToCopy = Math.min(maxFramesPerChunk, remainingFrames);
      const chunkData = new Float32Array(numberOfChannels * framesToCopy);
      for (let channel = 0; channel < numberOfChannels; channel++) {
        audioBuffer.copyFromChannel(chunkData.subarray(channel * framesToCopy, (channel + 1) * framesToCopy), channel, currentRelativeFrame);
      }
      yield new _AudioSample({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: framesToCopy,
        numberOfChannels,
        timestamp: timestamp + currentRelativeFrame / sampleRate,
        data: chunkData
      });
      currentRelativeFrame += framesToCopy;
      remainingFrames -= framesToCopy;
    }
  }
  /**
   * Creates AudioSamples from an AudioBuffer, starting at the given timestamp in seconds. Typically creates exactly
   * one sample, but may create multiple if the AudioBuffer is exceedingly large.
   */
  static fromAudioBuffer(audioBuffer, timestamp) {
    if (!(audioBuffer instanceof AudioBuffer)) {
      throw new TypeError("audioBuffer must be an AudioBuffer.");
    }
    const MAX_FLOAT_COUNT = 48e3 * 5;
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const totalFrames = audioBuffer.length;
    const maxFramesPerChunk = Math.floor(MAX_FLOAT_COUNT / numberOfChannels);
    let currentRelativeFrame = 0;
    let remainingFrames = totalFrames;
    const result = [];
    while (remainingFrames > 0) {
      const framesToCopy = Math.min(maxFramesPerChunk, remainingFrames);
      const chunkData = new Float32Array(numberOfChannels * framesToCopy);
      for (let channel = 0; channel < numberOfChannels; channel++) {
        audioBuffer.copyFromChannel(chunkData.subarray(channel * framesToCopy, (channel + 1) * framesToCopy), channel, currentRelativeFrame);
      }
      const audioSample = new _AudioSample({
        format: "f32-planar",
        sampleRate,
        numberOfFrames: framesToCopy,
        numberOfChannels,
        timestamp: timestamp + currentRelativeFrame / sampleRate,
        data: chunkData
      });
      result.push(audioSample);
      currentRelativeFrame += framesToCopy;
      remainingFrames -= framesToCopy;
    }
    return result;
  }
};
var getBytesPerSample = (format) => {
  switch (format) {
    case "u8":
    case "u8-planar":
      return 1;
    case "s16":
    case "s16-planar":
      return 2;
    case "s32":
    case "s32-planar":
      return 4;
    case "f32":
    case "f32-planar":
      return 4;
    default:
      throw new Error("Unknown AudioSampleFormat");
  }
};
var formatIsPlanar = (format) => {
  switch (format) {
    case "u8-planar":
    case "s16-planar":
    case "s32-planar":
    case "f32-planar":
      return true;
    default:
      return false;
  }
};
var getReadFunction = (format) => {
  switch (format) {
    case "u8":
    case "u8-planar":
      return (view2, offset) => (view2.getUint8(offset) - 128) / 128;
    case "s16":
    case "s16-planar":
      return (view2, offset) => view2.getInt16(offset, true) / 32768;
    case "s32":
    case "s32-planar":
      return (view2, offset) => view2.getInt32(offset, true) / 2147483648;
    case "f32":
    case "f32-planar":
      return (view2, offset) => view2.getFloat32(offset, true);
  }
};
var getWriteFunction = (format) => {
  switch (format) {
    case "u8":
    case "u8-planar":
      return (view2, offset, value) => view2.setUint8(offset, clamp((value + 1) * 127.5, 0, 255));
    case "s16":
    case "s16-planar":
      return (view2, offset, value) => view2.setInt16(offset, clamp(Math.round(value * 32767), -32768, 32767), true);
    case "s32":
    case "s32-planar":
      return (view2, offset, value) => view2.setInt32(offset, clamp(Math.round(value * 2147483647), -2147483648, 2147483647), true);
    case "f32":
    case "f32-planar":
      return (view2, offset, value) => view2.setFloat32(offset, value, true);
  }
};
var isAudioData = (x) => {
  return typeof AudioData !== "undefined" && x instanceof AudioData;
};
var doAudioDataCopyToWebKitWorkaround = (audioData, destView, srcFormat, destFormat, numChannels, planeIndex, frameOffset, copyFrameCount) => {
  const readFn = getReadFunction(srcFormat);
  const writeFn = getWriteFunction(destFormat);
  const srcBytesPerSample = getBytesPerSample(srcFormat);
  const destBytesPerSample = getBytesPerSample(destFormat);
  const srcIsPlanar = formatIsPlanar(srcFormat);
  const destIsPlanar = formatIsPlanar(destFormat);
  if (destIsPlanar) {
    if (srcIsPlanar) {
      const data = new ArrayBuffer(copyFrameCount * srcBytesPerSample);
      const dataView = toDataView(data);
      audioData.copyTo(data, {
        planeIndex,
        frameOffset,
        frameCount: copyFrameCount,
        format: srcFormat
      });
      for (let i = 0; i < copyFrameCount; i++) {
        const srcOffset = i * srcBytesPerSample;
        const destOffset = i * destBytesPerSample;
        const sample = readFn(dataView, srcOffset);
        writeFn(destView, destOffset, sample);
      }
    } else {
      const data = new ArrayBuffer(copyFrameCount * numChannels * srcBytesPerSample);
      const dataView = toDataView(data);
      audioData.copyTo(data, {
        planeIndex: 0,
        frameOffset,
        frameCount: copyFrameCount,
        format: srcFormat
      });
      for (let i = 0; i < copyFrameCount; i++) {
        const srcOffset = (i * numChannels + planeIndex) * srcBytesPerSample;
        const destOffset = i * destBytesPerSample;
        const sample = readFn(dataView, srcOffset);
        writeFn(destView, destOffset, sample);
      }
    }
  } else {
    if (srcIsPlanar) {
      const planeSize = copyFrameCount * srcBytesPerSample;
      const data = new ArrayBuffer(planeSize);
      const dataView = toDataView(data);
      for (let ch = 0; ch < numChannels; ch++) {
        audioData.copyTo(data, {
          planeIndex: ch,
          frameOffset,
          frameCount: copyFrameCount,
          format: srcFormat
        });
        for (let i = 0; i < copyFrameCount; i++) {
          const srcOffset = i * srcBytesPerSample;
          const destOffset = (i * numChannels + ch) * destBytesPerSample;
          const sample = readFn(dataView, srcOffset);
          writeFn(destView, destOffset, sample);
        }
      }
    } else {
      const data = new ArrayBuffer(copyFrameCount * numChannels * srcBytesPerSample);
      const dataView = toDataView(data);
      audioData.copyTo(data, {
        planeIndex: 0,
        frameOffset,
        frameCount: copyFrameCount,
        format: srcFormat
      });
      for (let i = 0; i < copyFrameCount; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          const idx = i * numChannels + ch;
          const srcOffset = idx * srcBytesPerSample;
          const destOffset = idx * destBytesPerSample;
          const sample = readFn(dataView, srcOffset);
          writeFn(destView, destOffset, sample);
        }
      }
    }
  }
};

// node_modules/mediabunny/dist/modules/src/isobmff/isobmff-misc.js
var buildIsobmffMimeType = (info) => {
  const base = info.hasVideo ? "video/" : info.hasAudio ? "audio/" : "application/";
  let string = base + (info.isQuickTime ? "quicktime" : "mp4");
  if (info.codecStrings.length > 0) {
    const uniqueCodecMimeTypes = [...new Set(info.codecStrings)];
    string += `; codecs="${uniqueCodecMimeTypes.join(", ")}"`;
  }
  return string;
};

// node_modules/mediabunny/dist/modules/src/isobmff/isobmff-reader.js
var MIN_BOX_HEADER_SIZE = 8;
var MAX_BOX_HEADER_SIZE = 16;

// node_modules/mediabunny/dist/modules/src/adts/adts-reader.js
var MIN_ADTS_FRAME_HEADER_SIZE = 7;
var MAX_ADTS_FRAME_HEADER_SIZE = 9;
var readAdtsFrameHeader = (slice) => {
  const startPos = slice.filePos;
  const bytes2 = readBytes(slice, 9);
  const bitstream = new Bitstream(bytes2);
  const syncword = bitstream.readBits(12);
  if (syncword !== 4095) {
    return null;
  }
  bitstream.skipBits(1);
  const layer = bitstream.readBits(2);
  if (layer !== 0) {
    return null;
  }
  const protectionAbsence = bitstream.readBits(1);
  const objectType = bitstream.readBits(2) + 1;
  const samplingFrequencyIndex = bitstream.readBits(4);
  if (samplingFrequencyIndex === 15) {
    return null;
  }
  bitstream.skipBits(1);
  const channelConfiguration = bitstream.readBits(3);
  if (channelConfiguration === 0) {
    throw new Error("ADTS frames with channel configuration 0 are not supported.");
  }
  bitstream.skipBits(1);
  bitstream.skipBits(1);
  bitstream.skipBits(1);
  bitstream.skipBits(1);
  const frameLength = bitstream.readBits(13);
  bitstream.skipBits(11);
  const numberOfAacFrames = bitstream.readBits(2) + 1;
  if (numberOfAacFrames !== 1) {
    throw new Error("ADTS frames with more than one AAC frame are not supported.");
  }
  let crcCheck = null;
  if (protectionAbsence === 1) {
    slice.filePos -= 2;
  } else {
    crcCheck = bitstream.readBits(16);
  }
  return {
    objectType,
    samplingFrequencyIndex,
    channelConfiguration,
    frameLength,
    numberOfAacFrames,
    crcCheck,
    startPos
  };
};

// node_modules/mediabunny/dist/modules/src/reader.js
var FileSlice = class _FileSlice {
  constructor(bytes2, view2, offset, start, end) {
    this.bytes = bytes2;
    this.view = view2;
    this.offset = offset;
    this.start = start;
    this.end = end;
    this.bufferPos = start - offset;
  }
  static tempFromBytes(bytes2) {
    return new _FileSlice(bytes2, toDataView(bytes2), 0, 0, bytes2.length);
  }
  get length() {
    return this.end - this.start;
  }
  get filePos() {
    return this.offset + this.bufferPos;
  }
  set filePos(value) {
    this.bufferPos = value - this.offset;
  }
  /** The number of bytes left from the current pos to the end of the slice. */
  get remainingLength() {
    return Math.max(this.end - this.filePos, 0);
  }
  skip(byteCount) {
    this.bufferPos += byteCount;
  }
  /** Creates a new subslice of this slice whose byte range must be contained within this slice. */
  slice(filePos, length = this.end - filePos) {
    if (filePos < this.start || filePos + length > this.end) {
      throw new RangeError("Slicing outside of original slice.");
    }
    return new _FileSlice(this.bytes, this.view, this.offset, filePos, filePos + length);
  }
};
var checkIsInRange = (slice, bytesToRead) => {
  if (slice.filePos < slice.start || slice.filePos + bytesToRead > slice.end) {
    throw new RangeError(`Tried reading [${slice.filePos}, ${slice.filePos + bytesToRead}), but slice is [${slice.start}, ${slice.end}). This is likely an internal error, please report it alongside the file that caused it.`);
  }
};
var readBytes = (slice, length) => {
  checkIsInRange(slice, length);
  const bytes2 = slice.bytes.subarray(slice.bufferPos, slice.bufferPos + length);
  slice.bufferPos += length;
  return bytes2;
};

// node_modules/mediabunny/dist/modules/src/muxer.js
var Muxer = class {
  constructor(output) {
    this.mutex = new AsyncMutex();
    this.firstMediaStreamTimestamp = null;
    this.trackTimestampInfo = /* @__PURE__ */ new WeakMap();
    this.output = output;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onTrackClose(track) {
  }
  validateAndNormalizeTimestamp(track, timestampInSeconds, isKeyPacket) {
    timestampInSeconds += track.source._timestampOffset;
    if (timestampInSeconds < 0) {
      throw new Error(`Timestamps must be non-negative (got ${timestampInSeconds}s).`);
    }
    let timestampInfo = this.trackTimestampInfo.get(track);
    if (!timestampInfo) {
      if (!isKeyPacket) {
        throw new Error("First packet must be a key packet.");
      }
      timestampInfo = {
        maxTimestamp: timestampInSeconds,
        maxTimestampBeforeLastKeyPacket: null
      };
      this.trackTimestampInfo.set(track, timestampInfo);
    } else {
      if (isKeyPacket) {
        timestampInfo.maxTimestampBeforeLastKeyPacket = timestampInfo.maxTimestamp;
      }
      if (timestampInfo.maxTimestampBeforeLastKeyPacket !== null && timestampInSeconds < timestampInfo.maxTimestampBeforeLastKeyPacket) {
        throw new Error(`Timestamps cannot be smaller than the largest timestamp of the previous GOP (a GOP begins with a key packet and ends right before the next key packet). Got ${timestampInSeconds}s, but largest timestamp is ${timestampInfo.maxTimestampBeforeLastKeyPacket}s.`);
      }
      timestampInfo.maxTimestamp = Math.max(timestampInfo.maxTimestamp, timestampInSeconds);
    }
    return timestampInSeconds;
  }
};

// node_modules/mediabunny/dist/modules/src/subtitles.js
var inlineTimestampRegex = /<(?:(\d{2}):)?(\d{2}):(\d{2}).(\d{3})>/g;
var formatSubtitleTimestamp = (timestamp) => {
  const hours = Math.floor(timestamp / (60 * 60 * 1e3));
  const minutes = Math.floor(timestamp % (60 * 60 * 1e3) / (60 * 1e3));
  const seconds = Math.floor(timestamp % (60 * 1e3) / 1e3);
  const milliseconds = timestamp % 1e3;
  return hours.toString().padStart(2, "0") + ":" + minutes.toString().padStart(2, "0") + ":" + seconds.toString().padStart(2, "0") + "." + milliseconds.toString().padStart(3, "0");
};

// node_modules/mediabunny/dist/modules/src/isobmff/isobmff-boxes.js
var IsobmffBoxWriter = class {
  constructor(writer) {
    this.writer = writer;
    this.helper = new Uint8Array(8);
    this.helperView = new DataView(this.helper.buffer);
    this.offsets = /* @__PURE__ */ new WeakMap();
  }
  writeU32(value) {
    this.helperView.setUint32(0, value, false);
    this.writer.write(this.helper.subarray(0, 4));
  }
  writeU64(value) {
    this.helperView.setUint32(0, Math.floor(value / 2 ** 32), false);
    this.helperView.setUint32(4, value, false);
    this.writer.write(this.helper.subarray(0, 8));
  }
  writeAscii(text) {
    for (let i = 0; i < text.length; i++) {
      this.helperView.setUint8(i % 8, text.charCodeAt(i));
      if (i % 8 === 7)
        this.writer.write(this.helper);
    }
    if (text.length % 8 !== 0) {
      this.writer.write(this.helper.subarray(0, text.length % 8));
    }
  }
  writeBox(box2) {
    this.offsets.set(box2, this.writer.getPos());
    if (box2.contents && !box2.children) {
      this.writeBoxHeader(box2, box2.size ?? box2.contents.byteLength + 8);
      this.writer.write(box2.contents);
    } else {
      const startPos = this.writer.getPos();
      this.writeBoxHeader(box2, 0);
      if (box2.contents)
        this.writer.write(box2.contents);
      if (box2.children) {
        for (const child of box2.children)
          if (child)
            this.writeBox(child);
      }
      const endPos = this.writer.getPos();
      const size = box2.size ?? endPos - startPos;
      this.writer.seek(startPos);
      this.writeBoxHeader(box2, size);
      this.writer.seek(endPos);
    }
  }
  writeBoxHeader(box2, size) {
    this.writeU32(box2.largeSize ? 1 : size);
    this.writeAscii(box2.type);
    if (box2.largeSize)
      this.writeU64(size);
  }
  measureBoxHeader(box2) {
    return 8 + (box2.largeSize ? 8 : 0);
  }
  patchBox(box2) {
    const boxOffset = this.offsets.get(box2);
    assert(boxOffset !== void 0);
    const endPos = this.writer.getPos();
    this.writer.seek(boxOffset);
    this.writeBox(box2);
    this.writer.seek(endPos);
  }
  measureBox(box2) {
    if (box2.contents && !box2.children) {
      const headerSize = this.measureBoxHeader(box2);
      return headerSize + box2.contents.byteLength;
    } else {
      let result = this.measureBoxHeader(box2);
      if (box2.contents)
        result += box2.contents.byteLength;
      if (box2.children) {
        for (const child of box2.children)
          if (child)
            result += this.measureBox(child);
      }
      return result;
    }
  }
};
var bytes = /* @__PURE__ */ new Uint8Array(8);
var view = /* @__PURE__ */ new DataView(bytes.buffer);
var u8 = (value) => {
  return [(value % 256 + 256) % 256];
};
var u16 = (value) => {
  view.setUint16(0, value, false);
  return [bytes[0], bytes[1]];
};
var i16 = (value) => {
  view.setInt16(0, value, false);
  return [bytes[0], bytes[1]];
};
var u24 = (value) => {
  view.setUint32(0, value, false);
  return [bytes[1], bytes[2], bytes[3]];
};
var u32 = (value) => {
  view.setUint32(0, value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var i32 = (value) => {
  view.setInt32(0, value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var u64 = (value) => {
  view.setUint32(0, Math.floor(value / 2 ** 32), false);
  view.setUint32(4, value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7]];
};
var fixed_8_8 = (value) => {
  view.setInt16(0, 2 ** 8 * value, false);
  return [bytes[0], bytes[1]];
};
var fixed_16_16 = (value) => {
  view.setInt32(0, 2 ** 16 * value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var fixed_2_30 = (value) => {
  view.setInt32(0, 2 ** 30 * value, false);
  return [bytes[0], bytes[1], bytes[2], bytes[3]];
};
var variableUnsignedInt = (value, byteLength) => {
  const bytes2 = [];
  let remaining = value;
  do {
    let byte = remaining & 127;
    remaining >>= 7;
    if (bytes2.length > 0) {
      byte |= 128;
    }
    bytes2.push(byte);
    if (byteLength !== void 0) {
      byteLength--;
    }
  } while (remaining > 0 || byteLength);
  return bytes2.reverse();
};
var ascii = (text, nullTerminated = false) => {
  const bytes2 = Array(text.length).fill(null).map((_, i) => text.charCodeAt(i));
  if (nullTerminated)
    bytes2.push(0);
  return bytes2;
};
var lastPresentedSample = (samples) => {
  let result = null;
  for (const sample of samples) {
    if (!result || sample.timestamp > result.timestamp) {
      result = sample;
    }
  }
  return result;
};
var rotationMatrix = (rotationInDegrees) => {
  const theta = rotationInDegrees * (Math.PI / 180);
  const cosTheta = Math.round(Math.cos(theta));
  const sinTheta = Math.round(Math.sin(theta));
  return [
    cosTheta,
    sinTheta,
    0,
    -sinTheta,
    cosTheta,
    0,
    0,
    0,
    1
  ];
};
var IDENTITY_MATRIX = /* @__PURE__ */ rotationMatrix(0);
var matrixToBytes = (matrix) => {
  return [
    fixed_16_16(matrix[0]),
    fixed_16_16(matrix[1]),
    fixed_2_30(matrix[2]),
    fixed_16_16(matrix[3]),
    fixed_16_16(matrix[4]),
    fixed_2_30(matrix[5]),
    fixed_16_16(matrix[6]),
    fixed_16_16(matrix[7]),
    fixed_2_30(matrix[8])
  ];
};
var box = (type, contents, children) => ({
  type,
  contents: contents && new Uint8Array(contents.flat(10)),
  children
});
var fullBox = (type, version, flags, contents, children) => box(type, [u8(version), u24(flags), contents ?? []], children);
var ftyp = (details) => {
  const minorVersion = 512;
  if (details.isQuickTime) {
    return box("ftyp", [
      ascii("qt  "),
      // Major brand
      u32(minorVersion),
      // Minor version
      // Compatible brands
      ascii("qt  ")
    ]);
  }
  if (details.fragmented) {
    return box("ftyp", [
      ascii("iso5"),
      // Major brand
      u32(minorVersion),
      // Minor version
      // Compatible brands
      ascii("iso5"),
      ascii("iso6"),
      ascii("mp41")
    ]);
  }
  return box("ftyp", [
    ascii("isom"),
    // Major brand
    u32(minorVersion),
    // Minor version
    // Compatible brands
    ascii("isom"),
    details.holdsAvc ? ascii("avc1") : [],
    ascii("mp41")
  ]);
};
var mdat = (reserveLargeSize) => ({ type: "mdat", largeSize: reserveLargeSize });
var free = (size) => ({ type: "free", size });
var moov = (muxer) => box("moov", void 0, [
  mvhd(muxer.creationTime, muxer.trackDatas),
  ...muxer.trackDatas.map((x) => trak(x, muxer.creationTime)),
  muxer.isFragmented ? mvex(muxer.trackDatas) : null,
  udta(muxer)
]);
var mvhd = (creationTime, trackDatas) => {
  const duration = intoTimescale(Math.max(0, ...trackDatas.filter((x) => x.samples.length > 0).map((x) => {
    const lastSample = lastPresentedSample(x.samples);
    return lastSample.timestamp + lastSample.duration;
  })), GLOBAL_TIMESCALE);
  const nextTrackId = Math.max(0, ...trackDatas.map((x) => x.track.id)) + 1;
  const needsU64 = !isU32(creationTime) || !isU32(duration);
  const u32OrU64 = needsU64 ? u64 : u32;
  return fullBox("mvhd", +needsU64, 0, [
    u32OrU64(creationTime),
    // Creation time
    u32OrU64(creationTime),
    // Modification time
    u32(GLOBAL_TIMESCALE),
    // Timescale
    u32OrU64(duration),
    // Duration
    fixed_16_16(1),
    // Preferred rate
    fixed_8_8(1),
    // Preferred volume
    Array(10).fill(0),
    // Reserved
    matrixToBytes(IDENTITY_MATRIX),
    // Matrix
    Array(24).fill(0),
    // Pre-defined
    u32(nextTrackId)
    // Next track ID
  ]);
};
var trak = (trackData, creationTime) => {
  const trackMetadata = getTrackMetadata(trackData);
  return box("trak", void 0, [
    tkhd(trackData, creationTime),
    mdia(trackData, creationTime),
    trackMetadata.name !== void 0 ? box("udta", void 0, [
      box("name", [
        ...textEncoder.encode(trackMetadata.name)
      ])
    ]) : null
  ]);
};
var tkhd = (trackData, creationTime) => {
  const lastSample = lastPresentedSample(trackData.samples);
  const durationInGlobalTimescale = intoTimescale(lastSample ? lastSample.timestamp + lastSample.duration : 0, GLOBAL_TIMESCALE);
  const needsU64 = !isU32(creationTime) || !isU32(durationInGlobalTimescale);
  const u32OrU64 = needsU64 ? u64 : u32;
  let matrix;
  if (trackData.type === "video") {
    const rotation = trackData.track.metadata.rotation;
    matrix = rotationMatrix(rotation ?? 0);
  } else {
    matrix = IDENTITY_MATRIX;
  }
  let flags = 2;
  if (trackData.track.metadata.disposition?.default !== false) {
    flags |= 1;
  }
  return fullBox("tkhd", +needsU64, flags, [
    u32OrU64(creationTime),
    // Creation time
    u32OrU64(creationTime),
    // Modification time
    u32(trackData.track.id),
    // Track ID
    u32(0),
    // Reserved
    u32OrU64(durationInGlobalTimescale),
    // Duration
    Array(8).fill(0),
    // Reserved
    u16(0),
    // Layer
    u16(trackData.track.id),
    // Alternate group
    fixed_8_8(trackData.type === "audio" ? 1 : 0),
    // Volume
    u16(0),
    // Reserved
    matrixToBytes(matrix),
    // Matrix
    fixed_16_16(trackData.type === "video" ? trackData.info.width : 0),
    // Track width
    fixed_16_16(trackData.type === "video" ? trackData.info.height : 0)
    // Track height
  ]);
};
var mdia = (trackData, creationTime) => box("mdia", void 0, [
  mdhd(trackData, creationTime),
  hdlr(true, TRACK_TYPE_TO_COMPONENT_SUBTYPE[trackData.type], TRACK_TYPE_TO_HANDLER_NAME[trackData.type]),
  minf(trackData)
]);
var mdhd = (trackData, creationTime) => {
  const lastSample = lastPresentedSample(trackData.samples);
  const localDuration = intoTimescale(lastSample ? lastSample.timestamp + lastSample.duration : 0, trackData.timescale);
  const needsU64 = !isU32(creationTime) || !isU32(localDuration);
  const u32OrU64 = needsU64 ? u64 : u32;
  return fullBox("mdhd", +needsU64, 0, [
    u32OrU64(creationTime),
    // Creation time
    u32OrU64(creationTime),
    // Modification time
    u32(trackData.timescale),
    // Timescale
    u32OrU64(localDuration),
    // Duration
    u16(getLanguageCodeInt(trackData.track.metadata.languageCode ?? UNDETERMINED_LANGUAGE)),
    // Language
    u16(0)
    // Quality
  ]);
};
var TRACK_TYPE_TO_COMPONENT_SUBTYPE = {
  video: "vide",
  audio: "soun",
  subtitle: "text"
};
var TRACK_TYPE_TO_HANDLER_NAME = {
  video: "MediabunnyVideoHandler",
  audio: "MediabunnySoundHandler",
  subtitle: "MediabunnyTextHandler"
};
var hdlr = (hasComponentType, handlerType, name, manufacturer = "\0\0\0\0") => fullBox("hdlr", 0, 0, [
  hasComponentType ? ascii("mhlr") : u32(0),
  // Component type
  ascii(handlerType),
  // Component subtype
  ascii(manufacturer),
  // Component manufacturer
  u32(0),
  // Component flags
  u32(0),
  // Component flags mask
  ascii(name, true)
  // Component name
]);
var minf = (trackData) => box("minf", void 0, [
  TRACK_TYPE_TO_HEADER_BOX[trackData.type](),
  dinf(),
  stbl(trackData)
]);
var vmhd = () => fullBox("vmhd", 0, 1, [
  u16(0),
  // Graphics mode
  u16(0),
  // Opcolor R
  u16(0),
  // Opcolor G
  u16(0)
  // Opcolor B
]);
var smhd = () => fullBox("smhd", 0, 0, [
  u16(0),
  // Balance
  u16(0)
  // Reserved
]);
var nmhd = () => fullBox("nmhd", 0, 0);
var TRACK_TYPE_TO_HEADER_BOX = {
  video: vmhd,
  audio: smhd,
  subtitle: nmhd
};
var dinf = () => box("dinf", void 0, [
  dref()
]);
var dref = () => fullBox("dref", 0, 0, [
  u32(1)
  // Entry count
], [
  url()
]);
var url = () => fullBox("url ", 0, 1);
var stbl = (trackData) => {
  const needsCtts = trackData.compositionTimeOffsetTable.length > 1 || trackData.compositionTimeOffsetTable.some((x) => x.sampleCompositionTimeOffset !== 0);
  return box("stbl", void 0, [
    stsd(trackData),
    stts(trackData),
    needsCtts ? ctts(trackData) : null,
    needsCtts ? cslg(trackData) : null,
    stsc(trackData),
    stsz(trackData),
    stco(trackData),
    stss(trackData)
  ]);
};
var stsd = (trackData) => {
  let sampleDescription;
  if (trackData.type === "video") {
    sampleDescription = videoSampleDescription(videoCodecToBoxName(trackData.track.source._codec, trackData.info.decoderConfig.codec), trackData);
  } else if (trackData.type === "audio") {
    const boxName = audioCodecToBoxName(trackData.track.source._codec, trackData.muxer.isQuickTime);
    assert(boxName);
    sampleDescription = soundSampleDescription(boxName, trackData);
  } else if (trackData.type === "subtitle") {
    sampleDescription = subtitleSampleDescription(SUBTITLE_CODEC_TO_BOX_NAME[trackData.track.source._codec], trackData);
  }
  assert(sampleDescription);
  return fullBox("stsd", 0, 0, [
    u32(1)
    // Entry count
  ], [
    sampleDescription
  ]);
};
var videoSampleDescription = (compressionType, trackData) => box(compressionType, [
  Array(6).fill(0),
  // Reserved
  u16(1),
  // Data reference index
  u16(0),
  // Pre-defined
  u16(0),
  // Reserved
  Array(12).fill(0),
  // Pre-defined
  u16(trackData.info.width),
  // Width
  u16(trackData.info.height),
  // Height
  u32(4718592),
  // Horizontal resolution
  u32(4718592),
  // Vertical resolution
  u32(0),
  // Reserved
  u16(1),
  // Frame count
  Array(32).fill(0),
  // Compressor name
  u16(24),
  // Depth
  i16(65535)
  // Pre-defined
], [
  VIDEO_CODEC_TO_CONFIGURATION_BOX[trackData.track.source._codec](trackData),
  pasp(trackData),
  colorSpaceIsComplete(trackData.info.decoderConfig.colorSpace) ? colr(trackData) : null
]);
var pasp = (trackData) => {
  if (trackData.info.pixelAspectRatio.num === trackData.info.pixelAspectRatio.den) {
    return null;
  }
  return box("pasp", [
    u32(trackData.info.pixelAspectRatio.num),
    u32(trackData.info.pixelAspectRatio.den)
  ]);
};
var colr = (trackData) => box("colr", [
  ascii("nclx"),
  // Colour type
  u16(COLOR_PRIMARIES_MAP[trackData.info.decoderConfig.colorSpace.primaries]),
  // Colour primaries
  u16(TRANSFER_CHARACTERISTICS_MAP[trackData.info.decoderConfig.colorSpace.transfer]),
  // Transfer characteristics
  u16(MATRIX_COEFFICIENTS_MAP[trackData.info.decoderConfig.colorSpace.matrix]),
  // Matrix coefficients
  u8((trackData.info.decoderConfig.colorSpace.fullRange ? 1 : 0) << 7)
  // Full range flag
]);
var avcC = (trackData) => trackData.info.decoderConfig && box("avcC", [
  // For AVC, description is an AVCDecoderConfigurationRecord, so nothing else to do here
  ...toUint8Array(trackData.info.decoderConfig.description)
]);
var hvcC = (trackData) => trackData.info.decoderConfig && box("hvcC", [
  // For HEVC, description is an HEVCDecoderConfigurationRecord, so nothing else to do here
  ...toUint8Array(trackData.info.decoderConfig.description)
]);
var vpcC = (trackData) => {
  if (!trackData.info.decoderConfig) {
    return null;
  }
  const decoderConfig = trackData.info.decoderConfig;
  const parts = decoderConfig.codec.split(".");
  const profile = Number(parts[1]);
  const level = Number(parts[2]);
  const bitDepth = Number(parts[3]);
  const chromaSubsampling = parts[4] ? Number(parts[4]) : 1;
  const videoFullRangeFlag = parts[8] ? Number(parts[8]) : Number(decoderConfig.colorSpace?.fullRange ?? 0);
  const thirdByte = (bitDepth << 4) + (chromaSubsampling << 1) + videoFullRangeFlag;
  const colourPrimaries = parts[5] ? Number(parts[5]) : decoderConfig.colorSpace?.primaries ? COLOR_PRIMARIES_MAP[decoderConfig.colorSpace.primaries] : 2;
  const transferCharacteristics = parts[6] ? Number(parts[6]) : decoderConfig.colorSpace?.transfer ? TRANSFER_CHARACTERISTICS_MAP[decoderConfig.colorSpace.transfer] : 2;
  const matrixCoefficients = parts[7] ? Number(parts[7]) : decoderConfig.colorSpace?.matrix ? MATRIX_COEFFICIENTS_MAP[decoderConfig.colorSpace.matrix] : 2;
  return fullBox("vpcC", 1, 0, [
    u8(profile),
    // Profile
    u8(level),
    // Level
    u8(thirdByte),
    // Bit depth, chroma subsampling, full range
    u8(colourPrimaries),
    // Colour primaries
    u8(transferCharacteristics),
    // Transfer characteristics
    u8(matrixCoefficients),
    // Matrix coefficients
    u16(0)
    // Codec initialization data size
  ]);
};
var av1C = (trackData) => {
  return box("av1C", generateAv1CodecConfigurationFromCodecString(trackData.info.decoderConfig.codec));
};
var soundSampleDescription = (compressionType, trackData) => {
  let version = 0;
  let contents;
  let sampleSizeInBits = 16;
  const isPcmCodec = PCM_AUDIO_CODECS.includes(trackData.track.source._codec);
  if (isPcmCodec) {
    const codec = trackData.track.source._codec;
    const { sampleSize } = parsePcmCodec(codec);
    sampleSizeInBits = 8 * sampleSize;
    if (sampleSizeInBits > 16) {
      version = 1;
    }
  }
  if (trackData.muxer.isQuickTime) {
    version = 1;
  }
  if (version === 0) {
    contents = [
      Array(6).fill(0),
      // Reserved
      u16(1),
      // Data reference index
      u16(version),
      // Version
      u16(0),
      // Revision level
      u32(0),
      // Vendor
      u16(trackData.info.numberOfChannels),
      // Number of channels
      u16(sampleSizeInBits),
      // Sample size (bits)
      u16(0),
      // Compression ID
      u16(0),
      // Packet size
      u16(trackData.info.sampleRate < 2 ** 16 ? trackData.info.sampleRate : 0),
      // Sample rate (upper)
      u16(0)
      // Sample rate (lower)
    ];
  } else {
    const compressionId = isPcmCodec ? 0 : -2;
    contents = [
      Array(6).fill(0),
      // Reserved
      u16(1),
      // Data reference index
      u16(version),
      // Version
      u16(0),
      // Revision level
      u32(0),
      // Vendor
      u16(trackData.info.numberOfChannels),
      // Number of channels
      u16(Math.min(sampleSizeInBits, 16)),
      // Sample size (bits)
      i16(compressionId),
      // Compression ID
      u16(0),
      // Packet size
      u16(trackData.info.sampleRate < 2 ** 16 ? trackData.info.sampleRate : 0),
      // Sample rate (upper)
      u16(0),
      // Sample rate (lower)
      isPcmCodec ? [
        u32(1),
        // Samples per packet (must be 1 for uncompressed formats)
        u32(sampleSizeInBits / 8),
        // Bytes per packet
        u32(trackData.info.numberOfChannels * sampleSizeInBits / 8)
        // Bytes per frame
      ] : [
        u32(0),
        // Samples per packet (don't bother, still works with 0)
        u32(0),
        // Bytes per packet (variable)
        u32(0)
        // Bytes per frame (variable)
      ],
      u32(2)
      // Bytes per sample (constant in FFmpeg)
    ];
  }
  return box(compressionType, contents, [
    audioCodecToConfigurationBox(trackData.track.source._codec, trackData.muxer.isQuickTime)?.(trackData) ?? null
  ]);
};
var esds = (trackData) => {
  let objectTypeIndication;
  switch (trackData.track.source._codec) {
    case "aac":
      {
        objectTypeIndication = 64;
      }
      ;
      break;
    case "mp3":
      {
        objectTypeIndication = 107;
      }
      ;
      break;
    case "vorbis":
      {
        objectTypeIndication = 221;
      }
      ;
      break;
    default:
      throw new Error(`Unhandled audio codec: ${trackData.track.source._codec}`);
  }
  let bytes2 = [
    ...u8(objectTypeIndication),
    // Object type indication
    ...u8(21),
    // stream type(6bits)=5 audio, flags(2bits)=1
    ...u24(0),
    // 24bit buffer size
    ...u32(0),
    // max bitrate
    ...u32(0)
    // avg bitrate
  ];
  if (trackData.info.decoderConfig.description) {
    const description = toUint8Array(trackData.info.decoderConfig.description);
    bytes2 = [
      ...bytes2,
      ...u8(5),
      // TAG(5) = DecoderSpecificInfo
      ...variableUnsignedInt(description.byteLength),
      ...description
    ];
  }
  bytes2 = [
    ...u16(1),
    // ES_ID = 1
    ...u8(0),
    // flags etc = 0
    ...u8(4),
    // TAG(4) = ES Descriptor
    ...variableUnsignedInt(bytes2.length),
    ...bytes2,
    ...u8(6),
    // TAG(6)
    ...u8(1),
    // length
    ...u8(2)
    // data
  ];
  bytes2 = [
    ...u8(3),
    // TAG(3) = Object Descriptor
    ...variableUnsignedInt(bytes2.length),
    ...bytes2
  ];
  return fullBox("esds", 0, 0, bytes2);
};
var wave = (trackData) => {
  return box("wave", void 0, [
    frma(trackData),
    enda(trackData),
    box("\0\0\0\0")
    // NULL tag at the end
  ]);
};
var frma = (trackData) => {
  return box("frma", [
    ascii(audioCodecToBoxName(trackData.track.source._codec, trackData.muxer.isQuickTime))
  ]);
};
var enda = (trackData) => {
  const { littleEndian } = parsePcmCodec(trackData.track.source._codec);
  return box("enda", [
    u16(+littleEndian)
  ]);
};
var dOps = (trackData) => {
  let outputChannelCount = trackData.info.numberOfChannels;
  let preSkip = 3840;
  let inputSampleRate = trackData.info.sampleRate;
  let outputGain = 0;
  let channelMappingFamily = 0;
  let channelMappingTable = new Uint8Array(0);
  const description = trackData.info.decoderConfig?.description;
  if (description) {
    assert(description.byteLength >= 18);
    const bytes2 = toUint8Array(description);
    const header = parseOpusIdentificationHeader(bytes2);
    outputChannelCount = header.outputChannelCount;
    preSkip = header.preSkip;
    inputSampleRate = header.inputSampleRate;
    outputGain = header.outputGain;
    channelMappingFamily = header.channelMappingFamily;
    if (header.channelMappingTable) {
      channelMappingTable = header.channelMappingTable;
    }
  }
  return box("dOps", [
    u8(0),
    // Version
    u8(outputChannelCount),
    // OutputChannelCount
    u16(preSkip),
    // PreSkip
    u32(inputSampleRate),
    // InputSampleRate
    i16(outputGain),
    // OutputGain
    u8(channelMappingFamily),
    // ChannelMappingFamily
    ...channelMappingTable
  ]);
};
var dfLa = (trackData) => {
  const description = trackData.info.decoderConfig?.description;
  assert(description);
  const bytes2 = toUint8Array(description);
  return fullBox("dfLa", 0, 0, [
    ...bytes2.subarray(4)
  ]);
};
var pcmC = (trackData) => {
  const { littleEndian, sampleSize } = parsePcmCodec(trackData.track.source._codec);
  const formatFlags = +littleEndian;
  return fullBox("pcmC", 0, 0, [
    u8(formatFlags),
    u8(8 * sampleSize)
  ]);
};
var dac3 = (trackData) => {
  const frameInfo = parseAc3SyncFrame(trackData.info.firstPacket.data);
  if (!frameInfo) {
    throw new Error("Couldn't extract AC-3 frame info from the audio packet. Ensure the packets contain valid AC-3 sync frames (as specified in ETSI TS 102 366).");
  }
  const bytes2 = new Uint8Array(3);
  const bitstream = new Bitstream(bytes2);
  bitstream.writeBits(2, frameInfo.fscod);
  bitstream.writeBits(5, frameInfo.bsid);
  bitstream.writeBits(3, frameInfo.bsmod);
  bitstream.writeBits(3, frameInfo.acmod);
  bitstream.writeBits(1, frameInfo.lfeon);
  bitstream.writeBits(5, frameInfo.bitRateCode);
  bitstream.writeBits(5, 0);
  return box("dac3", [...bytes2]);
};
var dec3 = (trackData) => {
  const frameInfo = parseEac3SyncFrame(trackData.info.firstPacket.data);
  if (!frameInfo) {
    throw new Error("Couldn't extract E-AC-3 frame info from the audio packet. Ensure the packets contain valid E-AC-3 sync frames (as specified in ETSI TS 102 366).");
  }
  let totalBits = 16;
  for (const sub of frameInfo.substreams) {
    totalBits += 23;
    if (sub.numDepSub > 0) {
      totalBits += 9;
    } else {
      totalBits += 1;
    }
  }
  const size = Math.ceil(totalBits / 8);
  const bytes2 = new Uint8Array(size);
  const bitstream = new Bitstream(bytes2);
  bitstream.writeBits(13, frameInfo.dataRate);
  bitstream.writeBits(3, frameInfo.substreams.length - 1);
  for (const sub of frameInfo.substreams) {
    bitstream.writeBits(2, sub.fscod);
    bitstream.writeBits(5, sub.bsid);
    bitstream.writeBits(1, 0);
    bitstream.writeBits(1, 0);
    bitstream.writeBits(3, sub.bsmod);
    bitstream.writeBits(3, sub.acmod);
    bitstream.writeBits(1, sub.lfeon);
    bitstream.writeBits(3, 0);
    bitstream.writeBits(4, sub.numDepSub);
    if (sub.numDepSub > 0) {
      bitstream.writeBits(9, sub.chanLoc);
    } else {
      bitstream.writeBits(1, 0);
    }
  }
  return box("dec3", [...bytes2]);
};
var subtitleSampleDescription = (compressionType, trackData) => box(compressionType, [
  Array(6).fill(0),
  // Reserved
  u16(1)
  // Data reference index
], [
  SUBTITLE_CODEC_TO_CONFIGURATION_BOX[trackData.track.source._codec](trackData)
]);
var vttC = (trackData) => box("vttC", [
  ...textEncoder.encode(trackData.info.config.description)
]);
var stts = (trackData) => {
  return fullBox("stts", 0, 0, [
    u32(trackData.timeToSampleTable.length),
    // Number of entries
    trackData.timeToSampleTable.map((x) => [
      u32(x.sampleCount),
      // Sample count
      u32(x.sampleDelta)
      // Sample duration
    ])
  ]);
};
var stss = (trackData) => {
  if (trackData.samples.every((x) => x.type === "key"))
    return null;
  const keySamples = [...trackData.samples.entries()].filter(([, sample]) => sample.type === "key");
  return fullBox("stss", 0, 0, [
    u32(keySamples.length),
    // Number of entries
    keySamples.map(([index]) => u32(index + 1))
    // Sync sample table
  ]);
};
var stsc = (trackData) => {
  return fullBox("stsc", 0, 0, [
    u32(trackData.compactlyCodedChunkTable.length),
    // Number of entries
    trackData.compactlyCodedChunkTable.map((x) => [
      u32(x.firstChunk),
      // First chunk
      u32(x.samplesPerChunk),
      // Samples per chunk
      u32(1)
      // Sample description index
    ])
  ]);
};
var stsz = (trackData) => {
  if (trackData.type === "audio" && trackData.info.requiresPcmTransformation) {
    const { sampleSize } = parsePcmCodec(trackData.track.source._codec);
    return fullBox("stsz", 0, 0, [
      u32(sampleSize * trackData.info.numberOfChannels),
      // Sample size
      u32(trackData.samples.reduce((acc, x) => acc + intoTimescale(x.duration, trackData.timescale), 0))
    ]);
  }
  return fullBox("stsz", 0, 0, [
    u32(0),
    // Sample size (0 means non-constant size)
    u32(trackData.samples.length),
    // Number of entries
    trackData.samples.map((x) => u32(x.size))
    // Sample size table
  ]);
};
var stco = (trackData) => {
  if (trackData.finalizedChunks.length > 0 && last(trackData.finalizedChunks).offset >= 2 ** 32) {
    return fullBox("co64", 0, 0, [
      u32(trackData.finalizedChunks.length),
      // Number of entries
      trackData.finalizedChunks.map((x) => u64(x.offset))
      // Chunk offset table
    ]);
  }
  return fullBox("stco", 0, 0, [
    u32(trackData.finalizedChunks.length),
    // Number of entries
    trackData.finalizedChunks.map((x) => u32(x.offset))
    // Chunk offset table
  ]);
};
var ctts = (trackData) => {
  return fullBox("ctts", 1, 0, [
    u32(trackData.compositionTimeOffsetTable.length),
    // Number of entries
    trackData.compositionTimeOffsetTable.map((x) => [
      u32(x.sampleCount),
      // Sample count
      i32(x.sampleCompositionTimeOffset)
      // Sample offset
    ])
  ]);
};
var cslg = (trackData) => {
  let leastDecodeToDisplayDelta = Infinity;
  let greatestDecodeToDisplayDelta = -Infinity;
  let compositionStartTime = Infinity;
  let compositionEndTime = -Infinity;
  assert(trackData.compositionTimeOffsetTable.length > 0);
  assert(trackData.samples.length > 0);
  for (let i = 0; i < trackData.compositionTimeOffsetTable.length; i++) {
    const entry = trackData.compositionTimeOffsetTable[i];
    leastDecodeToDisplayDelta = Math.min(leastDecodeToDisplayDelta, entry.sampleCompositionTimeOffset);
    greatestDecodeToDisplayDelta = Math.max(greatestDecodeToDisplayDelta, entry.sampleCompositionTimeOffset);
  }
  for (let i = 0; i < trackData.samples.length; i++) {
    const sample = trackData.samples[i];
    compositionStartTime = Math.min(compositionStartTime, intoTimescale(sample.timestamp, trackData.timescale));
    compositionEndTime = Math.max(compositionEndTime, intoTimescale(sample.timestamp + sample.duration, trackData.timescale));
  }
  const compositionToDtsShift = Math.max(-leastDecodeToDisplayDelta, 0);
  if (compositionEndTime >= 2 ** 31) {
    return null;
  }
  return fullBox("cslg", 0, 0, [
    i32(compositionToDtsShift),
    // Composition to DTS shift
    i32(leastDecodeToDisplayDelta),
    // Least decode to display delta
    i32(greatestDecodeToDisplayDelta),
    // Greatest decode to display delta
    i32(compositionStartTime),
    // Composition start time
    i32(compositionEndTime)
    // Composition end time
  ]);
};
var mvex = (trackDatas) => {
  return box("mvex", void 0, trackDatas.map(trex));
};
var trex = (trackData) => {
  return fullBox("trex", 0, 0, [
    u32(trackData.track.id),
    // Track ID
    u32(1),
    // Default sample description index
    u32(0),
    // Default sample duration
    u32(0),
    // Default sample size
    u32(0)
    // Default sample flags
  ]);
};
var moof = (sequenceNumber, trackDatas) => {
  return box("moof", void 0, [
    mfhd(sequenceNumber),
    ...trackDatas.map(traf)
  ]);
};
var mfhd = (sequenceNumber) => {
  return fullBox("mfhd", 0, 0, [
    u32(sequenceNumber)
    // Sequence number
  ]);
};
var fragmentSampleFlags = (sample) => {
  let byte1 = 0;
  let byte2 = 0;
  const byte3 = 0;
  const byte4 = 0;
  const sampleIsDifferenceSample = sample.type === "delta";
  byte2 |= +sampleIsDifferenceSample;
  if (sampleIsDifferenceSample) {
    byte1 |= 1;
  } else {
    byte1 |= 2;
  }
  return byte1 << 24 | byte2 << 16 | byte3 << 8 | byte4;
};
var traf = (trackData) => {
  return box("traf", void 0, [
    tfhd(trackData),
    tfdt(trackData),
    trun(trackData)
  ]);
};
var tfhd = (trackData) => {
  assert(trackData.currentChunk);
  let tfFlags = 0;
  tfFlags |= 8;
  tfFlags |= 16;
  tfFlags |= 32;
  tfFlags |= 131072;
  const referenceSample = trackData.currentChunk.samples[1] ?? trackData.currentChunk.samples[0];
  const referenceSampleInfo = {
    duration: referenceSample.timescaleUnitsToNextSample,
    size: referenceSample.size,
    flags: fragmentSampleFlags(referenceSample)
  };
  return fullBox("tfhd", 0, tfFlags, [
    u32(trackData.track.id),
    // Track ID
    u32(referenceSampleInfo.duration),
    // Default sample duration
    u32(referenceSampleInfo.size),
    // Default sample size
    u32(referenceSampleInfo.flags)
    // Default sample flags
  ]);
};
var tfdt = (trackData) => {
  assert(trackData.currentChunk);
  return fullBox("tfdt", 1, 0, [
    u64(intoTimescale(trackData.currentChunk.startTimestamp, trackData.timescale))
    // Base Media Decode Time
  ]);
};
var trun = (trackData) => {
  assert(trackData.currentChunk);
  const allSampleDurations = trackData.currentChunk.samples.map((x) => x.timescaleUnitsToNextSample);
  const allSampleSizes = trackData.currentChunk.samples.map((x) => x.size);
  const allSampleFlags = trackData.currentChunk.samples.map(fragmentSampleFlags);
  const allSampleCompositionTimeOffsets = trackData.currentChunk.samples.map((x) => intoTimescale(x.timestamp - x.decodeTimestamp, trackData.timescale));
  const uniqueSampleDurations = new Set(allSampleDurations);
  const uniqueSampleSizes = new Set(allSampleSizes);
  const uniqueSampleFlags = new Set(allSampleFlags);
  const uniqueSampleCompositionTimeOffsets = new Set(allSampleCompositionTimeOffsets);
  const firstSampleFlagsPresent = uniqueSampleFlags.size === 2 && allSampleFlags[0] !== allSampleFlags[1];
  const sampleDurationPresent = uniqueSampleDurations.size > 1;
  const sampleSizePresent = uniqueSampleSizes.size > 1;
  const sampleFlagsPresent = !firstSampleFlagsPresent && uniqueSampleFlags.size > 1;
  const sampleCompositionTimeOffsetsPresent = uniqueSampleCompositionTimeOffsets.size > 1 || [...uniqueSampleCompositionTimeOffsets].some((x) => x !== 0);
  let flags = 0;
  flags |= 1;
  flags |= 4 * +firstSampleFlagsPresent;
  flags |= 256 * +sampleDurationPresent;
  flags |= 512 * +sampleSizePresent;
  flags |= 1024 * +sampleFlagsPresent;
  flags |= 2048 * +sampleCompositionTimeOffsetsPresent;
  return fullBox("trun", 1, flags, [
    u32(trackData.currentChunk.samples.length),
    // Sample count
    u32(trackData.currentChunk.offset - trackData.currentChunk.moofOffset || 0),
    // Data offset
    firstSampleFlagsPresent ? u32(allSampleFlags[0]) : [],
    trackData.currentChunk.samples.map((_, i) => [
      sampleDurationPresent ? u32(allSampleDurations[i]) : [],
      // Sample duration
      sampleSizePresent ? u32(allSampleSizes[i]) : [],
      // Sample size
      sampleFlagsPresent ? u32(allSampleFlags[i]) : [],
      // Sample flags
      // Sample composition time offsets
      sampleCompositionTimeOffsetsPresent ? i32(allSampleCompositionTimeOffsets[i]) : []
    ])
  ]);
};
var mfra = (trackDatas) => {
  return box("mfra", void 0, [
    ...trackDatas.map(tfra),
    mfro()
  ]);
};
var tfra = (trackData, trackIndex) => {
  const version = 1;
  return fullBox("tfra", version, 0, [
    u32(trackData.track.id),
    // Track ID
    u32(63),
    // This specifies that traf number, trun number and sample number are 32-bit ints
    u32(trackData.finalizedChunks.length),
    // Number of entries
    trackData.finalizedChunks.map((chunk) => [
      u64(intoTimescale(chunk.samples[0].timestamp, trackData.timescale)),
      // Time (in presentation time)
      u64(chunk.moofOffset),
      // moof offset
      u32(trackIndex + 1),
      // traf number
      u32(1),
      // trun number
      u32(1)
      // Sample number
    ])
  ]);
};
var mfro = () => {
  return fullBox("mfro", 0, 0, [
    // This value needs to be overwritten manually from the outside, where the actual size of the enclosing mfra box
    // is known
    u32(0)
    // Size
  ]);
};
var vtte = () => box("vtte");
var vttc = (payload, timestamp, identifier, settings, sourceId) => box("vttc", void 0, [
  sourceId !== null ? box("vsid", [i32(sourceId)]) : null,
  identifier !== null ? box("iden", [...textEncoder.encode(identifier)]) : null,
  timestamp !== null ? box("ctim", [...textEncoder.encode(formatSubtitleTimestamp(timestamp))]) : null,
  settings !== null ? box("sttg", [...textEncoder.encode(settings)]) : null,
  box("payl", [...textEncoder.encode(payload)])
]);
var vtta = (notes) => box("vtta", [...textEncoder.encode(notes)]);
var udta = (muxer) => {
  const boxes = [];
  const metadataFormat = muxer.format._options.metadataFormat ?? "auto";
  const metadataTags = muxer.output._metadataTags;
  if (metadataFormat === "mdir" || metadataFormat === "auto" && !muxer.isQuickTime) {
    const metaBox = metaMdir(metadataTags);
    if (metaBox)
      boxes.push(metaBox);
  } else if (metadataFormat === "mdta") {
    const metaBox = metaMdta(metadataTags);
    if (metaBox)
      boxes.push(metaBox);
  } else if (metadataFormat === "udta" || metadataFormat === "auto" && muxer.isQuickTime) {
    addQuickTimeMetadataTagBoxes(boxes, muxer.output._metadataTags);
  }
  if (boxes.length === 0) {
    return null;
  }
  return box("udta", void 0, boxes);
};
var addQuickTimeMetadataTagBoxes = (boxes, tags) => {
  for (const { key, value } of keyValueIterator(tags)) {
    switch (key) {
      case "title":
        {
          boxes.push(metadataTagStringBoxShort("\xA9nam", value));
        }
        ;
        break;
      case "description":
        {
          boxes.push(metadataTagStringBoxShort("\xA9des", value));
        }
        ;
        break;
      case "artist":
        {
          boxes.push(metadataTagStringBoxShort("\xA9ART", value));
        }
        ;
        break;
      case "album":
        {
          boxes.push(metadataTagStringBoxShort("\xA9alb", value));
        }
        ;
        break;
      case "albumArtist":
        {
          boxes.push(metadataTagStringBoxShort("albr", value));
        }
        ;
        break;
      case "genre":
        {
          boxes.push(metadataTagStringBoxShort("\xA9gen", value));
        }
        ;
        break;
      case "date":
        {
          boxes.push(metadataTagStringBoxShort("\xA9day", value.toISOString().slice(0, 10)));
        }
        ;
        break;
      case "comment":
        {
          boxes.push(metadataTagStringBoxShort("\xA9cmt", value));
        }
        ;
        break;
      case "lyrics":
        {
          boxes.push(metadataTagStringBoxShort("\xA9lyr", value));
        }
        ;
        break;
      case "raw":
        {
        }
        ;
        break;
      case "discNumber":
      case "discsTotal":
      case "trackNumber":
      case "tracksTotal":
      case "images":
        {
        }
        ;
        break;
      default:
        assertNever(key);
    }
  }
  if (tags.raw) {
    for (const key in tags.raw) {
      const value = tags.raw[key];
      if (value == null || key.length !== 4 || boxes.some((x) => x.type === key)) {
        continue;
      }
      if (typeof value === "string") {
        boxes.push(metadataTagStringBoxShort(key, value));
      } else if (value instanceof Uint8Array) {
        boxes.push(box(key, Array.from(value)));
      }
    }
  }
};
var metadataTagStringBoxShort = (name, value) => {
  const encoded = textEncoder.encode(value);
  return box(name, [
    u16(encoded.length),
    u16(getLanguageCodeInt("und")),
    Array.from(encoded)
  ]);
};
var DATA_BOX_MIME_TYPE_MAP = {
  "image/jpeg": 13,
  "image/png": 14,
  "image/bmp": 27
};
var generateMetadataPairs = (tags, isMdta) => {
  const pairs = [];
  for (const { key, value } of keyValueIterator(tags)) {
    switch (key) {
      case "title":
        {
          pairs.push({ key: isMdta ? "title" : "\xA9nam", value: dataStringBoxLong(value) });
        }
        ;
        break;
      case "description":
        {
          pairs.push({ key: isMdta ? "description" : "\xA9des", value: dataStringBoxLong(value) });
        }
        ;
        break;
      case "artist":
        {
          pairs.push({ key: isMdta ? "artist" : "\xA9ART", value: dataStringBoxLong(value) });
        }
        ;
        break;
      case "album":
        {
          pairs.push({ key: isMdta ? "album" : "\xA9alb", value: dataStringBoxLong(value) });
        }
        ;
        break;
      case "albumArtist":
        {
          pairs.push({ key: isMdta ? "album_artist" : "aART", value: dataStringBoxLong(value) });
        }
        ;
        break;
      case "comment":
        {
          pairs.push({ key: isMdta ? "comment" : "\xA9cmt", value: dataStringBoxLong(value) });
        }
        ;
        break;
      case "genre":
        {
          pairs.push({ key: isMdta ? "genre" : "\xA9gen", value: dataStringBoxLong(value) });
        }
        ;
        break;
      case "lyrics":
        {
          pairs.push({ key: isMdta ? "lyrics" : "\xA9lyr", value: dataStringBoxLong(value) });
        }
        ;
        break;
      case "date":
        {
          pairs.push({
            key: isMdta ? "date" : "\xA9day",
            value: dataStringBoxLong(value.toISOString().slice(0, 10))
          });
        }
        ;
        break;
      case "images":
        {
          for (const image of value) {
            if (image.kind !== "coverFront") {
              continue;
            }
            pairs.push({ key: "covr", value: box("data", [
              u32(DATA_BOX_MIME_TYPE_MAP[image.mimeType] ?? 0),
              // Type indicator
              u32(0),
              // Locale indicator
              Array.from(image.data)
              // Kinda slow, hopefully temp
            ]) });
          }
        }
        ;
        break;
      case "trackNumber":
        {
          if (isMdta) {
            const string = tags.tracksTotal !== void 0 ? `${value}/${tags.tracksTotal}` : value.toString();
            pairs.push({ key: "track", value: dataStringBoxLong(string) });
          } else {
            pairs.push({ key: "trkn", value: box("data", [
              u32(0),
              // 8 bytes empty
              u32(0),
              u16(0),
              // Empty
              u16(value),
              u16(tags.tracksTotal ?? 0),
              u16(0)
              // Empty
            ]) });
          }
        }
        ;
        break;
      case "discNumber":
        {
          if (!isMdta) {
            pairs.push({ key: "disc", value: box("data", [
              u32(0),
              // 8 bytes empty
              u32(0),
              u16(0),
              // Empty
              u16(value),
              u16(tags.discsTotal ?? 0),
              u16(0)
              // Empty
            ]) });
          }
        }
        ;
        break;
      case "tracksTotal":
      case "discsTotal":
        {
        }
        ;
        break;
      case "raw":
        {
        }
        ;
        break;
      default:
        assertNever(key);
    }
  }
  if (tags.raw) {
    for (const key in tags.raw) {
      const value = tags.raw[key];
      if (value == null || !isMdta && key.length !== 4 || pairs.some((x) => x.key === key)) {
        continue;
      }
      if (typeof value === "string") {
        pairs.push({ key, value: dataStringBoxLong(value) });
      } else if (value instanceof Uint8Array) {
        pairs.push({ key, value: box("data", [
          u32(0),
          // Type indicator
          u32(0),
          // Locale indicator
          Array.from(value)
        ]) });
      } else if (value instanceof RichImageData) {
        pairs.push({ key, value: box("data", [
          u32(DATA_BOX_MIME_TYPE_MAP[value.mimeType] ?? 0),
          // Type indicator
          u32(0),
          // Locale indicator
          Array.from(value.data)
          // Kinda slow, hopefully temp
        ]) });
      }
    }
  }
  return pairs;
};
var metaMdir = (tags) => {
  const pairs = generateMetadataPairs(tags, false);
  if (pairs.length === 0) {
    return null;
  }
  return fullBox("meta", 0, 0, void 0, [
    hdlr(false, "mdir", "", "appl"),
    // mdir handler
    box("ilst", void 0, pairs.map((pair) => box(pair.key, void 0, [pair.value])))
    // Item list without keys box
  ]);
};
var metaMdta = (tags) => {
  const pairs = generateMetadataPairs(tags, true);
  if (pairs.length === 0) {
    return null;
  }
  return box("meta", void 0, [
    hdlr(false, "mdta", ""),
    // mdta handler
    fullBox("keys", 0, 0, [
      u32(pairs.length)
    ], pairs.map((pair) => box("mdta", [
      ...textEncoder.encode(pair.key)
    ]))),
    box("ilst", void 0, pairs.map((pair, i) => {
      const boxName = String.fromCharCode(...u32(i + 1));
      return box(boxName, void 0, [pair.value]);
    }))
  ]);
};
var dataStringBoxLong = (value) => {
  return box("data", [
    u32(1),
    // Type indicator (UTF-8)
    u32(0),
    // Locale indicator
    ...textEncoder.encode(value)
  ]);
};
var videoCodecToBoxName = (codec, fullCodecString) => {
  switch (codec) {
    case "avc":
      return fullCodecString.startsWith("avc3") ? "avc3" : "avc1";
    case "hevc":
      return "hvc1";
    case "vp8":
      return "vp08";
    case "vp9":
      return "vp09";
    case "av1":
      return "av01";
  }
};
var VIDEO_CODEC_TO_CONFIGURATION_BOX = {
  avc: avcC,
  hevc: hvcC,
  vp8: vpcC,
  vp9: vpcC,
  av1: av1C
};
var audioCodecToBoxName = (codec, isQuickTime) => {
  switch (codec) {
    case "aac":
      return "mp4a";
    case "mp3":
      return "mp4a";
    case "opus":
      return "Opus";
    case "vorbis":
      return "mp4a";
    case "flac":
      return "fLaC";
    case "ulaw":
      return "ulaw";
    case "alaw":
      return "alaw";
    case "pcm-u8":
      return "raw ";
    case "pcm-s8":
      return "sowt";
    case "ac3":
      return "ac-3";
    case "eac3":
      return "ec-3";
  }
  if (isQuickTime) {
    switch (codec) {
      case "pcm-s16":
        return "sowt";
      case "pcm-s16be":
        return "twos";
      case "pcm-s24":
        return "in24";
      case "pcm-s24be":
        return "in24";
      case "pcm-s32":
        return "in32";
      case "pcm-s32be":
        return "in32";
      case "pcm-f32":
        return "fl32";
      case "pcm-f32be":
        return "fl32";
      case "pcm-f64":
        return "fl64";
      case "pcm-f64be":
        return "fl64";
    }
  } else {
    switch (codec) {
      case "pcm-s16":
        return "ipcm";
      case "pcm-s16be":
        return "ipcm";
      case "pcm-s24":
        return "ipcm";
      case "pcm-s24be":
        return "ipcm";
      case "pcm-s32":
        return "ipcm";
      case "pcm-s32be":
        return "ipcm";
      case "pcm-f32":
        return "fpcm";
      case "pcm-f32be":
        return "fpcm";
      case "pcm-f64":
        return "fpcm";
      case "pcm-f64be":
        return "fpcm";
    }
  }
};
var audioCodecToConfigurationBox = (codec, isQuickTime) => {
  switch (codec) {
    case "aac":
      return esds;
    case "mp3":
      return esds;
    case "opus":
      return dOps;
    case "vorbis":
      return esds;
    case "flac":
      return dfLa;
    case "ac3":
      return dac3;
    case "eac3":
      return dec3;
  }
  if (isQuickTime) {
    switch (codec) {
      case "pcm-s24":
        return wave;
      case "pcm-s24be":
        return wave;
      case "pcm-s32":
        return wave;
      case "pcm-s32be":
        return wave;
      case "pcm-f32":
        return wave;
      case "pcm-f32be":
        return wave;
      case "pcm-f64":
        return wave;
      case "pcm-f64be":
        return wave;
    }
  } else {
    switch (codec) {
      case "pcm-s16":
        return pcmC;
      case "pcm-s16be":
        return pcmC;
      case "pcm-s24":
        return pcmC;
      case "pcm-s24be":
        return pcmC;
      case "pcm-s32":
        return pcmC;
      case "pcm-s32be":
        return pcmC;
      case "pcm-f32":
        return pcmC;
      case "pcm-f32be":
        return pcmC;
      case "pcm-f64":
        return pcmC;
      case "pcm-f64be":
        return pcmC;
    }
  }
  return null;
};
var SUBTITLE_CODEC_TO_BOX_NAME = {
  webvtt: "wvtt"
};
var SUBTITLE_CODEC_TO_CONFIGURATION_BOX = {
  webvtt: vttC
};
var getLanguageCodeInt = (code) => {
  assert(code.length === 3);
  ;
  let language = 0;
  for (let i = 0; i < 3; i++) {
    language <<= 5;
    language += code.charCodeAt(i) - 96;
  }
  return language;
};

// node_modules/mediabunny/dist/modules/src/writer.js
var Writer = class {
  constructor() {
    this.ensureMonotonicity = false;
    this.trackedWrites = null;
    this.trackedStart = -1;
    this.trackedEnd = -1;
  }
  start() {
  }
  maybeTrackWrites(data) {
    if (!this.trackedWrites) {
      return;
    }
    let pos = this.getPos();
    if (pos < this.trackedStart) {
      if (pos + data.byteLength <= this.trackedStart) {
        return;
      }
      data = data.subarray(this.trackedStart - pos);
      pos = 0;
    }
    const neededSize = pos + data.byteLength - this.trackedStart;
    let newLength = this.trackedWrites.byteLength;
    while (newLength < neededSize) {
      newLength *= 2;
    }
    if (newLength !== this.trackedWrites.byteLength) {
      const copy = new Uint8Array(newLength);
      copy.set(this.trackedWrites, 0);
      this.trackedWrites = copy;
    }
    this.trackedWrites.set(data, pos - this.trackedStart);
    this.trackedEnd = Math.max(this.trackedEnd, pos + data.byteLength);
  }
  startTrackingWrites() {
    this.trackedWrites = new Uint8Array(2 ** 10);
    this.trackedStart = this.getPos();
    this.trackedEnd = this.trackedStart;
  }
  stopTrackingWrites() {
    if (!this.trackedWrites) {
      throw new Error("Internal error: Can't get tracked writes since nothing was tracked.");
    }
    const slice = this.trackedWrites.subarray(0, this.trackedEnd - this.trackedStart);
    const result = {
      data: slice,
      start: this.trackedStart,
      end: this.trackedEnd
    };
    this.trackedWrites = null;
    return result;
  }
};
var ARRAY_BUFFER_INITIAL_SIZE = 2 ** 16;
var ARRAY_BUFFER_MAX_SIZE = 2 ** 32;
var BufferTargetWriter = class extends Writer {
  constructor(target) {
    super();
    this.pos = 0;
    this.maxPos = 0;
    this.target = target;
    this.supportsResize = "resize" in new ArrayBuffer(0);
    if (this.supportsResize) {
      try {
        this.buffer = new ArrayBuffer(ARRAY_BUFFER_INITIAL_SIZE, { maxByteLength: ARRAY_BUFFER_MAX_SIZE });
      } catch {
        this.buffer = new ArrayBuffer(ARRAY_BUFFER_INITIAL_SIZE);
        this.supportsResize = false;
      }
    } else {
      this.buffer = new ArrayBuffer(ARRAY_BUFFER_INITIAL_SIZE);
    }
    this.bytes = new Uint8Array(this.buffer);
  }
  ensureSize(size) {
    let newLength = this.buffer.byteLength;
    while (newLength < size)
      newLength *= 2;
    if (newLength === this.buffer.byteLength)
      return;
    if (newLength > ARRAY_BUFFER_MAX_SIZE) {
      throw new Error(`ArrayBuffer exceeded maximum size of ${ARRAY_BUFFER_MAX_SIZE} bytes. Please consider using another target.`);
    }
    if (this.supportsResize) {
      this.buffer.resize(newLength);
    } else {
      const newBuffer = new ArrayBuffer(newLength);
      const newBytes = new Uint8Array(newBuffer);
      newBytes.set(this.bytes, 0);
      this.buffer = newBuffer;
      this.bytes = newBytes;
    }
  }
  write(data) {
    this.maybeTrackWrites(data);
    this.ensureSize(this.pos + data.byteLength);
    this.bytes.set(data, this.pos);
    this.target.onwrite?.(this.pos, this.pos + data.byteLength);
    this.pos += data.byteLength;
    this.maxPos = Math.max(this.maxPos, this.pos);
  }
  seek(newPos) {
    this.pos = newPos;
  }
  getPos() {
    return this.pos;
  }
  async flush() {
  }
  async finalize() {
    this.ensureSize(this.pos);
    this.target.buffer = this.buffer.slice(0, Math.max(this.maxPos, this.pos));
  }
  async close() {
  }
  getSlice(start, end) {
    return this.bytes.slice(start, end);
  }
};
var DEFAULT_CHUNK_SIZE = 2 ** 24;

// node_modules/mediabunny/dist/modules/src/target.js
var Target = class {
  constructor() {
    this._output = null;
    this.onwrite = null;
  }
};
var BufferTarget = class extends Target {
  constructor() {
    super(...arguments);
    this.buffer = null;
  }
  /** @internal */
  _createWriter() {
    return new BufferTargetWriter(this);
  }
};

// node_modules/mediabunny/dist/modules/src/isobmff/isobmff-muxer.js
var GLOBAL_TIMESCALE = 1e3;
var TIMESTAMP_OFFSET = 2082844800;
var getTrackMetadata = (trackData) => {
  const metadata = {};
  const track = trackData.track;
  if (track.metadata.name !== void 0) {
    metadata.name = track.metadata.name;
  }
  return metadata;
};
var intoTimescale = (timeInSeconds, timescale, round = true) => {
  const value = timeInSeconds * timescale;
  return round ? Math.round(value) : value;
};
var IsobmffMuxer = class extends Muxer {
  constructor(output, format) {
    super(output);
    this.auxTarget = new BufferTarget();
    this.auxWriter = this.auxTarget._createWriter();
    this.auxBoxWriter = new IsobmffBoxWriter(this.auxWriter);
    this.mdat = null;
    this.ftypSize = null;
    this.trackDatas = [];
    this.allTracksKnown = promiseWithResolvers();
    this.creationTime = Math.floor(Date.now() / 1e3) + TIMESTAMP_OFFSET;
    this.finalizedChunks = [];
    this.nextFragmentNumber = 1;
    this.maxWrittenTimestamp = -Infinity;
    this.format = format;
    this.writer = output._writer;
    this.boxWriter = new IsobmffBoxWriter(this.writer);
    this.isQuickTime = format instanceof MovOutputFormat;
    const fastStartDefault = this.writer instanceof BufferTargetWriter ? "in-memory" : false;
    this.fastStart = format._options.fastStart ?? fastStartDefault;
    this.isFragmented = this.fastStart === "fragmented";
    if (this.fastStart === "in-memory" || this.isFragmented) {
      this.writer.ensureMonotonicity = true;
    }
    this.minimumFragmentDuration = format._options.minimumFragmentDuration ?? 1;
  }
  async start() {
    const release = await this.mutex.acquire();
    const holdsAvc = this.output._tracks.some((x) => x.type === "video" && x.source._codec === "avc");
    {
      if (this.format._options.onFtyp) {
        this.writer.startTrackingWrites();
      }
      this.boxWriter.writeBox(ftyp({
        isQuickTime: this.isQuickTime,
        holdsAvc,
        fragmented: this.isFragmented
      }));
      if (this.format._options.onFtyp) {
        const { data, start } = this.writer.stopTrackingWrites();
        this.format._options.onFtyp(data, start);
      }
    }
    this.ftypSize = this.writer.getPos();
    if (this.fastStart === "in-memory") {
    } else if (this.fastStart === "reserve") {
      for (const track of this.output._tracks) {
        if (track.metadata.maximumPacketCount === void 0) {
          throw new Error("All tracks must specify maximumPacketCount in their metadata when using fastStart: 'reserve'.");
        }
      }
    } else if (this.isFragmented) {
    } else {
      if (this.format._options.onMdat) {
        this.writer.startTrackingWrites();
      }
      this.mdat = mdat(true);
      this.boxWriter.writeBox(this.mdat);
    }
    await this.writer.flush();
    release();
  }
  allTracksAreKnown() {
    for (const track of this.output._tracks) {
      if (!track.source._closed && !this.trackDatas.some((x) => x.track === track)) {
        return false;
      }
    }
    return true;
  }
  async getMimeType() {
    await this.allTracksKnown.promise;
    const codecStrings = this.trackDatas.map((trackData) => {
      if (trackData.type === "video") {
        return trackData.info.decoderConfig.codec;
      } else if (trackData.type === "audio") {
        return trackData.info.decoderConfig.codec;
      } else {
        const map = {
          webvtt: "wvtt"
        };
        return map[trackData.track.source._codec];
      }
    });
    return buildIsobmffMimeType({
      isQuickTime: this.isQuickTime,
      hasVideo: this.trackDatas.some((x) => x.type === "video"),
      hasAudio: this.trackDatas.some((x) => x.type === "audio"),
      codecStrings
    });
  }
  getVideoTrackData(track, packet, meta) {
    const existingTrackData = this.trackDatas.find((x) => x.track === track);
    if (existingTrackData) {
      return existingTrackData;
    }
    validateVideoChunkMetadata(meta);
    assert(meta);
    assert(meta.decoderConfig);
    const decoderConfig = { ...meta.decoderConfig };
    assert(decoderConfig.codedWidth !== void 0);
    assert(decoderConfig.codedHeight !== void 0);
    let requiresAnnexBTransformation = false;
    if (track.source._codec === "avc" && !decoderConfig.description) {
      const decoderConfigurationRecord = extractAvcDecoderConfigurationRecord(packet.data);
      if (!decoderConfigurationRecord) {
        throw new Error("Couldn't extract an AVCDecoderConfigurationRecord from the AVC packet. Make sure the packets are in Annex B format (as specified in ITU-T-REC-H.264) when not providing a description, or provide a description (must be an AVCDecoderConfigurationRecord as specified in ISO 14496-15) and ensure the packets are in AVCC format.");
      }
      decoderConfig.description = serializeAvcDecoderConfigurationRecord(decoderConfigurationRecord);
      requiresAnnexBTransformation = true;
    } else if (track.source._codec === "hevc" && !decoderConfig.description) {
      const decoderConfigurationRecord = extractHevcDecoderConfigurationRecord(packet.data);
      if (!decoderConfigurationRecord) {
        throw new Error("Couldn't extract an HEVCDecoderConfigurationRecord from the HEVC packet. Make sure the packets are in Annex B format (as specified in ITU-T-REC-H.265) when not providing a description, or provide a description (must be an HEVCDecoderConfigurationRecord as specified in ISO 14496-15) and ensure the packets are in HEVC format.");
      }
      decoderConfig.description = serializeHevcDecoderConfigurationRecord(decoderConfigurationRecord);
      requiresAnnexBTransformation = true;
    }
    const timescale = computeRationalApproximation(1 / (track.metadata.frameRate ?? 57600), 1e6).denominator;
    const displayAspectWidth = decoderConfig.displayAspectWidth;
    const displayAspectHeight = decoderConfig.displayAspectHeight;
    const pixelAspectRatio = displayAspectWidth === void 0 || displayAspectHeight === void 0 ? { num: 1, den: 1 } : simplifyRational({
      num: displayAspectWidth * decoderConfig.codedHeight,
      den: displayAspectHeight * decoderConfig.codedWidth
    });
    const newTrackData = {
      muxer: this,
      track,
      type: "video",
      info: {
        width: decoderConfig.codedWidth,
        height: decoderConfig.codedHeight,
        pixelAspectRatio,
        decoderConfig,
        requiresAnnexBTransformation
      },
      timescale,
      samples: [],
      sampleQueue: [],
      timestampProcessingQueue: [],
      timeToSampleTable: [],
      compositionTimeOffsetTable: [],
      lastTimescaleUnits: null,
      lastSample: null,
      finalizedChunks: [],
      currentChunk: null,
      compactlyCodedChunkTable: []
    };
    this.trackDatas.push(newTrackData);
    this.trackDatas.sort((a, b) => a.track.id - b.track.id);
    if (this.allTracksAreKnown()) {
      this.allTracksKnown.resolve();
    }
    return newTrackData;
  }
  getAudioTrackData(track, packet, meta) {
    const existingTrackData = this.trackDatas.find((x) => x.track === track);
    if (existingTrackData) {
      return existingTrackData;
    }
    validateAudioChunkMetadata(meta);
    assert(meta);
    assert(meta.decoderConfig);
    const decoderConfig = { ...meta.decoderConfig };
    let requiresAdtsStripping = false;
    if (track.source._codec === "aac" && !decoderConfig.description) {
      const adtsFrame = readAdtsFrameHeader(FileSlice.tempFromBytes(packet.data));
      if (!adtsFrame) {
        throw new Error("Couldn't parse ADTS header from the AAC packet. Make sure the packets are in ADTS format (as specified in ISO 13818-7) when not providing a description, or provide a description (must be an AudioSpecificConfig as specified in ISO 14496-3) and ensure the packets are raw AAC data.");
      }
      const sampleRate = aacFrequencyTable[adtsFrame.samplingFrequencyIndex];
      const numberOfChannels = aacChannelMap[adtsFrame.channelConfiguration];
      if (sampleRate === void 0 || numberOfChannels === void 0) {
        throw new Error("Invalid ADTS frame header.");
      }
      decoderConfig.description = buildAacAudioSpecificConfig({
        objectType: adtsFrame.objectType,
        sampleRate,
        numberOfChannels
      });
      requiresAdtsStripping = true;
    }
    const newTrackData = {
      muxer: this,
      track,
      type: "audio",
      info: {
        numberOfChannels: meta.decoderConfig.numberOfChannels,
        sampleRate: meta.decoderConfig.sampleRate,
        decoderConfig,
        requiresPcmTransformation: !this.isFragmented && PCM_AUDIO_CODECS.includes(track.source._codec),
        requiresAdtsStripping,
        firstPacket: packet
      },
      timescale: decoderConfig.sampleRate,
      samples: [],
      sampleQueue: [],
      timestampProcessingQueue: [],
      timeToSampleTable: [],
      compositionTimeOffsetTable: [],
      lastTimescaleUnits: null,
      lastSample: null,
      finalizedChunks: [],
      currentChunk: null,
      compactlyCodedChunkTable: []
    };
    this.trackDatas.push(newTrackData);
    this.trackDatas.sort((a, b) => a.track.id - b.track.id);
    if (this.allTracksAreKnown()) {
      this.allTracksKnown.resolve();
    }
    return newTrackData;
  }
  getSubtitleTrackData(track, meta) {
    const existingTrackData = this.trackDatas.find((x) => x.track === track);
    if (existingTrackData) {
      return existingTrackData;
    }
    validateSubtitleMetadata(meta);
    assert(meta);
    assert(meta.config);
    const newTrackData = {
      muxer: this,
      track,
      type: "subtitle",
      info: {
        config: meta.config
      },
      timescale: 1e3,
      // Reasonable
      samples: [],
      sampleQueue: [],
      timestampProcessingQueue: [],
      timeToSampleTable: [],
      compositionTimeOffsetTable: [],
      lastTimescaleUnits: null,
      lastSample: null,
      finalizedChunks: [],
      currentChunk: null,
      compactlyCodedChunkTable: [],
      lastCueEndTimestamp: 0,
      cueQueue: [],
      nextSourceId: 0,
      cueToSourceId: /* @__PURE__ */ new WeakMap()
    };
    this.trackDatas.push(newTrackData);
    this.trackDatas.sort((a, b) => a.track.id - b.track.id);
    if (this.allTracksAreKnown()) {
      this.allTracksKnown.resolve();
    }
    return newTrackData;
  }
  async addEncodedVideoPacket(track, packet, meta) {
    const release = await this.mutex.acquire();
    try {
      const trackData = this.getVideoTrackData(track, packet, meta);
      let packetData = packet.data;
      if (trackData.info.requiresAnnexBTransformation) {
        const nalUnits = [...iterateNalUnitsInAnnexB(packetData)].map((loc) => packetData.subarray(loc.offset, loc.offset + loc.length));
        if (nalUnits.length === 0) {
          throw new Error("Failed to transform packet data. Make sure all packets are provided in Annex B format, as specified in ITU-T-REC-H.264 and ITU-T-REC-H.265.");
        }
        packetData = concatNalUnitsInLengthPrefixed(nalUnits, 4);
      }
      const timestamp = this.validateAndNormalizeTimestamp(trackData.track, packet.timestamp, packet.type === "key");
      const internalSample = this.createSampleForTrack(trackData, packetData, timestamp, packet.duration, packet.type);
      await this.registerSample(trackData, internalSample);
    } finally {
      release();
    }
  }
  async addEncodedAudioPacket(track, packet, meta) {
    const release = await this.mutex.acquire();
    try {
      const trackData = this.getAudioTrackData(track, packet, meta);
      let packetData = packet.data;
      if (trackData.info.requiresAdtsStripping) {
        const adtsFrame = readAdtsFrameHeader(FileSlice.tempFromBytes(packetData));
        if (!adtsFrame) {
          throw new Error("Expected ADTS frame, didn't get one.");
        }
        const headerLength = adtsFrame.crcCheck === null ? MIN_ADTS_FRAME_HEADER_SIZE : MAX_ADTS_FRAME_HEADER_SIZE;
        packetData = packetData.subarray(headerLength);
      }
      const timestamp = this.validateAndNormalizeTimestamp(trackData.track, packet.timestamp, packet.type === "key");
      const internalSample = this.createSampleForTrack(trackData, packetData, timestamp, packet.duration, packet.type);
      if (trackData.info.requiresPcmTransformation) {
        await this.maybePadWithSilence(trackData, timestamp);
      }
      await this.registerSample(trackData, internalSample);
    } finally {
      release();
    }
  }
  async maybePadWithSilence(trackData, untilTimestamp) {
    const lastSample = last(trackData.samples);
    const lastEndTimestamp = lastSample ? lastSample.timestamp + lastSample.duration : 0;
    const delta = untilTimestamp - lastEndTimestamp;
    const deltaInTimescale = intoTimescale(delta, trackData.timescale);
    if (deltaInTimescale > 0) {
      const { sampleSize, silentValue } = parsePcmCodec(trackData.info.decoderConfig.codec);
      const samplesNeeded = deltaInTimescale * trackData.info.numberOfChannels;
      const data = new Uint8Array(sampleSize * samplesNeeded).fill(silentValue);
      const paddingSample = this.createSampleForTrack(trackData, new Uint8Array(data.buffer), lastEndTimestamp, delta, "key");
      await this.registerSample(trackData, paddingSample);
    }
  }
  async addSubtitleCue(track, cue, meta) {
    const release = await this.mutex.acquire();
    try {
      const trackData = this.getSubtitleTrackData(track, meta);
      this.validateAndNormalizeTimestamp(trackData.track, cue.timestamp, true);
      if (track.source._codec === "webvtt") {
        trackData.cueQueue.push(cue);
        await this.processWebVTTCues(trackData, cue.timestamp);
      } else {
      }
    } finally {
      release();
    }
  }
  async processWebVTTCues(trackData, until) {
    while (trackData.cueQueue.length > 0) {
      const timestamps = /* @__PURE__ */ new Set([]);
      for (const cue of trackData.cueQueue) {
        assert(cue.timestamp <= until);
        assert(trackData.lastCueEndTimestamp <= cue.timestamp + cue.duration);
        timestamps.add(Math.max(cue.timestamp, trackData.lastCueEndTimestamp));
        timestamps.add(cue.timestamp + cue.duration);
      }
      const sortedTimestamps = [...timestamps].sort((a, b) => a - b);
      const sampleStart = sortedTimestamps[0];
      const sampleEnd = sortedTimestamps[1] ?? sampleStart;
      if (until < sampleEnd) {
        break;
      }
      if (trackData.lastCueEndTimestamp < sampleStart) {
        this.auxWriter.seek(0);
        const box2 = vtte();
        this.auxBoxWriter.writeBox(box2);
        const body2 = this.auxWriter.getSlice(0, this.auxWriter.getPos());
        const sample2 = this.createSampleForTrack(trackData, body2, trackData.lastCueEndTimestamp, sampleStart - trackData.lastCueEndTimestamp, "key");
        await this.registerSample(trackData, sample2);
        trackData.lastCueEndTimestamp = sampleStart;
      }
      this.auxWriter.seek(0);
      for (let i = 0; i < trackData.cueQueue.length; i++) {
        const cue = trackData.cueQueue[i];
        if (cue.timestamp >= sampleEnd) {
          break;
        }
        inlineTimestampRegex.lastIndex = 0;
        const containsTimestamp = inlineTimestampRegex.test(cue.text);
        const endTimestamp = cue.timestamp + cue.duration;
        let sourceId = trackData.cueToSourceId.get(cue);
        if (sourceId === void 0 && sampleEnd < endTimestamp) {
          sourceId = trackData.nextSourceId++;
          trackData.cueToSourceId.set(cue, sourceId);
        }
        if (cue.notes) {
          const box3 = vtta(cue.notes);
          this.auxBoxWriter.writeBox(box3);
        }
        const box2 = vttc(cue.text, containsTimestamp ? sampleStart : null, cue.identifier ?? null, cue.settings ?? null, sourceId ?? null);
        this.auxBoxWriter.writeBox(box2);
        if (endTimestamp === sampleEnd) {
          trackData.cueQueue.splice(i--, 1);
        }
      }
      const body = this.auxWriter.getSlice(0, this.auxWriter.getPos());
      const sample = this.createSampleForTrack(trackData, body, sampleStart, sampleEnd - sampleStart, "key");
      await this.registerSample(trackData, sample);
      trackData.lastCueEndTimestamp = sampleEnd;
    }
  }
  createSampleForTrack(trackData, data, timestamp, duration, type) {
    const sample = {
      timestamp,
      decodeTimestamp: timestamp,
      // This may be refined later
      duration,
      data,
      size: data.byteLength,
      type,
      timescaleUnitsToNextSample: intoTimescale(duration, trackData.timescale)
      // Will be refined
    };
    return sample;
  }
  processTimestamps(trackData, nextSample) {
    if (trackData.timestampProcessingQueue.length === 0) {
      return;
    }
    if (trackData.type === "audio" && trackData.info.requiresPcmTransformation) {
      let totalDuration = 0;
      for (let i = 0; i < trackData.timestampProcessingQueue.length; i++) {
        const sample = trackData.timestampProcessingQueue[i];
        const duration = intoTimescale(sample.duration, trackData.timescale);
        totalDuration += duration;
      }
      if (trackData.timeToSampleTable.length === 0) {
        trackData.timeToSampleTable.push({
          sampleCount: totalDuration,
          sampleDelta: 1
        });
      } else {
        const lastEntry = last(trackData.timeToSampleTable);
        lastEntry.sampleCount += totalDuration;
      }
      trackData.timestampProcessingQueue.length = 0;
      return;
    }
    const sortedTimestamps = trackData.timestampProcessingQueue.map((x) => x.timestamp).sort((a, b) => a - b);
    for (let i = 0; i < trackData.timestampProcessingQueue.length; i++) {
      const sample = trackData.timestampProcessingQueue[i];
      sample.decodeTimestamp = sortedTimestamps[i];
      if (!this.isFragmented && trackData.lastTimescaleUnits === null) {
        sample.decodeTimestamp = 0;
      }
      const sampleCompositionTimeOffset = intoTimescale(sample.timestamp - sample.decodeTimestamp, trackData.timescale);
      const durationInTimescale = intoTimescale(sample.duration, trackData.timescale);
      if (trackData.lastTimescaleUnits !== null) {
        assert(trackData.lastSample);
        const timescaleUnits = intoTimescale(sample.decodeTimestamp, trackData.timescale, false);
        const delta = Math.round(timescaleUnits - trackData.lastTimescaleUnits);
        assert(delta >= 0);
        trackData.lastTimescaleUnits += delta;
        trackData.lastSample.timescaleUnitsToNextSample = delta;
        if (!this.isFragmented) {
          let lastTableEntry = last(trackData.timeToSampleTable);
          assert(lastTableEntry);
          if (lastTableEntry.sampleCount === 1) {
            lastTableEntry.sampleDelta = delta;
            const entryBefore = trackData.timeToSampleTable[trackData.timeToSampleTable.length - 2];
            if (entryBefore && entryBefore.sampleDelta === delta) {
              entryBefore.sampleCount++;
              trackData.timeToSampleTable.pop();
              lastTableEntry = entryBefore;
            }
          } else if (lastTableEntry.sampleDelta !== delta) {
            lastTableEntry.sampleCount--;
            trackData.timeToSampleTable.push(lastTableEntry = {
              sampleCount: 1,
              sampleDelta: delta
            });
          }
          if (lastTableEntry.sampleDelta === durationInTimescale) {
            lastTableEntry.sampleCount++;
          } else {
            trackData.timeToSampleTable.push({
              sampleCount: 1,
              sampleDelta: durationInTimescale
            });
          }
          const lastCompositionTimeOffsetTableEntry = last(trackData.compositionTimeOffsetTable);
          assert(lastCompositionTimeOffsetTableEntry);
          if (lastCompositionTimeOffsetTableEntry.sampleCompositionTimeOffset === sampleCompositionTimeOffset) {
            lastCompositionTimeOffsetTableEntry.sampleCount++;
          } else {
            trackData.compositionTimeOffsetTable.push({
              sampleCount: 1,
              sampleCompositionTimeOffset
            });
          }
        }
      } else {
        trackData.lastTimescaleUnits = intoTimescale(sample.decodeTimestamp, trackData.timescale, false);
        if (!this.isFragmented) {
          trackData.timeToSampleTable.push({
            sampleCount: 1,
            sampleDelta: durationInTimescale
          });
          trackData.compositionTimeOffsetTable.push({
            sampleCount: 1,
            sampleCompositionTimeOffset
          });
        }
      }
      trackData.lastSample = sample;
    }
    trackData.timestampProcessingQueue.length = 0;
    assert(trackData.lastSample);
    assert(trackData.lastTimescaleUnits !== null);
    if (nextSample !== void 0 && trackData.lastSample.timescaleUnitsToNextSample === 0) {
      assert(nextSample.type === "key");
      const timescaleUnits = intoTimescale(nextSample.timestamp, trackData.timescale, false);
      const delta = Math.round(timescaleUnits - trackData.lastTimescaleUnits);
      trackData.lastSample.timescaleUnitsToNextSample = delta;
    }
  }
  async registerSample(trackData, sample) {
    if (sample.type === "key") {
      this.processTimestamps(trackData, sample);
    }
    trackData.timestampProcessingQueue.push(sample);
    if (this.isFragmented) {
      trackData.sampleQueue.push(sample);
      await this.interleaveSamples();
    } else if (this.fastStart === "reserve") {
      await this.registerSampleFastStartReserve(trackData, sample);
    } else {
      await this.addSampleToTrack(trackData, sample);
    }
  }
  async addSampleToTrack(trackData, sample) {
    if (!this.isFragmented) {
      trackData.samples.push(sample);
      if (this.fastStart === "reserve") {
        const maximumPacketCount = trackData.track.metadata.maximumPacketCount;
        assert(maximumPacketCount !== void 0);
        if (trackData.samples.length > maximumPacketCount) {
          throw new Error(`Track #${trackData.track.id} has already reached the maximum packet count (${maximumPacketCount}). Either add less packets or increase the maximum packet count.`);
        }
      }
    }
    let beginNewChunk = false;
    if (!trackData.currentChunk) {
      beginNewChunk = true;
    } else {
      trackData.currentChunk.startTimestamp = Math.min(trackData.currentChunk.startTimestamp, sample.timestamp);
      const currentChunkDuration = sample.timestamp - trackData.currentChunk.startTimestamp;
      if (this.isFragmented) {
        const keyFrameQueuedEverywhere = this.trackDatas.every((otherTrackData) => {
          if (trackData === otherTrackData) {
            return sample.type === "key";
          }
          const firstQueuedSample = otherTrackData.sampleQueue[0];
          if (firstQueuedSample) {
            return firstQueuedSample.type === "key";
          }
          return otherTrackData.track.source._closed;
        });
        if (currentChunkDuration >= this.minimumFragmentDuration && keyFrameQueuedEverywhere && sample.timestamp > this.maxWrittenTimestamp) {
          beginNewChunk = true;
          await this.finalizeFragment();
        }
      } else {
        beginNewChunk = currentChunkDuration >= 0.5;
      }
    }
    if (beginNewChunk) {
      if (trackData.currentChunk) {
        await this.finalizeCurrentChunk(trackData);
      }
      trackData.currentChunk = {
        startTimestamp: sample.timestamp,
        samples: [],
        offset: null,
        moofOffset: null
      };
    }
    assert(trackData.currentChunk);
    trackData.currentChunk.samples.push(sample);
    if (this.isFragmented) {
      this.maxWrittenTimestamp = Math.max(this.maxWrittenTimestamp, sample.timestamp);
    }
  }
  async finalizeCurrentChunk(trackData) {
    assert(!this.isFragmented);
    if (!trackData.currentChunk)
      return;
    trackData.finalizedChunks.push(trackData.currentChunk);
    this.finalizedChunks.push(trackData.currentChunk);
    let sampleCount = trackData.currentChunk.samples.length;
    if (trackData.type === "audio" && trackData.info.requiresPcmTransformation) {
      sampleCount = trackData.currentChunk.samples.reduce((acc, sample) => acc + intoTimescale(sample.duration, trackData.timescale), 0);
    }
    if (trackData.compactlyCodedChunkTable.length === 0 || last(trackData.compactlyCodedChunkTable).samplesPerChunk !== sampleCount) {
      trackData.compactlyCodedChunkTable.push({
        firstChunk: trackData.finalizedChunks.length,
        // 1-indexed
        samplesPerChunk: sampleCount
      });
    }
    if (this.fastStart === "in-memory") {
      trackData.currentChunk.offset = 0;
      return;
    }
    trackData.currentChunk.offset = this.writer.getPos();
    for (const sample of trackData.currentChunk.samples) {
      assert(sample.data);
      this.writer.write(sample.data);
      sample.data = null;
    }
    await this.writer.flush();
  }
  async interleaveSamples(isFinalCall = false) {
    assert(this.isFragmented);
    if (!isFinalCall && !this.allTracksAreKnown()) {
      return;
    }
    outer: while (true) {
      let trackWithMinTimestamp = null;
      let minTimestamp = Infinity;
      for (const trackData of this.trackDatas) {
        if (!isFinalCall && trackData.sampleQueue.length === 0 && !trackData.track.source._closed) {
          break outer;
        }
        if (trackData.sampleQueue.length > 0 && trackData.sampleQueue[0].timestamp < minTimestamp) {
          trackWithMinTimestamp = trackData;
          minTimestamp = trackData.sampleQueue[0].timestamp;
        }
      }
      if (!trackWithMinTimestamp) {
        break;
      }
      const sample = trackWithMinTimestamp.sampleQueue.shift();
      await this.addSampleToTrack(trackWithMinTimestamp, sample);
    }
  }
  async finalizeFragment(flushWriter = true) {
    assert(this.isFragmented);
    const fragmentNumber = this.nextFragmentNumber++;
    if (fragmentNumber === 1) {
      if (this.format._options.onMoov) {
        this.writer.startTrackingWrites();
      }
      const movieBox = moov(this);
      this.boxWriter.writeBox(movieBox);
      if (this.format._options.onMoov) {
        const { data, start } = this.writer.stopTrackingWrites();
        this.format._options.onMoov(data, start);
      }
    }
    const tracksInFragment = this.trackDatas.filter((x) => x.currentChunk);
    const moofBox = moof(fragmentNumber, tracksInFragment);
    const moofOffset = this.writer.getPos();
    const mdatStartPos = moofOffset + this.boxWriter.measureBox(moofBox);
    let currentPos = mdatStartPos + MIN_BOX_HEADER_SIZE;
    let fragmentStartTimestamp = Infinity;
    for (const trackData of tracksInFragment) {
      trackData.currentChunk.offset = currentPos;
      trackData.currentChunk.moofOffset = moofOffset;
      for (const sample of trackData.currentChunk.samples) {
        currentPos += sample.size;
      }
      fragmentStartTimestamp = Math.min(fragmentStartTimestamp, trackData.currentChunk.startTimestamp);
    }
    const mdatSize = currentPos - mdatStartPos;
    const needsLargeMdatSize = mdatSize >= 2 ** 32;
    if (needsLargeMdatSize) {
      for (const trackData of tracksInFragment) {
        trackData.currentChunk.offset += MAX_BOX_HEADER_SIZE - MIN_BOX_HEADER_SIZE;
      }
    }
    if (this.format._options.onMoof) {
      this.writer.startTrackingWrites();
    }
    const newMoofBox = moof(fragmentNumber, tracksInFragment);
    this.boxWriter.writeBox(newMoofBox);
    if (this.format._options.onMoof) {
      const { data, start } = this.writer.stopTrackingWrites();
      this.format._options.onMoof(data, start, fragmentStartTimestamp);
    }
    assert(this.writer.getPos() === mdatStartPos);
    if (this.format._options.onMdat) {
      this.writer.startTrackingWrites();
    }
    const mdatBox = mdat(needsLargeMdatSize);
    mdatBox.size = mdatSize;
    this.boxWriter.writeBox(mdatBox);
    this.writer.seek(mdatStartPos + (needsLargeMdatSize ? MAX_BOX_HEADER_SIZE : MIN_BOX_HEADER_SIZE));
    for (const trackData of tracksInFragment) {
      for (const sample of trackData.currentChunk.samples) {
        this.writer.write(sample.data);
        sample.data = null;
      }
    }
    if (this.format._options.onMdat) {
      const { data, start } = this.writer.stopTrackingWrites();
      this.format._options.onMdat(data, start);
    }
    for (const trackData of tracksInFragment) {
      trackData.finalizedChunks.push(trackData.currentChunk);
      this.finalizedChunks.push(trackData.currentChunk);
      trackData.currentChunk = null;
    }
    if (flushWriter) {
      await this.writer.flush();
    }
  }
  async registerSampleFastStartReserve(trackData, sample) {
    if (this.allTracksAreKnown()) {
      if (!this.mdat) {
        const moovBox = moov(this);
        const moovSize = this.boxWriter.measureBox(moovBox);
        const reservedSize = moovSize + this.computeSampleTableSizeUpperBound() + 4096;
        assert(this.ftypSize !== null);
        this.writer.seek(this.ftypSize + reservedSize);
        if (this.format._options.onMdat) {
          this.writer.startTrackingWrites();
        }
        this.mdat = mdat(true);
        this.boxWriter.writeBox(this.mdat);
        for (const trackData2 of this.trackDatas) {
          for (const sample2 of trackData2.sampleQueue) {
            await this.addSampleToTrack(trackData2, sample2);
          }
          trackData2.sampleQueue.length = 0;
        }
      }
      await this.addSampleToTrack(trackData, sample);
    } else {
      trackData.sampleQueue.push(sample);
    }
  }
  computeSampleTableSizeUpperBound() {
    assert(this.fastStart === "reserve");
    let upperBound = 0;
    for (const trackData of this.trackDatas) {
      const n = trackData.track.metadata.maximumPacketCount;
      assert(n !== void 0);
      upperBound += (4 + 4) * Math.ceil(2 / 3 * n);
      upperBound += 4 * n;
      upperBound += (4 + 4) * Math.ceil(2 / 3 * n);
      upperBound += (4 + 4 + 4) * Math.ceil(2 / 3 * n);
      upperBound += 4 * n;
      upperBound += 8 * n;
    }
    return upperBound;
  }
  // eslint-disable-next-line @typescript-eslint/no-misused-promises
  async onTrackClose(track) {
    const release = await this.mutex.acquire();
    const trackData = this.trackDatas.find((x) => x.track === track);
    if (trackData) {
      if (trackData.type === "subtitle" && track.source._codec === "webvtt") {
        await this.processWebVTTCues(trackData, Infinity);
      }
      this.processTimestamps(trackData);
    }
    if (this.allTracksAreKnown()) {
      this.allTracksKnown.resolve();
    }
    if (this.isFragmented) {
      await this.interleaveSamples();
    }
    release();
  }
  /** Finalizes the file, making it ready for use. Must be called after all video and audio chunks have been added. */
  async finalize() {
    const release = await this.mutex.acquire();
    this.allTracksKnown.resolve();
    for (const trackData of this.trackDatas) {
      if (trackData.type === "subtitle" && trackData.track.source._codec === "webvtt") {
        await this.processWebVTTCues(trackData, Infinity);
      }
      this.processTimestamps(trackData);
    }
    if (this.isFragmented) {
      await this.interleaveSamples(true);
      await this.finalizeFragment(false);
    } else {
      for (const trackData of this.trackDatas) {
        await this.finalizeCurrentChunk(trackData);
      }
    }
    if (this.fastStart === "in-memory") {
      this.mdat = mdat(false);
      let mdatSize;
      for (let i = 0; i < 2; i++) {
        const movieBox2 = moov(this);
        const movieBoxSize = this.boxWriter.measureBox(movieBox2);
        mdatSize = this.boxWriter.measureBox(this.mdat);
        let currentChunkPos = this.writer.getPos() + movieBoxSize + mdatSize;
        for (const chunk of this.finalizedChunks) {
          chunk.offset = currentChunkPos;
          for (const { data } of chunk.samples) {
            assert(data);
            currentChunkPos += data.byteLength;
            mdatSize += data.byteLength;
          }
        }
        if (currentChunkPos < 2 ** 32)
          break;
        if (mdatSize >= 2 ** 32)
          this.mdat.largeSize = true;
      }
      if (this.format._options.onMoov) {
        this.writer.startTrackingWrites();
      }
      const movieBox = moov(this);
      this.boxWriter.writeBox(movieBox);
      if (this.format._options.onMoov) {
        const { data, start } = this.writer.stopTrackingWrites();
        this.format._options.onMoov(data, start);
      }
      if (this.format._options.onMdat) {
        this.writer.startTrackingWrites();
      }
      this.mdat.size = mdatSize;
      this.boxWriter.writeBox(this.mdat);
      for (const chunk of this.finalizedChunks) {
        for (const sample of chunk.samples) {
          assert(sample.data);
          this.writer.write(sample.data);
          sample.data = null;
        }
      }
      if (this.format._options.onMdat) {
        const { data, start } = this.writer.stopTrackingWrites();
        this.format._options.onMdat(data, start);
      }
    } else if (this.isFragmented) {
      const startPos = this.writer.getPos();
      const mfraBox = mfra(this.trackDatas);
      this.boxWriter.writeBox(mfraBox);
      const mfraBoxSize = this.writer.getPos() - startPos;
      this.writer.seek(this.writer.getPos() - 4);
      this.boxWriter.writeU32(mfraBoxSize);
    } else {
      assert(this.mdat);
      const mdatPos = this.boxWriter.offsets.get(this.mdat);
      assert(mdatPos !== void 0);
      const mdatSize = this.writer.getPos() - mdatPos;
      this.mdat.size = mdatSize;
      this.mdat.largeSize = mdatSize >= 2 ** 32;
      this.boxWriter.patchBox(this.mdat);
      if (this.format._options.onMdat) {
        const { data, start } = this.writer.stopTrackingWrites();
        this.format._options.onMdat(data, start);
      }
      const movieBox = moov(this);
      if (this.fastStart === "reserve") {
        assert(this.ftypSize !== null);
        this.writer.seek(this.ftypSize);
        if (this.format._options.onMoov) {
          this.writer.startTrackingWrites();
        }
        this.boxWriter.writeBox(movieBox);
        const remainingSpace = this.boxWriter.offsets.get(this.mdat) - this.writer.getPos();
        this.boxWriter.writeBox(free(remainingSpace));
      } else {
        if (this.format._options.onMoov) {
          this.writer.startTrackingWrites();
        }
        this.boxWriter.writeBox(movieBox);
      }
      if (this.format._options.onMoov) {
        const { data, start } = this.writer.stopTrackingWrites();
        this.format._options.onMoov(data, start);
      }
    }
    release();
  }
};

// node_modules/mediabunny/dist/modules/src/output-format.js
var OutputFormat = class {
  /** Returns a list of video codecs that this output format can contain. */
  getSupportedVideoCodecs() {
    return this.getSupportedCodecs().filter((codec) => VIDEO_CODECS.includes(codec));
  }
  /** Returns a list of audio codecs that this output format can contain. */
  getSupportedAudioCodecs() {
    return this.getSupportedCodecs().filter((codec) => AUDIO_CODECS.includes(codec));
  }
  /** Returns a list of subtitle codecs that this output format can contain. */
  getSupportedSubtitleCodecs() {
    return this.getSupportedCodecs().filter((codec) => SUBTITLE_CODECS.includes(codec));
  }
  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _codecUnsupportedHint(codec) {
    return "";
  }
};
var IsobmffOutputFormat = class extends OutputFormat {
  /** Internal constructor. */
  constructor(options = {}) {
    if (!options || typeof options !== "object") {
      throw new TypeError("options must be an object.");
    }
    if (options.fastStart !== void 0 && ![false, "in-memory", "reserve", "fragmented"].includes(options.fastStart)) {
      throw new TypeError("options.fastStart, when provided, must be false, 'in-memory', 'reserve', or 'fragmented'.");
    }
    if (options.minimumFragmentDuration !== void 0 && (!Number.isFinite(options.minimumFragmentDuration) || options.minimumFragmentDuration < 0)) {
      throw new TypeError("options.minimumFragmentDuration, when provided, must be a non-negative number.");
    }
    if (options.onFtyp !== void 0 && typeof options.onFtyp !== "function") {
      throw new TypeError("options.onFtyp, when provided, must be a function.");
    }
    if (options.onMoov !== void 0 && typeof options.onMoov !== "function") {
      throw new TypeError("options.onMoov, when provided, must be a function.");
    }
    if (options.onMdat !== void 0 && typeof options.onMdat !== "function") {
      throw new TypeError("options.onMdat, when provided, must be a function.");
    }
    if (options.onMoof !== void 0 && typeof options.onMoof !== "function") {
      throw new TypeError("options.onMoof, when provided, must be a function.");
    }
    if (options.metadataFormat !== void 0 && !["mdir", "mdta", "udta", "auto"].includes(options.metadataFormat)) {
      throw new TypeError("options.metadataFormat, when provided, must be either 'auto', 'mdir', 'mdta', or 'udta'.");
    }
    super();
    this._options = options;
  }
  getSupportedTrackCounts() {
    const max = 2 ** 32 - 1;
    return {
      video: { min: 0, max },
      audio: { min: 0, max },
      subtitle: { min: 0, max },
      total: { min: 1, max }
    };
  }
  get supportsVideoRotationMetadata() {
    return true;
  }
  get supportsTimestampedMediaData() {
    return true;
  }
  /** @internal */
  _createMuxer(output) {
    return new IsobmffMuxer(output, this);
  }
};
var Mp4OutputFormat = class extends IsobmffOutputFormat {
  /** Creates a new {@link Mp4OutputFormat} configured with the specified `options`. */
  constructor(options) {
    super(options);
  }
  /** @internal */
  get _name() {
    return "MP4";
  }
  get fileExtension() {
    return ".mp4";
  }
  get mimeType() {
    return "video/mp4";
  }
  getSupportedCodecs() {
    return [
      ...VIDEO_CODECS,
      ...NON_PCM_AUDIO_CODECS,
      // These are supported via ISO/IEC 23003-5:
      "pcm-s16",
      "pcm-s16be",
      "pcm-s24",
      "pcm-s24be",
      "pcm-s32",
      "pcm-s32be",
      "pcm-f32",
      "pcm-f32be",
      "pcm-f64",
      "pcm-f64be",
      ...SUBTITLE_CODECS
    ];
  }
  /** @internal */
  _codecUnsupportedHint(codec) {
    if (new MovOutputFormat().getSupportedCodecs().includes(codec)) {
      return " Switching to MOV will grant support for this codec.";
    }
    return "";
  }
};
var MovOutputFormat = class extends IsobmffOutputFormat {
  /** Creates a new {@link MovOutputFormat} configured with the specified `options`. */
  constructor(options) {
    super(options);
  }
  /** @internal */
  get _name() {
    return "MOV";
  }
  get fileExtension() {
    return ".mov";
  }
  get mimeType() {
    return "video/quicktime";
  }
  getSupportedCodecs() {
    return [
      ...VIDEO_CODECS,
      ...AUDIO_CODECS
    ];
  }
  /** @internal */
  _codecUnsupportedHint(codec) {
    if (new Mp4OutputFormat().getSupportedCodecs().includes(codec)) {
      return " Switching to MP4 will grant support for this codec.";
    }
    return "";
  }
};

// node_modules/mediabunny/dist/modules/src/encode.js
var validateVideoEncodingConfig = (config) => {
  if (!config || typeof config !== "object") {
    throw new TypeError("Encoding config must be an object.");
  }
  if (!VIDEO_CODECS.includes(config.codec)) {
    throw new TypeError(`Invalid video codec '${config.codec}'. Must be one of: ${VIDEO_CODECS.join(", ")}.`);
  }
  if (!(config.bitrate instanceof Quality) && (!Number.isInteger(config.bitrate) || config.bitrate <= 0)) {
    throw new TypeError("config.bitrate must be a positive integer or a quality.");
  }
  if (config.keyFrameInterval !== void 0 && (!Number.isFinite(config.keyFrameInterval) || config.keyFrameInterval < 0)) {
    throw new TypeError("config.keyFrameInterval, when provided, must be a non-negative number.");
  }
  if (config.sizeChangeBehavior !== void 0 && !["deny", "passThrough", "fill", "contain", "cover"].includes(config.sizeChangeBehavior)) {
    throw new TypeError("config.sizeChangeBehavior, when provided, must be 'deny', 'passThrough', 'fill', 'contain' or 'cover'.");
  }
  if (config.onEncodedPacket !== void 0 && typeof config.onEncodedPacket !== "function") {
    throw new TypeError("config.onEncodedChunk, when provided, must be a function.");
  }
  if (config.onEncoderConfig !== void 0 && typeof config.onEncoderConfig !== "function") {
    throw new TypeError("config.onEncoderConfig, when provided, must be a function.");
  }
  validateVideoEncodingAdditionalOptions(config.codec, config);
};
var validateVideoEncodingAdditionalOptions = (codec, options) => {
  if (!options || typeof options !== "object") {
    throw new TypeError("Encoding options must be an object.");
  }
  if (options.alpha !== void 0 && !["discard", "keep"].includes(options.alpha)) {
    throw new TypeError("options.alpha, when provided, must be 'discard' or 'keep'.");
  }
  if (options.bitrateMode !== void 0 && !["constant", "variable"].includes(options.bitrateMode)) {
    throw new TypeError("bitrateMode, when provided, must be 'constant' or 'variable'.");
  }
  if (options.latencyMode !== void 0 && !["quality", "realtime"].includes(options.latencyMode)) {
    throw new TypeError("latencyMode, when provided, must be 'quality' or 'realtime'.");
  }
  if (options.fullCodecString !== void 0 && typeof options.fullCodecString !== "string") {
    throw new TypeError("fullCodecString, when provided, must be a string.");
  }
  if (options.fullCodecString !== void 0 && inferCodecFromCodecString(options.fullCodecString) !== codec) {
    throw new TypeError(`fullCodecString, when provided, must be a string that matches the specified codec (${codec}).`);
  }
  if (options.hardwareAcceleration !== void 0 && !["no-preference", "prefer-hardware", "prefer-software"].includes(options.hardwareAcceleration)) {
    throw new TypeError("hardwareAcceleration, when provided, must be 'no-preference', 'prefer-hardware' or 'prefer-software'.");
  }
  if (options.scalabilityMode !== void 0 && typeof options.scalabilityMode !== "string") {
    throw new TypeError("scalabilityMode, when provided, must be a string.");
  }
  if (options.contentHint !== void 0 && typeof options.contentHint !== "string") {
    throw new TypeError("contentHint, when provided, must be a string.");
  }
};
var buildVideoEncoderConfig = (options) => {
  const resolvedBitrate = options.bitrate instanceof Quality ? options.bitrate._toVideoBitrate(options.codec, options.width, options.height) : options.bitrate;
  return {
    codec: options.fullCodecString ?? buildVideoCodecString(options.codec, options.width, options.height, resolvedBitrate),
    width: options.width,
    height: options.height,
    displayWidth: options.squarePixelWidth,
    displayHeight: options.squarePixelHeight,
    bitrate: resolvedBitrate,
    bitrateMode: options.bitrateMode,
    alpha: options.alpha ?? "discard",
    framerate: options.framerate,
    latencyMode: options.latencyMode,
    hardwareAcceleration: options.hardwareAcceleration,
    scalabilityMode: options.scalabilityMode,
    contentHint: options.contentHint,
    ...getVideoEncoderConfigExtension(options.codec)
  };
};
var validateAudioEncodingConfig = (config) => {
  if (!config || typeof config !== "object") {
    throw new TypeError("Encoding config must be an object.");
  }
  if (!AUDIO_CODECS.includes(config.codec)) {
    throw new TypeError(`Invalid audio codec '${config.codec}'. Must be one of: ${AUDIO_CODECS.join(", ")}.`);
  }
  if (config.bitrate === void 0 && (!PCM_AUDIO_CODECS.includes(config.codec) || config.codec === "flac")) {
    throw new TypeError("config.bitrate must be provided for compressed audio codecs.");
  }
  if (config.bitrate !== void 0 && !(config.bitrate instanceof Quality) && (!Number.isInteger(config.bitrate) || config.bitrate <= 0)) {
    throw new TypeError("config.bitrate, when provided, must be a positive integer or a quality.");
  }
  if (config.onEncodedPacket !== void 0 && typeof config.onEncodedPacket !== "function") {
    throw new TypeError("config.onEncodedChunk, when provided, must be a function.");
  }
  if (config.onEncoderConfig !== void 0 && typeof config.onEncoderConfig !== "function") {
    throw new TypeError("config.onEncoderConfig, when provided, must be a function.");
  }
  validateAudioEncodingAdditionalOptions(config.codec, config);
};
var validateAudioEncodingAdditionalOptions = (codec, options) => {
  if (!options || typeof options !== "object") {
    throw new TypeError("Encoding options must be an object.");
  }
  if (options.bitrateMode !== void 0 && !["constant", "variable"].includes(options.bitrateMode)) {
    throw new TypeError("bitrateMode, when provided, must be 'constant' or 'variable'.");
  }
  if (options.fullCodecString !== void 0 && typeof options.fullCodecString !== "string") {
    throw new TypeError("fullCodecString, when provided, must be a string.");
  }
  if (options.fullCodecString !== void 0 && inferCodecFromCodecString(options.fullCodecString) !== codec) {
    throw new TypeError(`fullCodecString, when provided, must be a string that matches the specified codec (${codec}).`);
  }
};
var buildAudioEncoderConfig = (options) => {
  const resolvedBitrate = options.bitrate instanceof Quality ? options.bitrate._toAudioBitrate(options.codec) : options.bitrate;
  return {
    codec: options.fullCodecString ?? buildAudioCodecString(options.codec, options.numberOfChannels, options.sampleRate),
    numberOfChannels: options.numberOfChannels,
    sampleRate: options.sampleRate,
    bitrate: resolvedBitrate,
    bitrateMode: options.bitrateMode,
    ...getAudioEncoderConfigExtension(options.codec)
  };
};
var Quality = class {
  /** @internal */
  constructor(factor) {
    this._factor = factor;
  }
  /** @internal */
  _toVideoBitrate(codec, width, height) {
    const pixels = width * height;
    const codecEfficiencyFactors = {
      avc: 1,
      // H.264/AVC (baseline)
      hevc: 0.6,
      // H.265/HEVC (~40% more efficient than AVC)
      vp9: 0.6,
      // Similar to HEVC
      av1: 0.4,
      // ~60% more efficient than AVC
      vp8: 1.2
      // Slightly less efficient than AVC
    };
    const referencePixels = 1920 * 1080;
    const referenceBitrate = 3e6;
    const scaleFactor = Math.pow(pixels / referencePixels, 0.95);
    const baseBitrate = referenceBitrate * scaleFactor;
    const codecAdjustedBitrate = baseBitrate * codecEfficiencyFactors[codec];
    const finalBitrate = codecAdjustedBitrate * this._factor;
    return Math.ceil(finalBitrate / 1e3) * 1e3;
  }
  /** @internal */
  _toAudioBitrate(codec) {
    if (PCM_AUDIO_CODECS.includes(codec) || codec === "flac") {
      return void 0;
    }
    const baseRates = {
      aac: 128e3,
      // 128kbps base for AAC
      opus: 64e3,
      // 64kbps base for Opus
      mp3: 16e4,
      // 160kbps base for MP3
      vorbis: 64e3,
      // 64kbps base for Vorbis
      ac3: 384e3,
      // 384kbps base for AC-3
      eac3: 192e3
      // 192kbps base for E-AC-3
    };
    const baseBitrate = baseRates[codec];
    if (!baseBitrate) {
      throw new Error(`Unhandled codec: ${codec}`);
    }
    let finalBitrate = baseBitrate * this._factor;
    if (codec === "aac") {
      const validRates = [96e3, 128e3, 16e4, 192e3];
      finalBitrate = validRates.reduce((prev, curr) => Math.abs(curr - finalBitrate) < Math.abs(prev - finalBitrate) ? curr : prev);
    } else if (codec === "opus" || codec === "vorbis") {
      finalBitrate = Math.max(6e3, finalBitrate);
    } else if (codec === "mp3") {
      const validRates = [
        8e3,
        16e3,
        24e3,
        32e3,
        4e4,
        48e3,
        64e3,
        8e4,
        96e3,
        112e3,
        128e3,
        16e4,
        192e3,
        224e3,
        256e3,
        32e4
      ];
      finalBitrate = validRates.reduce((prev, curr) => Math.abs(curr - finalBitrate) < Math.abs(prev - finalBitrate) ? curr : prev);
    }
    return Math.round(finalBitrate / 1e3) * 1e3;
  }
};
var QUALITY_HIGH = /* @__PURE__ */ new Quality(2);

// node_modules/mediabunny/dist/modules/src/media-source.js
var MediaSource = class {
  constructor() {
    this._connectedTrack = null;
    this._closingPromise = null;
    this._closed = false;
    this._timestampOffset = 0;
  }
  /** @internal */
  _ensureValidAdd() {
    if (!this._connectedTrack) {
      throw new Error("Source is not connected to an output track.");
    }
    if (this._connectedTrack.output.state === "canceled") {
      throw new Error("Output has been canceled.");
    }
    if (this._connectedTrack.output.state === "finalizing" || this._connectedTrack.output.state === "finalized") {
      throw new Error("Output has been finalized.");
    }
    if (this._connectedTrack.output.state === "pending") {
      throw new Error("Output has not started.");
    }
    if (this._closed) {
      throw new Error("Source is closed.");
    }
  }
  /** @internal */
  async _start() {
  }
  /** @internal */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async _flushAndClose(forceClose) {
  }
  /**
   * Closes this source. This prevents future samples from being added and signals to the output file that no further
   * samples will come in for this track. Calling `.close()` is optional but recommended after adding the
   * last sample - for improved performance and reduced memory usage.
   */
  close() {
    if (this._closingPromise) {
      return;
    }
    const connectedTrack = this._connectedTrack;
    if (!connectedTrack) {
      throw new Error("Cannot call close without connecting the source to an output track.");
    }
    if (connectedTrack.output.state === "pending") {
      throw new Error("Cannot call close before output has been started.");
    }
    this._closingPromise = (async () => {
      await this._flushAndClose(false);
      this._closed = true;
      if (connectedTrack.output.state === "finalizing" || connectedTrack.output.state === "finalized") {
        return;
      }
      connectedTrack.output._muxer.onTrackClose(connectedTrack);
    })();
  }
  /** @internal */
  async _flushOrWaitForOngoingClose(forceClose) {
    return this._closingPromise ??= (async () => {
      await this._flushAndClose(forceClose);
      this._closed = true;
    })();
  }
};
var VideoSource = class extends MediaSource {
  /** Internal constructor. */
  constructor(codec) {
    super();
    this._connectedTrack = null;
    if (!VIDEO_CODECS.includes(codec)) {
      throw new TypeError(`Invalid video codec '${codec}'. Must be one of: ${VIDEO_CODECS.join(", ")}.`);
    }
    this._codec = codec;
  }
};
var VideoEncoderWrapper = class {
  constructor(source, encodingConfig) {
    this.source = source;
    this.encodingConfig = encodingConfig;
    this.ensureEncoderPromise = null;
    this.encoderInitialized = false;
    this.encoder = null;
    this.muxer = null;
    this.lastMultipleOfKeyFrameInterval = -1;
    this.codedWidth = null;
    this.codedHeight = null;
    this.resizeCanvas = null;
    this.customEncoder = null;
    this.customEncoderCallSerializer = new CallSerializer();
    this.customEncoderQueueSize = 0;
    this.alphaEncoder = null;
    this.splitter = null;
    this.splitterCreationFailed = false;
    this.alphaFrameQueue = [];
    this.error = null;
  }
  async add(videoSample, shouldClose, encodeOptions) {
    try {
      this.checkForEncoderError();
      this.source._ensureValidAdd();
      if (this.codedWidth !== null && this.codedHeight !== null) {
        if (videoSample.codedWidth !== this.codedWidth || videoSample.codedHeight !== this.codedHeight) {
          const sizeChangeBehavior = this.encodingConfig.sizeChangeBehavior ?? "deny";
          if (sizeChangeBehavior === "passThrough") {
          } else if (sizeChangeBehavior === "deny") {
            throw new Error(`Video sample size must remain constant. Expected ${this.codedWidth}x${this.codedHeight}, got ${videoSample.codedWidth}x${videoSample.codedHeight}. To allow the sample size to change over time, set \`sizeChangeBehavior\` to a value other than 'strict' in the encoding options.`);
          } else {
            let canvasIsNew = false;
            if (!this.resizeCanvas) {
              if (typeof document !== "undefined") {
                this.resizeCanvas = document.createElement("canvas");
                this.resizeCanvas.width = this.codedWidth;
                this.resizeCanvas.height = this.codedHeight;
              } else {
                this.resizeCanvas = new OffscreenCanvas(this.codedWidth, this.codedHeight);
              }
              canvasIsNew = true;
            }
            const context = this.resizeCanvas.getContext("2d", {
              alpha: isFirefox()
              // Firefox has VideoFrame glitches with opaque canvases
            });
            assert(context);
            if (!canvasIsNew) {
              if (isFirefox()) {
                context.fillStyle = "black";
                context.fillRect(0, 0, this.codedWidth, this.codedHeight);
              } else {
                context.clearRect(0, 0, this.codedWidth, this.codedHeight);
              }
            }
            videoSample.drawWithFit(context, { fit: sizeChangeBehavior });
            if (shouldClose) {
              videoSample.close();
            }
            videoSample = new VideoSample(this.resizeCanvas, {
              timestamp: videoSample.timestamp,
              duration: videoSample.duration,
              rotation: videoSample.rotation
            });
            shouldClose = true;
          }
        }
      } else {
        this.codedWidth = videoSample.codedWidth;
        this.codedHeight = videoSample.codedHeight;
      }
      if (!this.encoderInitialized) {
        if (!this.ensureEncoderPromise) {
          this.ensureEncoder(videoSample);
        }
        if (!this.encoderInitialized) {
          await this.ensureEncoderPromise;
        }
      }
      assert(this.encoderInitialized);
      const keyFrameInterval = this.encodingConfig.keyFrameInterval ?? 5;
      const multipleOfKeyFrameInterval = Math.floor(videoSample.timestamp / keyFrameInterval);
      const finalEncodeOptions = {
        ...encodeOptions,
        keyFrame: encodeOptions?.keyFrame || keyFrameInterval === 0 || multipleOfKeyFrameInterval !== this.lastMultipleOfKeyFrameInterval
      };
      this.lastMultipleOfKeyFrameInterval = multipleOfKeyFrameInterval;
      if (this.customEncoder) {
        this.customEncoderQueueSize++;
        const clonedSample = videoSample.clone();
        const promise = this.customEncoderCallSerializer.call(() => this.customEncoder.encode(clonedSample, finalEncodeOptions)).then(() => this.customEncoderQueueSize--).catch((error) => this.error ??= error).finally(() => {
          clonedSample.close();
        });
        if (this.customEncoderQueueSize >= 4) {
          await promise;
        }
      } else {
        assert(this.encoder);
        const videoFrame = videoSample.toVideoFrame();
        if (!this.alphaEncoder) {
          this.encoder.encode(videoFrame, finalEncodeOptions);
          videoFrame.close();
        } else {
          const frameDefinitelyHasNoAlpha = !!videoFrame.format && !videoFrame.format.includes("A");
          if (frameDefinitelyHasNoAlpha || this.splitterCreationFailed) {
            this.alphaFrameQueue.push(null);
            this.encoder.encode(videoFrame, finalEncodeOptions);
            videoFrame.close();
          } else {
            const width = videoFrame.displayWidth;
            const height = videoFrame.displayHeight;
            if (!this.splitter) {
              try {
                this.splitter = new ColorAlphaSplitter(width, height);
              } catch (error) {
                console.error("Due to an error, only color data will be encoded.", error);
                this.splitterCreationFailed = true;
                this.alphaFrameQueue.push(null);
                this.encoder.encode(videoFrame, finalEncodeOptions);
                videoFrame.close();
              }
            }
            if (this.splitter) {
              const colorFrame = this.splitter.extractColor(videoFrame);
              const alphaFrame = this.splitter.extractAlpha(videoFrame);
              this.alphaFrameQueue.push(alphaFrame);
              this.encoder.encode(colorFrame, finalEncodeOptions);
              colorFrame.close();
              videoFrame.close();
            }
          }
        }
        if (shouldClose) {
          videoSample.close();
        }
        if (this.encoder.encodeQueueSize >= 4) {
          await new Promise((resolve) => this.encoder.addEventListener("dequeue", resolve, { once: true }));
        }
      }
      await this.muxer.mutex.currentPromise;
    } finally {
      if (shouldClose) {
        videoSample.close();
      }
    }
  }
  ensureEncoder(videoSample) {
    this.ensureEncoderPromise = (async () => {
      const encoderConfig = buildVideoEncoderConfig({
        width: videoSample.codedWidth,
        height: videoSample.codedHeight,
        squarePixelWidth: videoSample.squarePixelWidth,
        squarePixelHeight: videoSample.squarePixelHeight,
        ...this.encodingConfig,
        framerate: this.source._connectedTrack?.metadata.frameRate
      });
      this.encodingConfig.onEncoderConfig?.(encoderConfig);
      const MatchingCustomEncoder = customVideoEncoders.find((x) => x.supports(this.encodingConfig.codec, encoderConfig));
      if (MatchingCustomEncoder) {
        this.customEncoder = new MatchingCustomEncoder();
        this.customEncoder.codec = this.encodingConfig.codec;
        this.customEncoder.config = encoderConfig;
        this.customEncoder.onPacket = (packet, meta) => {
          if (!(packet instanceof EncodedPacket)) {
            throw new TypeError("The first argument passed to onPacket must be an EncodedPacket.");
          }
          if (meta !== void 0 && (!meta || typeof meta !== "object")) {
            throw new TypeError("The second argument passed to onPacket must be an object or undefined.");
          }
          this.encodingConfig.onEncodedPacket?.(packet, meta);
          void this.muxer.addEncodedVideoPacket(this.source._connectedTrack, packet, meta).catch((error) => {
            this.error ??= error;
          });
        };
        await this.customEncoder.init();
      } else {
        if (typeof VideoEncoder === "undefined") {
          throw new Error("VideoEncoder is not supported by this browser.");
        }
        encoderConfig.alpha = "discard";
        if (this.encodingConfig.alpha === "keep") {
          encoderConfig.latencyMode = "quality";
        }
        const hasOddDimension = encoderConfig.width % 2 === 1 || encoderConfig.height % 2 === 1;
        if (hasOddDimension && (this.encodingConfig.codec === "avc" || this.encodingConfig.codec === "hevc")) {
          throw new Error(`The dimensions ${encoderConfig.width}x${encoderConfig.height} are not supported for codec '${this.encodingConfig.codec}'; both width and height must be even numbers. Make sure to round your dimensions to the nearest even number.`);
        }
        const support = await VideoEncoder.isConfigSupported(encoderConfig);
        if (!support.supported) {
          throw new Error(`This specific encoder configuration (${encoderConfig.codec}, ${encoderConfig.bitrate} bps, ${encoderConfig.width}x${encoderConfig.height}, hardware acceleration: ${encoderConfig.hardwareAcceleration ?? "no-preference"}) is not supported by this browser. Consider using another codec or changing your video parameters.`);
        }
        const colorChunkQueue = [];
        const nullAlphaChunkQueue = [];
        let encodedAlphaChunkCount = 0;
        let alphaEncoderQueue = 0;
        const addPacket = (colorChunk, alphaChunk, meta) => {
          const sideData = {};
          if (alphaChunk) {
            const alphaData = new Uint8Array(alphaChunk.byteLength);
            alphaChunk.copyTo(alphaData);
            sideData.alpha = alphaData;
          }
          const packet = EncodedPacket.fromEncodedChunk(colorChunk, sideData);
          this.encodingConfig.onEncodedPacket?.(packet, meta);
          void this.muxer.addEncodedVideoPacket(this.source._connectedTrack, packet, meta).catch((error) => {
            this.error ??= error;
          });
        };
        const stack = new Error("Encoding error").stack;
        this.encoder = new VideoEncoder({
          output: (chunk, meta) => {
            if (!this.alphaEncoder) {
              addPacket(chunk, null, meta);
              return;
            }
            const alphaFrame = this.alphaFrameQueue.shift();
            assert(alphaFrame !== void 0);
            if (alphaFrame) {
              this.alphaEncoder.encode(alphaFrame, {
                // Crucial: The alpha frame is forced to be a key frame whenever the color frame
                // also is. Without this, playback can glitch and even crash in some browsers.
                // This is the reason why the two encoders are wired in series and not in parallel.
                keyFrame: chunk.type === "key"
              });
              alphaEncoderQueue++;
              alphaFrame.close();
              colorChunkQueue.push({ chunk, meta });
            } else {
              if (alphaEncoderQueue === 0) {
                addPacket(chunk, null, meta);
              } else {
                nullAlphaChunkQueue.push(encodedAlphaChunkCount + alphaEncoderQueue);
                colorChunkQueue.push({ chunk, meta });
              }
            }
          },
          error: (error) => {
            error.stack = stack;
            this.error ??= error;
          }
        });
        this.encoder.configure(encoderConfig);
        if (this.encodingConfig.alpha === "keep") {
          const stack2 = new Error("Encoding error").stack;
          this.alphaEncoder = new VideoEncoder({
            // We ignore the alpha chunk's metadata
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            output: (chunk, meta) => {
              alphaEncoderQueue--;
              const colorChunk = colorChunkQueue.shift();
              assert(colorChunk !== void 0);
              addPacket(colorChunk.chunk, chunk, colorChunk.meta);
              encodedAlphaChunkCount++;
              while (nullAlphaChunkQueue.length > 0 && nullAlphaChunkQueue[0] === encodedAlphaChunkCount) {
                nullAlphaChunkQueue.shift();
                const colorChunk2 = colorChunkQueue.shift();
                assert(colorChunk2 !== void 0);
                addPacket(colorChunk2.chunk, null, colorChunk2.meta);
              }
            },
            error: (error) => {
              error.stack = stack2;
              this.error ??= error;
            }
          });
          this.alphaEncoder.configure(encoderConfig);
        }
      }
      assert(this.source._connectedTrack);
      this.muxer = this.source._connectedTrack.output._muxer;
      this.encoderInitialized = true;
    })();
  }
  async flushAndClose(forceClose) {
    if (!forceClose)
      this.checkForEncoderError();
    if (this.customEncoder) {
      if (!forceClose) {
        void this.customEncoderCallSerializer.call(() => this.customEncoder.flush());
      }
      await this.customEncoderCallSerializer.call(() => this.customEncoder.close());
    } else if (this.encoder) {
      if (!forceClose) {
        await this.encoder.flush();
        await this.alphaEncoder?.flush();
      }
      if (this.encoder.state !== "closed") {
        this.encoder.close();
      }
      if (this.alphaEncoder && this.alphaEncoder.state !== "closed") {
        this.alphaEncoder.close();
      }
      this.alphaFrameQueue.forEach((x) => x?.close());
      this.splitter?.close();
    }
    if (!forceClose)
      this.checkForEncoderError();
  }
  getQueueSize() {
    if (this.customEncoder) {
      return this.customEncoderQueueSize;
    } else {
      return this.encoder?.encodeQueueSize ?? 0;
    }
  }
  checkForEncoderError() {
    if (this.error) {
      throw this.error;
    }
  }
};
var ColorAlphaSplitter = class {
  constructor(initialWidth, initialHeight) {
    this.lastFrame = null;
    if (typeof OffscreenCanvas !== "undefined") {
      this.canvas = new OffscreenCanvas(initialWidth, initialHeight);
    } else {
      this.canvas = document.createElement("canvas");
      this.canvas.width = initialWidth;
      this.canvas.height = initialHeight;
    }
    const gl = this.canvas.getContext("webgl2", {
      alpha: true
      // Needed due to the YUV thing we do for alpha
    });
    if (!gl) {
      throw new Error("Couldn't acquire WebGL 2 context.");
    }
    this.gl = gl;
    this.colorProgram = this.createColorProgram();
    this.alphaProgram = this.createAlphaProgram();
    this.vao = this.createVAO();
    this.sourceTexture = this.createTexture();
    this.alphaResolutionLocation = this.gl.getUniformLocation(this.alphaProgram, "u_resolution");
    this.gl.useProgram(this.colorProgram);
    this.gl.uniform1i(this.gl.getUniformLocation(this.colorProgram, "u_sourceTexture"), 0);
    this.gl.useProgram(this.alphaProgram);
    this.gl.uniform1i(this.gl.getUniformLocation(this.alphaProgram, "u_sourceTexture"), 0);
  }
  createVertexShader() {
    return this.createShader(this.gl.VERTEX_SHADER, `#version 300 es
			in vec2 a_position;
			in vec2 a_texCoord;
			out vec2 v_texCoord;
			
			void main() {
				gl_Position = vec4(a_position, 0.0, 1.0);
				v_texCoord = a_texCoord;
			}
		`);
  }
  createColorProgram() {
    const vertexShader = this.createVertexShader();
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, `#version 300 es
			precision highp float;
			
			uniform sampler2D u_sourceTexture;
			in vec2 v_texCoord;
			out vec4 fragColor;
			
			void main() {
				vec4 source = texture(u_sourceTexture, v_texCoord);
				fragColor = vec4(source.rgb, 1.0);
			}
		`);
    const program = this.gl.createProgram();
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    return program;
  }
  createAlphaProgram() {
    const vertexShader = this.createVertexShader();
    const fragmentShader = this.createShader(this.gl.FRAGMENT_SHADER, `#version 300 es
			precision highp float;
			
			uniform sampler2D u_sourceTexture;
			uniform vec2 u_resolution; // The width and height of the canvas
			in vec2 v_texCoord;
			out vec4 fragColor;

			// This function determines the value for a single byte in the YUV stream
			float getByteValue(float byteOffset) {
				float width = u_resolution.x;
				float height = u_resolution.y;

				float yPlaneSize = width * height;

				if (byteOffset < yPlaneSize) {
					// This byte is in the luma plane. Find the corresponding pixel coordinates to sample from
					float y = floor(byteOffset / width);
					float x = mod(byteOffset, width);
					
					// Add 0.5 to sample the center of the texel
					vec2 sampleCoord = (vec2(x, y) + 0.5) / u_resolution;
					
					// The luma value is the alpha from the source texture
					return texture(u_sourceTexture, sampleCoord).a;
				} else {
					// Write a fixed value for chroma and beyond
					return 128.0 / 255.0;
				}
			}
			
			void main() {
				// Each fragment writes 4 bytes (R, G, B, A)
				float pixelIndex = floor(gl_FragCoord.y) * u_resolution.x + floor(gl_FragCoord.x);
				float baseByteOffset = pixelIndex * 4.0;

				vec4 result;
				for (int i = 0; i < 4; i++) {
					float currentByteOffset = baseByteOffset + float(i);
					result[i] = getByteValue(currentByteOffset);
				}
				
				fragColor = result;
			}
		`);
    const program = this.gl.createProgram();
    this.gl.attachShader(program, vertexShader);
    this.gl.attachShader(program, fragmentShader);
    this.gl.linkProgram(program);
    return program;
  }
  createShader(type, source) {
    const shader = this.gl.createShader(type);
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      console.error("Shader compile error:", this.gl.getShaderInfoLog(shader));
    }
    return shader;
  }
  createVAO() {
    const vao = this.gl.createVertexArray();
    this.gl.bindVertexArray(vao);
    const vertices = new Float32Array([
      -1,
      -1,
      0,
      1,
      1,
      -1,
      1,
      1,
      -1,
      1,
      0,
      0,
      1,
      1,
      1,
      0
    ]);
    const buffer = this.gl.createBuffer();
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, buffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, vertices, this.gl.STATIC_DRAW);
    const positionLocation = this.gl.getAttribLocation(this.colorProgram, "a_position");
    const texCoordLocation = this.gl.getAttribLocation(this.colorProgram, "a_texCoord");
    this.gl.enableVertexAttribArray(positionLocation);
    this.gl.vertexAttribPointer(positionLocation, 2, this.gl.FLOAT, false, 16, 0);
    this.gl.enableVertexAttribArray(texCoordLocation);
    this.gl.vertexAttribPointer(texCoordLocation, 2, this.gl.FLOAT, false, 16, 8);
    return vao;
  }
  createTexture() {
    const texture = this.gl.createTexture();
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
    return texture;
  }
  updateTexture(sourceFrame) {
    if (this.lastFrame === sourceFrame) {
      return;
    }
    if (sourceFrame.displayWidth !== this.canvas.width || sourceFrame.displayHeight !== this.canvas.height) {
      this.canvas.width = sourceFrame.displayWidth;
      this.canvas.height = sourceFrame.displayHeight;
    }
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.gl.bindTexture(this.gl.TEXTURE_2D, this.sourceTexture);
    this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, sourceFrame);
    this.lastFrame = sourceFrame;
  }
  extractColor(sourceFrame) {
    this.updateTexture(sourceFrame);
    this.gl.useProgram(this.colorProgram);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    return new VideoFrame(this.canvas, {
      timestamp: sourceFrame.timestamp,
      duration: sourceFrame.duration ?? void 0,
      alpha: "discard"
    });
  }
  extractAlpha(sourceFrame) {
    this.updateTexture(sourceFrame);
    this.gl.useProgram(this.alphaProgram);
    this.gl.uniform2f(this.alphaResolutionLocation, this.canvas.width, this.canvas.height);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
    const { width, height } = this.canvas;
    const chromaSamples = Math.ceil(width / 2) * Math.ceil(height / 2);
    const yuvSize = width * height + chromaSamples * 2;
    const requiredHeight = Math.ceil(yuvSize / (width * 4));
    let yuv = new Uint8Array(4 * width * requiredHeight);
    this.gl.readPixels(0, 0, width, requiredHeight, this.gl.RGBA, this.gl.UNSIGNED_BYTE, yuv);
    yuv = yuv.subarray(0, yuvSize);
    assert(yuv[width * height] === 128);
    assert(yuv[yuv.length - 1] === 128);
    const init = {
      format: "I420",
      codedWidth: width,
      codedHeight: height,
      timestamp: sourceFrame.timestamp,
      duration: sourceFrame.duration ?? void 0,
      transfer: [yuv.buffer]
    };
    return new VideoFrame(yuv, init);
  }
  close() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
    this.gl = null;
  }
};
var CanvasSource = class extends VideoSource {
  /**
   * Creates a new {@link CanvasSource} from a canvas element or `OffscreenCanvas` whose samples are encoded
   * according to the specified {@link VideoEncodingConfig}.
   */
  constructor(canvas, encodingConfig) {
    if (!(typeof HTMLCanvasElement !== "undefined" && canvas instanceof HTMLCanvasElement) && !(typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas)) {
      throw new TypeError("canvas must be an HTMLCanvasElement or OffscreenCanvas.");
    }
    validateVideoEncodingConfig(encodingConfig);
    super(encodingConfig.codec);
    this._encoder = new VideoEncoderWrapper(this, encodingConfig);
    this._canvas = canvas;
  }
  /**
   * Captures the current canvas state as a video sample (frame), encodes it and adds it to the output.
   *
   * @param timestamp - The timestamp of the sample, in seconds.
   * @param duration - The duration of the sample, in seconds.
   *
   * @returns A Promise that resolves once the output is ready to receive more samples. You should await this Promise
   * to respect writer and encoder backpressure.
   */
  add(timestamp, duration = 0, encodeOptions) {
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new TypeError("timestamp must be a non-negative number.");
    }
    if (!Number.isFinite(duration) || duration < 0) {
      throw new TypeError("duration must be a non-negative number.");
    }
    const sample = new VideoSample(this._canvas, { timestamp, duration });
    return this._encoder.add(sample, true, encodeOptions);
  }
  /** @internal */
  _flushAndClose(forceClose) {
    return this._encoder.flushAndClose(forceClose);
  }
};
var AudioSource = class extends MediaSource {
  /** Internal constructor. */
  constructor(codec) {
    super();
    this._connectedTrack = null;
    if (!AUDIO_CODECS.includes(codec)) {
      throw new TypeError(`Invalid audio codec '${codec}'. Must be one of: ${AUDIO_CODECS.join(", ")}.`);
    }
    this._codec = codec;
  }
};
var AudioEncoderWrapper = class {
  constructor(source, encodingConfig) {
    this.source = source;
    this.encodingConfig = encodingConfig;
    this.ensureEncoderPromise = null;
    this.encoderInitialized = false;
    this.encoder = null;
    this.muxer = null;
    this.lastNumberOfChannels = null;
    this.lastSampleRate = null;
    this.isPcmEncoder = false;
    this.outputSampleSize = null;
    this.writeOutputValue = null;
    this.customEncoder = null;
    this.customEncoderCallSerializer = new CallSerializer();
    this.customEncoderQueueSize = 0;
    this.lastEndSampleIndex = null;
    this.error = null;
  }
  async add(audioSample, shouldClose) {
    try {
      this.checkForEncoderError();
      this.source._ensureValidAdd();
      if (this.lastNumberOfChannels !== null && this.lastSampleRate !== null) {
        if (audioSample.numberOfChannels !== this.lastNumberOfChannels || audioSample.sampleRate !== this.lastSampleRate) {
          throw new Error(`Audio parameters must remain constant. Expected ${this.lastNumberOfChannels} channels at ${this.lastSampleRate} Hz, got ${audioSample.numberOfChannels} channels at ${audioSample.sampleRate} Hz.`);
        }
      } else {
        this.lastNumberOfChannels = audioSample.numberOfChannels;
        this.lastSampleRate = audioSample.sampleRate;
      }
      if (!this.encoderInitialized) {
        if (!this.ensureEncoderPromise) {
          this.ensureEncoder(audioSample);
        }
        if (!this.encoderInitialized) {
          await this.ensureEncoderPromise;
        }
      }
      assert(this.encoderInitialized);
      {
        const startSampleIndex = Math.round(audioSample.timestamp * audioSample.sampleRate);
        const endSampleIndex = Math.round((audioSample.timestamp + audioSample.duration) * audioSample.sampleRate);
        if (this.lastEndSampleIndex === null) {
          this.lastEndSampleIndex = endSampleIndex;
        } else {
          const sampleDiff = startSampleIndex - this.lastEndSampleIndex;
          if (sampleDiff >= 64) {
            const fillSample = new AudioSample({
              data: new Float32Array(sampleDiff * audioSample.numberOfChannels),
              format: "f32-planar",
              sampleRate: audioSample.sampleRate,
              numberOfChannels: audioSample.numberOfChannels,
              numberOfFrames: sampleDiff,
              timestamp: this.lastEndSampleIndex / audioSample.sampleRate
            });
            await this.add(fillSample, true);
          }
          this.lastEndSampleIndex += audioSample.numberOfFrames;
        }
      }
      if (this.customEncoder) {
        this.customEncoderQueueSize++;
        const clonedSample = audioSample.clone();
        const promise = this.customEncoderCallSerializer.call(() => this.customEncoder.encode(clonedSample)).then(() => this.customEncoderQueueSize--).catch((error) => this.error ??= error).finally(() => {
          clonedSample.close();
        });
        if (this.customEncoderQueueSize >= 4) {
          await promise;
        }
        await this.muxer.mutex.currentPromise;
      } else if (this.isPcmEncoder) {
        await this.doPcmEncoding(audioSample, shouldClose);
      } else {
        assert(this.encoder);
        const audioData = audioSample.toAudioData();
        this.encoder.encode(audioData);
        audioData.close();
        if (shouldClose) {
          audioSample.close();
        }
        if (this.encoder.encodeQueueSize >= 4) {
          await new Promise((resolve) => this.encoder.addEventListener("dequeue", resolve, { once: true }));
        }
        await this.muxer.mutex.currentPromise;
      }
    } finally {
      if (shouldClose) {
        audioSample.close();
      }
    }
  }
  async doPcmEncoding(audioSample, shouldClose) {
    assert(this.outputSampleSize);
    assert(this.writeOutputValue);
    const { numberOfChannels, numberOfFrames, sampleRate, timestamp } = audioSample;
    const CHUNK_SIZE = 2048;
    const outputs = [];
    for (let frame = 0; frame < numberOfFrames; frame += CHUNK_SIZE) {
      const frameCount = Math.min(CHUNK_SIZE, audioSample.numberOfFrames - frame);
      const outputSize = frameCount * numberOfChannels * this.outputSampleSize;
      const outputBuffer = new ArrayBuffer(outputSize);
      const outputView = new DataView(outputBuffer);
      outputs.push({ frameCount, view: outputView });
    }
    const allocationSize = audioSample.allocationSize({ planeIndex: 0, format: "f32-planar" });
    const floats = new Float32Array(allocationSize / Float32Array.BYTES_PER_ELEMENT);
    for (let i = 0; i < numberOfChannels; i++) {
      audioSample.copyTo(floats, { planeIndex: i, format: "f32-planar" });
      for (let j = 0; j < outputs.length; j++) {
        const { frameCount, view: view2 } = outputs[j];
        for (let k = 0; k < frameCount; k++) {
          this.writeOutputValue(view2, (k * numberOfChannels + i) * this.outputSampleSize, floats[j * CHUNK_SIZE + k]);
        }
      }
    }
    if (shouldClose) {
      audioSample.close();
    }
    const meta = {
      decoderConfig: {
        codec: this.encodingConfig.codec,
        numberOfChannels,
        sampleRate
      }
    };
    for (let i = 0; i < outputs.length; i++) {
      const { frameCount, view: view2 } = outputs[i];
      const outputBuffer = view2.buffer;
      const startFrame = i * CHUNK_SIZE;
      const packet = new EncodedPacket(new Uint8Array(outputBuffer), "key", timestamp + startFrame / sampleRate, frameCount / sampleRate);
      this.encodingConfig.onEncodedPacket?.(packet, meta);
      await this.muxer.addEncodedAudioPacket(this.source._connectedTrack, packet, meta);
    }
  }
  ensureEncoder(audioSample) {
    this.ensureEncoderPromise = (async () => {
      const { numberOfChannels, sampleRate } = audioSample;
      const encoderConfig = buildAudioEncoderConfig({
        numberOfChannels,
        sampleRate,
        ...this.encodingConfig
      });
      this.encodingConfig.onEncoderConfig?.(encoderConfig);
      const MatchingCustomEncoder = customAudioEncoders.find((x) => x.supports(this.encodingConfig.codec, encoderConfig));
      if (MatchingCustomEncoder) {
        this.customEncoder = new MatchingCustomEncoder();
        this.customEncoder.codec = this.encodingConfig.codec;
        this.customEncoder.config = encoderConfig;
        this.customEncoder.onPacket = (packet, meta) => {
          if (!(packet instanceof EncodedPacket)) {
            throw new TypeError("The first argument passed to onPacket must be an EncodedPacket.");
          }
          if (meta !== void 0 && (!meta || typeof meta !== "object")) {
            throw new TypeError("The second argument passed to onPacket must be an object or undefined.");
          }
          this.encodingConfig.onEncodedPacket?.(packet, meta);
          void this.muxer.addEncodedAudioPacket(this.source._connectedTrack, packet, meta).catch((error) => {
            this.error ??= error;
          });
        };
        await this.customEncoder.init();
      } else if (PCM_AUDIO_CODECS.includes(this.encodingConfig.codec)) {
        this.initPcmEncoder();
      } else {
        if (typeof AudioEncoder === "undefined") {
          throw new Error("AudioEncoder is not supported by this browser.");
        }
        const support = await AudioEncoder.isConfigSupported(encoderConfig);
        if (!support.supported) {
          throw new Error(`This specific encoder configuration (${encoderConfig.codec}, ${encoderConfig.bitrate} bps, ${encoderConfig.numberOfChannels} channels, ${encoderConfig.sampleRate} Hz) is not supported by this browser. Consider using another codec or changing your audio parameters.`);
        }
        const stack = new Error("Encoding error").stack;
        this.encoder = new AudioEncoder({
          output: (chunk, meta) => {
            if (this.encodingConfig.codec === "aac" && meta?.decoderConfig) {
              let needsDescriptionOverwrite = false;
              if (!meta.decoderConfig.description || meta.decoderConfig.description.byteLength < 2) {
                needsDescriptionOverwrite = true;
              } else {
                const audioSpecificConfig = parseAacAudioSpecificConfig(toUint8Array(meta.decoderConfig.description));
                needsDescriptionOverwrite = audioSpecificConfig.objectType === 0;
              }
              if (needsDescriptionOverwrite) {
                const objectType = Number(last(encoderConfig.codec.split(".")));
                meta.decoderConfig.description = buildAacAudioSpecificConfig({
                  objectType,
                  numberOfChannels: meta.decoderConfig.numberOfChannels,
                  sampleRate: meta.decoderConfig.sampleRate
                });
              }
            }
            const packet = EncodedPacket.fromEncodedChunk(chunk);
            this.encodingConfig.onEncodedPacket?.(packet, meta);
            void this.muxer.addEncodedAudioPacket(this.source._connectedTrack, packet, meta).catch((error) => {
              this.error ??= error;
            });
          },
          error: (error) => {
            error.stack = stack;
            this.error ??= error;
          }
        });
        this.encoder.configure(encoderConfig);
      }
      assert(this.source._connectedTrack);
      this.muxer = this.source._connectedTrack.output._muxer;
      this.encoderInitialized = true;
    })();
  }
  initPcmEncoder() {
    this.isPcmEncoder = true;
    const codec = this.encodingConfig.codec;
    const { dataType, sampleSize, littleEndian } = parsePcmCodec(codec);
    this.outputSampleSize = sampleSize;
    switch (sampleSize) {
      case 1:
        {
          if (dataType === "unsigned") {
            this.writeOutputValue = (view2, byteOffset, value) => view2.setUint8(byteOffset, clamp((value + 1) * 127.5, 0, 255));
          } else if (dataType === "signed") {
            this.writeOutputValue = (view2, byteOffset, value) => {
              view2.setInt8(byteOffset, clamp(Math.round(value * 128), -128, 127));
            };
          } else if (dataType === "ulaw") {
            this.writeOutputValue = (view2, byteOffset, value) => {
              const int16 = clamp(Math.floor(value * 32767), -32768, 32767);
              view2.setUint8(byteOffset, toUlaw(int16));
            };
          } else if (dataType === "alaw") {
            this.writeOutputValue = (view2, byteOffset, value) => {
              const int16 = clamp(Math.floor(value * 32767), -32768, 32767);
              view2.setUint8(byteOffset, toAlaw(int16));
            };
          } else {
            assert(false);
          }
        }
        ;
        break;
      case 2:
        {
          if (dataType === "unsigned") {
            this.writeOutputValue = (view2, byteOffset, value) => view2.setUint16(byteOffset, clamp((value + 1) * 32767.5, 0, 65535), littleEndian);
          } else if (dataType === "signed") {
            this.writeOutputValue = (view2, byteOffset, value) => view2.setInt16(byteOffset, clamp(Math.round(value * 32767), -32768, 32767), littleEndian);
          } else {
            assert(false);
          }
        }
        ;
        break;
      case 3:
        {
          if (dataType === "unsigned") {
            this.writeOutputValue = (view2, byteOffset, value) => setUint24(view2, byteOffset, clamp((value + 1) * 83886075e-1, 0, 16777215), littleEndian);
          } else if (dataType === "signed") {
            this.writeOutputValue = (view2, byteOffset, value) => setInt24(view2, byteOffset, clamp(Math.round(value * 8388607), -8388608, 8388607), littleEndian);
          } else {
            assert(false);
          }
        }
        ;
        break;
      case 4:
        {
          if (dataType === "unsigned") {
            this.writeOutputValue = (view2, byteOffset, value) => view2.setUint32(byteOffset, clamp((value + 1) * 21474836475e-1, 0, 4294967295), littleEndian);
          } else if (dataType === "signed") {
            this.writeOutputValue = (view2, byteOffset, value) => view2.setInt32(byteOffset, clamp(Math.round(value * 2147483647), -2147483648, 2147483647), littleEndian);
          } else if (dataType === "float") {
            this.writeOutputValue = (view2, byteOffset, value) => view2.setFloat32(byteOffset, value, littleEndian);
          } else {
            assert(false);
          }
        }
        ;
        break;
      case 8:
        {
          if (dataType === "float") {
            this.writeOutputValue = (view2, byteOffset, value) => view2.setFloat64(byteOffset, value, littleEndian);
          } else {
            assert(false);
          }
        }
        ;
        break;
      default:
        {
          assertNever(sampleSize);
          assert(false);
        }
        ;
    }
  }
  async flushAndClose(forceClose) {
    if (!forceClose)
      this.checkForEncoderError();
    if (this.customEncoder) {
      if (!forceClose) {
        void this.customEncoderCallSerializer.call(() => this.customEncoder.flush());
      }
      await this.customEncoderCallSerializer.call(() => this.customEncoder.close());
    } else if (this.encoder) {
      if (!forceClose) {
        await this.encoder.flush();
      }
      if (this.encoder.state !== "closed") {
        this.encoder.close();
      }
    }
    if (!forceClose)
      this.checkForEncoderError();
  }
  getQueueSize() {
    if (this.customEncoder) {
      return this.customEncoderQueueSize;
    } else if (this.isPcmEncoder) {
      return 0;
    } else {
      return this.encoder?.encodeQueueSize ?? 0;
    }
  }
  checkForEncoderError() {
    if (this.error) {
      throw this.error;
    }
  }
};
var AudioBufferSource = class extends AudioSource {
  /**
   * Creates a new {@link AudioBufferSource} whose `AudioBuffer` instances are encoded according to the specified
   * {@link AudioEncodingConfig}.
   */
  constructor(encodingConfig) {
    validateAudioEncodingConfig(encodingConfig);
    super(encodingConfig.codec);
    this._accumulatedTime = 0;
    this._encoder = new AudioEncoderWrapper(this, encodingConfig);
  }
  /**
   * Converts an AudioBuffer to audio samples, encodes them and adds them to the output. The first AudioBuffer will
   * be played at timestamp 0, and any subsequent AudioBuffer will have a timestamp equal to the total duration of
   * all previous AudioBuffers.
   *
   * @returns A Promise that resolves once the output is ready to receive more samples. You should await this Promise
   * to respect writer and encoder backpressure.
   */
  async add(audioBuffer) {
    if (!(audioBuffer instanceof AudioBuffer)) {
      throw new TypeError("audioBuffer must be an AudioBuffer.");
    }
    const iterator = AudioSample._fromAudioBuffer(audioBuffer, this._accumulatedTime);
    this._accumulatedTime += audioBuffer.duration;
    for (const audioSample of iterator) {
      await this._encoder.add(audioSample, true);
    }
  }
  /** @internal */
  _flushAndClose(forceClose) {
    return this._encoder.flushAndClose(forceClose);
  }
};
var SubtitleSource = class extends MediaSource {
  /** Internal constructor. */
  constructor(codec) {
    super();
    this._connectedTrack = null;
    if (!SUBTITLE_CODECS.includes(codec)) {
      throw new TypeError(`Invalid subtitle codec '${codec}'. Must be one of: ${SUBTITLE_CODECS.join(", ")}.`);
    }
    this._codec = codec;
  }
};

// node_modules/mediabunny/dist/modules/src/output.js
var ALL_TRACK_TYPES = ["video", "audio", "subtitle"];
var validateBaseTrackMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object") {
    throw new TypeError("metadata must be an object.");
  }
  if (metadata.languageCode !== void 0 && !isIso639Dash2LanguageCode(metadata.languageCode)) {
    throw new TypeError("metadata.languageCode, when provided, must be a three-letter, ISO 639-2/T language code.");
  }
  if (metadata.name !== void 0 && typeof metadata.name !== "string") {
    throw new TypeError("metadata.name, when provided, must be a string.");
  }
  if (metadata.disposition !== void 0) {
    validateTrackDisposition(metadata.disposition);
  }
  if (metadata.maximumPacketCount !== void 0 && (!Number.isInteger(metadata.maximumPacketCount) || metadata.maximumPacketCount < 0)) {
    throw new TypeError("metadata.maximumPacketCount, when provided, must be a non-negative integer.");
  }
};
var Output = class {
  /**
   * Creates a new instance of {@link Output} which can then be used to create a new media file according to the
   * specified {@link OutputOptions}.
   */
  constructor(options) {
    this.state = "pending";
    this._tracks = [];
    this._startPromise = null;
    this._cancelPromise = null;
    this._finalizePromise = null;
    this._mutex = new AsyncMutex();
    this._metadataTags = {};
    if (!options || typeof options !== "object") {
      throw new TypeError("options must be an object.");
    }
    if (!(options.format instanceof OutputFormat)) {
      throw new TypeError("options.format must be an OutputFormat.");
    }
    if (!(options.target instanceof Target)) {
      throw new TypeError("options.target must be a Target.");
    }
    if (options.target._output) {
      throw new Error("Target is already used for another output.");
    }
    options.target._output = this;
    this.format = options.format;
    this.target = options.target;
    this._writer = options.target._createWriter();
    this._muxer = options.format._createMuxer(this);
  }
  /** Adds a video track to the output with the given source. Can only be called before the output is started. */
  addVideoTrack(source, metadata = {}) {
    if (!(source instanceof VideoSource)) {
      throw new TypeError("source must be a VideoSource.");
    }
    validateBaseTrackMetadata(metadata);
    if (metadata.rotation !== void 0 && ![0, 90, 180, 270].includes(metadata.rotation)) {
      throw new TypeError(`Invalid video rotation: ${metadata.rotation}. Has to be 0, 90, 180 or 270.`);
    }
    if (!this.format.supportsVideoRotationMetadata && metadata.rotation) {
      throw new Error(`${this.format._name} does not support video rotation metadata.`);
    }
    if (metadata.frameRate !== void 0 && (!Number.isFinite(metadata.frameRate) || metadata.frameRate <= 0)) {
      throw new TypeError(`Invalid video frame rate: ${metadata.frameRate}. Must be a positive number.`);
    }
    this._addTrack("video", source, metadata);
  }
  /** Adds an audio track to the output with the given source. Can only be called before the output is started. */
  addAudioTrack(source, metadata = {}) {
    if (!(source instanceof AudioSource)) {
      throw new TypeError("source must be an AudioSource.");
    }
    validateBaseTrackMetadata(metadata);
    this._addTrack("audio", source, metadata);
  }
  /** Adds a subtitle track to the output with the given source. Can only be called before the output is started. */
  addSubtitleTrack(source, metadata = {}) {
    if (!(source instanceof SubtitleSource)) {
      throw new TypeError("source must be a SubtitleSource.");
    }
    validateBaseTrackMetadata(metadata);
    this._addTrack("subtitle", source, metadata);
  }
  /**
   * Sets descriptive metadata tags about the media file, such as title, author, date, or cover art. When called
   * multiple times, only the metadata from the last call will be used.
   *
   * Can only be called before the output is started.
   */
  setMetadataTags(tags) {
    validateMetadataTags(tags);
    if (this.state !== "pending") {
      throw new Error("Cannot set metadata tags after output has been started or canceled.");
    }
    this._metadataTags = tags;
  }
  /** @internal */
  _addTrack(type, source, metadata) {
    if (this.state !== "pending") {
      throw new Error("Cannot add track after output has been started or canceled.");
    }
    if (source._connectedTrack) {
      throw new Error("Source is already used for a track.");
    }
    const supportedTrackCounts = this.format.getSupportedTrackCounts();
    const presentTracksOfThisType = this._tracks.reduce((count, track2) => count + (track2.type === type ? 1 : 0), 0);
    const maxCount = supportedTrackCounts[type].max;
    if (presentTracksOfThisType === maxCount) {
      throw new Error(maxCount === 0 ? `${this.format._name} does not support ${type} tracks.` : `${this.format._name} does not support more than ${maxCount} ${type} track${maxCount === 1 ? "" : "s"}.`);
    }
    const maxTotalCount = supportedTrackCounts.total.max;
    if (this._tracks.length === maxTotalCount) {
      throw new Error(`${this.format._name} does not support more than ${maxTotalCount} tracks${maxTotalCount === 1 ? "" : "s"} in total.`);
    }
    const track = {
      id: this._tracks.length + 1,
      output: this,
      type,
      source,
      metadata
    };
    if (track.type === "video") {
      const supportedVideoCodecs = this.format.getSupportedVideoCodecs();
      if (supportedVideoCodecs.length === 0) {
        throw new Error(`${this.format._name} does not support video tracks.` + this.format._codecUnsupportedHint(track.source._codec));
      } else if (!supportedVideoCodecs.includes(track.source._codec)) {
        throw new Error(`Codec '${track.source._codec}' cannot be contained within ${this.format._name}. Supported video codecs are: ${supportedVideoCodecs.map((codec) => `'${codec}'`).join(", ")}.` + this.format._codecUnsupportedHint(track.source._codec));
      }
    } else if (track.type === "audio") {
      const supportedAudioCodecs = this.format.getSupportedAudioCodecs();
      if (supportedAudioCodecs.length === 0) {
        throw new Error(`${this.format._name} does not support audio tracks.` + this.format._codecUnsupportedHint(track.source._codec));
      } else if (!supportedAudioCodecs.includes(track.source._codec)) {
        throw new Error(`Codec '${track.source._codec}' cannot be contained within ${this.format._name}. Supported audio codecs are: ${supportedAudioCodecs.map((codec) => `'${codec}'`).join(", ")}.` + this.format._codecUnsupportedHint(track.source._codec));
      }
    } else if (track.type === "subtitle") {
      const supportedSubtitleCodecs = this.format.getSupportedSubtitleCodecs();
      if (supportedSubtitleCodecs.length === 0) {
        throw new Error(`${this.format._name} does not support subtitle tracks.` + this.format._codecUnsupportedHint(track.source._codec));
      } else if (!supportedSubtitleCodecs.includes(track.source._codec)) {
        throw new Error(`Codec '${track.source._codec}' cannot be contained within ${this.format._name}. Supported subtitle codecs are: ${supportedSubtitleCodecs.map((codec) => `'${codec}'`).join(", ")}.` + this.format._codecUnsupportedHint(track.source._codec));
      }
    }
    this._tracks.push(track);
    source._connectedTrack = track;
  }
  /**
   * Starts the creation of the output file. This method should be called after all tracks have been added. Only after
   * the output has started can media samples be added to the tracks.
   *
   * @returns A promise that resolves when the output has successfully started and is ready to receive media samples.
   */
  async start() {
    const supportedTrackCounts = this.format.getSupportedTrackCounts();
    for (const trackType of ALL_TRACK_TYPES) {
      const presentTracksOfThisType = this._tracks.reduce((count, track) => count + (track.type === trackType ? 1 : 0), 0);
      const minCount = supportedTrackCounts[trackType].min;
      if (presentTracksOfThisType < minCount) {
        throw new Error(minCount === supportedTrackCounts[trackType].max ? `${this.format._name} requires exactly ${minCount} ${trackType} track${minCount === 1 ? "" : "s"}.` : `${this.format._name} requires at least ${minCount} ${trackType} track${minCount === 1 ? "" : "s"}.`);
      }
    }
    const totalMinCount = supportedTrackCounts.total.min;
    if (this._tracks.length < totalMinCount) {
      throw new Error(totalMinCount === supportedTrackCounts.total.max ? `${this.format._name} requires exactly ${totalMinCount} track${totalMinCount === 1 ? "" : "s"}.` : `${this.format._name} requires at least ${totalMinCount} track${totalMinCount === 1 ? "" : "s"}.`);
    }
    if (this.state === "canceled") {
      throw new Error("Output has been canceled.");
    }
    if (this._startPromise) {
      console.warn("Output has already been started.");
      return this._startPromise;
    }
    return this._startPromise = (async () => {
      this.state = "started";
      this._writer.start();
      const release = await this._mutex.acquire();
      await this._muxer.start();
      const promises = this._tracks.map((track) => track.source._start());
      await Promise.all(promises);
      release();
    })();
  }
  /**
   * Resolves with the full MIME type of the output file, including track codecs.
   *
   * The returned promise will resolve only once the precise codec strings of all tracks are known.
   */
  getMimeType() {
    return this._muxer.getMimeType();
  }
  /**
   * Cancels the creation of the output file, releasing internal resources like encoders and preventing further
   * samples from being added.
   *
   * @returns A promise that resolves once all internal resources have been released.
   */
  async cancel() {
    if (this._cancelPromise) {
      console.warn("Output has already been canceled.");
      return this._cancelPromise;
    } else if (this.state === "finalizing" || this.state === "finalized") {
      console.warn("Output has already been finalized.");
      return;
    }
    return this._cancelPromise = (async () => {
      this.state = "canceled";
      const release = await this._mutex.acquire();
      const promises = this._tracks.map((x) => x.source._flushOrWaitForOngoingClose(true));
      await Promise.all(promises);
      await this._writer.close();
      release();
    })();
  }
  /**
   * Finalizes the output file. This method must be called after all media samples across all tracks have been added.
   * Once the Promise returned by this method completes, the output file is ready.
   */
  async finalize() {
    if (this.state === "pending") {
      throw new Error("Cannot finalize before starting.");
    }
    if (this.state === "canceled") {
      throw new Error("Cannot finalize after canceling.");
    }
    if (this._finalizePromise) {
      console.warn("Output has already been finalized.");
      return this._finalizePromise;
    }
    return this._finalizePromise = (async () => {
      this.state = "finalizing";
      const release = await this._mutex.acquire();
      const promises = this._tracks.map((x) => x.source._flushOrWaitForOngoingClose(false));
      await Promise.all(promises);
      await this._muxer.finalize();
      await this._writer.flush();
      await this._writer.finalize();
      this.state = "finalized";
      release();
    })();
  }
};

// node_modules/mediabunny/dist/modules/src/index.js
var MEDIABUNNY_LOADED_SYMBOL = Symbol.for("mediabunny loaded");
if (globalThis[MEDIABUNNY_LOADED_SYMBOL]) {
  console.error("[WARNING]\nMediabunny was loaded twice. This will likely cause Mediabunny not to work correctly. Check if multiple dependencies are importing different versions of Mediabunny, or if something is being bundled incorrectly.");
}
globalThis[MEDIABUNNY_LOADED_SYMBOL] = true;

// src/renderer-browser/layers/RuntimeBaseLayer.ts
var RuntimeBaseLayer = class {
  json;
  fps;
  projectWidth;
  projectHeight;
  $element = null;
  /** Reference to the parent renderer for font loading, property lookup, etc. */
  renderer;
  constructor(json, fps, width, height, renderer2) {
    this.json = json;
    this.fps = fps;
    this.projectWidth = width;
    this.projectHeight = height;
    this.renderer = renderer2;
  }
  // -- Capabilities (overridden by subclasses) ----------------------------
  /** Whether this layer type produces visible output. */
  get hasVisual() {
    return false;
  }
  /** Whether this layer type produces audio output. */
  get hasAudio() {
    return false;
  }
  // -- Timing helpers -----------------------------------------------------
  /** Timeline-time (seconds) at which the playable segment starts. */
  get startTime() {
    return this.json.settings.startTime ?? 0;
  }
  /** Source-time (seconds) offset where the playable segment begins. */
  get sourceStart() {
    return this.json.settings.sourceStart ?? 0;
  }
  /** Length of the playable segment in source seconds. */
  get sourceDuration() {
    return this.json.settings.sourceDuration ?? 0;
  }
  /** Intrinsic length of the source media in seconds, when known. */
  get mediaDuration() {
    return this.json.settings.mediaDuration;
  }
  get speed() {
    return this.json.settings.speed ?? 1;
  }
  /** Length of the layer's timeline footprint in seconds. */
  get timelineDuration() {
    const speedAbs = Math.abs(this.speed);
    if (speedAbs === 0) return 0;
    return this.sourceDuration / speedAbs;
  }
  /** Timeline-time (seconds) at which the layer's footprint ends. */
  get endTime() {
    return this.startTime + this.timelineDuration;
  }
  get startFrame() {
    return Math.round(this.startTime * this.fps);
  }
  get endFrame() {
    return Math.round(this.endTime * this.fps);
  }
  // -- Retiming -----------------------------------------------------------
  /**
   * Convert a timeline frame to the corresponding **absolute source-time**
   * (in seconds). This is the value at which keyframes should be looked up
   * and the value to feed into a video element's `currentTime`.
   */
  sourceTimeAtFrame(frame) {
    const timelineSec = frame / this.fps;
    const elapsedSec = timelineSec - this.startTime;
    const speedAbs = Math.abs(this.speed);
    if (speedAbs === 0) return this.sourceStart;
    const elapsedSourceSec = elapsedSec * speedAbs;
    if (this.speed < 0) {
      return this.sourceStart + this.sourceDuration - elapsedSourceSec;
    }
    return this.sourceStart + elapsedSourceSec;
  }
  // -- Property interpolation ---------------------------------------------
  /**
   * Get all animated property values for this layer at the given frame.
   *
   * Iterates the layer's set properties and interpolates each one at the
   * retimed frame.
   */
  getPropertiesAtFrame(frame) {
    const sourceTimeSec = this.sourceTimeAtFrame(frame);
    const props = {};
    const allDefs = this.getPropertiesDefinition();
    for (const anim of this.json.animations) {
      const kfs = anim.keyframes;
      if (kfs.length === 0) continue;
      const definition = allDefs[anim.property];
      if (!definition) continue;
      props[anim.property] = this.interpolateKeyframes(anim.property, sourceTimeSec, kfs, definition);
    }
    for (const [key, value] of Object.entries(this.json.properties)) {
      if (!(key in props)) {
        const definition = allDefs[key];
        if (!definition) continue;
        props[key] = this.ensureUnit(value, definition);
      }
    }
    for (const [key, def] of Object.entries(allDefs)) {
      if (!(key in props) && def.default !== void 0) {
        props[key] = this.ensureUnit(def.default, def);
      }
    }
    return props;
  }
  /**
   * Interpolate keyframes for a property at a given time.
   */
  interpolateKeyframes(property, time, keyframes, definition) {
    if (keyframes.length === 0) return definition?.default;
    const kf1Idx = keyframes.findIndex((kf) => kf.time > time);
    const kf1 = kf1Idx >= 0 ? keyframes[kf1Idx] : null;
    if (!kf1) {
      return this.ensureUnit(keyframes[keyframes.length - 1].value, definition);
    }
    const kf2 = kf1Idx > 0 ? keyframes[kf1Idx - 1] : null;
    if (!kf2) {
      return this.ensureUnit(kf1.value, definition);
    }
    if (kf2.time === time) {
      return this.ensureUnit(kf2.value, definition);
    }
    if (definition?.animatable === false) {
      return kf2.value;
    }
    const t = (time - kf2.time) / (kf1.time - kf2.time);
    return this.interpolate(kf2.value, kf1.value, t, kf2.easing ?? "step", definition);
  }
  // -- Unit handling --
  /** Ensure a value has the correct unit from the property definition. */
  ensureUnit(value, definition) {
    if (!definition || definition.animatable === false) return value;
    if (Array.isArray(value)) return value.map((v2) => this.ensureUnit(v2, definition));
    if (this.isColor(value)) return value;
    const [v, u] = this.getNumUnit(value);
    const units = definition.units ?? [""];
    if (!units.includes(u)) {
      if (units.includes("")) return v;
      return `${v}${units[0]}`;
    }
    return `${v}${u}`;
  }
  /** Parse a value into [number, unit]. */
  getNumUnit(value) {
    const match = String(value).match(/^([0-9.-]+)([a-z%]*)$/i);
    if (match) return [parseFloat(match[1]), match[2]];
    return [parseFloat(String(value)), ""];
  }
  /** Check if a value is a CSS color string. */
  isColor(v) {
    return typeof v === "string" && /^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|[a-z]+$)/i.test(v);
  }
  /** Prepare two values for interpolation, ensuring compatible units. */
  prepareUnits(v1, v2, definition) {
    const units = definition?.units ?? [""];
    if (typeof v1 === "number" && typeof v2 === "number" && units.includes("")) {
      return [v1, void 0, v2, void 0];
    }
    let [n1, u1] = this.getNumUnit(v1);
    let [n2, u2] = this.getNumUnit(v2);
    if (!units.includes(u1)) u1 = units[0];
    if (!units.includes(u2)) u2 = units[0];
    if (u1 !== u2) {
      return [`${n1}${u1}`, u1, `${n2}${u2}`, u2];
    }
    return [n1, u1, n2, u2];
  }
  /** Match array sizes for interpolation. */
  matchArraySizes(v1, v2, cssProperty) {
    const a1 = Array.isArray(v1) ? v1 : [v1];
    const a2 = Array.isArray(v2) ? v2 : [v2];
    const extendSame = !["--position", "--rotation", "--anchor"].includes(cssProperty ?? "");
    if (a1.length > a2.length) {
      return [a1, a2.concat(new Array(a1.length - a2.length).fill(extendSame ? a2[a2.length - 1] : 0))];
    }
    if (a1.length < a2.length) {
      return [a1.concat(new Array(a2.length - a1.length).fill(extendSame ? a1[a1.length - 1] : 0)), a2];
    }
    return [a1, a2];
  }
  // -- Interpolation --
  /** Interpolate between two values with easing. */
  interpolate(v1, v2, t, easing, definition) {
    const cssProperty = typeof definition?.cssProperty === "string" ? definition.cssProperty : void 0;
    if (Array.isArray(v1) || Array.isArray(v2)) {
      const [a1, a2] = this.matchArraySizes(v1, v2, cssProperty);
      return a1.map((_, i) => this.interpolate(a1[i], a2[i], t, easing, definition));
    }
    const isCol = this.isColor(v1);
    let n1, u1, n2, u2;
    if (isCol) {
      [n1, u1, n2, u2] = [v1, void 0, v2, void 0];
    } else {
      [n1, u1, n2, u2] = this.prepareUnits(v1, v2, definition);
    }
    if (typeof n1 === "number" && typeof n2 === "number" || easing === "step") {
      const outUnit = u2 ?? "";
      switch (easing) {
        case "step":
          return outUnit ? n1 + outUnit : n1;
        case "easeIn":
          return n1 + (n2 - n1) * (t * t) + outUnit;
        case "easeOut":
          return n1 + (n2 - n1) * (t * (2 - t)) + outUnit;
        case "easeInOut":
          return n1 + (n2 - n1) * (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t) + outUnit;
        case "linear":
        default:
          return n1 + (n2 - n1) * t + outUnit;
      }
    } else {
      if (!this.$element) return v1;
      let propAnim = cssProperty ?? "--value";
      if (propAnim.startsWith("--")) {
        if (isCol) propAnim = "color";
        else if (u1 === "%" || u2 === "%" || u1 === "" || u2 === "") propAnim = "flex-grow";
        else propAnim = "width";
      }
      const anim = this.$element.animate([
        { [propAnim]: v1 },
        { [propAnim]: v2 }
      ], {
        duration: 1e3,
        fill: "both",
        easing: {
          linear: "linear",
          easeIn: "ease-in",
          easeOut: "ease-out",
          easeInOut: "ease-in-out"
        }[easing] || "ease-in-out"
      });
      anim.pause();
      anim.currentTime = t * 1e3;
      const computed = getComputedStyle(this.$element)[propAnim];
      anim.cancel();
      return computed;
    }
  }
  /** Apply an easing curve to a normalised t ∈ [0, 1]. */
  applyEasing(t, easing) {
    switch (easing) {
      case "step":
        return 0;
      case "linear":
        return t;
      case "easeIn":
        return t * t;
      case "easeOut":
        return t * (2 - t);
      case "easeInOut":
        return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      default:
        return t;
    }
  }
  // -- Lifecycle (overridden by subclasses) --------------------------------
  /** Initialise media assets (fetch, decode, extract metadata). */
  async initialize() {
  }
  /**
   * Intrinsic source duration in seconds, when known by this runtime layer.
   * Subclasses (RuntimeMediaLayer / RuntimeAudioLayer) override.
   */
  get intrinsicDuration() {
    return void 0;
  }
  /**
   * Resolve a deferred `sourceEnd` setting into a concrete `sourceDuration`
   * once the runtime layer's intrinsic media duration is known. Called by
   * the renderer after `initialize()` and before any frame is rendered.
   * No-op when there is no `sourceEnd` to resolve, or when the intrinsic
   * duration is unknown.
   */
  resolveMediaTimings() {
    const s = this.json.settings;
    if (s.sourceEnd == null) return;
    const intrinsic = this.intrinsicDuration;
    if (intrinsic == null || !Number.isFinite(intrinsic) || intrinsic <= 0) return;
    const sourceStart = s.sourceStart ?? 0;
    const sourceDuration = Math.max(0, intrinsic - sourceStart - s.sourceEnd);
    s.sourceDuration = sourceDuration;
    s.mediaDuration = intrinsic;
    delete s.sourceEnd;
  }
  /**
   * Create the DOM element for this layer.
   *
   * Uses the static elementTag from the constructor and sets data-element and
   * data-id attributes. Returns `null` for layers with no visual output.
   */
  async generateElement() {
    if (!this.hasVisual) return null;
    if (this.$element) return this.$element;
    return null;
  }
  // -- Frame rendering ----------------------------------------------------
  /**
   * Render this layer's visual state at the given frame.
   *
   * Hides if out of range, gets properties, applies them, shows.
   */
  async renderFrame(frame) {
    if (!this.$element) return;
    if (frame < this.startFrame || frame >= this.endFrame || !this.json.settings.enabled) {
      this.$element.style.display = "none";
      return;
    }
    const props = this.getPropertiesAtFrame(frame);
    await this.applyProperties(props);
    this.$element.style.display = "";
  }
  // -- Property application --
  /**
   * Reset CSS on the element before applying new properties.
   * Subclasses override to add layer-specific resets (e.g. data-fit, --object-width).
   */
  resetCSSProperties() {
    if (!this.$element) return;
    if (this.$element.style.display === "none")
      this.$element.style.cssText = "display:none;";
    else
      this.$element.style.cssText = "";
  }
  /**
   * Apply interpolated property values to the DOM element.
   *
   * 1. Reset CSS
   * 2. Set z-index
   * 3. For each property:
   *    - cssProperty === false → applyProperty() (non-CSS, e.g. text)
   *    - otherwise → applyCSSProperty() (CSS property or variable)
   *
   * Subclasses override applyProperties to pre-process props (e.g.
   * VisualLayer removes unused shadow sub-props, builds filter array).
   */
  async applyProperties(props) {
    if (!this.$element) return;
    this.resetCSSProperties();
    const propertiesDefinition = this.getPropertiesDefinition();
    this.$element.style.setProperty("z-index", String(this.getLayerIndex() + 1));
    for (const prop of Object.keys(props)) {
      const definition = propertiesDefinition[prop];
      if (definition?.cssProperty === false) {
        await this.applyProperty(prop, props[prop], definition);
      } else {
        const value = props[prop];
        const cssProp = typeof definition?.cssProperty === "string" ? definition.cssProperty : prop;
        if (Array.isArray(value) && cssProp.startsWith("--")) {
          for (let i = 0; i < value.length; i++) {
            await this.applyCSSProperty(`${cssProp}-${i}`, String(value[i]), definition);
          }
        } else {
          await this.applyCSSProperty(cssProp, value, definition);
        }
      }
    }
  }
  /**
   * Apply a single CSS property to the element.
   * Subclasses override to intercept specific properties (e.g. boxShadow,
   * filter, text-align, font-family, fit).
   */
  async applyCSSProperty(prop, value, definition) {
    if (!this.$element) return;
    this.$element.style.setProperty(prop, Array.isArray(value) ? value.join(" ") : String(value));
  }
  /**
   * Handle a non-CSS property (cssProperty === false).
   * Subclasses override to handle properties like `text`, `mute`, etc.
   */
  async applyProperty(prop, value, definition) {
  }
  /**
   * Get the full propertiesDefinition for this layer's type.
   */
  getPropertiesDefinition() {
    return this.renderer.getPropertyDefinition(this.json.type) ?? {};
  }
  /**
   * Look up a single property definition.
   */
  getPropertyDefinition(prop) {
    return this.getPropertiesDefinition()[prop];
  }
  /** Get this layer's index in the parent layers array (for z-ordering). */
  getLayerIndex() {
    return this.renderer.layers.indexOf(this);
  }
  // -- Cleanup ------------------------------------------------------------
  /** Release resources. */
  destroy() {
  }
};

// src/renderer-browser/layers/RuntimeVisualLayer.ts
var FILTER_MAP = {
  blur: "blur",
  brightness: "brightness",
  contrast: "contrast",
  grayscale: "grayscale",
  hueRotate: "hue-rotate",
  invert: "invert",
  opacity: "opacity",
  saturate: "saturate",
  sepia: "sepia"
};
var FILTER_DEFAULTS = {
  blur: 0,
  brightness: 1,
  contrast: 1,
  grayscale: 0,
  sepia: 0,
  invert: 0,
  hueRotate: 0,
  saturate: 1,
  opacity: 1
};
var RuntimeVisualLayer = class extends RuntimeBaseLayer {
  get hasVisual() {
    return true;
  }
  /**
   * Override applyProperties to pre-process visual props before CSS application.
   *
   * - Remove boxShadow sub-props if boxShadow is false
   * - Build filter array from individual filter* props
   */
  async applyProperties(props) {
    if (!props.boxShadow) {
      delete props.boxShadowColor;
      delete props.boxShadowOffset;
      delete props.boxShadowBlur;
      delete props.boxShadowSpread;
    }
    const nonDefaultFilters = Object.keys(FILTER_MAP).filter((p) => {
      const propKey = `filter${p.charAt(0).toUpperCase()}${p.slice(1)}`;
      if (!Object.hasOwn(props, propKey)) return false;
      return props[propKey] !== FILTER_DEFAULTS[p];
    });
    if (nonDefaultFilters.length > 0) {
      props.filter = nonDefaultFilters;
    } else {
      delete props.filter;
    }
    return super.applyProperties(props);
  }
  /**
   * Override applyCSSProperty for visual-specific CSS handling.
   */
  async applyCSSProperty(prop, value, definition) {
    if (prop === "boxShadow") {
      if (value) {
        return super.applyCSSProperty(
          "box-shadow",
          "var(--box-shadow-offset-0) var(--box-shadow-offset-1) var(--box-shadow-blur) var(--box-shadow-spread) var(--box-shadow-color)",
          definition
        );
      }
      return;
    }
    if (prop === "filter") {
      if (Array.isArray(value) && value.length > 0) {
        return super.applyCSSProperty(
          "filter",
          value.map((v) => `${FILTER_MAP[v]}(var(--filter-${FILTER_MAP[v]}))`).join(" "),
          definition
        );
      }
      return;
    }
    if (prop === "border-radius") {
      let vals = Array.isArray(value) ? value : [value];
      vals = vals.map((v) => {
        if (typeof v === "number" || typeof v === "string" && /^[0-9.]+$/.test(v)) {
          return `calc(${v} * 0.5px * min(var(--object-actual-width, var(--project-width)), var(--object-actual-height, var(--project-height))))`;
        }
        return v;
      });
      return super.applyCSSProperty(prop, vals.join(" "), definition);
    }
    if (prop === "visible") {
      if (!value) {
        return super.applyCSSProperty("visibility", "hidden", definition);
      }
      return;
    }
    if (prop === "outerBorder") {
      if (value) {
        return super.applyCSSProperty("box-sizing", "content-box", definition);
      }
      return;
    }
    return super.applyCSSProperty(prop, value, definition);
  }
};

// src/renderer-browser/layers/RuntimeTextualLayer.ts
var RuntimeTextualLayer = class extends RuntimeVisualLayer {
  async generateElement() {
    if (this.$element) return this.$element;
    this.$element = document.createElement("textual-layer");
    this.$element.setAttribute("data-element", this.json.type);
    this.$element.setAttribute("data-id", this.json.id);
    this.$element.layerObject = this;
    return this.$element;
  }
  /**
   * Override applyProperties to pre-process text props:
   * - Remove textStroke sub-props if textStroke is false
   * - Remove textShadow sub-props if textShadow is false
   */
  async applyProperties(props) {
    if (!props.textStroke) {
      delete props.textStrokeWidth;
      delete props.textStrokeColor;
    }
    if (!props.textShadow) {
      delete props.textShadowOffset;
      delete props.textShadowBlur;
      delete props.textShadowColor;
    }
    return super.applyProperties(props);
  }
  /**
   * Override applyCSSProperty for text-specific CSS handling.
   */
  async applyCSSProperty(prop, value, definition) {
    if (prop === "text-align") {
      if (value === "left" || value === "justify") {
        await super.applyCSSProperty("left", "50%", { units: ["%"], default: 0 });
      } else if (value === "right") {
        await super.applyCSSProperty("right", "50%", { units: ["%"], default: 0 });
      }
    } else if (prop === "vertical-align") {
      if (value === "top") {
        return super.applyCSSProperty("top", "50%", { units: ["%"], default: 0 });
      } else if (value === "bottom") {
        return super.applyCSSProperty("bottom", "50%", { units: ["%"], default: 0 });
      }
      return;
    } else if (prop === "textShadow") {
      if (value) {
        return super.applyCSSProperty(
          "text-shadow",
          "var(--text-shadow-offset-0) var(--text-shadow-offset-1) var(--text-shadow-blur) var(--text-shadow-color)",
          definition
        );
      }
      return;
    } else if (prop === "font-family") {
      await this.renderer.loadFont(value);
      value = `"${value}", "Noto Sans", Roboto, Verdana, Helvetica, sans-serif`;
    }
    return super.applyCSSProperty(prop, value, definition);
  }
};

// src/renderer-browser/layers/RuntimeTextLayer.ts
var RuntimeTextLayer = class extends RuntimeTextualLayer {
  async applyProperty(prop, value, definition) {
    if (prop === "text") {
      if (this.$element) this.$element.textContent = value;
    } else {
      await super.applyProperty(prop, value, definition);
    }
  }
};

// src/renderer-browser/layers/RuntimeCaptionsLayer.ts
var RuntimeCaptionsLayer = class extends RuntimeTextualLayer {
  getPropertiesAtFrame(frame) {
    const props = super.getPropertiesAtFrame(frame);
    if (this.json.settings.captions) {
      const timeSec = frame / this.fps;
      const caption = this.json.settings.captions.find(
        (c) => c.startTime <= timeSec && c.endTime >= timeSec
      );
      props["text"] = caption?.caption ?? "";
    }
    return props;
  }
  async applyProperty(prop, value, definition) {
    if (prop === "text") {
      if (this.$element) this.$element.textContent = value;
    } else {
      await super.applyProperty(prop, value, definition);
    }
  }
};

// src/renderer-browser/layers/RuntimeMediaLayer.ts
var RuntimeMediaLayer = class extends RuntimeVisualLayer {
  ctx = null;
  internalMedia = null;
  dimensions = [0, 0];
  duration = 0;
  /** Handle into the global media cache; null until initialize() runs. */
  cacheEntry = null;
  /** Backwards-compatible accessor — returns the cached blob, if any. */
  get dataBlob() {
    return this.cacheEntry?.blob ?? null;
  }
  /** Backwards-compatible accessor — returns the cached object URL, if any. */
  get dataUrl() {
    return this.cacheEntry?.objectUrl ?? null;
  }
  get intrinsicDuration() {
    return this.duration > 0 ? this.duration : void 0;
  }
  async generateElement() {
    if (this.$element) return this.$element;
    this.$element = document.createElement("canvas");
    this.$element.setAttribute("data-element", this.json.type);
    this.$element.setAttribute("data-id", this.json.id);
    this.$element.layerObject = this;
    return this.$element;
  }
  /**
   * Override resetCSSProperties to clear data-fit and set object dimensions.
   */
  resetCSSProperties() {
    super.resetCSSProperties();
    if (this.$element) {
      this.$element.removeAttribute("data-fit");
    }
  }
  /**
   * Override applyProperties to ensure fit is always set.
   */
  async applyProperties(props) {
    if (!props.fit) {
      const defaultProps = this.getPropertiesDefinition();
      props.fit = defaultProps.fit?.default ?? "cover";
    }
    return super.applyProperties(props);
  }
  /**
   * Override applyCSSProperty to handle the `fit` property via data attribute.
   */
  async applyCSSProperty(prop, value, definition) {
    if (prop === "fit") {
      if (this.$element) this.$element.setAttribute("data-fit", value);
      return;
    }
    return super.applyCSSProperty(prop, value, definition);
  }
  destroy() {
    if (this.cacheEntry) {
      const source = this.json.settings.source;
      if (typeof source === "string") loadedMedia.release(source);
      this.cacheEntry = null;
    }
  }
};

// src/renderer-browser/layers/RuntimeImageLayer.ts
var RuntimeImageLayer = class extends RuntimeMediaLayer {
  async initialize() {
    if (this.cacheEntry) return;
    const source = this.json.settings.source;
    if (!source) return;
    this.cacheEntry = await loadedMedia.acquire(source);
    this.internalMedia = document.createElement("img");
    this.internalMedia.src = this.cacheEntry.objectUrl;
    await new Promise((resolve, reject) => {
      this.internalMedia.onload = () => {
        this.dimensions = [
          this.internalMedia.naturalWidth,
          this.internalMedia.naturalHeight
        ];
        resolve();
      };
      this.internalMedia.onerror = () => reject(new Error(`Failed to load image: ${source}`));
    });
  }
  /**
   * Override generateElement to set canvas dimensions and draw initial image.
   */
  async generateElement() {
    const $ele = await super.generateElement();
    if ($ele) {
      $ele.width = this.dimensions[0];
      $ele.height = this.dimensions[1];
      if (!this.ctx) {
        this.ctx = $ele.getContext("2d");
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = "high";
        this.ctx.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
        if (this.internalMedia) {
          this.ctx.drawImage(
            this.internalMedia,
            0,
            0,
            this.dimensions[0],
            this.dimensions[1]
          );
        }
      }
    }
    return $ele;
  }
  /**
   * Override resetCSSProperties to set object dimensions for fit calculations.
   */
  resetCSSProperties() {
    super.resetCSSProperties();
    if (this.$element) {
      this.$element.style.setProperty("--object-width", String(this.dimensions[0]));
      this.$element.style.setProperty("--object-height", String(this.dimensions[1]));
    }
  }
};

// src/renderer-browser/layers/RuntimeVideoLayer.ts
var RuntimeVideoLayer = class extends RuntimeMediaLayer {
  get hasAudio() {
    return true;
  }
  /** Dual video elements for decode-ahead buffering. */
  vidA = null;
  vidB = null;
  /** Track which time each video element is targeted to. */
  vidATargetTime = -Infinity;
  vidBTargetTime = -Infinity;
  /** Decode completion promises for each video. */
  vidAReady = Promise.resolve();
  vidBReady = Promise.resolve();
  async initialize() {
    if (this.cacheEntry) return;
    const source = this.json.settings.source;
    if (!source) return;
    this.cacheEntry = await loadedMedia.acquire(source);
    if (this.cacheEntry.dimensions) {
      this.dimensions = [...this.cacheEntry.dimensions];
    }
    if (this.cacheEntry.duration > 0) {
      this.duration = this.cacheEntry.duration;
    }
    const createVideoElement = () => {
      const vid = document.createElement("video");
      vid.src = this.cacheEntry.objectUrl;
      vid.controls = false;
      vid.autoplay = false;
      vid.loop = false;
      vid.muted = true;
      vid.defaultMuted = true;
      vid.playsInline = true;
      return vid;
    };
    this.vidA = createVideoElement();
    this.vidB = createVideoElement();
    this.internalMedia = this.vidA;
    await Promise.all([
      new Promise((resolve, reject) => {
        this.vidA.oncanplay = () => {
          this.dimensions = [this.vidA.videoWidth, this.vidA.videoHeight];
          this.duration = this.vidA.duration;
          if (this.cacheEntry) {
            if (!this.cacheEntry.dimensions) {
              this.cacheEntry.dimensions = [this.dimensions[0], this.dimensions[1]];
            }
            if (!(this.cacheEntry.duration > 0)) {
              this.cacheEntry.duration = this.duration;
            }
          }
          resolve();
        };
        this.vidA.onerror = () => reject(new Error(`Failed to load video: ${source}`));
      }),
      new Promise((resolve, reject) => {
        this.vidB.oncanplay = () => resolve();
        this.vidB.onerror = () => reject(new Error(`Failed to load video: ${source}`));
      })
    ]);
  }
  /**
   * Override generateElement to set canvas dimensions and context.
   */
  async generateElement() {
    const $ele = await super.generateElement();
    if ($ele) {
      $ele.width = this.dimensions[0];
      $ele.height = this.dimensions[1];
      if (!this.ctx) {
        this.ctx = $ele.getContext("2d");
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = "high";
      }
    }
    return $ele;
  }
  /**
   * Override resetCSSProperties to set object dimensions for fit calculations.
   */
  resetCSSProperties() {
    super.resetCSSProperties();
    if (this.$element) {
      this.$element.style.setProperty("--object-width", String(this.dimensions[0]));
      this.$element.style.setProperty("--object-height", String(this.dimensions[1]));
    }
  }
  /**
   * Seek a video to a target time and return a promise that resolves
   * when the frame is decoded and ready to display.
   */
  seekVideo(vid, targetTime) {
    vid.pause();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(), 2e3);
      vid.requestVideoFrameCallback(() => {
        clearTimeout(timeout);
        resolve();
      });
      vid.currentTime = targetTime;
    });
  }
  /**
   * Decode-ahead buffering: maintain two video elements that ping-pong.
   * While rendering frame N, frame N+1 is being decoded on the other element.
   *
   * Seeks first, then calls super.renderFrame() for property application.
   */
  async renderFrame(frame) {
    if (this.$element && this.vidA && this.vidB && frame >= this.startFrame && frame < this.endFrame) {
      const targetTime = this.sourceTimeAtFrame(frame);
      const nextFrame = Math.min(frame + 1, this.endFrame - 1);
      const nextTargetTime = this.sourceTimeAtFrame(nextFrame);
      let drawFromVid;
      if (this.vidATargetTime === targetTime) {
        await this.vidAReady;
        drawFromVid = this.vidA;
      } else if (this.vidBTargetTime === targetTime) {
        await this.vidBReady;
        drawFromVid = this.vidB;
      } else {
        const diffA = Math.abs(this.vidATargetTime - targetTime);
        const diffB = Math.abs(this.vidBTargetTime - targetTime);
        if (diffA <= diffB) {
          this.vidATargetTime = targetTime;
          this.vidAReady = this.seekVideo(this.vidA, targetTime);
          await this.vidAReady;
          drawFromVid = this.vidA;
        } else {
          this.vidBTargetTime = targetTime;
          this.vidBReady = this.seekVideo(this.vidB, targetTime);
          await this.vidBReady;
          drawFromVid = this.vidB;
        }
      }
      if (this.ctx) {
        this.ctx.clearRect(0, 0, this.dimensions[0], this.dimensions[1]);
        this.ctx.drawImage(drawFromVid, 0, 0, this.dimensions[0], this.dimensions[1]);
      }
      const other = drawFromVid === this.vidA ? this.vidB : this.vidA;
      const isOtherA = other === this.vidA;
      if (isOtherA) {
        this.vidATargetTime = nextTargetTime;
        this.vidAReady = this.seekVideo(this.vidA, nextTargetTime);
      } else {
        this.vidBTargetTime = nextTargetTime;
        this.vidBReady = this.seekVideo(this.vidB, nextTargetTime);
      }
    }
    return super.renderFrame(frame);
  }
  /**
   * Clean up both video elements and parent resources.
   */
  destroy() {
    if (this.vidA) {
      this.vidA.pause();
      this.vidA = null;
    }
    if (this.vidB) {
      this.vidB.pause();
      this.vidB = null;
    }
    this.internalMedia = null;
    super.destroy();
  }
};

// src/renderer-browser/layers/RuntimeAudioLayer.ts
var RuntimeAudioLayer = class extends RuntimeBaseLayer {
  get hasAudio() {
    return true;
  }
  /** Handle into the global media cache; null until initialize() runs. */
  cacheEntry = null;
  /** Decoded audio buffer (cached when needed for sourceEnd resolution). */
  decodedBuffer = null;
  /** Intrinsic source duration in seconds (populated when known). */
  duration = 0;
  /** Backwards-compatible accessor — returns the cached blob, if any. */
  get dataBlob() {
    return this.cacheEntry?.blob ?? null;
  }
  get intrinsicDuration() {
    return this.duration > 0 ? this.duration : void 0;
  }
  async initialize() {
    if (this.cacheEntry) return;
    const source = this.json.settings.source;
    if (!source) return;
    this.cacheEntry = await loadedMedia.acquire(source);
    if (this.cacheEntry.duration > 0) {
      this.duration = this.cacheEntry.duration;
    }
    if (this.json.settings.sourceEnd != null && !(this.duration > 0)) {
      try {
        const arrayBuffer = await this.cacheEntry.blob.arrayBuffer();
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = new Ctx();
        try {
          this.decodedBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
          this.duration = this.decodedBuffer.duration;
          if (this.cacheEntry && !(this.cacheEntry.duration > 0)) {
            this.cacheEntry.duration = this.duration;
          }
        } finally {
          if (typeof ctx.close === "function") await ctx.close();
        }
      } catch {
      }
    }
  }
  destroy() {
    if (this.cacheEntry) {
      const source = this.json.settings.source;
      if (typeof source === "string") loadedMedia.release(source);
      this.cacheEntry = null;
    }
    this.decodedBuffer = null;
  }
};

// src/renderer-browser/layers/index.ts
var RUNTIME_LAYER_CLASSES = {
  text: RuntimeTextLayer,
  captions: RuntimeCaptionsLayer,
  image: RuntimeImageLayer,
  video: RuntimeVideoLayer,
  audio: RuntimeAudioLayer
};
function createRuntimeLayer(json, fps, width, height, renderer2) {
  const Cls = RUNTIME_LAYER_CLASSES[json.type] ?? RuntimeBaseLayer;
  return new Cls(json, fps, width, height, renderer2);
}

// src/renderer-browser/workerBundle.ts
var workerBundle_default = `function h(t){if(!t)throw new Error("Assertion failed.")}var F=t=>t&&t[t.length-1],pe=t=>t>=0&&t<2**32,p=t=>{let e=0;for(;t.readBits(1)===0&&e<32;)e++;if(e>=32)throw new Error("Invalid exponential-Golomb code.");return(1<<e)-1+t.readBits(e)},G=t=>{let e=p(t);return e&1?e+1>>1:-(e>>1)};var W=t=>t.constructor===Uint8Array?t:ArrayBuffer.isView(t)?new Uint8Array(t.buffer,t.byteOffset,t.byteLength):new Uint8Array(t),$=t=>t.constructor===DataView?t:ArrayBuffer.isView(t)?new DataView(t.buffer,t.byteOffset,t.byteLength):new DataView(t);var q=new TextEncoder;var ge={bt709:1,bt470bg:5,smpte170m:6,bt2020:9,smpte432:12};var we={bt709:1,smpte170m:6,linear:8,"iec61966-2-1":13,pq:16,hlg:18};var be={rgb:0,bt709:1,bt470bg:5,smpte170m:6,"bt2020-ncl":9};var Xt=t=>!!t&&!!t.primaries&&!!t.transfer&&!!t.matrix&&t.fullRange!==void 0,ve=t=>t instanceof ArrayBuffer||typeof SharedArrayBuffer<"u"&&t instanceof SharedArrayBuffer||ArrayBuffer.isView(t),Se=class{constructor(){this.currentPromise=Promise.resolve(),this.pending=0}async acquire(){let e,r=new Promise(n=>{let s=!1;e=()=>{s||(n(),this.pending--,s=!0)}}),i=this.currentPromise;return this.currentPromise=r,this.pending++,await i,e}};var yt=()=>{let t,e;return{promise:new Promise((i,n)=>{t=i,e=n}),resolve:t,reject:e}};var ce=t=>{throw new Error(\`Unexpected value: \${t}\`)};var We=(t,e,r,i)=>{r=r>>>0,r=r&16777215,i?(t.setUint8(e,r&255),t.setUint8(e+1,r>>>8&255),t.setUint8(e+2,r>>>16&255)):(t.setUint8(e,r>>>16&255),t.setUint8(e+1,r>>>8&255),t.setUint8(e+2,r&255))},Gt=(t,e,r,i)=>{r=R(r,-8388608,8388607),r<0&&(r=r+16777216&16777215),We(t,e,r,i)};var R=(t,e,r)=>Math.max(e,Math.min(r,t)),Yt="und";var gi=/^[a-z]{3}$/,Kt=t=>gi.test(t),Y=1e6*(1+Number.EPSILON);var Zt=(t,e)=>{let r=t<0?-1:1;t=Math.abs(t);let i=0,n=1,s=1,o=0,a=t;for(;;){let d=Math.floor(a),l=d*s+i,c=d*o+n;if(c>e)return{numerator:r*s,denominator:o};if(i=s,n=o,s=l,o=c,a=1/(a-d),!isFinite(a))break}return{numerator:r*s,denominator:o}},Ne=class{constructor(){this.currentPromise=Promise.resolve()}call(e){return this.currentPromise=this.currentPromise.then(e)}},wt=null,Jt=()=>wt!==null?wt:wt=!!(typeof navigator<"u"&&(navigator.vendor?.match(/apple/i)||/AppleWebKit/.test(navigator.userAgent)&&!/Chrome/.test(navigator.userAgent)||/\\b(iPad|iPhone|iPod)\\b/.test(navigator.userAgent))),bt=null,De=()=>bt!==null?bt:bt=typeof navigator<"u"&&navigator.userAgent?.includes("Firefox");var st=function*(t){for(let e in t){let r=t[e];r!==void 0&&(yield{key:e,value:r})}};var er=()=>{Symbol.dispose??=Symbol("Symbol.dispose")};var ot=t=>{h(t.den!==0);let e=Math.abs(t.num),r=Math.abs(t.den);for(;r!==0;){let n=e%r;e=r,r=n}let i=e||1;return{num:t.num/i,den:t.den/i}},xt=(t,e)=>{if(typeof t!="object"||!t)throw new TypeError(\`\${e} must be an object.\`);if(!Number.isInteger(t.left)||t.left<0)throw new TypeError(\`\${e}.left must be a non-negative integer.\`);if(!Number.isInteger(t.top)||t.top<0)throw new TypeError(\`\${e}.top must be a non-negative integer.\`);if(!Number.isInteger(t.width)||t.width<0)throw new TypeError(\`\${e}.width must be a non-negative integer.\`);if(!Number.isInteger(t.height)||t.height<0)throw new TypeError(\`\${e}.height must be a non-negative integer.\`)};var He=class{constructor(e,r){if(this.data=e,this.mimeType=r,!(e instanceof Uint8Array))throw new TypeError("data must be a Uint8Array.");if(typeof r!="string")throw new TypeError("mimeType must be a string.")}},Tt=class{constructor(e,r,i,n){if(this.data=e,this.mimeType=r,this.name=i,this.description=n,!(e instanceof Uint8Array))throw new TypeError("data must be a Uint8Array.");if(r!==void 0&&typeof r!="string")throw new TypeError("mimeType, when provided, must be a string.");if(i!==void 0&&typeof i!="string")throw new TypeError("name, when provided, must be a string.");if(n!==void 0&&typeof n!="string")throw new TypeError("description, when provided, must be a string.")}},tr=t=>{if(!t||typeof t!="object")throw new TypeError("tags must be an object.");if(t.title!==void 0&&typeof t.title!="string")throw new TypeError("tags.title, when provided, must be a string.");if(t.description!==void 0&&typeof t.description!="string")throw new TypeError("tags.description, when provided, must be a string.");if(t.artist!==void 0&&typeof t.artist!="string")throw new TypeError("tags.artist, when provided, must be a string.");if(t.album!==void 0&&typeof t.album!="string")throw new TypeError("tags.album, when provided, must be a string.");if(t.albumArtist!==void 0&&typeof t.albumArtist!="string")throw new TypeError("tags.albumArtist, when provided, must be a string.");if(t.trackNumber!==void 0&&(!Number.isInteger(t.trackNumber)||t.trackNumber<=0))throw new TypeError("tags.trackNumber, when provided, must be a positive integer.");if(t.tracksTotal!==void 0&&(!Number.isInteger(t.tracksTotal)||t.tracksTotal<=0))throw new TypeError("tags.tracksTotal, when provided, must be a positive integer.");if(t.discNumber!==void 0&&(!Number.isInteger(t.discNumber)||t.discNumber<=0))throw new TypeError("tags.discNumber, when provided, must be a positive integer.");if(t.discsTotal!==void 0&&(!Number.isInteger(t.discsTotal)||t.discsTotal<=0))throw new TypeError("tags.discsTotal, when provided, must be a positive integer.");if(t.genre!==void 0&&typeof t.genre!="string")throw new TypeError("tags.genre, when provided, must be a string.");if(t.date!==void 0&&(!(t.date instanceof Date)||Number.isNaN(t.date.getTime())))throw new TypeError("tags.date, when provided, must be a valid Date.");if(t.lyrics!==void 0&&typeof t.lyrics!="string")throw new TypeError("tags.lyrics, when provided, must be a string.");if(t.images!==void 0){if(!Array.isArray(t.images))throw new TypeError("tags.images, when provided, must be an array.");for(let e of t.images){if(!e||typeof e!="object")throw new TypeError("Each image in tags.images must be an object.");if(!(e.data instanceof Uint8Array))throw new TypeError("Each image.data must be a Uint8Array.");if(typeof e.mimeType!="string")throw new TypeError("Each image.mimeType must be a string.");if(!["coverFront","coverBack","unknown"].includes(e.kind))throw new TypeError("Each image.kind must be 'coverFront', 'coverBack', or 'unknown'.")}}if(t.comment!==void 0&&typeof t.comment!="string")throw new TypeError("tags.comment, when provided, must be a string.");if(t.raw!==void 0){if(!t.raw||typeof t.raw!="object")throw new TypeError("tags.raw, when provided, must be an object.");for(let e of Object.values(t.raw))if(e!==null&&typeof e!="string"&&!(e instanceof Uint8Array)&&!(e instanceof He)&&!(e instanceof Tt))throw new TypeError("Each value in tags.raw must be a string, Uint8Array, RichImageData, AttachedFile, or null.")}};var rr=t=>{if(!t||typeof t!="object")throw new TypeError("disposition must be an object.");if(t.default!==void 0&&typeof t.default!="boolean")throw new TypeError("disposition.default must be a boolean.");if(t.forced!==void 0&&typeof t.forced!="boolean")throw new TypeError("disposition.forced must be a boolean.");if(t.original!==void 0&&typeof t.original!="boolean")throw new TypeError("disposition.original must be a boolean.");if(t.commentary!==void 0&&typeof t.commentary!="boolean")throw new TypeError("disposition.commentary must be a boolean.");if(t.hearingImpaired!==void 0&&typeof t.hearingImpaired!="boolean")throw new TypeError("disposition.hearingImpaired must be a boolean.");if(t.visuallyImpaired!==void 0&&typeof t.visuallyImpaired!="boolean")throw new TypeError("disposition.visuallyImpaired must be a boolean.")};var O=class t{constructor(e){this.bytes=e,this.pos=0}seekToByte(e){this.pos=8*e}readBit(){let e=Math.floor(this.pos/8),r=this.bytes[e]??0,i=7-(this.pos&7),n=(r&1<<i)>>i;return this.pos++,n}readBits(e){if(e===1)return this.readBit();let r=0;for(let i=0;i<e;i++)r<<=1,r|=this.readBit();return r}writeBits(e,r){let i=this.pos+e;for(let n=this.pos;n<i;n++){let s=Math.floor(n/8),o=this.bytes[s],a=7-(n&7);o&=~(1<<a),o|=(r&1<<i-n-1)>>i-n-1<<a,this.bytes[s]=o}this.pos=i}readAlignedByte(){if(this.pos%8!==0)throw new Error("Bitstream is not byte-aligned.");let e=this.pos/8,r=this.bytes[e]??0;return this.pos+=8,r}skipBits(e){this.pos+=e}getBitsLeft(){return this.bytes.length*8-this.pos}clone(){let e=new t(this.bytes);return e.pos=this.pos,e}};var je=[96e3,88200,64e3,48e3,44100,32e3,24e3,22050,16e3,12e3,11025,8e3,7350],at=[-1,1,2,3,4,5,6,8],ir=t=>{if(!t||t.byteLength<2)throw new TypeError("AAC description must be at least 2 bytes long.");let e=new O(t),r=e.readBits(5);r===31&&(r=32+e.readBits(6));let i=e.readBits(4),n=null;i===15?n=e.readBits(24):i<je.length&&(n=je[i]);let s=e.readBits(4),o=null;return s>=1&&s<=7&&(o=at[s]),{objectType:r,frequencyIndex:i,sampleRate:n,channelConfiguration:s,numberOfChannels:o}},ct=t=>{let e=je.indexOf(t.sampleRate),r=null;e===-1&&(e=15,r=t.sampleRate);let i=at.indexOf(t.numberOfChannels);if(i===-1)throw new TypeError(\`Unsupported number of channels: \${t.numberOfChannels}\`);let n=13;t.objectType>=32&&(n+=6),e===15&&(n+=24);let s=Math.ceil(n/8),o=new Uint8Array(s),a=new O(o);return t.objectType<32?a.writeBits(5,t.objectType):(a.writeBits(5,31),a.writeBits(6,t.objectType-32)),a.writeBits(4,e),e===15&&a.writeBits(24,r),a.writeBits(4,i),o};var K=["avc","hevc","vp9","av1","vp8"],L=["pcm-s16","pcm-s16be","pcm-s24","pcm-s24be","pcm-s32","pcm-s32be","pcm-f32","pcm-f32be","pcm-f64","pcm-f64be","pcm-u8","pcm-s8","ulaw","alaw"],Ct=["aac","opus","mp3","vorbis","flac","ac3","eac3"],ie=[...Ct,...L],ye=["webvtt"],$e=[{maxMacroblocks:99,maxBitrate:64e3,maxDpbMbs:396,level:10},{maxMacroblocks:396,maxBitrate:192e3,maxDpbMbs:900,level:11},{maxMacroblocks:396,maxBitrate:384e3,maxDpbMbs:2376,level:12},{maxMacroblocks:396,maxBitrate:768e3,maxDpbMbs:2376,level:13},{maxMacroblocks:396,maxBitrate:2e6,maxDpbMbs:2376,level:20},{maxMacroblocks:792,maxBitrate:4e6,maxDpbMbs:4752,level:21},{maxMacroblocks:1620,maxBitrate:4e6,maxDpbMbs:8100,level:22},{maxMacroblocks:1620,maxBitrate:1e7,maxDpbMbs:8100,level:30},{maxMacroblocks:3600,maxBitrate:14e6,maxDpbMbs:18e3,level:31},{maxMacroblocks:5120,maxBitrate:2e7,maxDpbMbs:20480,level:32},{maxMacroblocks:8192,maxBitrate:2e7,maxDpbMbs:32768,level:40},{maxMacroblocks:8192,maxBitrate:5e7,maxDpbMbs:32768,level:41},{maxMacroblocks:8704,maxBitrate:5e7,maxDpbMbs:34816,level:42},{maxMacroblocks:22080,maxBitrate:135e6,maxDpbMbs:110400,level:50},{maxMacroblocks:36864,maxBitrate:24e7,maxDpbMbs:184320,level:51},{maxMacroblocks:36864,maxBitrate:24e7,maxDpbMbs:184320,level:52},{maxMacroblocks:139264,maxBitrate:24e7,maxDpbMbs:696320,level:60},{maxMacroblocks:139264,maxBitrate:48e7,maxDpbMbs:696320,level:61},{maxMacroblocks:139264,maxBitrate:8e8,maxDpbMbs:696320,level:62}],nr=[{maxPictureSize:36864,maxBitrate:128e3,tier:"L",level:30},{maxPictureSize:122880,maxBitrate:15e5,tier:"L",level:60},{maxPictureSize:245760,maxBitrate:3e6,tier:"L",level:63},{maxPictureSize:552960,maxBitrate:6e6,tier:"L",level:90},{maxPictureSize:983040,maxBitrate:1e7,tier:"L",level:93},{maxPictureSize:2228224,maxBitrate:12e6,tier:"L",level:120},{maxPictureSize:2228224,maxBitrate:3e7,tier:"H",level:120},{maxPictureSize:2228224,maxBitrate:2e7,tier:"L",level:123},{maxPictureSize:2228224,maxBitrate:5e7,tier:"H",level:123},{maxPictureSize:8912896,maxBitrate:25e6,tier:"L",level:150},{maxPictureSize:8912896,maxBitrate:1e8,tier:"H",level:150},{maxPictureSize:8912896,maxBitrate:4e7,tier:"L",level:153},{maxPictureSize:8912896,maxBitrate:16e7,tier:"H",level:153},{maxPictureSize:8912896,maxBitrate:6e7,tier:"L",level:156},{maxPictureSize:8912896,maxBitrate:24e7,tier:"H",level:156},{maxPictureSize:35651584,maxBitrate:6e7,tier:"L",level:180},{maxPictureSize:35651584,maxBitrate:24e7,tier:"H",level:180},{maxPictureSize:35651584,maxBitrate:12e7,tier:"L",level:183},{maxPictureSize:35651584,maxBitrate:48e7,tier:"H",level:183},{maxPictureSize:35651584,maxBitrate:24e7,tier:"L",level:186},{maxPictureSize:35651584,maxBitrate:8e8,tier:"H",level:186}],Et=[{maxPictureSize:36864,maxBitrate:2e5,level:10},{maxPictureSize:73728,maxBitrate:8e5,level:11},{maxPictureSize:122880,maxBitrate:18e5,level:20},{maxPictureSize:245760,maxBitrate:36e5,level:21},{maxPictureSize:552960,maxBitrate:72e5,level:30},{maxPictureSize:983040,maxBitrate:12e6,level:31},{maxPictureSize:2228224,maxBitrate:18e6,level:40},{maxPictureSize:2228224,maxBitrate:3e7,level:41},{maxPictureSize:8912896,maxBitrate:6e7,level:50},{maxPictureSize:8912896,maxBitrate:12e7,level:51},{maxPictureSize:8912896,maxBitrate:18e7,level:52},{maxPictureSize:35651584,maxBitrate:18e7,level:60},{maxPictureSize:35651584,maxBitrate:24e7,level:61},{maxPictureSize:35651584,maxBitrate:48e7,level:62}],sr=[{maxPictureSize:147456,maxBitrate:15e5,tier:"M",level:0},{maxPictureSize:278784,maxBitrate:3e6,tier:"M",level:1},{maxPictureSize:665856,maxBitrate:6e6,tier:"M",level:4},{maxPictureSize:1065024,maxBitrate:1e7,tier:"M",level:5},{maxPictureSize:2359296,maxBitrate:12e6,tier:"M",level:8},{maxPictureSize:2359296,maxBitrate:3e7,tier:"H",level:8},{maxPictureSize:2359296,maxBitrate:2e7,tier:"M",level:9},{maxPictureSize:2359296,maxBitrate:5e7,tier:"H",level:9},{maxPictureSize:8912896,maxBitrate:3e7,tier:"M",level:12},{maxPictureSize:8912896,maxBitrate:1e8,tier:"H",level:12},{maxPictureSize:8912896,maxBitrate:4e7,tier:"M",level:13},{maxPictureSize:8912896,maxBitrate:16e7,tier:"H",level:13},{maxPictureSize:8912896,maxBitrate:6e7,tier:"M",level:14},{maxPictureSize:8912896,maxBitrate:24e7,tier:"H",level:14},{maxPictureSize:35651584,maxBitrate:6e7,tier:"M",level:15},{maxPictureSize:35651584,maxBitrate:24e7,tier:"H",level:15},{maxPictureSize:35651584,maxBitrate:6e7,tier:"M",level:16},{maxPictureSize:35651584,maxBitrate:24e7,tier:"H",level:16},{maxPictureSize:35651584,maxBitrate:1e8,tier:"M",level:17},{maxPictureSize:35651584,maxBitrate:48e7,tier:"H",level:17},{maxPictureSize:35651584,maxBitrate:16e7,tier:"M",level:18},{maxPictureSize:35651584,maxBitrate:8e8,tier:"H",level:18},{maxPictureSize:35651584,maxBitrate:16e7,tier:"M",level:19},{maxPictureSize:35651584,maxBitrate:8e8,tier:"H",level:19}];var or=(t,e,r,i)=>{if(t==="avc"){let s=Math.ceil(e/16)*Math.ceil(r/16),o=$e.find(u=>s<=u.maxMacroblocks&&i<=u.maxBitrate)??F($e),a=o?o.level:0,d="64".padStart(2,"0"),l="00",c=a.toString(16).padStart(2,"0");return\`avc1.\${d}\${l}\${c}\`}else if(t==="hevc"){let n="",o="6",a=e*r,d=nr.find(c=>a<=c.maxPictureSize&&i<=c.maxBitrate)??F(nr);return\`hev1.\${n}1.\${o}.\${d.tier}\${d.level}.B0\`}else{if(t==="vp8")return"vp8";if(t==="vp9"){let n="00",s=e*r,o=Et.find(d=>s<=d.maxPictureSize&&i<=d.maxBitrate)??F(Et);return\`vp09.\${n}.\${o.level.toString().padStart(2,"0")}.08\`}else if(t==="av1"){let s=e*r,o=sr.find(l=>s<=l.maxPictureSize&&i<=l.maxBitrate)??F(sr);return\`av01.0.\${o.level.toString().padStart(2,"0")}\${o.tier}.08\`}}throw new TypeError(\`Unhandled codec '\${t}'.\`)};var ar=t=>{let e=t.split("."),n=(1<<7)+1,s=Number(e[1]),o=e[2],a=Number(o.slice(0,-1)),d=(s<<5)+a,l=o.slice(-1)==="H"?1:0,u=Number(e[3])===8?0:1,f=0,g=e[4]?Number(e[4]):0,w=e[5]?Number(e[5][0]):1,T=e[5]?Number(e[5][1]):1,b=e[5]?Number(e[5][2]):0,E=(l<<7)+(u<<6)+(f<<5)+(g<<4)+(w<<3)+(T<<2)+b;return[n,d,E,0]};var cr=(t,e,r)=>{if(t==="aac")return e>=2&&r<=24e3?"mp4a.40.29":r<=24e3?"mp4a.40.5":"mp4a.40.2";if(t==="mp3")return"mp3";if(t==="opus")return"opus";if(t==="vorbis")return"vorbis";if(t==="flac")return"flac";if(t==="ac3")return"ac-3";if(t==="eac3")return"ec-3";if(L.includes(t))return t;throw new TypeError(\`Unhandled codec '\${t}'.\`)};var lr=/^pcm-([usf])(\\d+)+(be)?$/,ne=t=>{if(h(L.includes(t)),t==="ulaw")return{dataType:"ulaw",sampleSize:1,littleEndian:!0,silentValue:255};if(t==="alaw")return{dataType:"alaw",sampleSize:1,littleEndian:!0,silentValue:213};let e=lr.exec(t);h(e);let r;e[1]==="u"?r="unsigned":e[1]==="s"?r="signed":r="float";let i=Number(e[2])/8,n=e[3]!=="be",s=t==="pcm-u8"?2**7:0;return{dataType:r,sampleSize:i,littleEndian:n,silentValue:s}},St=t=>t.startsWith("avc1")||t.startsWith("avc3")?"avc":t.startsWith("hev1")||t.startsWith("hvc1")?"hevc":t==="vp8"?"vp8":t.startsWith("vp09")?"vp9":t.startsWith("av01")?"av1":t.startsWith("mp4a.40")||t==="mp4a.67"?"aac":t==="mp3"||t==="mp4a.69"||t==="mp4a.6B"||t==="mp4a.6b"?"mp3":t==="opus"?"opus":t==="vorbis"?"vorbis":t==="flac"?"flac":t==="ac-3"||t==="ac3"?"ac3":t==="ec-3"||t==="eac3"?"eac3":t==="ulaw"?"ulaw":t==="alaw"?"alaw":lr.test(t)?t:t==="webvtt"?"webvtt":null,dr=t=>t==="avc"?{avc:{format:"avc"}}:t==="hevc"?{hevc:{format:"hevc"}}:{},ur=t=>t==="aac"?{aac:{format:"aac"}}:t==="opus"?{opus:{format:"opus"}}:{},wi=["avc1","avc3","hev1","hvc1","vp8","vp09","av01"],bi=/^(avc1|avc3)\\.[0-9a-fA-F]{6}$/,yi=/^(hev1|hvc1)\\.(?:[ABC]?\\d+)\\.[0-9a-fA-F]{1,8}\\.[LH]\\d+(?:\\.[0-9a-fA-F]{1,2}){0,6}$/,xi=/^vp09(?:\\.\\d{2}){3}(?:(?:\\.\\d{2}){5})?$/,Ti=/^av01\\.\\d\\.\\d{2}[MH]\\.\\d{2}(?:\\.\\d\\.\\d{3}\\.\\d{2}\\.\\d{2}\\.\\d{2}\\.\\d)?$/,fr=t=>{if(!t)throw new TypeError("Video chunk metadata must be provided.");if(typeof t!="object")throw new TypeError("Video chunk metadata must be an object.");if(!t.decoderConfig)throw new TypeError("Video chunk metadata must include a decoder configuration.");if(typeof t.decoderConfig!="object")throw new TypeError("Video chunk metadata decoder configuration must be an object.");if(typeof t.decoderConfig.codec!="string")throw new TypeError("Video chunk metadata decoder configuration must specify a codec string.");if(!wi.some(e=>t.decoderConfig.codec.startsWith(e)))throw new TypeError("Video chunk metadata decoder configuration codec string must be a valid video codec string as specified in the Mediabunny Codec Registry.");if(!Number.isInteger(t.decoderConfig.codedWidth)||t.decoderConfig.codedWidth<=0)throw new TypeError("Video chunk metadata decoder configuration must specify a valid codedWidth (positive integer).");if(!Number.isInteger(t.decoderConfig.codedHeight)||t.decoderConfig.codedHeight<=0)throw new TypeError("Video chunk metadata decoder configuration must specify a valid codedHeight (positive integer).");if(t.decoderConfig.description!==void 0&&!ve(t.decoderConfig.description))throw new TypeError("Video chunk metadata decoder configuration description, when defined, must be an ArrayBuffer or an ArrayBuffer view.");if(t.decoderConfig.colorSpace!==void 0){let{colorSpace:e}=t.decoderConfig;if(typeof e!="object")throw new TypeError("Video chunk metadata decoder configuration colorSpace, when provided, must be an object.");let r=Object.keys(ge);if(e.primaries!=null&&!r.includes(e.primaries))throw new TypeError(\`Video chunk metadata decoder configuration colorSpace primaries, when defined, must be one of \${r.join(", ")}.\`);let i=Object.keys(we);if(e.transfer!=null&&!i.includes(e.transfer))throw new TypeError(\`Video chunk metadata decoder configuration colorSpace transfer, when defined, must be one of \${i.join(", ")}.\`);let n=Object.keys(be);if(e.matrix!=null&&!n.includes(e.matrix))throw new TypeError(\`Video chunk metadata decoder configuration colorSpace matrix, when defined, must be one of \${n.join(", ")}.\`);if(e.fullRange!=null&&typeof e.fullRange!="boolean")throw new TypeError("Video chunk metadata decoder configuration colorSpace fullRange, when defined, must be a boolean.")}if(t.decoderConfig.codec.startsWith("avc1")||t.decoderConfig.codec.startsWith("avc3")){if(!bi.test(t.decoderConfig.codec))throw new TypeError("Video chunk metadata decoder configuration codec string for AVC must be a valid AVC codec string as specified in Section 3.4 of RFC 6381.")}else if(t.decoderConfig.codec.startsWith("hev1")||t.decoderConfig.codec.startsWith("hvc1")){if(!yi.test(t.decoderConfig.codec))throw new TypeError("Video chunk metadata decoder configuration codec string for HEVC must be a valid HEVC codec string as specified in Section E.3 of ISO 14496-15.")}else if(t.decoderConfig.codec.startsWith("vp8")){if(t.decoderConfig.codec!=="vp8")throw new TypeError('Video chunk metadata decoder configuration codec string for VP8 must be "vp8".')}else if(t.decoderConfig.codec.startsWith("vp09")){if(!xi.test(t.decoderConfig.codec))throw new TypeError('Video chunk metadata decoder configuration codec string for VP9 must be a valid VP9 codec string as specified in Section "Codecs Parameter String" of https://www.webmproject.org/vp9/mp4/.')}else if(t.decoderConfig.codec.startsWith("av01")&&!Ti.test(t.decoderConfig.codec))throw new TypeError('Video chunk metadata decoder configuration codec string for AV1 must be a valid AV1 codec string as specified in Section "Codecs Parameter String" of https://aomediacodec.github.io/av1-isobmff/.')},Ei=["mp4a","mp3","opus","vorbis","flac","ulaw","alaw","pcm","ac-3","ec-3"],hr=t=>{if(!t)throw new TypeError("Audio chunk metadata must be provided.");if(typeof t!="object")throw new TypeError("Audio chunk metadata must be an object.");if(!t.decoderConfig)throw new TypeError("Audio chunk metadata must include a decoder configuration.");if(typeof t.decoderConfig!="object")throw new TypeError("Audio chunk metadata decoder configuration must be an object.");if(typeof t.decoderConfig.codec!="string")throw new TypeError("Audio chunk metadata decoder configuration must specify a codec string.");if(!Ei.some(e=>t.decoderConfig.codec.startsWith(e)))throw new TypeError("Audio chunk metadata decoder configuration codec string must be a valid audio codec string as specified in the Mediabunny Codec Registry.");if(!Number.isInteger(t.decoderConfig.sampleRate)||t.decoderConfig.sampleRate<=0)throw new TypeError("Audio chunk metadata decoder configuration must specify a valid sampleRate (positive integer).");if(!Number.isInteger(t.decoderConfig.numberOfChannels)||t.decoderConfig.numberOfChannels<=0)throw new TypeError("Audio chunk metadata decoder configuration must specify a valid numberOfChannels (positive integer).");if(t.decoderConfig.description!==void 0&&!ve(t.decoderConfig.description))throw new TypeError("Audio chunk metadata decoder configuration description, when defined, must be an ArrayBuffer or an ArrayBuffer view.");if(t.decoderConfig.codec.startsWith("mp4a")&&t.decoderConfig.codec!=="mp4a.69"&&t.decoderConfig.codec!=="mp4a.6B"&&t.decoderConfig.codec!=="mp4a.6b"){if(!["mp4a.40.2","mp4a.40.02","mp4a.40.5","mp4a.40.05","mp4a.40.29","mp4a.67"].includes(t.decoderConfig.codec))throw new TypeError("Audio chunk metadata decoder configuration codec string for AAC must be a valid AAC codec string as specified in https://www.w3.org/TR/webcodecs-aac-codec-registration/.")}else if(t.decoderConfig.codec.startsWith("mp3")||t.decoderConfig.codec.startsWith("mp4a")){if(t.decoderConfig.codec!=="mp3"&&t.decoderConfig.codec!=="mp4a.69"&&t.decoderConfig.codec!=="mp4a.6B"&&t.decoderConfig.codec!=="mp4a.6b")throw new TypeError('Audio chunk metadata decoder configuration codec string for MP3 must be "mp3", "mp4a.69" or "mp4a.6B".')}else if(t.decoderConfig.codec.startsWith("opus")){if(t.decoderConfig.codec!=="opus")throw new TypeError('Audio chunk metadata decoder configuration codec string for Opus must be "opus".');if(t.decoderConfig.description&&t.decoderConfig.description.byteLength<18)throw new TypeError("Audio chunk metadata decoder configuration description, when specified, is expected to be an Identification Header as specified in Section 5.1 of RFC 7845.")}else if(t.decoderConfig.codec.startsWith("vorbis")){if(t.decoderConfig.codec!=="vorbis")throw new TypeError('Audio chunk metadata decoder configuration codec string for Vorbis must be "vorbis".');if(!t.decoderConfig.description)throw new TypeError("Audio chunk metadata decoder configuration for Vorbis must include a description, which is expected to adhere to the format described in https://www.w3.org/TR/webcodecs-vorbis-codec-registration/.")}else if(t.decoderConfig.codec.startsWith("flac")){if(t.decoderConfig.codec!=="flac")throw new TypeError('Audio chunk metadata decoder configuration codec string for FLAC must be "flac".');if(!t.decoderConfig.description||t.decoderConfig.description.byteLength<42)throw new TypeError("Audio chunk metadata decoder configuration for FLAC must include a description, which is expected to adhere to the format described in https://www.w3.org/TR/webcodecs-flac-codec-registration/.")}else if(t.decoderConfig.codec.startsWith("ac-3")||t.decoderConfig.codec.startsWith("ac3")){if(t.decoderConfig.codec!=="ac-3")throw new TypeError('Audio chunk metadata decoder configuration codec string for AC-3 must be "ac-3".')}else if(t.decoderConfig.codec.startsWith("ec-3")||t.decoderConfig.codec.startsWith("eac3")){if(t.decoderConfig.codec!=="ec-3")throw new TypeError('Audio chunk metadata decoder configuration codec string for EC-3 must be "ec-3".')}else if((t.decoderConfig.codec.startsWith("pcm")||t.decoderConfig.codec.startsWith("ulaw")||t.decoderConfig.codec.startsWith("alaw"))&&!L.includes(t.decoderConfig.codec))throw new TypeError(\`Audio chunk metadata decoder configuration codec string for PCM must be one of the supported PCM codecs (\${L.join(", ")}).\`)},mr=t=>{if(!t)throw new TypeError("Subtitle metadata must be provided.");if(typeof t!="object")throw new TypeError("Subtitle metadata must be an object.");if(!t.config)throw new TypeError("Subtitle metadata must include a config object.");if(typeof t.config!="object")throw new TypeError("Subtitle metadata config must be an object.");if(typeof t.config.description!="string")throw new TypeError("Subtitle metadata config description must be a string.")};var pr=[48e3,44100,32e3],gr=[24e3,22050,16e3];var qe;(function(t){t[t.NON_IDR_SLICE=1]="NON_IDR_SLICE",t[t.SLICE_DPA=2]="SLICE_DPA",t[t.SLICE_DPB=3]="SLICE_DPB",t[t.SLICE_DPC=4]="SLICE_DPC",t[t.IDR=5]="IDR",t[t.SEI=6]="SEI",t[t.SPS=7]="SPS",t[t.PPS=8]="PPS",t[t.AUD=9]="AUD",t[t.SPS_EXT=13]="SPS_EXT"})(qe||(qe={}));var Z;(function(t){t[t.RASL_N=8]="RASL_N",t[t.RASL_R=9]="RASL_R",t[t.BLA_W_LP=16]="BLA_W_LP",t[t.RSV_IRAP_VCL23=23]="RSV_IRAP_VCL23",t[t.VPS_NUT=32]="VPS_NUT",t[t.SPS_NUT=33]="SPS_NUT",t[t.PPS_NUT=34]="PPS_NUT",t[t.AUD_NUT=35]="AUD_NUT",t[t.PREFIX_SEI_NUT=39]="PREFIX_SEI_NUT",t[t.SUFFIX_SEI_NUT=40]="SUFFIX_SEI_NUT"})(Z||(Z={}));var lt=function*(t){let e=0,r=-1;for(;e<t.length-2;){let i=t.indexOf(0,e);if(i===-1||i>=t.length-2)break;e=i;let n=0;if(e+3<t.length&&t[e+1]===0&&t[e+2]===0&&t[e+3]===1?n=4:t[e+1]===0&&t[e+2]===1&&(n=3),n===0){e++;continue}r!==-1&&e>r&&(yield{offset:r,length:e-r}),r=e+n,e=r}r!==-1&&r<t.length&&(yield{offset:r,length:t.length-r})};var Si=t=>t&31,vt=t=>{let e=[],r=t.length;for(let i=0;i<r;i++)i+2<r&&t[i]===0&&t[i+1]===0&&t[i+2]===3?(e.push(0,0),i+=2):e.push(t[i]);return new Uint8Array(e)},gs=new Uint8Array([0,0,0,1]);var Tr=(t,e)=>{let r=t.reduce((s,o)=>s+e+o.byteLength,0),i=new Uint8Array(r),n=0;for(let s of t){let o=new DataView(i.buffer,i.byteOffset,i.byteLength);switch(e){case 1:o.setUint8(n,s.byteLength);break;case 2:o.setUint16(n,s.byteLength,!1);break;case 3:We(o,n,s.byteLength,!1);break;case 4:o.setUint32(n,s.byteLength,!1);break}n+=e,i.set(s,n),n+=s.byteLength}return i};var Er=t=>{try{let e=[],r=[],i=[];for(let a of lt(t)){let d=t.subarray(a.offset,a.offset+a.length),l=Si(d[0]);l===qe.SPS?e.push(d):l===qe.PPS?r.push(d):l===qe.SPS_EXT&&i.push(d)}if(e.length===0||r.length===0)return null;let n=e[0],s=vi(n);h(s!==null);let o=s.profileIdc===100||s.profileIdc===110||s.profileIdc===122||s.profileIdc===144;return{configurationVersion:1,avcProfileIndication:s.profileIdc,profileCompatibility:s.constraintFlags,avcLevelIndication:s.levelIdc,lengthSizeMinusOne:3,sequenceParameterSets:e,pictureParameterSets:r,chromaFormat:o?s.chromaFormatIdc:null,bitDepthLumaMinus8:o?s.bitDepthLumaMinus8:null,bitDepthChromaMinus8:o?s.bitDepthChromaMinus8:null,sequenceParameterSetExt:o?i:null}}catch(e){return console.error("Error building AVC Decoder Configuration Record:",e),null}},Cr=t=>{let e=[];e.push(t.configurationVersion),e.push(t.avcProfileIndication),e.push(t.profileCompatibility),e.push(t.avcLevelIndication),e.push(252|t.lengthSizeMinusOne&3),e.push(224|t.sequenceParameterSets.length&31);for(let r of t.sequenceParameterSets){let i=r.byteLength;e.push(i>>8),e.push(i&255);for(let n=0;n<i;n++)e.push(r[n])}e.push(t.pictureParameterSets.length);for(let r of t.pictureParameterSets){let i=r.byteLength;e.push(i>>8),e.push(i&255);for(let n=0;n<i;n++)e.push(r[n])}if(t.avcProfileIndication===100||t.avcProfileIndication===110||t.avcProfileIndication===122||t.avcProfileIndication===144){h(t.chromaFormat!==null),h(t.bitDepthLumaMinus8!==null),h(t.bitDepthChromaMinus8!==null),h(t.sequenceParameterSetExt!==null),e.push(252|t.chromaFormat&3),e.push(248|t.bitDepthLumaMinus8&7),e.push(248|t.bitDepthChromaMinus8&7),e.push(t.sequenceParameterSetExt.length);for(let r of t.sequenceParameterSetExt){let i=r.byteLength;e.push(i>>8),e.push(i&255);for(let n=0;n<i;n++)e.push(r[n])}}return new Uint8Array(e)};var Sr={1:{num:1,den:1},2:{num:12,den:11},3:{num:10,den:11},4:{num:16,den:11},5:{num:40,den:33},6:{num:24,den:11},7:{num:20,den:11},8:{num:32,den:11},9:{num:80,den:33},10:{num:18,den:11},11:{num:15,den:11},12:{num:64,den:33},13:{num:160,den:99},14:{num:4,den:3},15:{num:3,den:2},16:{num:2,den:1}},vi=t=>{try{let e=new O(vt(t));if(e.skipBits(1),e.skipBits(2),e.readBits(5)!==7)return null;let i=e.readAlignedByte(),n=e.readAlignedByte(),s=e.readAlignedByte();p(e);let o=1,a=0,d=0,l=0;if((i===100||i===110||i===122||i===244||i===44||i===83||i===86||i===118||i===128)&&(o=p(e),o===3&&(l=e.readBits(1)),a=p(e),d=p(e),e.skipBits(1),e.readBits(1))){for(let v=0;v<(o!==3?8:12);v++)if(e.readBits(1)){let ae=v<6?16:64,H=8,I=8;for(let j=0;j<ae;j++){if(I!==0){let me=G(e);I=(H+me+256)%256}H=I===0?H:I}}}p(e);let c=p(e);if(c===0)p(e);else if(c===1){e.skipBits(1),G(e),G(e);let N=p(e);for(let v=0;v<N;v++)G(e)}p(e),e.skipBits(1);let u=p(e),f=p(e),g=16*(u+1),w=16*(f+1),T=g,b=w,E=e.readBits(1);if(E||e.skipBits(1),e.skipBits(1),e.readBits(1)){let N=p(e),v=p(e),D=p(e),ae=p(e),H,I;if((l===0?o:0)===0)H=1,I=2-E;else{let me=o===3?1:2,Ve=o===1?2:1;H=me,I=Ve*(2-E)}T-=H*(N+v),b-=I*(D+ae)}let k=2,z=2,V=2,X=0,re={num:1,den:1},P=null,M=null;if(e.readBits(1)){if(e.readBits(1)){let Ve=e.readBits(8);if(Ve===255)re={num:e.readBits(16),den:e.readBits(16)};else{let Qt=Sr[Ve];Qt&&(re=Qt)}}e.readBits(1)&&e.skipBits(1),e.readBits(1)&&(e.skipBits(3),X=e.readBits(1),e.readBits(1)&&(k=e.readBits(8),z=e.readBits(8),V=e.readBits(8))),e.readBits(1)&&(p(e),p(e)),e.readBits(1)&&(e.skipBits(32),e.skipBits(32),e.skipBits(1));let I=e.readBits(1);I&&wr(e);let j=e.readBits(1);j&&wr(e),(I||j)&&e.skipBits(1),e.skipBits(1),e.readBits(1)&&(e.skipBits(1),p(e),p(e),p(e),p(e),P=p(e),M=p(e))}if(P===null){h(M===null);let N=n&16;if((i===44||i===86||i===100||i===110||i===122||i===244)&&N)P=0,M=0;else{let v=u+1,D=f+1,ae=(2-E)*D,H=$e.find(j=>j.level>=s)??F($e),I=Math.min(Math.floor(H.maxDpbMbs/(v*ae)),16);P=I,M=I}}return h(M!==null),{profileIdc:i,constraintFlags:n,levelIdc:s,frameMbsOnlyFlag:E,chromaFormatIdc:o,bitDepthLumaMinus8:a,bitDepthChromaMinus8:d,codedWidth:g,codedHeight:w,displayWidth:T,displayHeight:b,pixelAspectRatio:re,colourPrimaries:k,matrixCoefficients:V,transferCharacteristics:z,fullRangeFlag:X,numReorderFrames:P,maxDecFrameBuffering:M}}catch(e){return console.error("Error parsing AVC SPS:",e),null}},wr=t=>{let e=p(t);t.skipBits(4),t.skipBits(4);for(let r=0;r<=e;r++)p(t),p(t),t.skipBits(1);t.skipBits(5),t.skipBits(5),t.skipBits(5),t.skipBits(5)};var br=t=>t>>1&63,_i=t=>{try{let e=new O(vt(t));e.skipBits(16),e.readBits(4);let r=e.readBits(3),i=e.readBits(1),{general_profile_space:n,general_tier_flag:s,general_profile_idc:o,general_profile_compatibility_flags:a,general_constraint_indicator_flags:d,general_level_idc:l}=Ai(e,r);p(e);let c=p(e),u=0;c===3&&(u=e.readBits(1));let f=p(e),g=p(e),w=f,T=g;if(e.readBits(1)){let v=p(e),D=p(e),ae=p(e),H=p(e),I=1,j=1,me=u===0?c:0;me===1?(I=2,j=2):me===2&&(I=2,j=1),w-=(v+D)*I,T-=(ae+H)*j}let b=p(e),E=p(e);p(e);let k=e.readBits(1)?0:r,z=0;for(let v=k;v<=r;v++)p(e),z=p(e),p(e);p(e),p(e),p(e),p(e),p(e),p(e),e.readBits(1)&&e.readBits(1)&&ki(e),e.skipBits(1),e.skipBits(1),e.readBits(1)&&(e.skipBits(4),e.skipBits(4),p(e),p(e),e.skipBits(1));let V=p(e);if(Bi(e,V),e.readBits(1)){let v=p(e);for(let D=0;D<v;D++)p(e),e.skipBits(1)}e.skipBits(1),e.skipBits(1);let X=2,re=2,P=2,M=0,oe=0,N={num:1,den:1};if(e.readBits(1)){let v=Pi(e,r);N=v.pixelAspectRatio,X=v.colourPrimaries,re=v.transferCharacteristics,P=v.matrixCoefficients,M=v.fullRangeFlag,oe=v.minSpatialSegmentationIdc}return{displayWidth:w,displayHeight:T,pixelAspectRatio:N,colourPrimaries:X,transferCharacteristics:re,matrixCoefficients:P,fullRangeFlag:M,maxDecFrameBuffering:z+1,spsMaxSubLayersMinus1:r,spsTemporalIdNestingFlag:i,generalProfileSpace:n,generalTierFlag:s,generalProfileIdc:o,generalProfileCompatibilityFlags:a,generalConstraintIndicatorFlags:d,generalLevelIdc:l,chromaFormatIdc:c,bitDepthLumaMinus8:b,bitDepthChromaMinus8:E,minSpatialSegmentationIdc:oe}}catch(e){return console.error("Error parsing HEVC SPS:",e),null}},vr=t=>{try{let e=[],r=[],i=[],n=[];for(let l of lt(t)){let c=t.subarray(l.offset,l.offset+l.length),u=br(c[0]);u===Z.VPS_NUT?e.push(c):u===Z.SPS_NUT?r.push(c):u===Z.PPS_NUT?i.push(c):(u===Z.PREFIX_SEI_NUT||u===Z.SUFFIX_SEI_NUT)&&n.push(c)}if(r.length===0||i.length===0)return null;let s=_i(r[0]);if(!s)return null;let o=0;if(i.length>0){let l=i[0],c=new O(vt(l));c.skipBits(16),p(c),p(c),c.skipBits(1),c.skipBits(1),c.skipBits(3),c.skipBits(1),c.skipBits(1),p(c),p(c),G(c),c.skipBits(1),c.skipBits(1),c.readBits(1)&&p(c),G(c),G(c),c.skipBits(1),c.skipBits(1),c.skipBits(1),c.skipBits(1);let u=c.readBits(1),f=c.readBits(1);!u&&!f?o=0:u&&!f?o=2:!u&&f?o=3:o=0}let a=[...e.length?[{arrayCompleteness:1,nalUnitType:Z.VPS_NUT,nalUnits:e}]:[],...r.length?[{arrayCompleteness:1,nalUnitType:Z.SPS_NUT,nalUnits:r}]:[],...i.length?[{arrayCompleteness:1,nalUnitType:Z.PPS_NUT,nalUnits:i}]:[],...n.length?[{arrayCompleteness:1,nalUnitType:br(n[0][0]),nalUnits:n}]:[]];return{configurationVersion:1,generalProfileSpace:s.generalProfileSpace,generalTierFlag:s.generalTierFlag,generalProfileIdc:s.generalProfileIdc,generalProfileCompatibilityFlags:s.generalProfileCompatibilityFlags,generalConstraintIndicatorFlags:s.generalConstraintIndicatorFlags,generalLevelIdc:s.generalLevelIdc,minSpatialSegmentationIdc:s.minSpatialSegmentationIdc,parallelismType:o,chromaFormatIdc:s.chromaFormatIdc,bitDepthLumaMinus8:s.bitDepthLumaMinus8,bitDepthChromaMinus8:s.bitDepthChromaMinus8,avgFrameRate:0,constantFrameRate:0,numTemporalLayers:s.spsMaxSubLayersMinus1+1,temporalIdNested:s.spsTemporalIdNestingFlag,lengthSizeMinusOne:3,arrays:a}}catch(e){return console.error("Error building HEVC Decoder Configuration Record:",e),null}},Ai=(t,e)=>{let r=t.readBits(2),i=t.readBits(1),n=t.readBits(5),s=0;for(let c=0;c<32;c++)s=s<<1|t.readBits(1);let o=new Uint8Array(6);for(let c=0;c<6;c++)o[c]=t.readBits(8);let a=t.readBits(8),d=[],l=[];for(let c=0;c<e;c++)d.push(t.readBits(1)),l.push(t.readBits(1));if(e>0)for(let c=e;c<8;c++)t.skipBits(2);for(let c=0;c<e;c++)d[c]&&t.skipBits(88),l[c]&&t.skipBits(8);return{general_profile_space:r,general_tier_flag:i,general_profile_idc:n,general_profile_compatibility_flags:s,general_constraint_indicator_flags:o,general_level_idc:a}},ki=t=>{for(let e=0;e<4;e++)for(let r=0;r<(e===3?2:6);r++)if(!t.readBits(1))p(t);else{let n=Math.min(64,1<<4+(e<<1));e>1&&G(t);for(let s=0;s<n;s++)G(t)}},Bi=(t,e)=>{let r=[];for(let i=0;i<e;i++)r[i]=Ii(t,i,e,r)},Ii=(t,e,r,i)=>{let n=0,s=0,o=0;if(e!==0&&(s=t.readBits(1)),s){if(e===r){let d=p(t);o=e-(d+1)}else o=e-1;t.readBits(1),p(t);let a=i[o]??0;for(let d=0;d<=a;d++)t.readBits(1)||t.readBits(1);n=i[o]}else{let a=p(t),d=p(t);for(let l=0;l<a;l++)p(t),t.readBits(1);for(let l=0;l<d;l++)p(t),t.readBits(1);n=a+d}return n},Pi=(t,e)=>{let r=2,i=2,n=2,s=0,o=0,a={num:1,den:1};if(t.readBits(1)){let d=t.readBits(8);if(d===255)a={num:t.readBits(16),den:t.readBits(16)};else{let l=Sr[d];l&&(a=l)}}return t.readBits(1)&&t.readBits(1),t.readBits(1)&&(t.readBits(3),s=t.readBits(1),t.readBits(1)&&(r=t.readBits(8),i=t.readBits(8),n=t.readBits(8))),t.readBits(1)&&(p(t),p(t)),t.readBits(1),t.readBits(1),t.readBits(1),t.readBits(1)&&(p(t),p(t),p(t),p(t)),t.readBits(1)&&(t.readBits(32),t.readBits(32),t.readBits(1)&&p(t),t.readBits(1)&&Mi(t,!0,e)),t.readBits(1)&&(t.readBits(1),t.readBits(1),t.readBits(1),o=p(t),p(t),p(t),p(t),p(t)),{pixelAspectRatio:a,colourPrimaries:r,transferCharacteristics:i,matrixCoefficients:n,fullRangeFlag:s,minSpatialSegmentationIdc:o}},Mi=(t,e,r)=>{let i=!1,n=!1,s=!1;e&&(i=t.readBits(1)===1,n=t.readBits(1)===1,(i||n)&&(s=t.readBits(1)===1,s&&(t.readBits(8),t.readBits(5),t.readBits(1),t.readBits(5)),t.readBits(4),t.readBits(4),s&&t.readBits(4),t.readBits(5),t.readBits(5),t.readBits(5)));for(let o=0;o<=r;o++){let a=t.readBits(1)===1,d=!0;a||(d=t.readBits(1)===1);let l=!1;d?p(t):l=t.readBits(1)===1;let c=1;l||(c=p(t)+1),i&&yr(t,c,s),n&&yr(t,c,s)}},yr=(t,e,r)=>{for(let i=0;i<e;i++)p(t),p(t),r&&(p(t),p(t)),t.readBits(1)},_r=t=>{let e=[];e.push(t.configurationVersion),e.push((t.generalProfileSpace&3)<<6|(t.generalTierFlag&1)<<5|t.generalProfileIdc&31),e.push(t.generalProfileCompatibilityFlags>>>24&255),e.push(t.generalProfileCompatibilityFlags>>>16&255),e.push(t.generalProfileCompatibilityFlags>>>8&255),e.push(t.generalProfileCompatibilityFlags&255),e.push(...t.generalConstraintIndicatorFlags),e.push(t.generalLevelIdc&255),e.push(240|t.minSpatialSegmentationIdc>>8&15),e.push(t.minSpatialSegmentationIdc&255),e.push(252|t.parallelismType&3),e.push(252|t.chromaFormatIdc&3),e.push(248|t.bitDepthLumaMinus8&7),e.push(248|t.bitDepthChromaMinus8&7),e.push(t.avgFrameRate>>8&255),e.push(t.avgFrameRate&255),e.push((t.constantFrameRate&3)<<6|(t.numTemporalLayers&7)<<3|(t.temporalIdNested&1)<<2|t.lengthSizeMinusOne&3),e.push(t.arrays.length&255);for(let r of t.arrays){e.push((r.arrayCompleteness&1)<<7|0|r.nalUnitType&63),e.push(r.nalUnits.length>>8&255),e.push(r.nalUnits.length&255);for(let i of r.nalUnits){e.push(i.length>>8&255),e.push(i.length&255);for(let n=0;n<i.length;n++)e.push(i[n])}}return new Uint8Array(e)};var Ar=t=>{let e=$(t),r=e.getUint8(9),i=e.getUint16(10,!0),n=e.getUint32(12,!0),s=e.getInt16(16,!0),o=e.getUint8(18),a=null;return o&&(a=t.subarray(19,21+r)),{outputChannelCount:r,preSkip:i,inputSampleRate:n,outputGain:s,channelMappingFamily:o,channelMappingTable:a}};var xr;(function(t){t[t.STREAMINFO=0]="STREAMINFO",t[t.VORBIS_COMMENT=4]="VORBIS_COMMENT",t[t.PICTURE=6]="PICTURE"})(xr||(xr={}));var kr=t=>{if(t.length<7||t[0]!==11||t[1]!==119)return null;let e=new O(t);e.skipBits(16),e.skipBits(16);let r=e.readBits(2);if(r===3)return null;let i=e.readBits(6),n=e.readBits(5);if(n>8)return null;let s=e.readBits(3),o=e.readBits(3);o&1&&o!==1&&e.skipBits(2),o&4&&e.skipBits(2),o===2&&e.skipBits(2);let a=e.readBits(1),d=Math.floor(i/2);return{fscod:r,bsid:n,bsmod:s,acmod:o,lfeon:a,bitRateCode:d}},ws=[64*2,69*2,96*2,64*2,70*2,96*2,80*2,87*2,120*2,80*2,88*2,120*2,96*2,104*2,144*2,96*2,105*2,144*2,112*2,121*2,168*2,112*2,122*2,168*2,128*2,139*2,192*2,128*2,140*2,192*2,160*2,174*2,240*2,160*2,175*2,240*2,192*2,208*2,288*2,192*2,209*2,288*2,224*2,243*2,336*2,224*2,244*2,336*2,256*2,278*2,384*2,256*2,279*2,384*2,320*2,348*2,480*2,320*2,349*2,480*2,384*2,417*2,576*2,384*2,418*2,576*2,448*2,487*2,672*2,448*2,488*2,672*2,512*2,557*2,768*2,512*2,558*2,768*2,640*2,696*2,960*2,640*2,697*2,960*2,768*2,835*2,1152*2,768*2,836*2,1152*2,896*2,975*2,1344*2,896*2,976*2,1344*2,1024*2,1114*2,1536*2,1024*2,1115*2,1536*2,1152*2,1253*2,1728*2,1152*2,1254*2,1728*2,1280*2,1393*2,1920*2,1280*2,1394*2,1920*2];var bs=new Uint8Array([5,4,65,67,45,51]),ys=new Uint8Array([5,4,69,65,67,51]),Fi=[1,2,3,6],Br=t=>{if(t.length<6||t[0]!==11||t[1]!==119)return null;let e=new O(t);e.skipBits(16);let r=e.readBits(2);if(e.skipBits(3),r!==0&&r!==2)return null;let i=e.readBits(11),n=e.readBits(2),s=0,o;n===3?(s=e.readBits(2),o=3):o=e.readBits(2);let a=e.readBits(3),d=e.readBits(1),l=e.readBits(5);if(l<11||l>16)return null;let c=Fi[o],u;return n<3?u=pr[n]/1e3:u=gr[s]/1e3,{dataRate:Math.round((i+1)*u/(c*16)),substreams:[{fscod:n,fscod2:s,bsid:l,bsmod:0,acmod:a,lfeon:d,numDepSub:0,chanLoc:0}]}};var Ir=[],Pr=[];var Mr=new Uint8Array(0),le=class t{constructor(e,r,i,n,s=-1,o,a){if(this.data=e,this.type=r,this.timestamp=i,this.duration=n,this.sequenceNumber=s,e===Mr&&o===void 0)throw new Error("Internal error: byteLength must be explicitly provided when constructing metadata-only packets.");if(o===void 0&&(o=e.byteLength),!(e instanceof Uint8Array))throw new TypeError("data must be a Uint8Array.");if(r!=="key"&&r!=="delta")throw new TypeError('type must be either "key" or "delta".');if(!Number.isFinite(i))throw new TypeError("timestamp must be a number.");if(!Number.isFinite(n)||n<0)throw new TypeError("duration must be a non-negative number.");if(!Number.isFinite(s))throw new TypeError("sequenceNumber must be a number.");if(!Number.isInteger(o)||o<0)throw new TypeError("byteLength must be a non-negative integer.");if(a!==void 0&&(typeof a!="object"||!a))throw new TypeError("sideData, when provided, must be an object.");if(a?.alpha!==void 0&&!(a.alpha instanceof Uint8Array))throw new TypeError("sideData.alpha, when provided, must be a Uint8Array.");if(a?.alphaByteLength!==void 0&&(!Number.isInteger(a.alphaByteLength)||a.alphaByteLength<0))throw new TypeError("sideData.alphaByteLength, when provided, must be a non-negative integer.");this.byteLength=o,this.sideData=a??{},this.sideData.alpha&&this.sideData.alphaByteLength===void 0&&(this.sideData.alphaByteLength=this.sideData.alpha.byteLength)}get isMetadataOnly(){return this.data===Mr}get microsecondTimestamp(){return Math.trunc(Y*this.timestamp)}get microsecondDuration(){return Math.trunc(Y*this.duration)}toEncodedVideoChunk(){if(this.isMetadataOnly)throw new TypeError("Metadata-only packets cannot be converted to a video chunk.");if(typeof EncodedVideoChunk>"u")throw new Error("Your browser does not support EncodedVideoChunk.");return new EncodedVideoChunk({data:this.data,type:this.type,timestamp:this.microsecondTimestamp,duration:this.microsecondDuration})}alphaToEncodedVideoChunk(e=this.type){if(!this.sideData.alpha)throw new TypeError("This packet does not contain alpha side data.");if(this.isMetadataOnly)throw new TypeError("Metadata-only packets cannot be converted to a video chunk.");if(typeof EncodedVideoChunk>"u")throw new Error("Your browser does not support EncodedVideoChunk.");return new EncodedVideoChunk({data:this.sideData.alpha,type:e,timestamp:this.microsecondTimestamp,duration:this.microsecondDuration})}toEncodedAudioChunk(){if(this.isMetadataOnly)throw new TypeError("Metadata-only packets cannot be converted to an audio chunk.");if(typeof EncodedAudioChunk>"u")throw new Error("Your browser does not support EncodedAudioChunk.");return new EncodedAudioChunk({data:this.data,type:this.type,timestamp:this.microsecondTimestamp,duration:this.microsecondDuration})}static fromEncodedChunk(e,r){if(!(e instanceof EncodedVideoChunk||e instanceof EncodedAudioChunk))throw new TypeError("chunk must be an EncodedVideoChunk or EncodedAudioChunk.");let i=new Uint8Array(e.byteLength);return e.copyTo(i),new t(i,e.type,e.timestamp/1e6,(e.duration??0)/1e6,void 0,void 0,r)}clone(e){if(e!==void 0&&(typeof e!="object"||e===null))throw new TypeError("options, when provided, must be an object.");if(e?.data!==void 0&&!(e.data instanceof Uint8Array))throw new TypeError("options.data, when provided, must be a Uint8Array.");if(e?.type!==void 0&&e.type!=="key"&&e.type!=="delta")throw new TypeError('options.type, when provided, must be either "key" or "delta".');if(e?.timestamp!==void 0&&!Number.isFinite(e.timestamp))throw new TypeError("options.timestamp, when provided, must be a number.");if(e?.duration!==void 0&&!Number.isFinite(e.duration))throw new TypeError("options.duration, when provided, must be a number.");if(e?.sequenceNumber!==void 0&&!Number.isFinite(e.sequenceNumber))throw new TypeError("options.sequenceNumber, when provided, must be a number.");if(e?.sideData!==void 0&&(typeof e.sideData!="object"||e.sideData===null))throw new TypeError("options.sideData, when provided, must be an object.");return new t(e?.data??this.data,e?.type??this.type,e?.timestamp??this.timestamp,e?.duration??this.duration,e?.sequenceNumber??this.sequenceNumber,this.byteLength,e?.sideData??this.sideData)}};var Fr=t=>{let i=t,n=4096,s=0,o=12,a=0;for(i<0&&(i=-i,s=128),i+=33,i>8191&&(i=8191);(i&n)!==n&&o>=5;)n>>=1,o--;return a=i>>o-4&15,~(s|o-5<<4|a)&255};var Rr=t=>{let r=2048,i=0,n=11,s=0,o=t;for(o<0&&(o=-o,i=128),o>4095&&(o=4095);(o&r)!==r&&n>=5;)r>>=1,n--;return s=o>>(n===4?1:n-4)&15,(i|n-4<<4|s)^85};er();var Or=-1/0,Ur=-1/0,Xe=null;typeof FinalizationRegistry<"u"&&(Xe=new FinalizationRegistry(t=>{let e=Date.now();t.type==="video"?(e-Or>=1e3&&(console.error("A VideoSample was garbage collected without first being closed. For proper resource management, make sure to call close() on all your VideoSamples as soon as you're done using them."),Or=e),typeof VideoFrame<"u"&&t.data instanceof VideoFrame&&t.data.close()):(e-Ur>=1e3&&(console.error("An AudioSample was garbage collected without first being closed. For proper resource management, make sure to call close() on all your AudioSamples as soon as you're done using them."),Ur=e),typeof AudioData<"u"&&t.data instanceof AudioData&&t.data.close())}));var At=["I420","I420P10","I420P12","I420A","I420AP10","I420AP12","I422","I422P10","I422P12","I422A","I422AP10","I422AP12","I444","I444P10","I444P12","I444A","I444AP10","I444AP12","NV12","RGBA","RGBX","BGRA","BGRX"],Ri=new Set(At),ke=class t{get codedWidth(){return this.visibleRect.width}get codedHeight(){return this.visibleRect.height}get displayWidth(){return this.rotation%180===0?this.squarePixelWidth:this.squarePixelHeight}get displayHeight(){return this.rotation%180===0?this.squarePixelHeight:this.squarePixelWidth}get microsecondTimestamp(){return Math.trunc(Y*this.timestamp)}get microsecondDuration(){return Math.trunc(Y*this.duration)}get hasAlpha(){return this.format&&this.format.includes("A")}constructor(e,r){if(this._closed=!1,e instanceof ArrayBuffer||typeof SharedArrayBuffer<"u"&&e instanceof SharedArrayBuffer||ArrayBuffer.isView(e)){if(!r||typeof r!="object")throw new TypeError("init must be an object.");if(r.format===void 0||!Ri.has(r.format))throw new TypeError("init.format must be one of: "+At.join(", "));if(!Number.isInteger(r.codedWidth)||r.codedWidth<=0)throw new TypeError("init.codedWidth must be a positive integer.");if(!Number.isInteger(r.codedHeight)||r.codedHeight<=0)throw new TypeError("init.codedHeight must be a positive integer.");if(r.rotation!==void 0&&![0,90,180,270].includes(r.rotation))throw new TypeError("init.rotation, when provided, must be 0, 90, 180, or 270.");if(!Number.isFinite(r.timestamp))throw new TypeError("init.timestamp must be a number.");if(r.duration!==void 0&&(!Number.isFinite(r.duration)||r.duration<0))throw new TypeError("init.duration, when provided, must be a non-negative number.");if(r.layout!==void 0){if(!Array.isArray(r.layout))throw new TypeError("init.layout, when provided, must be an array.");for(let i of r.layout){if(!i||typeof i!="object"||Array.isArray(i))throw new TypeError("Each entry in init.layout must be an object.");if(!Number.isInteger(i.offset)||i.offset<0)throw new TypeError("plane.offset must be a non-negative integer.");if(!Number.isInteger(i.stride)||i.stride<0)throw new TypeError("plane.stride must be a non-negative integer.")}}if(r.visibleRect!==void 0&&xt(r.visibleRect,"init.visibleRect"),r.displayWidth!==void 0&&(!Number.isInteger(r.displayWidth)||r.displayWidth<=0))throw new TypeError("init.displayWidth, when provided, must be a positive integer.");if(r.displayHeight!==void 0&&(!Number.isInteger(r.displayHeight)||r.displayHeight<=0))throw new TypeError("init.displayHeight, when provided, must be a positive integer.");if(r.displayWidth!==void 0!=(r.displayHeight!==void 0))throw new TypeError("init.displayWidth and init.displayHeight must be either both provided or both omitted.");this._data=W(e).slice(),this._layout=r.layout??Li(r.format,r.codedWidth,r.codedHeight),this.format=r.format,this.rotation=r.rotation??0,this.timestamp=r.timestamp,this.duration=r.duration??0,this.colorSpace=new Ae(r.colorSpace),this.visibleRect={left:r.visibleRect?.left??0,top:r.visibleRect?.top??0,width:r.visibleRect?.width??r.codedWidth,height:r.visibleRect?.height??r.codedHeight},r.displayWidth!==void 0?(this.squarePixelWidth=this.rotation%180===0?r.displayWidth:r.displayHeight,this.squarePixelHeight=this.rotation%180===0?r.displayHeight:r.displayWidth):(this.squarePixelWidth=this.codedWidth,this.squarePixelHeight=this.codedHeight)}else if(typeof VideoFrame<"u"&&e instanceof VideoFrame){if(r?.rotation!==void 0&&![0,90,180,270].includes(r.rotation))throw new TypeError("init.rotation, when provided, must be 0, 90, 180, or 270.");if(r?.timestamp!==void 0&&!Number.isFinite(r?.timestamp))throw new TypeError("init.timestamp, when provided, must be a number.");if(r?.duration!==void 0&&(!Number.isFinite(r.duration)||r.duration<0))throw new TypeError("init.duration, when provided, must be a non-negative number.");r?.visibleRect!==void 0&&xt(r.visibleRect,"init.visibleRect"),this._data=e,this._layout=null,this.format=e.format,this.visibleRect={left:e.visibleRect?.x??0,top:e.visibleRect?.y??0,width:e.visibleRect?.width??e.codedWidth,height:e.visibleRect?.height??e.codedHeight},this.rotation=r?.rotation??0,this.squarePixelWidth=e.displayWidth,this.squarePixelHeight=e.displayHeight,this.timestamp=r?.timestamp??e.timestamp/1e6,this.duration=r?.duration??(e.duration??0)/1e6,this.colorSpace=new Ae(e.colorSpace)}else if(typeof HTMLImageElement<"u"&&e instanceof HTMLImageElement||typeof SVGImageElement<"u"&&e instanceof SVGImageElement||typeof ImageBitmap<"u"&&e instanceof ImageBitmap||typeof HTMLVideoElement<"u"&&e instanceof HTMLVideoElement||typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement||typeof OffscreenCanvas<"u"&&e instanceof OffscreenCanvas){if(!r||typeof r!="object")throw new TypeError("init must be an object.");if(r.rotation!==void 0&&![0,90,180,270].includes(r.rotation))throw new TypeError("init.rotation, when provided, must be 0, 90, 180, or 270.");if(!Number.isFinite(r.timestamp))throw new TypeError("init.timestamp must be a number.");if(r.duration!==void 0&&(!Number.isFinite(r.duration)||r.duration<0))throw new TypeError("init.duration, when provided, must be a non-negative number.");if(typeof VideoFrame<"u")return new t(new VideoFrame(e,{timestamp:Math.trunc(r.timestamp*Y),duration:Math.trunc((r.duration??0)*Y)||void 0}),r);let i=0,n=0;if("naturalWidth"in e?(i=e.naturalWidth,n=e.naturalHeight):"videoWidth"in e?(i=e.videoWidth,n=e.videoHeight):"width"in e&&(i=Number(e.width),n=Number(e.height)),!i||!n)throw new TypeError("Could not determine dimensions.");let s=new OffscreenCanvas(i,n),o=s.getContext("2d",{alpha:De(),willReadFrequently:!0});h(o),o.drawImage(e,0,0),this._data=s,this._layout=null,this.format="RGBX",this.visibleRect={left:0,top:0,width:i,height:n},this.squarePixelWidth=i,this.squarePixelHeight=n,this.rotation=r.rotation??0,this.timestamp=r.timestamp,this.duration=r.duration??0,this.colorSpace=new Ae({matrix:"rgb",primaries:"bt709",transfer:"iec61966-2-1",fullRange:!0})}else throw new TypeError("Invalid data type: Must be a BufferSource or CanvasImageSource.");this.pixelAspectRatio=ot({num:this.squarePixelWidth*this.codedHeight,den:this.squarePixelHeight*this.codedWidth}),Xe?.register(this,{type:"video",data:this._data},this)}clone(){if(this._closed)throw new Error("VideoSample is closed.");return h(this._data!==null),xe(this._data)?new t(this._data.clone(),{timestamp:this.timestamp,duration:this.duration,rotation:this.rotation}):this._data instanceof Uint8Array?(h(this._layout),new t(this._data,{format:this.format,layout:this._layout,codedWidth:this.codedWidth,codedHeight:this.codedHeight,timestamp:this.timestamp,duration:this.duration,colorSpace:this.colorSpace,rotation:this.rotation,visibleRect:this.visibleRect,displayWidth:this.displayWidth,displayHeight:this.displayHeight})):new t(this._data,{format:this.format,codedWidth:this.codedWidth,codedHeight:this.codedHeight,timestamp:this.timestamp,duration:this.duration,colorSpace:this.colorSpace,rotation:this.rotation,visibleRect:this.visibleRect,displayWidth:this.displayWidth,displayHeight:this.displayHeight})}close(){this._closed||(Xe?.unregister(this),xe(this._data)?this._data.close():this._data=null,this._closed=!0)}allocationSize(e={}){if(Lr(e),this._closed)throw new Error("VideoSample is closed.");if(this.format===null)throw new Error("Cannot get allocation size when format is null. Sorry!");if(h(this._data!==null),!xe(this._data)&&(e.colorSpace||e.format&&e.format!==this.format||e.layout||e.rect)){let r=this.toVideoFrame(),i=r.allocationSize(e);return r.close(),i}return xe(this._data)?this._data.allocationSize(e):this._data instanceof Uint8Array?this._data.byteLength:this.codedWidth*this.codedHeight*4}async copyTo(e,r={}){if(!ve(e))throw new TypeError("destination must be an ArrayBuffer or an ArrayBuffer view.");if(Lr(r),this._closed)throw new Error("VideoSample is closed.");if(this.format===null)throw new Error("Cannot copy video sample data when format is null. Sorry!");if(h(this._data!==null),!xe(this._data)&&(r.colorSpace||r.format&&r.format!==this.format||r.layout||r.rect)){let i=this.toVideoFrame(),n=await i.copyTo(e,r);return i.close(),n}if(xe(this._data))return this._data.copyTo(e,r);if(this._data instanceof Uint8Array)return h(this._layout),W(e).set(this._data),this._layout;{let n=this._data.getContext("2d");h(n);let s=n.getImageData(0,0,this.codedWidth,this.codedHeight);return W(e).set(s.data),[{offset:0,stride:4*this.codedWidth}]}}toVideoFrame(){if(this._closed)throw new Error("VideoSample is closed.");return h(this._data!==null),xe(this._data)?new VideoFrame(this._data,{timestamp:this.microsecondTimestamp,duration:this.microsecondDuration||void 0}):this._data instanceof Uint8Array?new VideoFrame(this._data,{format:this.format,codedWidth:this.codedWidth,codedHeight:this.codedHeight,timestamp:this.microsecondTimestamp,duration:this.microsecondDuration||void 0,colorSpace:this.colorSpace}):new VideoFrame(this._data,{timestamp:this.microsecondTimestamp,duration:this.microsecondDuration||void 0})}draw(e,r,i,n,s,o,a,d,l){let c=0,u=0,f=this.displayWidth,g=this.displayHeight,w=0,T=0,b=this.displayWidth,E=this.displayHeight;if(o!==void 0?(c=r,u=i,f=n,g=s,w=o,T=a,d!==void 0?(b=d,E=l):(b=f,E=g)):(w=r,T=i,n!==void 0&&(b=n,E=s)),!(typeof CanvasRenderingContext2D<"u"&&e instanceof CanvasRenderingContext2D||typeof OffscreenCanvasRenderingContext2D<"u"&&e instanceof OffscreenCanvasRenderingContext2D))throw new TypeError("context must be a CanvasRenderingContext2D or OffscreenCanvasRenderingContext2D.");if(!Number.isFinite(c))throw new TypeError("sx must be a number.");if(!Number.isFinite(u))throw new TypeError("sy must be a number.");if(!Number.isFinite(f)||f<0)throw new TypeError("sWidth must be a non-negative number.");if(!Number.isFinite(g)||g<0)throw new TypeError("sHeight must be a non-negative number.");if(!Number.isFinite(w))throw new TypeError("dx must be a number.");if(!Number.isFinite(T))throw new TypeError("dy must be a number.");if(!Number.isFinite(b)||b<0)throw new TypeError("dWidth must be a non-negative number.");if(!Number.isFinite(E)||E<0)throw new TypeError("dHeight must be a non-negative number.");if(this._closed)throw new Error("VideoSample is closed.");({sx:c,sy:u,sWidth:f,sHeight:g}=this._rotateSourceRegion(c,u,f,g,this.rotation));let _=this.toCanvasImageSource();e.save();let k=w+b/2,z=T+E/2;e.translate(k,z),e.rotate(this.rotation*Math.PI/180);let V=this.rotation%180===0?1:b/E;e.scale(1/V,V),e.drawImage(_,c,u,f,g,-b/2,-E/2,b,E),e.restore()}drawWithFit(e,r){if(!(typeof CanvasRenderingContext2D<"u"&&e instanceof CanvasRenderingContext2D||typeof OffscreenCanvasRenderingContext2D<"u"&&e instanceof OffscreenCanvasRenderingContext2D))throw new TypeError("context must be a CanvasRenderingContext2D or OffscreenCanvasRenderingContext2D.");if(!r||typeof r!="object")throw new TypeError("options must be an object.");if(!["fill","contain","cover"].includes(r.fit))throw new TypeError("options.fit must be 'fill', 'contain', or 'cover'.");if(r.rotation!==void 0&&![0,90,180,270].includes(r.rotation))throw new TypeError("options.rotation, when provided, must be 0, 90, 180, or 270.");r.crop!==void 0&&Ui(r.crop,"options.");let i=e.canvas.width,n=e.canvas.height,s=r.rotation??this.rotation,[o,a]=s%180===0?[this.squarePixelWidth,this.squarePixelHeight]:[this.squarePixelHeight,this.squarePixelWidth];r.crop&&Oi(r.crop,o,a);let d,l,c,u,{sx:f,sy:g,sWidth:w,sHeight:T}=this._rotateSourceRegion(r.crop?.left??0,r.crop?.top??0,r.crop?.width??o,r.crop?.height??a,s);if(r.fit==="fill")d=0,l=0,c=i,u=n;else{let[E,_]=r.crop?[r.crop.width,r.crop.height]:[o,a],k=r.fit==="contain"?Math.min(i/E,n/_):Math.max(i/E,n/_);c=E*k,u=_*k,d=(i-c)/2,l=(n-u)/2}e.save();let b=s%180===0?1:c/u;e.translate(i/2,n/2),e.rotate(s*Math.PI/180),e.scale(1/b,b),e.translate(-i/2,-n/2),e.drawImage(this.toCanvasImageSource(),f,g,w,T,d,l,c,u),e.restore()}_rotateSourceRegion(e,r,i,n,s){return s===90?[e,r,i,n]=[r,this.squarePixelHeight-e-i,n,i]:s===180?[e,r]=[this.squarePixelWidth-e-i,this.squarePixelHeight-r-n]:s===270&&([e,r,i,n]=[this.squarePixelWidth-r-n,e,n,i]),{sx:e,sy:r,sWidth:i,sHeight:n}}toCanvasImageSource(){if(this._closed)throw new Error("VideoSample is closed.");if(h(this._data!==null),this._data instanceof Uint8Array){let e=this.toVideoFrame();return queueMicrotask(()=>e.close()),e}else return this._data}setRotation(e){if(![0,90,180,270].includes(e))throw new TypeError("newRotation must be 0, 90, 180, or 270.");this.rotation=e}setTimestamp(e){if(!Number.isFinite(e))throw new TypeError("newTimestamp must be a number.");this.timestamp=e}setDuration(e){if(!Number.isFinite(e)||e<0)throw new TypeError("newDuration must be a non-negative number.");this.duration=e}[Symbol.dispose](){this.close()}},Ae=class{constructor(e){if(e!==void 0){if(!e||typeof e!="object")throw new TypeError("init.colorSpace, when provided, must be an object.");let r=Object.keys(ge);if(e.primaries!=null&&!r.includes(e.primaries))throw new TypeError(\`init.colorSpace.primaries, when provided, must be one of \${r.join(", ")}.\`);let i=Object.keys(we);if(e.transfer!=null&&!i.includes(e.transfer))throw new TypeError(\`init.colorSpace.transfer, when provided, must be one of \${i.join(", ")}.\`);let n=Object.keys(be);if(e.matrix!=null&&!n.includes(e.matrix))throw new TypeError(\`init.colorSpace.matrix, when provided, must be one of \${n.join(", ")}.\`);if(e.fullRange!=null&&typeof e.fullRange!="boolean")throw new TypeError("init.colorSpace.fullRange, when provided, must be a boolean.")}this.primaries=e?.primaries??null,this.transfer=e?.transfer??null,this.matrix=e?.matrix??null,this.fullRange=e?.fullRange??null}toJSON(){return{primaries:this.primaries,transfer:this.transfer,matrix:this.matrix,fullRange:this.fullRange}}},xe=t=>typeof VideoFrame<"u"&&t instanceof VideoFrame,Oi=(t,e,r)=>{t.left=Math.min(t.left,e),t.top=Math.min(t.top,r),t.width=Math.min(t.width,e-t.left),t.height=Math.min(t.height,r-t.top),h(t.width>=0),h(t.height>=0)},Ui=(t,e)=>{if(!t||typeof t!="object")throw new TypeError(e+"crop, when provided, must be an object.");if(!Number.isInteger(t.left)||t.left<0)throw new TypeError(e+"crop.left must be a non-negative integer.");if(!Number.isInteger(t.top)||t.top<0)throw new TypeError(e+"crop.top must be a non-negative integer.");if(!Number.isInteger(t.width)||t.width<0)throw new TypeError(e+"crop.width must be a non-negative integer.");if(!Number.isInteger(t.height)||t.height<0)throw new TypeError(e+"crop.height must be a non-negative integer.")},Lr=t=>{if(!t||typeof t!="object")throw new TypeError("options must be an object.");if(t.colorSpace!==void 0&&!["display-p3","srgb"].includes(t.colorSpace))throw new TypeError("options.colorSpace, when provided, must be 'display-p3' or 'srgb'.");if(t.format!==void 0&&typeof t.format!="string")throw new TypeError("options.format, when provided, must be a string.");if(t.layout!==void 0){if(!Array.isArray(t.layout))throw new TypeError("options.layout, when provided, must be an array.");for(let e of t.layout){if(!e||typeof e!="object")throw new TypeError("Each entry in options.layout must be an object.");if(!Number.isInteger(e.offset)||e.offset<0)throw new TypeError("plane.offset must be a non-negative integer.");if(!Number.isInteger(e.stride)||e.stride<0)throw new TypeError("plane.stride must be a non-negative integer.")}}if(t.rect!==void 0){if(!t.rect||typeof t.rect!="object")throw new TypeError("options.rect, when provided, must be an object.");if(t.rect.x!==void 0&&(!Number.isInteger(t.rect.x)||t.rect.x<0))throw new TypeError("options.rect.x, when provided, must be a non-negative integer.");if(t.rect.y!==void 0&&(!Number.isInteger(t.rect.y)||t.rect.y<0))throw new TypeError("options.rect.y, when provided, must be a non-negative integer.");if(t.rect.width!==void 0&&(!Number.isInteger(t.rect.width)||t.rect.width<0))throw new TypeError("options.rect.width, when provided, must be a non-negative integer.");if(t.rect.height!==void 0&&(!Number.isInteger(t.rect.height)||t.rect.height<0))throw new TypeError("options.rect.height, when provided, must be a non-negative integer.")}},Li=(t,e,r)=>{let i=zi(t),n=[],s=0;for(let o of i){let a=Math.ceil(e/o.widthDivisor),d=Math.ceil(r/o.heightDivisor),l=a*o.sampleBytes,c=l*d;n.push({offset:s,stride:l}),s+=c}return n},zi=t=>{let e=(r,i,n,s,o)=>{let a=[{sampleBytes:r,widthDivisor:1,heightDivisor:1},{sampleBytes:i,widthDivisor:n,heightDivisor:s},{sampleBytes:i,widthDivisor:n,heightDivisor:s}];return o&&a.push({sampleBytes:r,widthDivisor:1,heightDivisor:1}),a};switch(t){case"I420":return e(1,1,2,2,!1);case"I420P10":case"I420P12":return e(2,2,2,2,!1);case"I420A":return e(1,1,2,2,!0);case"I420AP10":case"I420AP12":return e(2,2,2,2,!0);case"I422":return e(1,1,2,1,!1);case"I422P10":case"I422P12":return e(2,2,2,1,!1);case"I422A":return e(1,1,2,1,!0);case"I422AP10":case"I422AP12":return e(2,2,2,1,!0);case"I444":return e(1,1,1,1,!1);case"I444P10":case"I444P12":return e(2,2,1,1,!1);case"I444A":return e(1,1,1,1,!0);case"I444AP10":case"I444AP12":return e(2,2,1,1,!0);case"NV12":return[{sampleBytes:1,widthDivisor:1,heightDivisor:1},{sampleBytes:2,widthDivisor:2,heightDivisor:2}];case"RGBA":case"RGBX":case"BGRA":case"BGRX":return[{sampleBytes:4,widthDivisor:1,heightDivisor:1}];default:ce(t),h(!1)}},_t=new Set(["f32","f32-planar","s16","s16-planar","s32","s32-planar","u8","u8-planar"]),de=class t{get microsecondTimestamp(){return Math.trunc(Y*this.timestamp)}get microsecondDuration(){return Math.trunc(Y*this.duration)}constructor(e){if(this._closed=!1,Qe(e)){if(e.format===null)throw new TypeError("AudioData with null format is not supported.");this._data=e,this.format=e.format,this.sampleRate=e.sampleRate,this.numberOfFrames=e.numberOfFrames,this.numberOfChannels=e.numberOfChannels,this.timestamp=e.timestamp/1e6,this.duration=e.numberOfFrames/e.sampleRate}else{if(!e||typeof e!="object")throw new TypeError("Invalid AudioDataInit: must be an object.");if(!_t.has(e.format))throw new TypeError("Invalid AudioDataInit: invalid format.");if(!Number.isFinite(e.sampleRate)||e.sampleRate<=0)throw new TypeError("Invalid AudioDataInit: sampleRate must be > 0.");if(!Number.isInteger(e.numberOfChannels)||e.numberOfChannels===0)throw new TypeError("Invalid AudioDataInit: numberOfChannels must be an integer > 0.");if(!Number.isFinite(e?.timestamp))throw new TypeError("init.timestamp must be a number.");let r=e.data.byteLength/(Te(e.format)*e.numberOfChannels);if(!Number.isInteger(r))throw new TypeError("Invalid AudioDataInit: data size is not a multiple of frame size.");this.format=e.format,this.sampleRate=e.sampleRate,this.numberOfFrames=r,this.numberOfChannels=e.numberOfChannels,this.timestamp=e.timestamp,this.duration=r/e.sampleRate;let i;if(e.data instanceof ArrayBuffer)i=new Uint8Array(e.data);else if(ArrayBuffer.isView(e.data))i=new Uint8Array(e.data.buffer,e.data.byteOffset,e.data.byteLength);else throw new TypeError("Invalid AudioDataInit: data is not a BufferSource.");let n=this.numberOfFrames*this.numberOfChannels*Te(this.format);if(i.byteLength<n)throw new TypeError("Invalid AudioDataInit: insufficient data size.");this._data=i}Xe?.register(this,{type:"audio",data:this._data},this)}allocationSize(e){if(!e||typeof e!="object")throw new TypeError("options must be an object.");if(!Number.isInteger(e.planeIndex)||e.planeIndex<0)throw new TypeError("planeIndex must be a non-negative integer.");if(e.format!==void 0&&!_t.has(e.format))throw new TypeError("Invalid format.");if(e.frameOffset!==void 0&&(!Number.isInteger(e.frameOffset)||e.frameOffset<0))throw new TypeError("frameOffset must be a non-negative integer.");if(e.frameCount!==void 0&&(!Number.isInteger(e.frameCount)||e.frameCount<0))throw new TypeError("frameCount must be a non-negative integer.");if(this._closed)throw new Error("AudioSample is closed.");let r=e.format??this.format,i=e.frameOffset??0;if(i>=this.numberOfFrames)throw new RangeError("frameOffset out of range");let n=e.frameCount!==void 0?e.frameCount:this.numberOfFrames-i;if(n>this.numberOfFrames-i)throw new RangeError("frameCount out of range");let s=Te(r),o=_e(r);if(o&&e.planeIndex>=this.numberOfChannels)throw new RangeError("planeIndex out of range");if(!o&&e.planeIndex!==0)throw new RangeError("planeIndex out of range");return(o?n:n*this.numberOfChannels)*s}copyTo(e,r){if(!ve(e))throw new TypeError("destination must be an ArrayBuffer or an ArrayBuffer view.");if(!r||typeof r!="object")throw new TypeError("options must be an object.");if(!Number.isInteger(r.planeIndex)||r.planeIndex<0)throw new TypeError("planeIndex must be a non-negative integer.");if(r.format!==void 0&&!_t.has(r.format))throw new TypeError("Invalid format.");if(r.frameOffset!==void 0&&(!Number.isInteger(r.frameOffset)||r.frameOffset<0))throw new TypeError("frameOffset must be a non-negative integer.");if(r.frameCount!==void 0&&(!Number.isInteger(r.frameCount)||r.frameCount<0))throw new TypeError("frameCount must be a non-negative integer.");if(this._closed)throw new Error("AudioSample is closed.");let{planeIndex:i,format:n,frameCount:s,frameOffset:o}=r,a=this.format,d=n??this.format;if(!d)throw new Error("Destination format not determined");let l=this.numberOfFrames,c=this.numberOfChannels,u=o??0;if(u>=l)throw new RangeError("frameOffset out of range");let f=s!==void 0?s:l-u;if(f>l-u)throw new RangeError("frameCount out of range");let g=Te(d),w=_e(d);if(w&&i>=c)throw new RangeError("planeIndex out of range");if(!w&&i!==0)throw new RangeError("planeIndex out of range");let b=(w?f:f*c)*g;if(e.byteLength<b)throw new RangeError("Destination buffer is too small");let E=$(e),_=Vr(d);if(Qe(this._data))Jt()&&c>2&&d!==a?Vi(this._data,E,a,d,c,i,u,f):this._data.copyTo(e,{planeIndex:i,frameOffset:u,frameCount:f,format:d});else{let k=this._data,z=$(k),V=zr(a),X=Te(a),re=_e(a);for(let P=0;P<f;P++)if(w){let M=P*g,oe;re?oe=(i*l+(P+u))*X:oe=((P+u)*c+i)*X;let N=V(z,oe);_(E,M,N)}else for(let M=0;M<c;M++){let N=(P*c+M)*g,v;re?v=(M*l+(P+u))*X:v=((P+u)*c+M)*X;let D=V(z,v);_(E,N,D)}}}clone(){if(this._closed)throw new Error("AudioSample is closed.");if(Qe(this._data)){let e=new t(this._data.clone());return e.setTimestamp(this.timestamp),e}else return new t({format:this.format,sampleRate:this.sampleRate,numberOfFrames:this.numberOfFrames,numberOfChannels:this.numberOfChannels,timestamp:this.timestamp,data:this._data})}close(){this._closed||(Xe?.unregister(this),Qe(this._data)?this._data.close():this._data=new Uint8Array(0),this._closed=!0)}toAudioData(){if(this._closed)throw new Error("AudioSample is closed.");if(Qe(this._data)){if(this._data.timestamp===this.microsecondTimestamp)return this._data.clone();if(_e(this.format)){let e=this.allocationSize({planeIndex:0,format:this.format}),r=new ArrayBuffer(e*this.numberOfChannels);for(let i=0;i<this.numberOfChannels;i++)this.copyTo(new Uint8Array(r,i*e,e),{planeIndex:i,format:this.format});return new AudioData({format:this.format,sampleRate:this.sampleRate,numberOfFrames:this.numberOfFrames,numberOfChannels:this.numberOfChannels,timestamp:this.microsecondTimestamp,data:r})}else{let e=new ArrayBuffer(this.allocationSize({planeIndex:0,format:this.format}));return this.copyTo(e,{planeIndex:0,format:this.format}),new AudioData({format:this.format,sampleRate:this.sampleRate,numberOfFrames:this.numberOfFrames,numberOfChannels:this.numberOfChannels,timestamp:this.microsecondTimestamp,data:e})}}else return new AudioData({format:this.format,sampleRate:this.sampleRate,numberOfFrames:this.numberOfFrames,numberOfChannels:this.numberOfChannels,timestamp:this.microsecondTimestamp,data:this._data.buffer instanceof ArrayBuffer?this._data.buffer:this._data.slice()})}toAudioBuffer(){if(this._closed)throw new Error("AudioSample is closed.");let e=new AudioBuffer({numberOfChannels:this.numberOfChannels,length:this.numberOfFrames,sampleRate:this.sampleRate}),r=new Float32Array(this.allocationSize({planeIndex:0,format:"f32-planar"})/4);for(let i=0;i<this.numberOfChannels;i++)this.copyTo(r,{planeIndex:i,format:"f32-planar"}),e.copyToChannel(r,i);return e}setTimestamp(e){if(!Number.isFinite(e))throw new TypeError("newTimestamp must be a number.");this.timestamp=e}[Symbol.dispose](){this.close()}static*_fromAudioBuffer(e,r){if(!(e instanceof AudioBuffer))throw new TypeError("audioBuffer must be an AudioBuffer.");let i=48e3*5,n=e.numberOfChannels,s=e.sampleRate,o=e.length,a=Math.floor(i/n),d=0,l=o;for(;l>0;){let c=Math.min(a,l),u=new Float32Array(n*c);for(let f=0;f<n;f++)e.copyFromChannel(u.subarray(f*c,(f+1)*c),f,d);yield new t({format:"f32-planar",sampleRate:s,numberOfFrames:c,numberOfChannels:n,timestamp:r+d/s,data:u}),d+=c,l-=c}}static fromAudioBuffer(e,r){if(!(e instanceof AudioBuffer))throw new TypeError("audioBuffer must be an AudioBuffer.");let i=48e3*5,n=e.numberOfChannels,s=e.sampleRate,o=e.length,a=Math.floor(i/n),d=0,l=o,c=[];for(;l>0;){let u=Math.min(a,l),f=new Float32Array(n*u);for(let w=0;w<n;w++)e.copyFromChannel(f.subarray(w*u,(w+1)*u),w,d);let g=new t({format:"f32-planar",sampleRate:s,numberOfFrames:u,numberOfChannels:n,timestamp:r+d/s,data:f});c.push(g),d+=u,l-=u}return c}},Te=t=>{switch(t){case"u8":case"u8-planar":return 1;case"s16":case"s16-planar":return 2;case"s32":case"s32-planar":return 4;case"f32":case"f32-planar":return 4;default:throw new Error("Unknown AudioSampleFormat")}},_e=t=>{switch(t){case"u8-planar":case"s16-planar":case"s32-planar":case"f32-planar":return!0;default:return!1}},zr=t=>{switch(t){case"u8":case"u8-planar":return(e,r)=>(e.getUint8(r)-128)/128;case"s16":case"s16-planar":return(e,r)=>e.getInt16(r,!0)/32768;case"s32":case"s32-planar":return(e,r)=>e.getInt32(r,!0)/2147483648;case"f32":case"f32-planar":return(e,r)=>e.getFloat32(r,!0)}},Vr=t=>{switch(t){case"u8":case"u8-planar":return(e,r,i)=>e.setUint8(r,R((i+1)*127.5,0,255));case"s16":case"s16-planar":return(e,r,i)=>e.setInt16(r,R(Math.round(i*32767),-32768,32767),!0);case"s32":case"s32-planar":return(e,r,i)=>e.setInt32(r,R(Math.round(i*2147483647),-2147483648,2147483647),!0);case"f32":case"f32-planar":return(e,r,i)=>e.setFloat32(r,i,!0)}},Qe=t=>typeof AudioData<"u"&&t instanceof AudioData,Vi=(t,e,r,i,n,s,o,a)=>{let d=zr(r),l=Vr(i),c=Te(r),u=Te(i),f=_e(r);if(_e(i))if(f){let w=new ArrayBuffer(a*c),T=$(w);t.copyTo(w,{planeIndex:s,frameOffset:o,frameCount:a,format:r});for(let b=0;b<a;b++){let E=b*c,_=b*u,k=d(T,E);l(e,_,k)}}else{let w=new ArrayBuffer(a*n*c),T=$(w);t.copyTo(w,{planeIndex:0,frameOffset:o,frameCount:a,format:r});for(let b=0;b<a;b++){let E=(b*n+s)*c,_=b*u,k=d(T,E);l(e,_,k)}}else if(f){let w=a*c,T=new ArrayBuffer(w),b=$(T);for(let E=0;E<n;E++){t.copyTo(T,{planeIndex:E,frameOffset:o,frameCount:a,format:r});for(let _=0;_<a;_++){let k=_*c,z=(_*n+E)*u,V=d(b,k);l(e,z,V)}}}else{let w=new ArrayBuffer(a*n*c),T=$(w);t.copyTo(w,{planeIndex:0,frameOffset:o,frameCount:a,format:r});for(let b=0;b<a;b++)for(let E=0;E<n;E++){let _=b*n+E,k=_*c,z=_*u,V=d(T,k);l(e,z,V)}}};var Nr=t=>{let r=(t.hasVideo?"video/":t.hasAudio?"audio/":"application/")+(t.isQuickTime?"quicktime":"mp4");if(t.codecStrings.length>0){let i=[...new Set(t.codecStrings)];r+=\`; codecs="\${i.join(", ")}"\`}return r};var dt=8,kt=16;var Wr=7,Dr=9,Bt=t=>{let e=t.filePos,r=Hr(t,9),i=new O(r);if(i.readBits(12)!==4095||(i.skipBits(1),i.readBits(2)!==0))return null;let o=i.readBits(1),a=i.readBits(2)+1,d=i.readBits(4);if(d===15)return null;i.skipBits(1);let l=i.readBits(3);if(l===0)throw new Error("ADTS frames with channel configuration 0 are not supported.");i.skipBits(1),i.skipBits(1),i.skipBits(1),i.skipBits(1);let c=i.readBits(13);i.skipBits(11);let u=i.readBits(2)+1;if(u!==1)throw new Error("ADTS frames with more than one AAC frame are not supported.");let f=null;return o===1?t.filePos-=2:f=i.readBits(16),{objectType:a,samplingFrequencyIndex:d,channelConfiguration:l,frameLength:c,numberOfAacFrames:u,crcCheck:f,startPos:e}};var Ge=class t{constructor(e,r,i,n,s){this.bytes=e,this.view=r,this.offset=i,this.start=n,this.end=s,this.bufferPos=n-i}static tempFromBytes(e){return new t(e,$(e),0,0,e.length)}get length(){return this.end-this.start}get filePos(){return this.offset+this.bufferPos}set filePos(e){this.bufferPos=e-this.offset}get remainingLength(){return Math.max(this.end-this.filePos,0)}skip(e){this.bufferPos+=e}slice(e,r=this.end-e){if(e<this.start||e+r>this.end)throw new RangeError("Slicing outside of original slice.");return new t(this.bytes,this.view,this.offset,e,e+r)}},Ni=(t,e)=>{if(t.filePos<t.start||t.filePos+e>t.end)throw new RangeError(\`Tried reading [\${t.filePos}, \${t.filePos+e}), but slice is [\${t.start}, \${t.end}). This is likely an internal error, please report it alongside the file that caused it.\`)},Hr=(t,e)=>{Ni(t,e);let r=t.bytes.subarray(t.bufferPos,t.bufferPos+e);return t.bufferPos+=e,r};var ut=class{constructor(e){this.mutex=new Se,this.firstMediaStreamTimestamp=null,this.trackTimestampInfo=new WeakMap,this.output=e}onTrackClose(e){}validateAndNormalizeTimestamp(e,r,i){if(r+=e.source._timestampOffset,r<0)throw new Error(\`Timestamps must be non-negative (got \${r}s).\`);let n=this.trackTimestampInfo.get(e);if(n){if(i&&(n.maxTimestampBeforeLastKeyPacket=n.maxTimestamp),n.maxTimestampBeforeLastKeyPacket!==null&&r<n.maxTimestampBeforeLastKeyPacket)throw new Error(\`Timestamps cannot be smaller than the largest timestamp of the previous GOP (a GOP begins with a key packet and ends right before the next key packet). Got \${r}s, but largest timestamp is \${n.maxTimestampBeforeLastKeyPacket}s.\`);n.maxTimestamp=Math.max(n.maxTimestamp,r)}else{if(!i)throw new Error("First packet must be a key packet.");n={maxTimestamp:r,maxTimestampBeforeLastKeyPacket:null},this.trackTimestampInfo.set(e,n)}return r}};var It=/<(?:(\\d{2}):)?(\\d{2}):(\\d{2}).(\\d{3})>/g;var jr=t=>{let e=Math.floor(t/36e5),r=Math.floor(t%(60*60*1e3)/(60*1e3)),i=Math.floor(t%(60*1e3)/1e3),n=t%1e3;return e.toString().padStart(2,"0")+":"+r.toString().padStart(2,"0")+":"+i.toString().padStart(2,"0")+"."+n.toString().padStart(3,"0")};var Ye=class{constructor(e){this.writer=e,this.helper=new Uint8Array(8),this.helperView=new DataView(this.helper.buffer),this.offsets=new WeakMap}writeU32(e){this.helperView.setUint32(0,e,!1),this.writer.write(this.helper.subarray(0,4))}writeU64(e){this.helperView.setUint32(0,Math.floor(e/2**32),!1),this.helperView.setUint32(4,e,!1),this.writer.write(this.helper.subarray(0,8))}writeAscii(e){for(let r=0;r<e.length;r++)this.helperView.setUint8(r%8,e.charCodeAt(r)),r%8===7&&this.writer.write(this.helper);e.length%8!==0&&this.writer.write(this.helper.subarray(0,e.length%8))}writeBox(e){if(this.offsets.set(e,this.writer.getPos()),e.contents&&!e.children)this.writeBoxHeader(e,e.size??e.contents.byteLength+8),this.writer.write(e.contents);else{let r=this.writer.getPos();if(this.writeBoxHeader(e,0),e.contents&&this.writer.write(e.contents),e.children)for(let s of e.children)s&&this.writeBox(s);let i=this.writer.getPos(),n=e.size??i-r;this.writer.seek(r),this.writeBoxHeader(e,n),this.writer.seek(i)}}writeBoxHeader(e,r){this.writeU32(e.largeSize?1:r),this.writeAscii(e.type),e.largeSize&&this.writeU64(r)}measureBoxHeader(e){return 8+(e.largeSize?8:0)}patchBox(e){let r=this.offsets.get(e);h(r!==void 0);let i=this.writer.getPos();this.writer.seek(r),this.writeBox(e),this.writer.seek(i)}measureBox(e){if(e.contents&&!e.children)return this.measureBoxHeader(e)+e.contents.byteLength;{let r=this.measureBoxHeader(e);if(e.contents&&(r+=e.contents.byteLength),e.children)for(let i of e.children)i&&(r+=this.measureBox(i));return r}}},C=new Uint8Array(8),te=new DataView(C.buffer),A=t=>[(t%256+256)%256],x=t=>(te.setUint16(0,t,!1),[C[0],C[1]]),Rt=t=>(te.setInt16(0,t,!1),[C[0],C[1]]),Qr=t=>(te.setUint32(0,t,!1),[C[1],C[2],C[3]]),m=t=>(te.setUint32(0,t,!1),[C[0],C[1],C[2],C[3]]),fe=t=>(te.setInt32(0,t,!1),[C[0],C[1],C[2],C[3]]),Ee=t=>(te.setUint32(0,Math.floor(t/2**32),!1),te.setUint32(4,t,!1),[C[0],C[1],C[2],C[3],C[4],C[5],C[6],C[7]]),Xr=t=>(te.setInt16(0,2**8*t,!1),[C[0],C[1]]),se=t=>(te.setInt32(0,2**16*t,!1),[C[0],C[1],C[2],C[3]]),Pt=t=>(te.setInt32(0,2**30*t,!1),[C[0],C[1],C[2],C[3]]),Mt=(t,e)=>{let r=[],i=t;do{let n=i&127;i>>=7,r.length>0&&(n|=128),r.push(n),e!==void 0&&e--}while(i>0||e);return r.reverse()},U=(t,e=!1)=>{let r=Array(t.length).fill(null).map((i,n)=>t.charCodeAt(n));return e&&r.push(0),r},Ot=t=>{let e=null;for(let r of t)(!e||r.timestamp>e.timestamp)&&(e=r);return e},Gr=t=>{let e=t*(Math.PI/180),r=Math.round(Math.cos(e)),i=Math.round(Math.sin(e));return[r,i,0,-i,r,0,0,0,1]},Yr=Gr(0),Kr=t=>[se(t[0]),se(t[1]),Pt(t[2]),se(t[3]),se(t[4]),Pt(t[5]),se(t[6]),se(t[7]),Pt(t[8])],y=(t,e,r)=>({type:t,contents:e&&new Uint8Array(e.flat(10)),children:r}),S=(t,e,r,i,n)=>y(t,[A(e),Qr(r),i??[]],n),Zr=t=>t.isQuickTime?y("ftyp",[U("qt  "),m(512),U("qt  ")]):t.fragmented?y("ftyp",[U("iso5"),m(512),U("iso5"),U("iso6"),U("mp41")]):y("ftyp",[U("isom"),m(512),U("isom"),t.holdsAvc?U("avc1"):[],U("mp41")]),Ke=t=>({type:"mdat",largeSize:t}),Jr=t=>({type:"free",size:t}),Be=t=>y("moov",void 0,[Wi(t.creationTime,t.trackDatas),...t.trackDatas.map(e=>Di(e,t.creationTime)),t.isFragmented?An(t.trackDatas):null,Un(t)]),Wi=(t,e)=>{let r=B(Math.max(0,...e.filter(o=>o.samples.length>0).map(o=>{let a=Ot(o.samples);return a.timestamp+a.duration})),ft),i=Math.max(0,...e.map(o=>o.track.id))+1,n=!pe(t)||!pe(r),s=n?Ee:m;return S("mvhd",+n,0,[s(t),s(t),m(ft),s(r),se(1),Xr(1),Array(10).fill(0),Kr(Yr),Array(24).fill(0),m(i)])},Di=(t,e)=>{let r=ci(t);return y("trak",void 0,[Hi(t,e),ji(t,e),r.name!==void 0?y("udta",void 0,[y("name",[...q.encode(r.name)])]):null])},Hi=(t,e)=>{let r=Ot(t.samples),i=B(r?r.timestamp+r.duration:0,ft),n=!pe(e)||!pe(i),s=n?Ee:m,o;if(t.type==="video"){let d=t.track.metadata.rotation;o=Gr(d??0)}else o=Yr;let a=2;return t.track.metadata.disposition?.default!==!1&&(a|=1),S("tkhd",+n,a,[s(e),s(e),m(t.track.id),m(0),s(i),Array(8).fill(0),x(0),x(t.track.id),Xr(t.type==="audio"?1:0),x(0),Kr(o),se(t.type==="video"?t.info.width:0),se(t.type==="video"?t.info.height:0)])},ji=(t,e)=>y("mdia",void 0,[$i(t,e),Ut(!0,qi[t.type],Qi[t.type]),Xi(t)]),$i=(t,e)=>{let r=Ot(t.samples),i=B(r?r.timestamp+r.duration:0,t.timescale),n=!pe(e)||!pe(i),s=n?Ee:m;return S("mdhd",+n,0,[s(e),s(e),m(t.timescale),s(i),x(ai(t.track.metadata.languageCode??Yt)),x(0)])},qi={video:"vide",audio:"soun",subtitle:"text"},Qi={video:"MediabunnyVideoHandler",audio:"MediabunnySoundHandler",subtitle:"MediabunnyTextHandler"},Ut=(t,e,r,i="\\0\\0\\0\\0")=>S("hdlr",0,0,[t?U("mhlr"):m(0),U(e),U(i),m(0),m(0),U(r,!0)]),Xi=t=>y("minf",void 0,[Zi[t.type](),Ji(),rn(t)]),Gi=()=>S("vmhd",0,1,[x(0),x(0),x(0),x(0)]),Yi=()=>S("smhd",0,0,[x(0),x(0)]),Ki=()=>S("nmhd",0,0),Zi={video:Gi,audio:Yi,subtitle:Ki},Ji=()=>y("dinf",void 0,[en()]),en=()=>S("dref",0,0,[m(1)],[tn()]),tn=()=>S("url ",0,1),rn=t=>{let e=t.compositionTimeOffsetTable.length>1||t.compositionTimeOffsetTable.some(r=>r.sampleCompositionTimeOffset!==0);return y("stbl",void 0,[nn(t),xn(t),e?vn(t):null,e?_n(t):null,En(t),Cn(t),Sn(t),Tn(t)])},nn=t=>{let e;if(t.type==="video")e=sn(Nn(t.track.source._codec,t.info.decoderConfig.codec),t);else if(t.type==="audio"){let r=oi(t.track.source._codec,t.muxer.isQuickTime);h(r),e=un(r,t)}else t.type==="subtitle"&&(e=bn(Hn[t.track.source._codec],t));return h(e),S("stsd",0,0,[m(1)],[e])},sn=(t,e)=>y(t,[Array(6).fill(0),x(1),x(0),x(0),Array(12).fill(0),x(e.info.width),x(e.info.height),m(4718592),m(4718592),m(0),x(1),Array(32).fill(0),x(24),Rt(65535)],[Wn[e.track.source._codec](e),on(e),Xt(e.info.decoderConfig.colorSpace)?an(e):null]),on=t=>t.info.pixelAspectRatio.num===t.info.pixelAspectRatio.den?null:y("pasp",[m(t.info.pixelAspectRatio.num),m(t.info.pixelAspectRatio.den)]),an=t=>y("colr",[U("nclx"),x(ge[t.info.decoderConfig.colorSpace.primaries]),x(we[t.info.decoderConfig.colorSpace.transfer]),x(be[t.info.decoderConfig.colorSpace.matrix]),A((t.info.decoderConfig.colorSpace.fullRange?1:0)<<7)]),cn=t=>t.info.decoderConfig&&y("avcC",[...W(t.info.decoderConfig.description)]),ln=t=>t.info.decoderConfig&&y("hvcC",[...W(t.info.decoderConfig.description)]),$r=t=>{if(!t.info.decoderConfig)return null;let e=t.info.decoderConfig,r=e.codec.split("."),i=Number(r[1]),n=Number(r[2]),s=Number(r[3]),o=r[4]?Number(r[4]):1,a=r[8]?Number(r[8]):Number(e.colorSpace?.fullRange??0),d=(s<<4)+(o<<1)+a,l=r[5]?Number(r[5]):e.colorSpace?.primaries?ge[e.colorSpace.primaries]:2,c=r[6]?Number(r[6]):e.colorSpace?.transfer?we[e.colorSpace.transfer]:2,u=r[7]?Number(r[7]):e.colorSpace?.matrix?be[e.colorSpace.matrix]:2;return S("vpcC",1,0,[A(i),A(n),A(d),A(l),A(c),A(u),x(0)])},dn=t=>y("av1C",ar(t.info.decoderConfig.codec)),un=(t,e)=>{let r=0,i,n=16,s=L.includes(e.track.source._codec);if(s){let o=e.track.source._codec,{sampleSize:a}=ne(o);n=8*a,n>16&&(r=1)}if(e.muxer.isQuickTime&&(r=1),r===0)i=[Array(6).fill(0),x(1),x(r),x(0),m(0),x(e.info.numberOfChannels),x(n),x(0),x(0),x(e.info.sampleRate<2**16?e.info.sampleRate:0),x(0)];else{let o=s?0:-2;i=[Array(6).fill(0),x(1),x(r),x(0),m(0),x(e.info.numberOfChannels),x(Math.min(n,16)),Rt(o),x(0),x(e.info.sampleRate<2**16?e.info.sampleRate:0),x(0),s?[m(1),m(n/8),m(e.info.numberOfChannels*n/8)]:[m(0),m(0),m(0)],m(2)]}return y(t,i,[Dn(e.track.source._codec,e.muxer.isQuickTime)?.(e)??null])},Ft=t=>{let e;switch(t.track.source._codec){case"aac":e=64;break;case"mp3":e=107;break;case"vorbis":e=221;break;default:throw new Error(\`Unhandled audio codec: \${t.track.source._codec}\`)}let r=[...A(e),...A(21),...Qr(0),...m(0),...m(0)];if(t.info.decoderConfig.description){let i=W(t.info.decoderConfig.description);r=[...r,...A(5),...Mt(i.byteLength),...i]}return r=[...x(1),...A(0),...A(4),...Mt(r.length),...r,...A(6),...A(1),...A(2)],r=[...A(3),...Mt(r.length),...r],S("esds",0,0,r)},ue=t=>y("wave",void 0,[fn(t),hn(t),y("\\0\\0\\0\\0")]),fn=t=>y("frma",[U(oi(t.track.source._codec,t.muxer.isQuickTime))]),hn=t=>{let{littleEndian:e}=ne(t.track.source._codec);return y("enda",[x(+e)])},mn=t=>{let e=t.info.numberOfChannels,r=3840,i=t.info.sampleRate,n=0,s=0,o=new Uint8Array(0),a=t.info.decoderConfig?.description;if(a){h(a.byteLength>=18);let d=W(a),l=Ar(d);e=l.outputChannelCount,r=l.preSkip,i=l.inputSampleRate,n=l.outputGain,s=l.channelMappingFamily,l.channelMappingTable&&(o=l.channelMappingTable)}return y("dOps",[A(0),A(e),x(r),m(i),Rt(n),A(s),...o])},pn=t=>{let e=t.info.decoderConfig?.description;h(e);let r=W(e);return S("dfLa",0,0,[...r.subarray(4)])},J=t=>{let{littleEndian:e,sampleSize:r}=ne(t.track.source._codec),i=+e;return S("pcmC",0,0,[A(i),A(8*r)])},gn=t=>{let e=kr(t.info.firstPacket.data);if(!e)throw new Error("Couldn't extract AC-3 frame info from the audio packet. Ensure the packets contain valid AC-3 sync frames (as specified in ETSI TS 102 366).");let r=new Uint8Array(3),i=new O(r);return i.writeBits(2,e.fscod),i.writeBits(5,e.bsid),i.writeBits(3,e.bsmod),i.writeBits(3,e.acmod),i.writeBits(1,e.lfeon),i.writeBits(5,e.bitRateCode),i.writeBits(5,0),y("dac3",[...r])},wn=t=>{let e=Br(t.info.firstPacket.data);if(!e)throw new Error("Couldn't extract E-AC-3 frame info from the audio packet. Ensure the packets contain valid E-AC-3 sync frames (as specified in ETSI TS 102 366).");let r=16;for(let o of e.substreams)r+=23,o.numDepSub>0?r+=9:r+=1;let i=Math.ceil(r/8),n=new Uint8Array(i),s=new O(n);s.writeBits(13,e.dataRate),s.writeBits(3,e.substreams.length-1);for(let o of e.substreams)s.writeBits(2,o.fscod),s.writeBits(5,o.bsid),s.writeBits(1,0),s.writeBits(1,0),s.writeBits(3,o.bsmod),s.writeBits(3,o.acmod),s.writeBits(1,o.lfeon),s.writeBits(3,0),s.writeBits(4,o.numDepSub),o.numDepSub>0?s.writeBits(9,o.chanLoc):s.writeBits(1,0);return y("dec3",[...n])},bn=(t,e)=>y(t,[Array(6).fill(0),x(1)],[jn[e.track.source._codec](e)]),yn=t=>y("vttC",[...q.encode(t.info.config.description)]);var xn=t=>S("stts",0,0,[m(t.timeToSampleTable.length),t.timeToSampleTable.map(e=>[m(e.sampleCount),m(e.sampleDelta)])]),Tn=t=>{if(t.samples.every(r=>r.type==="key"))return null;let e=[...t.samples.entries()].filter(([,r])=>r.type==="key");return S("stss",0,0,[m(e.length),e.map(([r])=>m(r+1))])},En=t=>S("stsc",0,0,[m(t.compactlyCodedChunkTable.length),t.compactlyCodedChunkTable.map(e=>[m(e.firstChunk),m(e.samplesPerChunk),m(1)])]),Cn=t=>{if(t.type==="audio"&&t.info.requiresPcmTransformation){let{sampleSize:e}=ne(t.track.source._codec);return S("stsz",0,0,[m(e*t.info.numberOfChannels),m(t.samples.reduce((r,i)=>r+B(i.duration,t.timescale),0))])}return S("stsz",0,0,[m(0),m(t.samples.length),t.samples.map(e=>m(e.size))])},Sn=t=>t.finalizedChunks.length>0&&F(t.finalizedChunks).offset>=2**32?S("co64",0,0,[m(t.finalizedChunks.length),t.finalizedChunks.map(e=>Ee(e.offset))]):S("stco",0,0,[m(t.finalizedChunks.length),t.finalizedChunks.map(e=>m(e.offset))]),vn=t=>S("ctts",1,0,[m(t.compositionTimeOffsetTable.length),t.compositionTimeOffsetTable.map(e=>[m(e.sampleCount),fe(e.sampleCompositionTimeOffset)])]),_n=t=>{let e=1/0,r=-1/0,i=1/0,n=-1/0;h(t.compositionTimeOffsetTable.length>0),h(t.samples.length>0);for(let o=0;o<t.compositionTimeOffsetTable.length;o++){let a=t.compositionTimeOffsetTable[o];e=Math.min(e,a.sampleCompositionTimeOffset),r=Math.max(r,a.sampleCompositionTimeOffset)}for(let o=0;o<t.samples.length;o++){let a=t.samples[o];i=Math.min(i,B(a.timestamp,t.timescale)),n=Math.max(n,B(a.timestamp+a.duration,t.timescale))}let s=Math.max(-e,0);return n>=2**31?null:S("cslg",0,0,[fe(s),fe(e),fe(r),fe(i),fe(n)])},An=t=>y("mvex",void 0,t.map(kn)),kn=t=>S("trex",0,0,[m(t.track.id),m(1),m(0),m(0),m(0)]),Lt=(t,e)=>y("moof",void 0,[Bn(t),...e.map(In)]),Bn=t=>S("mfhd",0,0,[m(t)]),ei=t=>{let e=0,r=0,i=0,n=0,s=t.type==="delta";return r|=+s,s?e|=1:e|=2,e<<24|r<<16|i<<8|n},In=t=>y("traf",void 0,[Pn(t),Mn(t),Fn(t)]),Pn=t=>{h(t.currentChunk);let e=0;e|=8,e|=16,e|=32,e|=131072;let r=t.currentChunk.samples[1]??t.currentChunk.samples[0],i={duration:r.timescaleUnitsToNextSample,size:r.size,flags:ei(r)};return S("tfhd",0,e,[m(t.track.id),m(i.duration),m(i.size),m(i.flags)])},Mn=t=>(h(t.currentChunk),S("tfdt",1,0,[Ee(B(t.currentChunk.startTimestamp,t.timescale))])),Fn=t=>{h(t.currentChunk);let e=t.currentChunk.samples.map(T=>T.timescaleUnitsToNextSample),r=t.currentChunk.samples.map(T=>T.size),i=t.currentChunk.samples.map(ei),n=t.currentChunk.samples.map(T=>B(T.timestamp-T.decodeTimestamp,t.timescale)),s=new Set(e),o=new Set(r),a=new Set(i),d=new Set(n),l=a.size===2&&i[0]!==i[1],c=s.size>1,u=o.size>1,f=!l&&a.size>1,g=d.size>1||[...d].some(T=>T!==0),w=0;return w|=1,w|=4*+l,w|=256*+c,w|=512*+u,w|=1024*+f,w|=2048*+g,S("trun",1,w,[m(t.currentChunk.samples.length),m(t.currentChunk.offset-t.currentChunk.moofOffset||0),l?m(i[0]):[],t.currentChunk.samples.map((T,b)=>[c?m(e[b]):[],u?m(r[b]):[],f?m(i[b]):[],g?fe(n[b]):[]])])},ti=t=>y("mfra",void 0,[...t.map(Rn),On()]),Rn=(t,e)=>S("tfra",1,0,[m(t.track.id),m(63),m(t.finalizedChunks.length),t.finalizedChunks.map(i=>[Ee(B(i.samples[0].timestamp,t.timescale)),Ee(i.moofOffset),m(e+1),m(1),m(1)])]),On=()=>S("mfro",0,0,[m(0)]),ri=()=>y("vtte"),ii=(t,e,r,i,n)=>y("vttc",void 0,[n!==null?y("vsid",[fe(n)]):null,r!==null?y("iden",[...q.encode(r)]):null,e!==null?y("ctim",[...q.encode(jr(e))]):null,i!==null?y("sttg",[...q.encode(i)]):null,y("payl",[...q.encode(t)])]),ni=t=>y("vtta",[...q.encode(t)]),Un=t=>{let e=[],r=t.format._options.metadataFormat??"auto",i=t.output._metadataTags;if(r==="mdir"||r==="auto"&&!t.isQuickTime){let n=zn(i);n&&e.push(n)}else if(r==="mdta"){let n=Vn(i);n&&e.push(n)}else(r==="udta"||r==="auto"&&t.isQuickTime)&&Ln(e,t.output._metadataTags);return e.length===0?null:y("udta",void 0,e)},Ln=(t,e)=>{for(let{key:r,value:i}of st(e))switch(r){case"title":t.push(ee("\\xA9nam",i));break;case"description":t.push(ee("\\xA9des",i));break;case"artist":t.push(ee("\\xA9ART",i));break;case"album":t.push(ee("\\xA9alb",i));break;case"albumArtist":t.push(ee("albr",i));break;case"genre":t.push(ee("\\xA9gen",i));break;case"date":t.push(ee("\\xA9day",i.toISOString().slice(0,10)));break;case"comment":t.push(ee("\\xA9cmt",i));break;case"lyrics":t.push(ee("\\xA9lyr",i));break;case"raw":break;case"discNumber":case"discsTotal":case"trackNumber":case"tracksTotal":case"images":break;default:ce(r)}if(e.raw)for(let r in e.raw){let i=e.raw[r];i==null||r.length!==4||t.some(n=>n.type===r)||(typeof i=="string"?t.push(ee(r,i)):i instanceof Uint8Array&&t.push(y(r,Array.from(i))))}},ee=(t,e)=>{let r=q.encode(e);return y(t,[x(r.length),x(ai("und")),Array.from(r)])},qr={"image/jpeg":13,"image/png":14,"image/bmp":27},si=(t,e)=>{let r=[];for(let{key:i,value:n}of st(t))switch(i){case"title":r.push({key:e?"title":"\\xA9nam",value:Q(n)});break;case"description":r.push({key:e?"description":"\\xA9des",value:Q(n)});break;case"artist":r.push({key:e?"artist":"\\xA9ART",value:Q(n)});break;case"album":r.push({key:e?"album":"\\xA9alb",value:Q(n)});break;case"albumArtist":r.push({key:e?"album_artist":"aART",value:Q(n)});break;case"comment":r.push({key:e?"comment":"\\xA9cmt",value:Q(n)});break;case"genre":r.push({key:e?"genre":"\\xA9gen",value:Q(n)});break;case"lyrics":r.push({key:e?"lyrics":"\\xA9lyr",value:Q(n)});break;case"date":r.push({key:e?"date":"\\xA9day",value:Q(n.toISOString().slice(0,10))});break;case"images":for(let s of n)s.kind==="coverFront"&&r.push({key:"covr",value:y("data",[m(qr[s.mimeType]??0),m(0),Array.from(s.data)])});break;case"trackNumber":if(e){let s=t.tracksTotal!==void 0?\`\${n}/\${t.tracksTotal}\`:n.toString();r.push({key:"track",value:Q(s)})}else r.push({key:"trkn",value:y("data",[m(0),m(0),x(0),x(n),x(t.tracksTotal??0),x(0)])});break;case"discNumber":e||r.push({key:"disc",value:y("data",[m(0),m(0),x(0),x(n),x(t.discsTotal??0),x(0)])});break;case"tracksTotal":case"discsTotal":break;case"raw":break;default:ce(i)}if(t.raw)for(let i in t.raw){let n=t.raw[i];n==null||!e&&i.length!==4||r.some(s=>s.key===i)||(typeof n=="string"?r.push({key:i,value:Q(n)}):n instanceof Uint8Array?r.push({key:i,value:y("data",[m(0),m(0),Array.from(n)])}):n instanceof He&&r.push({key:i,value:y("data",[m(qr[n.mimeType]??0),m(0),Array.from(n.data)])}))}return r},zn=t=>{let e=si(t,!1);return e.length===0?null:S("meta",0,0,void 0,[Ut(!1,"mdir","","appl"),y("ilst",void 0,e.map(r=>y(r.key,void 0,[r.value])))])},Vn=t=>{let e=si(t,!0);return e.length===0?null:y("meta",void 0,[Ut(!1,"mdta",""),S("keys",0,0,[m(e.length)],e.map(r=>y("mdta",[...q.encode(r.key)]))),y("ilst",void 0,e.map((r,i)=>{let n=String.fromCharCode(...m(i+1));return y(n,void 0,[r.value])}))])},Q=t=>y("data",[m(1),m(0),...q.encode(t)]),Nn=(t,e)=>{switch(t){case"avc":return e.startsWith("avc3")?"avc3":"avc1";case"hevc":return"hvc1";case"vp8":return"vp08";case"vp9":return"vp09";case"av1":return"av01"}},Wn={avc:cn,hevc:ln,vp8:$r,vp9:$r,av1:dn},oi=(t,e)=>{switch(t){case"aac":return"mp4a";case"mp3":return"mp4a";case"opus":return"Opus";case"vorbis":return"mp4a";case"flac":return"fLaC";case"ulaw":return"ulaw";case"alaw":return"alaw";case"pcm-u8":return"raw ";case"pcm-s8":return"sowt";case"ac3":return"ac-3";case"eac3":return"ec-3"}if(e)switch(t){case"pcm-s16":return"sowt";case"pcm-s16be":return"twos";case"pcm-s24":return"in24";case"pcm-s24be":return"in24";case"pcm-s32":return"in32";case"pcm-s32be":return"in32";case"pcm-f32":return"fl32";case"pcm-f32be":return"fl32";case"pcm-f64":return"fl64";case"pcm-f64be":return"fl64"}else switch(t){case"pcm-s16":return"ipcm";case"pcm-s16be":return"ipcm";case"pcm-s24":return"ipcm";case"pcm-s24be":return"ipcm";case"pcm-s32":return"ipcm";case"pcm-s32be":return"ipcm";case"pcm-f32":return"fpcm";case"pcm-f32be":return"fpcm";case"pcm-f64":return"fpcm";case"pcm-f64be":return"fpcm"}},Dn=(t,e)=>{switch(t){case"aac":return Ft;case"mp3":return Ft;case"opus":return mn;case"vorbis":return Ft;case"flac":return pn;case"ac3":return gn;case"eac3":return wn}if(e)switch(t){case"pcm-s24":return ue;case"pcm-s24be":return ue;case"pcm-s32":return ue;case"pcm-s32be":return ue;case"pcm-f32":return ue;case"pcm-f32be":return ue;case"pcm-f64":return ue;case"pcm-f64be":return ue}else switch(t){case"pcm-s16":return J;case"pcm-s16be":return J;case"pcm-s24":return J;case"pcm-s24be":return J;case"pcm-s32":return J;case"pcm-s32be":return J;case"pcm-f32":return J;case"pcm-f32be":return J;case"pcm-f64":return J;case"pcm-f64be":return J}return null},Hn={webvtt:"wvtt"},jn={webvtt:yn},ai=t=>{h(t.length===3);let e=0;for(let r=0;r<3;r++)e<<=5,e+=t.charCodeAt(r)-96;return e};var Nt=class{constructor(){this.ensureMonotonicity=!1,this.trackedWrites=null,this.trackedStart=-1,this.trackedEnd=-1}start(){}maybeTrackWrites(e){if(!this.trackedWrites)return;let r=this.getPos();if(r<this.trackedStart){if(r+e.byteLength<=this.trackedStart)return;e=e.subarray(this.trackedStart-r),r=0}let i=r+e.byteLength-this.trackedStart,n=this.trackedWrites.byteLength;for(;n<i;)n*=2;if(n!==this.trackedWrites.byteLength){let s=new Uint8Array(n);s.set(this.trackedWrites,0),this.trackedWrites=s}this.trackedWrites.set(e,r-this.trackedStart),this.trackedEnd=Math.max(this.trackedEnd,r+e.byteLength)}startTrackingWrites(){this.trackedWrites=new Uint8Array(2**10),this.trackedStart=this.getPos(),this.trackedEnd=this.trackedStart}stopTrackingWrites(){if(!this.trackedWrites)throw new Error("Internal error: Can't get tracked writes since nothing was tracked.");let r={data:this.trackedWrites.subarray(0,this.trackedEnd-this.trackedStart),start:this.trackedStart,end:this.trackedEnd};return this.trackedWrites=null,r}},zt=2**16,Vt=2**32,Ie=class extends Nt{constructor(e){if(super(),this.pos=0,this.maxPos=0,this.target=e,this.supportsResize="resize"in new ArrayBuffer(0),this.supportsResize)try{this.buffer=new ArrayBuffer(zt,{maxByteLength:Vt})}catch{this.buffer=new ArrayBuffer(zt),this.supportsResize=!1}else this.buffer=new ArrayBuffer(zt);this.bytes=new Uint8Array(this.buffer)}ensureSize(e){let r=this.buffer.byteLength;for(;r<e;)r*=2;if(r!==this.buffer.byteLength){if(r>Vt)throw new Error(\`ArrayBuffer exceeded maximum size of \${Vt} bytes. Please consider using another target.\`);if(this.supportsResize)this.buffer.resize(r);else{let i=new ArrayBuffer(r),n=new Uint8Array(i);n.set(this.bytes,0),this.buffer=i,this.bytes=n}}}write(e){this.maybeTrackWrites(e),this.ensureSize(this.pos+e.byteLength),this.bytes.set(e,this.pos),this.target.onwrite?.(this.pos,this.pos+e.byteLength),this.pos+=e.byteLength,this.maxPos=Math.max(this.maxPos,this.pos)}seek(e){this.pos=e}getPos(){return this.pos}async flush(){}async finalize(){this.ensureSize(this.pos),this.target.buffer=this.buffer.slice(0,Math.max(this.maxPos,this.pos))}async close(){}getSlice(e,r){return this.bytes.slice(e,r)}},$s=2**24;var Pe=class{constructor(){this._output=null,this.onwrite=null}},Ce=class extends Pe{constructor(){super(...arguments),this.buffer=null}_createWriter(){return new Ie(this)}};var ft=1e3,$n=2082844800,ci=t=>{let e={},r=t.track;return r.metadata.name!==void 0&&(e.name=r.metadata.name),e},B=(t,e,r=!0)=>{let i=t*e;return r?Math.round(i):i},ht=class extends ut{constructor(e,r){super(e),this.auxTarget=new Ce,this.auxWriter=this.auxTarget._createWriter(),this.auxBoxWriter=new Ye(this.auxWriter),this.mdat=null,this.ftypSize=null,this.trackDatas=[],this.allTracksKnown=yt(),this.creationTime=Math.floor(Date.now()/1e3)+$n,this.finalizedChunks=[],this.nextFragmentNumber=1,this.maxWrittenTimestamp=-1/0,this.format=r,this.writer=e._writer,this.boxWriter=new Ye(this.writer),this.isQuickTime=r instanceof Me;let i=this.writer instanceof Ie?"in-memory":!1;this.fastStart=r._options.fastStart??i,this.isFragmented=this.fastStart==="fragmented",(this.fastStart==="in-memory"||this.isFragmented)&&(this.writer.ensureMonotonicity=!0),this.minimumFragmentDuration=r._options.minimumFragmentDuration??1}async start(){let e=await this.mutex.acquire(),r=this.output._tracks.some(i=>i.type==="video"&&i.source._codec==="avc");if(this.format._options.onFtyp&&this.writer.startTrackingWrites(),this.boxWriter.writeBox(Zr({isQuickTime:this.isQuickTime,holdsAvc:r,fragmented:this.isFragmented})),this.format._options.onFtyp){let{data:i,start:n}=this.writer.stopTrackingWrites();this.format._options.onFtyp(i,n)}if(this.ftypSize=this.writer.getPos(),this.fastStart!=="in-memory")if(this.fastStart==="reserve"){for(let i of this.output._tracks)if(i.metadata.maximumPacketCount===void 0)throw new Error("All tracks must specify maximumPacketCount in their metadata when using fastStart: 'reserve'.")}else this.isFragmented||(this.format._options.onMdat&&this.writer.startTrackingWrites(),this.mdat=Ke(!0),this.boxWriter.writeBox(this.mdat));await this.writer.flush(),e()}allTracksAreKnown(){for(let e of this.output._tracks)if(!e.source._closed&&!this.trackDatas.some(r=>r.track===e))return!1;return!0}async getMimeType(){await this.allTracksKnown.promise;let e=this.trackDatas.map(r=>r.type==="video"||r.type==="audio"?r.info.decoderConfig.codec:{webvtt:"wvtt"}[r.track.source._codec]);return Nr({isQuickTime:this.isQuickTime,hasVideo:this.trackDatas.some(r=>r.type==="video"),hasAudio:this.trackDatas.some(r=>r.type==="audio"),codecStrings:e})}getVideoTrackData(e,r,i){let n=this.trackDatas.find(f=>f.track===e);if(n)return n;fr(i),h(i),h(i.decoderConfig);let s={...i.decoderConfig};h(s.codedWidth!==void 0),h(s.codedHeight!==void 0);let o=!1;if(e.source._codec==="avc"&&!s.description){let f=Er(r.data);if(!f)throw new Error("Couldn't extract an AVCDecoderConfigurationRecord from the AVC packet. Make sure the packets are in Annex B format (as specified in ITU-T-REC-H.264) when not providing a description, or provide a description (must be an AVCDecoderConfigurationRecord as specified in ISO 14496-15) and ensure the packets are in AVCC format.");s.description=Cr(f),o=!0}else if(e.source._codec==="hevc"&&!s.description){let f=vr(r.data);if(!f)throw new Error("Couldn't extract an HEVCDecoderConfigurationRecord from the HEVC packet. Make sure the packets are in Annex B format (as specified in ITU-T-REC-H.265) when not providing a description, or provide a description (must be an HEVCDecoderConfigurationRecord as specified in ISO 14496-15) and ensure the packets are in HEVC format.");s.description=_r(f),o=!0}let a=Zt(1/(e.metadata.frameRate??57600),1e6).denominator,d=s.displayAspectWidth,l=s.displayAspectHeight,c=d===void 0||l===void 0?{num:1,den:1}:ot({num:d*s.codedHeight,den:l*s.codedWidth}),u={muxer:this,track:e,type:"video",info:{width:s.codedWidth,height:s.codedHeight,pixelAspectRatio:c,decoderConfig:s,requiresAnnexBTransformation:o},timescale:a,samples:[],sampleQueue:[],timestampProcessingQueue:[],timeToSampleTable:[],compositionTimeOffsetTable:[],lastTimescaleUnits:null,lastSample:null,finalizedChunks:[],currentChunk:null,compactlyCodedChunkTable:[]};return this.trackDatas.push(u),this.trackDatas.sort((f,g)=>f.track.id-g.track.id),this.allTracksAreKnown()&&this.allTracksKnown.resolve(),u}getAudioTrackData(e,r,i){let n=this.trackDatas.find(d=>d.track===e);if(n)return n;hr(i),h(i),h(i.decoderConfig);let s={...i.decoderConfig},o=!1;if(e.source._codec==="aac"&&!s.description){let d=Bt(Ge.tempFromBytes(r.data));if(!d)throw new Error("Couldn't parse ADTS header from the AAC packet. Make sure the packets are in ADTS format (as specified in ISO 13818-7) when not providing a description, or provide a description (must be an AudioSpecificConfig as specified in ISO 14496-3) and ensure the packets are raw AAC data.");let l=je[d.samplingFrequencyIndex],c=at[d.channelConfiguration];if(l===void 0||c===void 0)throw new Error("Invalid ADTS frame header.");s.description=ct({objectType:d.objectType,sampleRate:l,numberOfChannels:c}),o=!0}let a={muxer:this,track:e,type:"audio",info:{numberOfChannels:i.decoderConfig.numberOfChannels,sampleRate:i.decoderConfig.sampleRate,decoderConfig:s,requiresPcmTransformation:!this.isFragmented&&L.includes(e.source._codec),requiresAdtsStripping:o,firstPacket:r},timescale:s.sampleRate,samples:[],sampleQueue:[],timestampProcessingQueue:[],timeToSampleTable:[],compositionTimeOffsetTable:[],lastTimescaleUnits:null,lastSample:null,finalizedChunks:[],currentChunk:null,compactlyCodedChunkTable:[]};return this.trackDatas.push(a),this.trackDatas.sort((d,l)=>d.track.id-l.track.id),this.allTracksAreKnown()&&this.allTracksKnown.resolve(),a}getSubtitleTrackData(e,r){let i=this.trackDatas.find(s=>s.track===e);if(i)return i;mr(r),h(r),h(r.config);let n={muxer:this,track:e,type:"subtitle",info:{config:r.config},timescale:1e3,samples:[],sampleQueue:[],timestampProcessingQueue:[],timeToSampleTable:[],compositionTimeOffsetTable:[],lastTimescaleUnits:null,lastSample:null,finalizedChunks:[],currentChunk:null,compactlyCodedChunkTable:[],lastCueEndTimestamp:0,cueQueue:[],nextSourceId:0,cueToSourceId:new WeakMap};return this.trackDatas.push(n),this.trackDatas.sort((s,o)=>s.track.id-o.track.id),this.allTracksAreKnown()&&this.allTracksKnown.resolve(),n}async addEncodedVideoPacket(e,r,i){let n=await this.mutex.acquire();try{let s=this.getVideoTrackData(e,r,i),o=r.data;if(s.info.requiresAnnexBTransformation){let l=[...lt(o)].map(c=>o.subarray(c.offset,c.offset+c.length));if(l.length===0)throw new Error("Failed to transform packet data. Make sure all packets are provided in Annex B format, as specified in ITU-T-REC-H.264 and ITU-T-REC-H.265.");o=Tr(l,4)}let a=this.validateAndNormalizeTimestamp(s.track,r.timestamp,r.type==="key"),d=this.createSampleForTrack(s,o,a,r.duration,r.type);await this.registerSample(s,d)}finally{n()}}async addEncodedAudioPacket(e,r,i){let n=await this.mutex.acquire();try{let s=this.getAudioTrackData(e,r,i),o=r.data;if(s.info.requiresAdtsStripping){let l=Bt(Ge.tempFromBytes(o));if(!l)throw new Error("Expected ADTS frame, didn't get one.");let c=l.crcCheck===null?Wr:Dr;o=o.subarray(c)}let a=this.validateAndNormalizeTimestamp(s.track,r.timestamp,r.type==="key"),d=this.createSampleForTrack(s,o,a,r.duration,r.type);s.info.requiresPcmTransformation&&await this.maybePadWithSilence(s,a),await this.registerSample(s,d)}finally{n()}}async maybePadWithSilence(e,r){let i=F(e.samples),n=i?i.timestamp+i.duration:0,s=r-n,o=B(s,e.timescale);if(o>0){let{sampleSize:a,silentValue:d}=ne(e.info.decoderConfig.codec),l=o*e.info.numberOfChannels,c=new Uint8Array(a*l).fill(d),u=this.createSampleForTrack(e,new Uint8Array(c.buffer),n,s,"key");await this.registerSample(e,u)}}async addSubtitleCue(e,r,i){let n=await this.mutex.acquire();try{let s=this.getSubtitleTrackData(e,i);this.validateAndNormalizeTimestamp(s.track,r.timestamp,!0),e.source._codec==="webvtt"&&(s.cueQueue.push(r),await this.processWebVTTCues(s,r.timestamp))}finally{n()}}async processWebVTTCues(e,r){for(;e.cueQueue.length>0;){let i=new Set([]);for(let l of e.cueQueue)h(l.timestamp<=r),h(e.lastCueEndTimestamp<=l.timestamp+l.duration),i.add(Math.max(l.timestamp,e.lastCueEndTimestamp)),i.add(l.timestamp+l.duration);let n=[...i].sort((l,c)=>l-c),s=n[0],o=n[1]??s;if(r<o)break;if(e.lastCueEndTimestamp<s){this.auxWriter.seek(0);let l=ri();this.auxBoxWriter.writeBox(l);let c=this.auxWriter.getSlice(0,this.auxWriter.getPos()),u=this.createSampleForTrack(e,c,e.lastCueEndTimestamp,s-e.lastCueEndTimestamp,"key");await this.registerSample(e,u),e.lastCueEndTimestamp=s}this.auxWriter.seek(0);for(let l=0;l<e.cueQueue.length;l++){let c=e.cueQueue[l];if(c.timestamp>=o)break;It.lastIndex=0;let u=It.test(c.text),f=c.timestamp+c.duration,g=e.cueToSourceId.get(c);if(g===void 0&&o<f&&(g=e.nextSourceId++,e.cueToSourceId.set(c,g)),c.notes){let T=ni(c.notes);this.auxBoxWriter.writeBox(T)}let w=ii(c.text,u?s:null,c.identifier??null,c.settings??null,g??null);this.auxBoxWriter.writeBox(w),f===o&&e.cueQueue.splice(l--,1)}let a=this.auxWriter.getSlice(0,this.auxWriter.getPos()),d=this.createSampleForTrack(e,a,s,o-s,"key");await this.registerSample(e,d),e.lastCueEndTimestamp=o}}createSampleForTrack(e,r,i,n,s){return{timestamp:i,decodeTimestamp:i,duration:n,data:r,size:r.byteLength,type:s,timescaleUnitsToNextSample:B(n,e.timescale)}}processTimestamps(e,r){if(e.timestampProcessingQueue.length===0)return;if(e.type==="audio"&&e.info.requiresPcmTransformation){let n=0;for(let s=0;s<e.timestampProcessingQueue.length;s++){let o=e.timestampProcessingQueue[s],a=B(o.duration,e.timescale);n+=a}if(e.timeToSampleTable.length===0)e.timeToSampleTable.push({sampleCount:n,sampleDelta:1});else{let s=F(e.timeToSampleTable);s.sampleCount+=n}e.timestampProcessingQueue.length=0;return}let i=e.timestampProcessingQueue.map(n=>n.timestamp).sort((n,s)=>n-s);for(let n=0;n<e.timestampProcessingQueue.length;n++){let s=e.timestampProcessingQueue[n];s.decodeTimestamp=i[n],!this.isFragmented&&e.lastTimescaleUnits===null&&(s.decodeTimestamp=0);let o=B(s.timestamp-s.decodeTimestamp,e.timescale),a=B(s.duration,e.timescale);if(e.lastTimescaleUnits!==null){h(e.lastSample);let d=B(s.decodeTimestamp,e.timescale,!1),l=Math.round(d-e.lastTimescaleUnits);if(h(l>=0),e.lastTimescaleUnits+=l,e.lastSample.timescaleUnitsToNextSample=l,!this.isFragmented){let c=F(e.timeToSampleTable);if(h(c),c.sampleCount===1){c.sampleDelta=l;let f=e.timeToSampleTable[e.timeToSampleTable.length-2];f&&f.sampleDelta===l&&(f.sampleCount++,e.timeToSampleTable.pop(),c=f)}else c.sampleDelta!==l&&(c.sampleCount--,e.timeToSampleTable.push(c={sampleCount:1,sampleDelta:l}));c.sampleDelta===a?c.sampleCount++:e.timeToSampleTable.push({sampleCount:1,sampleDelta:a});let u=F(e.compositionTimeOffsetTable);h(u),u.sampleCompositionTimeOffset===o?u.sampleCount++:e.compositionTimeOffsetTable.push({sampleCount:1,sampleCompositionTimeOffset:o})}}else e.lastTimescaleUnits=B(s.decodeTimestamp,e.timescale,!1),this.isFragmented||(e.timeToSampleTable.push({sampleCount:1,sampleDelta:a}),e.compositionTimeOffsetTable.push({sampleCount:1,sampleCompositionTimeOffset:o}));e.lastSample=s}if(e.timestampProcessingQueue.length=0,h(e.lastSample),h(e.lastTimescaleUnits!==null),r!==void 0&&e.lastSample.timescaleUnitsToNextSample===0){h(r.type==="key");let n=B(r.timestamp,e.timescale,!1),s=Math.round(n-e.lastTimescaleUnits);e.lastSample.timescaleUnitsToNextSample=s}}async registerSample(e,r){r.type==="key"&&this.processTimestamps(e,r),e.timestampProcessingQueue.push(r),this.isFragmented?(e.sampleQueue.push(r),await this.interleaveSamples()):this.fastStart==="reserve"?await this.registerSampleFastStartReserve(e,r):await this.addSampleToTrack(e,r)}async addSampleToTrack(e,r){if(!this.isFragmented&&(e.samples.push(r),this.fastStart==="reserve")){let n=e.track.metadata.maximumPacketCount;if(h(n!==void 0),e.samples.length>n)throw new Error(\`Track #\${e.track.id} has already reached the maximum packet count (\${n}). Either add less packets or increase the maximum packet count.\`)}let i=!1;if(!e.currentChunk)i=!0;else{e.currentChunk.startTimestamp=Math.min(e.currentChunk.startTimestamp,r.timestamp);let n=r.timestamp-e.currentChunk.startTimestamp;if(this.isFragmented){let s=this.trackDatas.every(o=>{if(e===o)return r.type==="key";let a=o.sampleQueue[0];return a?a.type==="key":o.track.source._closed});n>=this.minimumFragmentDuration&&s&&r.timestamp>this.maxWrittenTimestamp&&(i=!0,await this.finalizeFragment())}else i=n>=.5}i&&(e.currentChunk&&await this.finalizeCurrentChunk(e),e.currentChunk={startTimestamp:r.timestamp,samples:[],offset:null,moofOffset:null}),h(e.currentChunk),e.currentChunk.samples.push(r),this.isFragmented&&(this.maxWrittenTimestamp=Math.max(this.maxWrittenTimestamp,r.timestamp))}async finalizeCurrentChunk(e){if(h(!this.isFragmented),!e.currentChunk)return;e.finalizedChunks.push(e.currentChunk),this.finalizedChunks.push(e.currentChunk);let r=e.currentChunk.samples.length;if(e.type==="audio"&&e.info.requiresPcmTransformation&&(r=e.currentChunk.samples.reduce((i,n)=>i+B(n.duration,e.timescale),0)),(e.compactlyCodedChunkTable.length===0||F(e.compactlyCodedChunkTable).samplesPerChunk!==r)&&e.compactlyCodedChunkTable.push({firstChunk:e.finalizedChunks.length,samplesPerChunk:r}),this.fastStart==="in-memory"){e.currentChunk.offset=0;return}e.currentChunk.offset=this.writer.getPos();for(let i of e.currentChunk.samples)h(i.data),this.writer.write(i.data),i.data=null;await this.writer.flush()}async interleaveSamples(e=!1){if(h(this.isFragmented),!(!e&&!this.allTracksAreKnown()))e:for(;;){let r=null,i=1/0;for(let s of this.trackDatas){if(!e&&s.sampleQueue.length===0&&!s.track.source._closed)break e;s.sampleQueue.length>0&&s.sampleQueue[0].timestamp<i&&(r=s,i=s.sampleQueue[0].timestamp)}if(!r)break;let n=r.sampleQueue.shift();await this.addSampleToTrack(r,n)}}async finalizeFragment(e=!0){h(this.isFragmented);let r=this.nextFragmentNumber++;if(r===1){this.format._options.onMoov&&this.writer.startTrackingWrites();let g=Be(this);if(this.boxWriter.writeBox(g),this.format._options.onMoov){let{data:w,start:T}=this.writer.stopTrackingWrites();this.format._options.onMoov(w,T)}}let i=this.trackDatas.filter(g=>g.currentChunk),n=Lt(r,i),s=this.writer.getPos(),o=s+this.boxWriter.measureBox(n),a=o+dt,d=1/0;for(let g of i){g.currentChunk.offset=a,g.currentChunk.moofOffset=s;for(let w of g.currentChunk.samples)a+=w.size;d=Math.min(d,g.currentChunk.startTimestamp)}let l=a-o,c=l>=2**32;if(c)for(let g of i)g.currentChunk.offset+=kt-dt;this.format._options.onMoof&&this.writer.startTrackingWrites();let u=Lt(r,i);if(this.boxWriter.writeBox(u),this.format._options.onMoof){let{data:g,start:w}=this.writer.stopTrackingWrites();this.format._options.onMoof(g,w,d)}h(this.writer.getPos()===o),this.format._options.onMdat&&this.writer.startTrackingWrites();let f=Ke(c);f.size=l,this.boxWriter.writeBox(f),this.writer.seek(o+(c?kt:dt));for(let g of i)for(let w of g.currentChunk.samples)this.writer.write(w.data),w.data=null;if(this.format._options.onMdat){let{data:g,start:w}=this.writer.stopTrackingWrites();this.format._options.onMdat(g,w)}for(let g of i)g.finalizedChunks.push(g.currentChunk),this.finalizedChunks.push(g.currentChunk),g.currentChunk=null;e&&await this.writer.flush()}async registerSampleFastStartReserve(e,r){if(this.allTracksAreKnown()){if(!this.mdat){let i=Be(this),s=this.boxWriter.measureBox(i)+this.computeSampleTableSizeUpperBound()+4096;h(this.ftypSize!==null),this.writer.seek(this.ftypSize+s),this.format._options.onMdat&&this.writer.startTrackingWrites(),this.mdat=Ke(!0),this.boxWriter.writeBox(this.mdat);for(let o of this.trackDatas){for(let a of o.sampleQueue)await this.addSampleToTrack(o,a);o.sampleQueue.length=0}}await this.addSampleToTrack(e,r)}else e.sampleQueue.push(r)}computeSampleTableSizeUpperBound(){h(this.fastStart==="reserve");let e=0;for(let r of this.trackDatas){let i=r.track.metadata.maximumPacketCount;h(i!==void 0),e+=8*Math.ceil(2/3*i),e+=4*i,e+=8*Math.ceil(2/3*i),e+=12*Math.ceil(2/3*i),e+=4*i,e+=8*i}return e}async onTrackClose(e){let r=await this.mutex.acquire(),i=this.trackDatas.find(n=>n.track===e);i&&(i.type==="subtitle"&&e.source._codec==="webvtt"&&await this.processWebVTTCues(i,1/0),this.processTimestamps(i)),this.allTracksAreKnown()&&this.allTracksKnown.resolve(),this.isFragmented&&await this.interleaveSamples(),r()}async finalize(){let e=await this.mutex.acquire();this.allTracksKnown.resolve();for(let r of this.trackDatas)r.type==="subtitle"&&r.track.source._codec==="webvtt"&&await this.processWebVTTCues(r,1/0),this.processTimestamps(r);if(this.isFragmented)await this.interleaveSamples(!0),await this.finalizeFragment(!1);else for(let r of this.trackDatas)await this.finalizeCurrentChunk(r);if(this.fastStart==="in-memory"){this.mdat=Ke(!1);let r;for(let n=0;n<2;n++){let s=Be(this),o=this.boxWriter.measureBox(s);r=this.boxWriter.measureBox(this.mdat);let a=this.writer.getPos()+o+r;for(let d of this.finalizedChunks){d.offset=a;for(let{data:l}of d.samples)h(l),a+=l.byteLength,r+=l.byteLength}if(a<2**32)break;r>=2**32&&(this.mdat.largeSize=!0)}this.format._options.onMoov&&this.writer.startTrackingWrites();let i=Be(this);if(this.boxWriter.writeBox(i),this.format._options.onMoov){let{data:n,start:s}=this.writer.stopTrackingWrites();this.format._options.onMoov(n,s)}this.format._options.onMdat&&this.writer.startTrackingWrites(),this.mdat.size=r,this.boxWriter.writeBox(this.mdat);for(let n of this.finalizedChunks)for(let s of n.samples)h(s.data),this.writer.write(s.data),s.data=null;if(this.format._options.onMdat){let{data:n,start:s}=this.writer.stopTrackingWrites();this.format._options.onMdat(n,s)}}else if(this.isFragmented){let r=this.writer.getPos(),i=ti(this.trackDatas);this.boxWriter.writeBox(i);let n=this.writer.getPos()-r;this.writer.seek(this.writer.getPos()-4),this.boxWriter.writeU32(n)}else{h(this.mdat);let r=this.boxWriter.offsets.get(this.mdat);h(r!==void 0);let i=this.writer.getPos()-r;if(this.mdat.size=i,this.mdat.largeSize=i>=2**32,this.boxWriter.patchBox(this.mdat),this.format._options.onMdat){let{data:s,start:o}=this.writer.stopTrackingWrites();this.format._options.onMdat(s,o)}let n=Be(this);if(this.fastStart==="reserve"){h(this.ftypSize!==null),this.writer.seek(this.ftypSize),this.format._options.onMoov&&this.writer.startTrackingWrites(),this.boxWriter.writeBox(n);let s=this.boxWriter.offsets.get(this.mdat)-this.writer.getPos();this.boxWriter.writeBox(Jr(s))}else this.format._options.onMoov&&this.writer.startTrackingWrites(),this.boxWriter.writeBox(n);if(this.format._options.onMoov){let{data:s,start:o}=this.writer.stopTrackingWrites();this.format._options.onMoov(s,o)}}e()}};var Fe=class{getSupportedVideoCodecs(){return this.getSupportedCodecs().filter(e=>K.includes(e))}getSupportedAudioCodecs(){return this.getSupportedCodecs().filter(e=>ie.includes(e))}getSupportedSubtitleCodecs(){return this.getSupportedCodecs().filter(e=>ye.includes(e))}_codecUnsupportedHint(e){return""}},Ze=class extends Fe{constructor(e={}){if(!e||typeof e!="object")throw new TypeError("options must be an object.");if(e.fastStart!==void 0&&![!1,"in-memory","reserve","fragmented"].includes(e.fastStart))throw new TypeError("options.fastStart, when provided, must be false, 'in-memory', 'reserve', or 'fragmented'.");if(e.minimumFragmentDuration!==void 0&&(!Number.isFinite(e.minimumFragmentDuration)||e.minimumFragmentDuration<0))throw new TypeError("options.minimumFragmentDuration, when provided, must be a non-negative number.");if(e.onFtyp!==void 0&&typeof e.onFtyp!="function")throw new TypeError("options.onFtyp, when provided, must be a function.");if(e.onMoov!==void 0&&typeof e.onMoov!="function")throw new TypeError("options.onMoov, when provided, must be a function.");if(e.onMdat!==void 0&&typeof e.onMdat!="function")throw new TypeError("options.onMdat, when provided, must be a function.");if(e.onMoof!==void 0&&typeof e.onMoof!="function")throw new TypeError("options.onMoof, when provided, must be a function.");if(e.metadataFormat!==void 0&&!["mdir","mdta","udta","auto"].includes(e.metadataFormat))throw new TypeError("options.metadataFormat, when provided, must be either 'auto', 'mdir', 'mdta', or 'udta'.");super(),this._options=e}getSupportedTrackCounts(){return{video:{min:0,max:4294967295},audio:{min:0,max:4294967295},subtitle:{min:0,max:4294967295},total:{min:1,max:4294967295}}}get supportsVideoRotationMetadata(){return!0}get supportsTimestampedMediaData(){return!0}_createMuxer(e){return new ht(e,this)}},Re=class extends Ze{constructor(e){super(e)}get _name(){return"MP4"}get fileExtension(){return".mp4"}get mimeType(){return"video/mp4"}getSupportedCodecs(){return[...K,...Ct,"pcm-s16","pcm-s16be","pcm-s24","pcm-s24be","pcm-s32","pcm-s32be","pcm-f32","pcm-f32be","pcm-f64","pcm-f64be",...ye]}_codecUnsupportedHint(e){return new Me().getSupportedCodecs().includes(e)?" Switching to MOV will grant support for this codec.":""}},Me=class extends Ze{constructor(e){super(e)}get _name(){return"MOV"}get fileExtension(){return".mov"}get mimeType(){return"video/quicktime"}getSupportedCodecs(){return[...K,...ie]}_codecUnsupportedHint(e){return new Re().getSupportedCodecs().includes(e)?" Switching to MP4 will grant support for this codec.":""}};var li=t=>{if(!t||typeof t!="object")throw new TypeError("Encoding config must be an object.");if(!K.includes(t.codec))throw new TypeError(\`Invalid video codec '\${t.codec}'. Must be one of: \${K.join(", ")}.\`);if(!(t.bitrate instanceof he)&&(!Number.isInteger(t.bitrate)||t.bitrate<=0))throw new TypeError("config.bitrate must be a positive integer or a quality.");if(t.keyFrameInterval!==void 0&&(!Number.isFinite(t.keyFrameInterval)||t.keyFrameInterval<0))throw new TypeError("config.keyFrameInterval, when provided, must be a non-negative number.");if(t.sizeChangeBehavior!==void 0&&!["deny","passThrough","fill","contain","cover"].includes(t.sizeChangeBehavior))throw new TypeError("config.sizeChangeBehavior, when provided, must be 'deny', 'passThrough', 'fill', 'contain' or 'cover'.");if(t.onEncodedPacket!==void 0&&typeof t.onEncodedPacket!="function")throw new TypeError("config.onEncodedChunk, when provided, must be a function.");if(t.onEncoderConfig!==void 0&&typeof t.onEncoderConfig!="function")throw new TypeError("config.onEncoderConfig, when provided, must be a function.");qn(t.codec,t)},qn=(t,e)=>{if(!e||typeof e!="object")throw new TypeError("Encoding options must be an object.");if(e.alpha!==void 0&&!["discard","keep"].includes(e.alpha))throw new TypeError("options.alpha, when provided, must be 'discard' or 'keep'.");if(e.bitrateMode!==void 0&&!["constant","variable"].includes(e.bitrateMode))throw new TypeError("bitrateMode, when provided, must be 'constant' or 'variable'.");if(e.latencyMode!==void 0&&!["quality","realtime"].includes(e.latencyMode))throw new TypeError("latencyMode, when provided, must be 'quality' or 'realtime'.");if(e.fullCodecString!==void 0&&typeof e.fullCodecString!="string")throw new TypeError("fullCodecString, when provided, must be a string.");if(e.fullCodecString!==void 0&&St(e.fullCodecString)!==t)throw new TypeError(\`fullCodecString, when provided, must be a string that matches the specified codec (\${t}).\`);if(e.hardwareAcceleration!==void 0&&!["no-preference","prefer-hardware","prefer-software"].includes(e.hardwareAcceleration))throw new TypeError("hardwareAcceleration, when provided, must be 'no-preference', 'prefer-hardware' or 'prefer-software'.");if(e.scalabilityMode!==void 0&&typeof e.scalabilityMode!="string")throw new TypeError("scalabilityMode, when provided, must be a string.");if(e.contentHint!==void 0&&typeof e.contentHint!="string")throw new TypeError("contentHint, when provided, must be a string.")},di=t=>{let e=t.bitrate instanceof he?t.bitrate._toVideoBitrate(t.codec,t.width,t.height):t.bitrate;return{codec:t.fullCodecString??or(t.codec,t.width,t.height,e),width:t.width,height:t.height,displayWidth:t.squarePixelWidth,displayHeight:t.squarePixelHeight,bitrate:e,bitrateMode:t.bitrateMode,alpha:t.alpha??"discard",framerate:t.framerate,latencyMode:t.latencyMode,hardwareAcceleration:t.hardwareAcceleration,scalabilityMode:t.scalabilityMode,contentHint:t.contentHint,...dr(t.codec)}},ui=t=>{if(!t||typeof t!="object")throw new TypeError("Encoding config must be an object.");if(!ie.includes(t.codec))throw new TypeError(\`Invalid audio codec '\${t.codec}'. Must be one of: \${ie.join(", ")}.\`);if(t.bitrate===void 0&&(!L.includes(t.codec)||t.codec==="flac"))throw new TypeError("config.bitrate must be provided for compressed audio codecs.");if(t.bitrate!==void 0&&!(t.bitrate instanceof he)&&(!Number.isInteger(t.bitrate)||t.bitrate<=0))throw new TypeError("config.bitrate, when provided, must be a positive integer or a quality.");if(t.onEncodedPacket!==void 0&&typeof t.onEncodedPacket!="function")throw new TypeError("config.onEncodedChunk, when provided, must be a function.");if(t.onEncoderConfig!==void 0&&typeof t.onEncoderConfig!="function")throw new TypeError("config.onEncoderConfig, when provided, must be a function.");Qn(t.codec,t)},Qn=(t,e)=>{if(!e||typeof e!="object")throw new TypeError("Encoding options must be an object.");if(e.bitrateMode!==void 0&&!["constant","variable"].includes(e.bitrateMode))throw new TypeError("bitrateMode, when provided, must be 'constant' or 'variable'.");if(e.fullCodecString!==void 0&&typeof e.fullCodecString!="string")throw new TypeError("fullCodecString, when provided, must be a string.");if(e.fullCodecString!==void 0&&St(e.fullCodecString)!==t)throw new TypeError(\`fullCodecString, when provided, must be a string that matches the specified codec (\${t}).\`)},fi=t=>{let e=t.bitrate instanceof he?t.bitrate._toAudioBitrate(t.codec):t.bitrate;return{codec:t.fullCodecString??cr(t.codec,t.numberOfChannels,t.sampleRate),numberOfChannels:t.numberOfChannels,sampleRate:t.sampleRate,bitrate:e,bitrateMode:t.bitrateMode,...ur(t.codec)}},he=class{constructor(e){this._factor=e}_toVideoBitrate(e,r,i){let n=r*i,s={avc:1,hevc:.6,vp9:.6,av1:.4,vp8:1.2},o=1920*1080,a=3e6,d=Math.pow(n/o,.95),u=a*d*s[e]*this._factor;return Math.ceil(u/1e3)*1e3}_toAudioBitrate(e){if(L.includes(e)||e==="flac")return;let i={aac:128e3,opus:64e3,mp3:16e4,vorbis:64e3,ac3:384e3,eac3:192e3}[e];if(!i)throw new Error(\`Unhandled codec: \${e}\`);let n=i*this._factor;return e==="aac"?n=[96e3,128e3,16e4,192e3].reduce((o,a)=>Math.abs(a-n)<Math.abs(o-n)?a:o):e==="opus"||e==="vorbis"?n=Math.max(6e3,n):e==="mp3"&&(n=[8e3,16e3,24e3,32e3,4e4,48e3,64e3,8e4,96e3,112e3,128e3,16e4,192e3,224e3,256e3,32e4].reduce((o,a)=>Math.abs(a-n)<Math.abs(o-n)?a:o)),Math.round(n/1e3)*1e3}};var Wt=new he(2);var Oe=class{constructor(){this._connectedTrack=null,this._closingPromise=null,this._closed=!1,this._timestampOffset=0}_ensureValidAdd(){if(!this._connectedTrack)throw new Error("Source is not connected to an output track.");if(this._connectedTrack.output.state==="canceled")throw new Error("Output has been canceled.");if(this._connectedTrack.output.state==="finalizing"||this._connectedTrack.output.state==="finalized")throw new Error("Output has been finalized.");if(this._connectedTrack.output.state==="pending")throw new Error("Output has not started.");if(this._closed)throw new Error("Source is closed.")}async _start(){}async _flushAndClose(e){}close(){if(this._closingPromise)return;let e=this._connectedTrack;if(!e)throw new Error("Cannot call close without connecting the source to an output track.");if(e.output.state==="pending")throw new Error("Cannot call close before output has been started.");this._closingPromise=(async()=>{await this._flushAndClose(!1),this._closed=!0,!(e.output.state==="finalizing"||e.output.state==="finalized")&&e.output._muxer.onTrackClose(e)})()}async _flushOrWaitForOngoingClose(e){return this._closingPromise??=(async()=>{await this._flushAndClose(e),this._closed=!0})()}},Ue=class extends Oe{constructor(e){if(super(),this._connectedTrack=null,!K.includes(e))throw new TypeError(\`Invalid video codec '\${e}'. Must be one of: \${K.join(", ")}.\`);this._codec=e}};var Dt=class{constructor(e,r){this.source=e,this.encodingConfig=r,this.ensureEncoderPromise=null,this.encoderInitialized=!1,this.encoder=null,this.muxer=null,this.lastMultipleOfKeyFrameInterval=-1,this.codedWidth=null,this.codedHeight=null,this.resizeCanvas=null,this.customEncoder=null,this.customEncoderCallSerializer=new Ne,this.customEncoderQueueSize=0,this.alphaEncoder=null,this.splitter=null,this.splitterCreationFailed=!1,this.alphaFrameQueue=[],this.error=null}async add(e,r,i){try{if(this.checkForEncoderError(),this.source._ensureValidAdd(),this.codedWidth!==null&&this.codedHeight!==null){if(e.codedWidth!==this.codedWidth||e.codedHeight!==this.codedHeight){let a=this.encodingConfig.sizeChangeBehavior??"deny";if(a!=="passThrough"){if(a==="deny")throw new Error(\`Video sample size must remain constant. Expected \${this.codedWidth}x\${this.codedHeight}, got \${e.codedWidth}x\${e.codedHeight}. To allow the sample size to change over time, set \\\`sizeChangeBehavior\\\` to a value other than 'strict' in the encoding options.\`);{let d=!1;this.resizeCanvas||(typeof document<"u"?(this.resizeCanvas=document.createElement("canvas"),this.resizeCanvas.width=this.codedWidth,this.resizeCanvas.height=this.codedHeight):this.resizeCanvas=new OffscreenCanvas(this.codedWidth,this.codedHeight),d=!0);let l=this.resizeCanvas.getContext("2d",{alpha:De()});h(l),d||(De()?(l.fillStyle="black",l.fillRect(0,0,this.codedWidth,this.codedHeight)):l.clearRect(0,0,this.codedWidth,this.codedHeight)),e.drawWithFit(l,{fit:a}),r&&e.close(),e=new ke(this.resizeCanvas,{timestamp:e.timestamp,duration:e.duration,rotation:e.rotation}),r=!0}}}}else this.codedWidth=e.codedWidth,this.codedHeight=e.codedHeight;this.encoderInitialized||(this.ensureEncoderPromise||this.ensureEncoder(e),this.encoderInitialized||await this.ensureEncoderPromise),h(this.encoderInitialized);let n=this.encodingConfig.keyFrameInterval??5,s=Math.floor(e.timestamp/n),o={...i,keyFrame:i?.keyFrame||n===0||s!==this.lastMultipleOfKeyFrameInterval};if(this.lastMultipleOfKeyFrameInterval=s,this.customEncoder){this.customEncoderQueueSize++;let a=e.clone(),d=this.customEncoderCallSerializer.call(()=>this.customEncoder.encode(a,o)).then(()=>this.customEncoderQueueSize--).catch(l=>this.error??=l).finally(()=>{a.close()});this.customEncoderQueueSize>=4&&await d}else{h(this.encoder);let a=e.toVideoFrame();if(!this.alphaEncoder)this.encoder.encode(a,o),a.close();else if(!!a.format&&!a.format.includes("A")||this.splitterCreationFailed)this.alphaFrameQueue.push(null),this.encoder.encode(a,o),a.close();else{let l=a.displayWidth,c=a.displayHeight;if(!this.splitter)try{this.splitter=new Ht(l,c)}catch(u){console.error("Due to an error, only color data will be encoded.",u),this.splitterCreationFailed=!0,this.alphaFrameQueue.push(null),this.encoder.encode(a,o),a.close()}if(this.splitter){let u=this.splitter.extractColor(a),f=this.splitter.extractAlpha(a);this.alphaFrameQueue.push(f),this.encoder.encode(u,o),u.close(),a.close()}}r&&e.close(),this.encoder.encodeQueueSize>=4&&await new Promise(d=>this.encoder.addEventListener("dequeue",d,{once:!0}))}await this.muxer.mutex.currentPromise}finally{r&&e.close()}}ensureEncoder(e){this.ensureEncoderPromise=(async()=>{let r=di({width:e.codedWidth,height:e.codedHeight,squarePixelWidth:e.squarePixelWidth,squarePixelHeight:e.squarePixelHeight,...this.encodingConfig,framerate:this.source._connectedTrack?.metadata.frameRate});this.encodingConfig.onEncoderConfig?.(r);let i=Ir.find(n=>n.supports(this.encodingConfig.codec,r));if(i)this.customEncoder=new i,this.customEncoder.codec=this.encodingConfig.codec,this.customEncoder.config=r,this.customEncoder.onPacket=(n,s)=>{if(!(n instanceof le))throw new TypeError("The first argument passed to onPacket must be an EncodedPacket.");if(s!==void 0&&(!s||typeof s!="object"))throw new TypeError("The second argument passed to onPacket must be an object or undefined.");this.encodingConfig.onEncodedPacket?.(n,s),this.muxer.addEncodedVideoPacket(this.source._connectedTrack,n,s).catch(o=>{this.error??=o})},await this.customEncoder.init();else{if(typeof VideoEncoder>"u")throw new Error("VideoEncoder is not supported by this browser.");if(r.alpha="discard",this.encodingConfig.alpha==="keep"&&(r.latencyMode="quality"),(r.width%2===1||r.height%2===1)&&(this.encodingConfig.codec==="avc"||this.encodingConfig.codec==="hevc"))throw new Error(\`The dimensions \${r.width}x\${r.height} are not supported for codec '\${this.encodingConfig.codec}'; both width and height must be even numbers. Make sure to round your dimensions to the nearest even number.\`);if(!(await VideoEncoder.isConfigSupported(r)).supported)throw new Error(\`This specific encoder configuration (\${r.codec}, \${r.bitrate} bps, \${r.width}x\${r.height}, hardware acceleration: \${r.hardwareAcceleration??"no-preference"}) is not supported by this browser. Consider using another codec or changing your video parameters.\`);let o=[],a=[],d=0,l=0,c=(f,g,w)=>{let T={};if(g){let E=new Uint8Array(g.byteLength);g.copyTo(E),T.alpha=E}let b=le.fromEncodedChunk(f,T);this.encodingConfig.onEncodedPacket?.(b,w),this.muxer.addEncodedVideoPacket(this.source._connectedTrack,b,w).catch(E=>{this.error??=E})},u=new Error("Encoding error").stack;if(this.encoder=new VideoEncoder({output:(f,g)=>{if(!this.alphaEncoder){c(f,null,g);return}let w=this.alphaFrameQueue.shift();h(w!==void 0),w?(this.alphaEncoder.encode(w,{keyFrame:f.type==="key"}),l++,w.close(),o.push({chunk:f,meta:g})):l===0?c(f,null,g):(a.push(d+l),o.push({chunk:f,meta:g}))},error:f=>{f.stack=u,this.error??=f}}),this.encoder.configure(r),this.encodingConfig.alpha==="keep"){let f=new Error("Encoding error").stack;this.alphaEncoder=new VideoEncoder({output:(g,w)=>{l--;let T=o.shift();for(h(T!==void 0),c(T.chunk,g,T.meta),d++;a.length>0&&a[0]===d;){a.shift();let b=o.shift();h(b!==void 0),c(b.chunk,null,b.meta)}},error:g=>{g.stack=f,this.error??=g}}),this.alphaEncoder.configure(r)}}h(this.source._connectedTrack),this.muxer=this.source._connectedTrack.output._muxer,this.encoderInitialized=!0})()}async flushAndClose(e){e||this.checkForEncoderError(),this.customEncoder?(e||this.customEncoderCallSerializer.call(()=>this.customEncoder.flush()),await this.customEncoderCallSerializer.call(()=>this.customEncoder.close())):this.encoder&&(e||(await this.encoder.flush(),await this.alphaEncoder?.flush()),this.encoder.state!=="closed"&&this.encoder.close(),this.alphaEncoder&&this.alphaEncoder.state!=="closed"&&this.alphaEncoder.close(),this.alphaFrameQueue.forEach(r=>r?.close()),this.splitter?.close()),e||this.checkForEncoderError()}getQueueSize(){return this.customEncoder?this.customEncoderQueueSize:this.encoder?.encodeQueueSize??0}checkForEncoderError(){if(this.error)throw this.error}},Ht=class{constructor(e,r){this.lastFrame=null,typeof OffscreenCanvas<"u"?this.canvas=new OffscreenCanvas(e,r):(this.canvas=document.createElement("canvas"),this.canvas.width=e,this.canvas.height=r);let i=this.canvas.getContext("webgl2",{alpha:!0});if(!i)throw new Error("Couldn't acquire WebGL 2 context.");this.gl=i,this.colorProgram=this.createColorProgram(),this.alphaProgram=this.createAlphaProgram(),this.vao=this.createVAO(),this.sourceTexture=this.createTexture(),this.alphaResolutionLocation=this.gl.getUniformLocation(this.alphaProgram,"u_resolution"),this.gl.useProgram(this.colorProgram),this.gl.uniform1i(this.gl.getUniformLocation(this.colorProgram,"u_sourceTexture"),0),this.gl.useProgram(this.alphaProgram),this.gl.uniform1i(this.gl.getUniformLocation(this.alphaProgram,"u_sourceTexture"),0)}createVertexShader(){return this.createShader(this.gl.VERTEX_SHADER,\`#version 300 es
			in vec2 a_position;
			in vec2 a_texCoord;
			out vec2 v_texCoord;
			
			void main() {
				gl_Position = vec4(a_position, 0.0, 1.0);
				v_texCoord = a_texCoord;
			}
		\`)}createColorProgram(){let e=this.createVertexShader(),r=this.createShader(this.gl.FRAGMENT_SHADER,\`#version 300 es
			precision highp float;
			
			uniform sampler2D u_sourceTexture;
			in vec2 v_texCoord;
			out vec4 fragColor;
			
			void main() {
				vec4 source = texture(u_sourceTexture, v_texCoord);
				fragColor = vec4(source.rgb, 1.0);
			}
		\`),i=this.gl.createProgram();return this.gl.attachShader(i,e),this.gl.attachShader(i,r),this.gl.linkProgram(i),i}createAlphaProgram(){let e=this.createVertexShader(),r=this.createShader(this.gl.FRAGMENT_SHADER,\`#version 300 es
			precision highp float;
			
			uniform sampler2D u_sourceTexture;
			uniform vec2 u_resolution; // The width and height of the canvas
			in vec2 v_texCoord;
			out vec4 fragColor;

			// This function determines the value for a single byte in the YUV stream
			float getByteValue(float byteOffset) {
				float width = u_resolution.x;
				float height = u_resolution.y;

				float yPlaneSize = width * height;

				if (byteOffset < yPlaneSize) {
					// This byte is in the luma plane. Find the corresponding pixel coordinates to sample from
					float y = floor(byteOffset / width);
					float x = mod(byteOffset, width);
					
					// Add 0.5 to sample the center of the texel
					vec2 sampleCoord = (vec2(x, y) + 0.5) / u_resolution;
					
					// The luma value is the alpha from the source texture
					return texture(u_sourceTexture, sampleCoord).a;
				} else {
					// Write a fixed value for chroma and beyond
					return 128.0 / 255.0;
				}
			}
			
			void main() {
				// Each fragment writes 4 bytes (R, G, B, A)
				float pixelIndex = floor(gl_FragCoord.y) * u_resolution.x + floor(gl_FragCoord.x);
				float baseByteOffset = pixelIndex * 4.0;

				vec4 result;
				for (int i = 0; i < 4; i++) {
					float currentByteOffset = baseByteOffset + float(i);
					result[i] = getByteValue(currentByteOffset);
				}
				
				fragColor = result;
			}
		\`),i=this.gl.createProgram();return this.gl.attachShader(i,e),this.gl.attachShader(i,r),this.gl.linkProgram(i),i}createShader(e,r){let i=this.gl.createShader(e);return this.gl.shaderSource(i,r),this.gl.compileShader(i),this.gl.getShaderParameter(i,this.gl.COMPILE_STATUS)||console.error("Shader compile error:",this.gl.getShaderInfoLog(i)),i}createVAO(){let e=this.gl.createVertexArray();this.gl.bindVertexArray(e);let r=new Float32Array([-1,-1,0,1,1,-1,1,1,-1,1,0,0,1,1,1,0]),i=this.gl.createBuffer();this.gl.bindBuffer(this.gl.ARRAY_BUFFER,i),this.gl.bufferData(this.gl.ARRAY_BUFFER,r,this.gl.STATIC_DRAW);let n=this.gl.getAttribLocation(this.colorProgram,"a_position"),s=this.gl.getAttribLocation(this.colorProgram,"a_texCoord");return this.gl.enableVertexAttribArray(n),this.gl.vertexAttribPointer(n,2,this.gl.FLOAT,!1,16,0),this.gl.enableVertexAttribArray(s),this.gl.vertexAttribPointer(s,2,this.gl.FLOAT,!1,16,8),e}createTexture(){let e=this.gl.createTexture();return this.gl.bindTexture(this.gl.TEXTURE_2D,e),this.gl.texParameteri(this.gl.TEXTURE_2D,this.gl.TEXTURE_WRAP_S,this.gl.CLAMP_TO_EDGE),this.gl.texParameteri(this.gl.TEXTURE_2D,this.gl.TEXTURE_WRAP_T,this.gl.CLAMP_TO_EDGE),this.gl.texParameteri(this.gl.TEXTURE_2D,this.gl.TEXTURE_MIN_FILTER,this.gl.LINEAR),this.gl.texParameteri(this.gl.TEXTURE_2D,this.gl.TEXTURE_MAG_FILTER,this.gl.LINEAR),e}updateTexture(e){this.lastFrame!==e&&((e.displayWidth!==this.canvas.width||e.displayHeight!==this.canvas.height)&&(this.canvas.width=e.displayWidth,this.canvas.height=e.displayHeight),this.gl.activeTexture(this.gl.TEXTURE0),this.gl.bindTexture(this.gl.TEXTURE_2D,this.sourceTexture),this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,this.gl.RGBA,this.gl.UNSIGNED_BYTE,e),this.lastFrame=e)}extractColor(e){return this.updateTexture(e),this.gl.useProgram(this.colorProgram),this.gl.viewport(0,0,this.canvas.width,this.canvas.height),this.gl.clear(this.gl.COLOR_BUFFER_BIT),this.gl.bindVertexArray(this.vao),this.gl.drawArrays(this.gl.TRIANGLE_STRIP,0,4),new VideoFrame(this.canvas,{timestamp:e.timestamp,duration:e.duration??void 0,alpha:"discard"})}extractAlpha(e){this.updateTexture(e),this.gl.useProgram(this.alphaProgram),this.gl.uniform2f(this.alphaResolutionLocation,this.canvas.width,this.canvas.height),this.gl.viewport(0,0,this.canvas.width,this.canvas.height),this.gl.clear(this.gl.COLOR_BUFFER_BIT),this.gl.bindVertexArray(this.vao),this.gl.drawArrays(this.gl.TRIANGLE_STRIP,0,4);let{width:r,height:i}=this.canvas,n=Math.ceil(r/2)*Math.ceil(i/2),s=r*i+n*2,o=Math.ceil(s/(r*4)),a=new Uint8Array(4*r*o);this.gl.readPixels(0,0,r,o,this.gl.RGBA,this.gl.UNSIGNED_BYTE,a),a=a.subarray(0,s),h(a[r*i]===128),h(a[a.length-1]===128);let d={format:"I420",codedWidth:r,codedHeight:i,timestamp:e.timestamp,duration:e.duration??void 0,transfer:[a.buffer]};return new VideoFrame(a,d)}close(){this.gl.getExtension("WEBGL_lose_context")?.loseContext(),this.gl=null}};var Je=class extends Ue{constructor(e,r){if(!(typeof HTMLCanvasElement<"u"&&e instanceof HTMLCanvasElement)&&!(typeof OffscreenCanvas<"u"&&e instanceof OffscreenCanvas))throw new TypeError("canvas must be an HTMLCanvasElement or OffscreenCanvas.");li(r),super(r.codec),this._encoder=new Dt(this,r),this._canvas=e}add(e,r=0,i){if(!Number.isFinite(e)||e<0)throw new TypeError("timestamp must be a non-negative number.");if(!Number.isFinite(r)||r<0)throw new TypeError("duration must be a non-negative number.");let n=new ke(this._canvas,{timestamp:e,duration:r});return this._encoder.add(n,!0,i)}_flushAndClose(e){return this._encoder.flushAndClose(e)}};var Le=class extends Oe{constructor(e){if(super(),this._connectedTrack=null,!ie.includes(e))throw new TypeError(\`Invalid audio codec '\${e}'. Must be one of: \${ie.join(", ")}.\`);this._codec=e}};var jt=class{constructor(e,r){this.source=e,this.encodingConfig=r,this.ensureEncoderPromise=null,this.encoderInitialized=!1,this.encoder=null,this.muxer=null,this.lastNumberOfChannels=null,this.lastSampleRate=null,this.isPcmEncoder=!1,this.outputSampleSize=null,this.writeOutputValue=null,this.customEncoder=null,this.customEncoderCallSerializer=new Ne,this.customEncoderQueueSize=0,this.lastEndSampleIndex=null,this.error=null}async add(e,r){try{if(this.checkForEncoderError(),this.source._ensureValidAdd(),this.lastNumberOfChannels!==null&&this.lastSampleRate!==null){if(e.numberOfChannels!==this.lastNumberOfChannels||e.sampleRate!==this.lastSampleRate)throw new Error(\`Audio parameters must remain constant. Expected \${this.lastNumberOfChannels} channels at \${this.lastSampleRate} Hz, got \${e.numberOfChannels} channels at \${e.sampleRate} Hz.\`)}else this.lastNumberOfChannels=e.numberOfChannels,this.lastSampleRate=e.sampleRate;this.encoderInitialized||(this.ensureEncoderPromise||this.ensureEncoder(e),this.encoderInitialized||await this.ensureEncoderPromise),h(this.encoderInitialized);{let i=Math.round(e.timestamp*e.sampleRate),n=Math.round((e.timestamp+e.duration)*e.sampleRate);if(this.lastEndSampleIndex===null)this.lastEndSampleIndex=n;else{let s=i-this.lastEndSampleIndex;if(s>=64){let o=new de({data:new Float32Array(s*e.numberOfChannels),format:"f32-planar",sampleRate:e.sampleRate,numberOfChannels:e.numberOfChannels,numberOfFrames:s,timestamp:this.lastEndSampleIndex/e.sampleRate});await this.add(o,!0)}this.lastEndSampleIndex+=e.numberOfFrames}}if(this.customEncoder){this.customEncoderQueueSize++;let i=e.clone(),n=this.customEncoderCallSerializer.call(()=>this.customEncoder.encode(i)).then(()=>this.customEncoderQueueSize--).catch(s=>this.error??=s).finally(()=>{i.close()});this.customEncoderQueueSize>=4&&await n,await this.muxer.mutex.currentPromise}else if(this.isPcmEncoder)await this.doPcmEncoding(e,r);else{h(this.encoder);let i=e.toAudioData();this.encoder.encode(i),i.close(),r&&e.close(),this.encoder.encodeQueueSize>=4&&await new Promise(n=>this.encoder.addEventListener("dequeue",n,{once:!0})),await this.muxer.mutex.currentPromise}}finally{r&&e.close()}}async doPcmEncoding(e,r){h(this.outputSampleSize),h(this.writeOutputValue);let{numberOfChannels:i,numberOfFrames:n,sampleRate:s,timestamp:o}=e,a=2048,d=[];for(let f=0;f<n;f+=a){let g=Math.min(a,e.numberOfFrames-f),w=g*i*this.outputSampleSize,T=new ArrayBuffer(w),b=new DataView(T);d.push({frameCount:g,view:b})}let l=e.allocationSize({planeIndex:0,format:"f32-planar"}),c=new Float32Array(l/Float32Array.BYTES_PER_ELEMENT);for(let f=0;f<i;f++){e.copyTo(c,{planeIndex:f,format:"f32-planar"});for(let g=0;g<d.length;g++){let{frameCount:w,view:T}=d[g];for(let b=0;b<w;b++)this.writeOutputValue(T,(b*i+f)*this.outputSampleSize,c[g*a+b])}}r&&e.close();let u={decoderConfig:{codec:this.encodingConfig.codec,numberOfChannels:i,sampleRate:s}};for(let f=0;f<d.length;f++){let{frameCount:g,view:w}=d[f],T=w.buffer,b=f*a,E=new le(new Uint8Array(T),"key",o+b/s,g/s);this.encodingConfig.onEncodedPacket?.(E,u),await this.muxer.addEncodedAudioPacket(this.source._connectedTrack,E,u)}}ensureEncoder(e){this.ensureEncoderPromise=(async()=>{let{numberOfChannels:r,sampleRate:i}=e,n=fi({numberOfChannels:r,sampleRate:i,...this.encodingConfig});this.encodingConfig.onEncoderConfig?.(n);let s=Pr.find(o=>o.supports(this.encodingConfig.codec,n));if(s)this.customEncoder=new s,this.customEncoder.codec=this.encodingConfig.codec,this.customEncoder.config=n,this.customEncoder.onPacket=(o,a)=>{if(!(o instanceof le))throw new TypeError("The first argument passed to onPacket must be an EncodedPacket.");if(a!==void 0&&(!a||typeof a!="object"))throw new TypeError("The second argument passed to onPacket must be an object or undefined.");this.encodingConfig.onEncodedPacket?.(o,a),this.muxer.addEncodedAudioPacket(this.source._connectedTrack,o,a).catch(d=>{this.error??=d})},await this.customEncoder.init();else if(L.includes(this.encodingConfig.codec))this.initPcmEncoder();else{if(typeof AudioEncoder>"u")throw new Error("AudioEncoder is not supported by this browser.");if(!(await AudioEncoder.isConfigSupported(n)).supported)throw new Error(\`This specific encoder configuration (\${n.codec}, \${n.bitrate} bps, \${n.numberOfChannels} channels, \${n.sampleRate} Hz) is not supported by this browser. Consider using another codec or changing your audio parameters.\`);let a=new Error("Encoding error").stack;this.encoder=new AudioEncoder({output:(d,l)=>{if(this.encodingConfig.codec==="aac"&&l?.decoderConfig){let u=!1;if(!l.decoderConfig.description||l.decoderConfig.description.byteLength<2?u=!0:u=ir(W(l.decoderConfig.description)).objectType===0,u){let f=Number(F(n.codec.split(".")));l.decoderConfig.description=ct({objectType:f,numberOfChannels:l.decoderConfig.numberOfChannels,sampleRate:l.decoderConfig.sampleRate})}}let c=le.fromEncodedChunk(d);this.encodingConfig.onEncodedPacket?.(c,l),this.muxer.addEncodedAudioPacket(this.source._connectedTrack,c,l).catch(u=>{this.error??=u})},error:d=>{d.stack=a,this.error??=d}}),this.encoder.configure(n)}h(this.source._connectedTrack),this.muxer=this.source._connectedTrack.output._muxer,this.encoderInitialized=!0})()}initPcmEncoder(){this.isPcmEncoder=!0;let e=this.encodingConfig.codec,{dataType:r,sampleSize:i,littleEndian:n}=ne(e);switch(this.outputSampleSize=i,i){case 1:r==="unsigned"?this.writeOutputValue=(s,o,a)=>s.setUint8(o,R((a+1)*127.5,0,255)):r==="signed"?this.writeOutputValue=(s,o,a)=>{s.setInt8(o,R(Math.round(a*128),-128,127))}:r==="ulaw"?this.writeOutputValue=(s,o,a)=>{let d=R(Math.floor(a*32767),-32768,32767);s.setUint8(o,Fr(d))}:r==="alaw"?this.writeOutputValue=(s,o,a)=>{let d=R(Math.floor(a*32767),-32768,32767);s.setUint8(o,Rr(d))}:h(!1);break;case 2:r==="unsigned"?this.writeOutputValue=(s,o,a)=>s.setUint16(o,R((a+1)*32767.5,0,65535),n):r==="signed"?this.writeOutputValue=(s,o,a)=>s.setInt16(o,R(Math.round(a*32767),-32768,32767),n):h(!1);break;case 3:r==="unsigned"?this.writeOutputValue=(s,o,a)=>We(s,o,R((a+1)*83886075e-1,0,16777215),n):r==="signed"?this.writeOutputValue=(s,o,a)=>Gt(s,o,R(Math.round(a*8388607),-8388608,8388607),n):h(!1);break;case 4:r==="unsigned"?this.writeOutputValue=(s,o,a)=>s.setUint32(o,R((a+1)*21474836475e-1,0,4294967295),n):r==="signed"?this.writeOutputValue=(s,o,a)=>s.setInt32(o,R(Math.round(a*2147483647),-2147483648,2147483647),n):r==="float"?this.writeOutputValue=(s,o,a)=>s.setFloat32(o,a,n):h(!1);break;case 8:r==="float"?this.writeOutputValue=(s,o,a)=>s.setFloat64(o,a,n):h(!1);break;default:ce(i),h(!1)}}async flushAndClose(e){e||this.checkForEncoderError(),this.customEncoder?(e||this.customEncoderCallSerializer.call(()=>this.customEncoder.flush()),await this.customEncoderCallSerializer.call(()=>this.customEncoder.close())):this.encoder&&(e||await this.encoder.flush(),this.encoder.state!=="closed"&&this.encoder.close()),e||this.checkForEncoderError()}getQueueSize(){return this.customEncoder?this.customEncoderQueueSize:this.isPcmEncoder?0:this.encoder?.encodeQueueSize??0}checkForEncoderError(){if(this.error)throw this.error}},et=class extends Le{constructor(e){ui(e),super(e.codec),this._encoder=new jt(this,e)}add(e){if(!(e instanceof de))throw new TypeError("audioSample must be an AudioSample.");return this._encoder.add(e,!1)}_flushAndClose(e){return this._encoder.flushAndClose(e)}};var tt=class extends Oe{constructor(e){if(super(),this._connectedTrack=null,!ye.includes(e))throw new TypeError(\`Invalid subtitle codec '\${e}'. Must be one of: \${ye.join(", ")}.\`);this._codec=e}};var Xn=["video","audio","subtitle"],$t=t=>{if(!t||typeof t!="object")throw new TypeError("metadata must be an object.");if(t.languageCode!==void 0&&!Kt(t.languageCode))throw new TypeError("metadata.languageCode, when provided, must be a three-letter, ISO 639-2/T language code.");if(t.name!==void 0&&typeof t.name!="string")throw new TypeError("metadata.name, when provided, must be a string.");if(t.disposition!==void 0&&rr(t.disposition),t.maximumPacketCount!==void 0&&(!Number.isInteger(t.maximumPacketCount)||t.maximumPacketCount<0))throw new TypeError("metadata.maximumPacketCount, when provided, must be a non-negative integer.")},rt=class{constructor(e){if(this.state="pending",this._tracks=[],this._startPromise=null,this._cancelPromise=null,this._finalizePromise=null,this._mutex=new Se,this._metadataTags={},!e||typeof e!="object")throw new TypeError("options must be an object.");if(!(e.format instanceof Fe))throw new TypeError("options.format must be an OutputFormat.");if(!(e.target instanceof Pe))throw new TypeError("options.target must be a Target.");if(e.target._output)throw new Error("Target is already used for another output.");e.target._output=this,this.format=e.format,this.target=e.target,this._writer=e.target._createWriter(),this._muxer=e.format._createMuxer(this)}addVideoTrack(e,r={}){if(!(e instanceof Ue))throw new TypeError("source must be a VideoSource.");if($t(r),r.rotation!==void 0&&![0,90,180,270].includes(r.rotation))throw new TypeError(\`Invalid video rotation: \${r.rotation}. Has to be 0, 90, 180 or 270.\`);if(!this.format.supportsVideoRotationMetadata&&r.rotation)throw new Error(\`\${this.format._name} does not support video rotation metadata.\`);if(r.frameRate!==void 0&&(!Number.isFinite(r.frameRate)||r.frameRate<=0))throw new TypeError(\`Invalid video frame rate: \${r.frameRate}. Must be a positive number.\`);this._addTrack("video",e,r)}addAudioTrack(e,r={}){if(!(e instanceof Le))throw new TypeError("source must be an AudioSource.");$t(r),this._addTrack("audio",e,r)}addSubtitleTrack(e,r={}){if(!(e instanceof tt))throw new TypeError("source must be a SubtitleSource.");$t(r),this._addTrack("subtitle",e,r)}setMetadataTags(e){if(tr(e),this.state!=="pending")throw new Error("Cannot set metadata tags after output has been started or canceled.");this._metadataTags=e}_addTrack(e,r,i){if(this.state!=="pending")throw new Error("Cannot add track after output has been started or canceled.");if(r._connectedTrack)throw new Error("Source is already used for a track.");let n=this.format.getSupportedTrackCounts(),s=this._tracks.reduce((l,c)=>l+(c.type===e?1:0),0),o=n[e].max;if(s===o)throw new Error(o===0?\`\${this.format._name} does not support \${e} tracks.\`:\`\${this.format._name} does not support more than \${o} \${e} track\${o===1?"":"s"}.\`);let a=n.total.max;if(this._tracks.length===a)throw new Error(\`\${this.format._name} does not support more than \${a} tracks\${a===1?"":"s"} in total.\`);let d={id:this._tracks.length+1,output:this,type:e,source:r,metadata:i};if(d.type==="video"){let l=this.format.getSupportedVideoCodecs();if(l.length===0)throw new Error(\`\${this.format._name} does not support video tracks.\`+this.format._codecUnsupportedHint(d.source._codec));if(!l.includes(d.source._codec))throw new Error(\`Codec '\${d.source._codec}' cannot be contained within \${this.format._name}. Supported video codecs are: \${l.map(c=>\`'\${c}'\`).join(", ")}.\`+this.format._codecUnsupportedHint(d.source._codec))}else if(d.type==="audio"){let l=this.format.getSupportedAudioCodecs();if(l.length===0)throw new Error(\`\${this.format._name} does not support audio tracks.\`+this.format._codecUnsupportedHint(d.source._codec));if(!l.includes(d.source._codec))throw new Error(\`Codec '\${d.source._codec}' cannot be contained within \${this.format._name}. Supported audio codecs are: \${l.map(c=>\`'\${c}'\`).join(", ")}.\`+this.format._codecUnsupportedHint(d.source._codec))}else if(d.type==="subtitle"){let l=this.format.getSupportedSubtitleCodecs();if(l.length===0)throw new Error(\`\${this.format._name} does not support subtitle tracks.\`+this.format._codecUnsupportedHint(d.source._codec));if(!l.includes(d.source._codec))throw new Error(\`Codec '\${d.source._codec}' cannot be contained within \${this.format._name}. Supported subtitle codecs are: \${l.map(c=>\`'\${c}'\`).join(", ")}.\`+this.format._codecUnsupportedHint(d.source._codec))}this._tracks.push(d),r._connectedTrack=d}async start(){let e=this.format.getSupportedTrackCounts();for(let i of Xn){let n=this._tracks.reduce((o,a)=>o+(a.type===i?1:0),0),s=e[i].min;if(n<s)throw new Error(s===e[i].max?\`\${this.format._name} requires exactly \${s} \${i} track\${s===1?"":"s"}.\`:\`\${this.format._name} requires at least \${s} \${i} track\${s===1?"":"s"}.\`)}let r=e.total.min;if(this._tracks.length<r)throw new Error(r===e.total.max?\`\${this.format._name} requires exactly \${r} track\${r===1?"":"s"}.\`:\`\${this.format._name} requires at least \${r} track\${r===1?"":"s"}.\`);if(this.state==="canceled")throw new Error("Output has been canceled.");return this._startPromise?(console.warn("Output has already been started."),this._startPromise):this._startPromise=(async()=>{this.state="started",this._writer.start();let i=await this._mutex.acquire();await this._muxer.start();let n=this._tracks.map(s=>s.source._start());await Promise.all(n),i()})()}getMimeType(){return this._muxer.getMimeType()}async cancel(){if(this._cancelPromise)return console.warn("Output has already been canceled."),this._cancelPromise;if(this.state==="finalizing"||this.state==="finalized"){console.warn("Output has already been finalized.");return}return this._cancelPromise=(async()=>{this.state="canceled";let e=await this._mutex.acquire(),r=this._tracks.map(i=>i.source._flushOrWaitForOngoingClose(!0));await Promise.all(r),await this._writer.close(),e()})()}async finalize(){if(this.state==="pending")throw new Error("Cannot finalize before starting.");if(this.state==="canceled")throw new Error("Cannot finalize after canceling.");return this._finalizePromise?(console.warn("Output has already been finalized."),this._finalizePromise):this._finalizePromise=(async()=>{this.state="finalizing";let e=await this._mutex.acquire(),r=this._tracks.map(i=>i.source._flushOrWaitForOngoingClose(!1));await Promise.all(r),await this._muxer.finalize(),await this._writer.flush(),await this._writer.finalize(),this.state="finalized",e()})()}};var hi=Symbol.for("mediabunny loaded");globalThis[hi]&&console.error(\`[WARNING]
Mediabunny was loaded twice. This will likely cause Mediabunny not to work correctly. Check if multiple dependencies are importing different versions of Mediabunny, or if something is being bundled incorrectly.\`);globalThis[hi]=!0;var nt=self,it,mi,ze,mt,pt,pi=!1,gt=[],qt=!1;async function Gn(){if(!qt){for(qt=!0;gt.length>0;){let t=gt.shift();try{await Yn(t)}catch(e){nt.postMessage({type:"error",message:String(e?.message??e)}),gt.length=0}}qt=!1}}nt.onmessage=t=>{gt.push(t.data),Gn()};async function Yn(t){switch(t.type){case"init":{it=new OffscreenCanvas(t.width,t.height),mi=it.getContext("2d"),ze=new rt({format:new Re,target:new Ce}),mt=new Je(it,{codec:"avc",bitrate:Wt}),ze.addVideoTrack(mt,{frameRate:t.fps}),pt=new et({codec:"aac",bitrate:192e3}),ze.addAudioTrack(pt),await ze.start(),nt.postMessage({type:"ready"});break}case"audio":{if(t.numberOfChannels>0&&t.data.length>0){let e=new de({data:t.data,format:"f32-planar",numberOfChannels:t.numberOfChannels,sampleRate:t.sampleRate,timestamp:0});await pt.add(e),e.close()}pt.close();break}case"frame":{if(pi)return;mi.drawImage(t.bitmap,0,0,it.width,it.height),t.bitmap.close(),await mt.add(t.timestamp,t.duration),nt.postMessage({type:"frameEncoded"});break}case"finalize":{mt.close(),await ze.finalize();let e=ze.target.buffer;nt.postMessage({type:"done",buffer:e},[e]);break}case"abort":{pi=!0;break}}}
/*! Bundled license information:

mediabunny/dist/modules/src/misc.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/metadata.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/shared/bitstream.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/shared/aac-misc.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/codec.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/shared/ac3-misc.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/codec-data.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/custom-coder.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/packet.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/pcm.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/sample.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/isobmff/isobmff-misc.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/isobmff/isobmff-reader.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/adts/adts-reader.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/reader.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/muxer.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/subtitles.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/isobmff/isobmff-boxes.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/writer.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/target.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/isobmff/isobmff-muxer.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/output-format.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/encode.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/media-source.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/output.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/index.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)
*/
`;

// src/renderer-browser/BrowserRenderer.ts
var PROPERTIES_BY_TYPE = {
  text: TextLayer.propertiesDefinition,
  captions: CaptionsLayer.propertiesDefinition,
  image: ImageLayer.propertiesDefinition,
  video: VideoLayer.propertiesDefinition,
  audio: AudioLayer.propertiesDefinition
};
var BrowserRenderer = class _BrowserRenderer {
  /** The compiled video JSON being rendered. */
  videoJSON;
  /** Runtime layer wrappers. */
  layers = [];
  /** The container element for layer DOM elements. */
  $canvas;
  /** Track whether DOM elements have been set up. */
  elementsSetup = false;
  /** Frame being rendered right now (for dedup / cancellation). */
  currentFrame = -1;
  /** Whether a frame render is in progress. */
  rendering = false;
  /** If set, the current render should be interrupted for this frame. */
  pendingFrame = false;
  /** Cache of loaded Google Fonts — maps font name → stylesheet URL. */
  loadedFonts = {};
  /** Cache of font CSS with embedded base64 data URIs. */
  loadedFontsEmbedded = {};
  /** Off-screen canvas used for SVG → raster conversion. */
  renderCanvas = null;
  constructor(videoJSON) {
    this.videoJSON = videoJSON;
    if (!document.querySelector("style[data-videoflow-renderer]")) {
      const style = document.createElement("style");
      style.setAttribute("data-videoflow-renderer", "");
      style.textContent = renderer_css_default;
      document.head.appendChild(style);
    }
    this.$canvas = document.createElement("div");
    this.$canvas.toggleAttribute("data-renderer", true);
    this.$canvas.style.setProperty("--project-width", String(videoJSON.width));
    this.$canvas.style.setProperty("--project-height", String(videoJSON.height));
    for (const layerJSON of videoJSON.layers) {
      this.layers.push(createRuntimeLayer(layerJSON, videoJSON.fps, videoJSON.width, videoJSON.height, this));
    }
  }
  getPropertyDefinition(layerType, prop) {
    if (prop !== void 0) {
      return PROPERTIES_BY_TYPE[layerType]?.[prop];
    }
    return PROPERTIES_BY_TYPE[layerType];
  }
  // -----------------------------------------------------------------------
  //  Static render entry point
  // -----------------------------------------------------------------------
  /**
   * Render a {@link VideoJSON} to a video Blob or ArrayBuffer.
   *
   * This is the primary public API.  It creates a BrowserRenderer instance,
   * initialises all layers, renders every frame, encodes the result via
   * MediaBunny, and returns the output.
   *
   * @param videoJSON - The compiled video JSON.
   * @param options   - Rendering options (outputType, signal, etc.).
   * @returns An MP4 Blob (default) or ArrayBuffer.
   */
  static async render(videoJSON, options = {}) {
    const renderer2 = new _BrowserRenderer(videoJSON);
    try {
      return await renderer2.exportVideo(options);
    } finally {
      renderer2.destroy();
    }
  }
  // -----------------------------------------------------------------------
  //  Initialisation
  // -----------------------------------------------------------------------
  /** Initialise all layers — load media, create DOM elements. */
  async initLayers() {
    const defaultFont = "Noto Sans";
    await this.loadFont(defaultFont);
    this.$canvas.style.setProperty("font-family", `"${defaultFont}", sans-serif`);
    await Promise.all(this.layers.map((layer) => layer.initialize()));
    for (const layer of this.layers) {
      layer.resolveMediaTimings();
    }
    this.$canvas.innerHTML = "";
    for (const layer of this.layers) {
      if (!layer.json.settings.enabled) continue;
      const $el = await layer.generateElement();
      if ($el) {
        this.$canvas.appendChild($el);
      }
    }
    this.elementsSetup = true;
  }
  // -----------------------------------------------------------------------
  //  Frame rendering
  // -----------------------------------------------------------------------
  /**
   * Render a single frame to the DOM.
   *
   * Each enabled layer computes its interpolated properties at the given
   * frame and applies them to its DOM element.
   */
  async renderFrame(frame, force = false) {
    if (frame < 0) return;
    if (!force && frame === this.currentFrame && this.pendingFrame === false) return;
    if (this.rendering) {
      this.pendingFrame = frame;
      return;
    }
    try {
      this.rendering = true;
      if (!this.elementsSetup) await this.initLayers();
      await Promise.all(
        this.layers.map(async (layer) => {
          if (layer.json.settings.enabled) {
            await layer.renderFrame(frame);
          }
        })
      );
      this.currentFrame = frame;
      await document.fonts.ready;
    } catch (e) {
      if (e !== "STOP_RENDERING") throw e;
    } finally {
      this.rendering = false;
      if (this.pendingFrame !== false) {
        const next = this.pendingFrame;
        this.pendingFrame = false;
        await this.renderFrame(next);
      }
    }
  }
  // -----------------------------------------------------------------------
  //  SVG foreignObject frame capture
  // -----------------------------------------------------------------------
  /**
   * Clone the DOM tree with inlined styles, converting `<canvas>` elements
   * to `<img>` with data-URI sources so they survive serialisation.
   */
  async cloneWithInlineStyles() {
    const clone = this.$canvas.cloneNode(true);
    const sourceElements = Array.from(this.$canvas.querySelectorAll("*"));
    const cloneElements = Array.from(clone.querySelectorAll("*"));
    await Promise.all(sourceElements.map(async (srcElem, i) => {
      const cloneElem = cloneElements[i];
      if (!cloneElem) return;
      if (srcElem.style.display === "none") {
        cloneElem.remove();
        return;
      }
      if (cloneElem.tagName === "CANVAS") {
        const img = document.createElement("img");
        img.style.cssText = srcElem.style.cssText;
        img.src = srcElem.toDataURL();
        for (const attr of srcElem.attributes) {
          img.setAttribute(attr.name, attr.value);
        }
        cloneElem.replaceWith(img);
      }
    }));
    return clone;
  }
  /**
   * Build the SVG string for a single frame.
   *
   * 1. Render the frame to DOM
   * 2. Build embedded font CSS with base64-encoded font files
   * 3. Clone the DOM tree with inlined styles
   * 4. Wrap in SVG foreignObject and return the SVG markup
   *
   * This is the DOM-dependent part of the capture pipeline and must run on
   * the main thread. The returned SVG string can be rasterised either locally
   * (via {@link captureFrame}) or inside a Web Worker.
   */
  async buildFrameSVG(frame) {
    await this.renderFrame(frame);
    const usedFontUrls = performance.getEntriesByType("resource").filter((f) => f.name.startsWith("https://fonts.gstatic.com/")).map((f) => f.name);
    let fontCss = "";
    for (const fontName of Object.keys(this.loadedFonts)) {
      if (!this.loadedFontsEmbedded[fontName]) {
        const fontSheet = await (await fetch(this.loadedFonts[fontName], { cache: "force-cache" })).text();
        this.loadedFontsEmbedded[fontName] = {};
        const styleSheet = new CSSStyleSheet();
        await styleSheet.replace(fontSheet);
        await Promise.all([...styleSheet.cssRules].map(async (rule) => {
          if (rule.type === CSSRule.FONT_FACE_RULE) {
            const url2 = rule.cssText.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, "");
            if (!url2) return;
            if (usedFontUrls.includes(url2)) {
              const embedded = await this.embedFontUrl(rule.cssText);
              if (embedded) this.loadedFontsEmbedded[fontName][url2] = embedded;
            } else {
              this.loadedFontsEmbedded[fontName][url2] = rule.cssText;
            }
          }
        }));
      }
      for (const [url2, cssText] of Object.entries(this.loadedFontsEmbedded[fontName])) {
        if (usedFontUrls.includes(url2)) {
          if (cssText.includes(url2)) {
            const embedded = await this.embedFontUrl(cssText);
            if (embedded) {
              this.loadedFontsEmbedded[fontName][url2] = embedded;
              fontCss += embedded;
            }
          } else {
            fontCss += cssText;
          }
        }
      }
    }
    const node = await this.cloneWithInlineStyles();
    node.id = "";
    node.style.removeProperty("position");
    node.style.removeProperty("left");
    node.style.removeProperty("top");
    const width = this.videoJSON.width;
    const height = this.videoJSON.height;
    const styleEl = document.createElement("style");
    styleEl.textContent = renderer_css_default + fontCss;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
			${styleEl.outerHTML}
			<foreignObject width="${width}px" height="${height}px">
				${new XMLSerializer().serializeToString(node)}
			</foreignObject>
		</svg>`;
  }
  /**
   * Capture the current frame as a raster image on an OffscreenCanvas.
   *
   * Calls {@link buildFrameSVG} to produce the SVG markup, then decodes it
   * via an Image element and blits onto an OffscreenCanvas.
   */
  async captureFrame(frame) {
    const svg = await this.buildFrameSVG(frame);
    const width = this.videoJSON.width;
    const height = this.videoJSON.height;
    const img = new Image();
    img.width = width;
    img.height = height;
    img.crossOrigin = "anonymous";
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await img.decode();
    if (!this.renderCanvas) {
      this.renderCanvas = new OffscreenCanvas(width, height);
    }
    const ctx = this.renderCanvas.getContext("2d");
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = this.videoJSON.backgroundColor || "#000000";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return this.renderCanvas;
  }
  /**
   * Replace a remote font URL inside a CSS rule with a base64 data URI.
   * This is required because SVG foreignObject cannot load external fonts.
   */
  async embedFontUrl(cssText) {
    const url2 = cssText.match(/url\(([^)]+)\)/)?.[1]?.replace(/['"]/g, "");
    if (!url2) return null;
    try {
      const blob = await (await fetch(url2)).blob();
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      return cssText.replace(url2, `data:${blob.type};base64,${base64}`);
    } catch {
      return cssText;
    }
  }
  // -----------------------------------------------------------------------
  //  Audio rendering
  // -----------------------------------------------------------------------
  /**
   * Render all audio layers into a single AudioBuffer using OfflineAudioContext.
   *
   * Each audio/video layer creates a buffer source node with volume and pan
   * keyframe automation, connected to the context's destination.
   */
  async renderAudio() {
    const audioLayers = this.layers.filter((l) => l.hasAudio && l.json.settings.enabled);
    if (audioLayers.length === 0) return null;
    const durationSec = this.videoJSON.duration;
    if (durationSec <= 0) return null;
    const sampleRate = 44100;
    const channels = 2;
    const audioCtx = new OfflineAudioContext(channels, Math.ceil(durationSec * sampleRate), sampleRate);
    for (const layer of audioLayers) {
      try {
        await this.generateLayerAudio(layer, audioCtx);
      } catch (e) {
        console.error(`Error generating audio for layer ${layer.json.id}:`, e);
      }
    }
    return await audioCtx.startRendering();
  }
  /**
   * Generate audio for a single layer and connect it to the audio context.
   *
   * Creates a buffer source from the layer's audio data, applies volume
   * and pan keyframes, and schedules playback.
   */
  async generateLayerAudio(layer, audioCtx) {
    const audioSource = layer.json.settings.audioSource;
    const source = audioSource || layer.json.settings.source;
    if (!source) return;
    let audioBuffer = !audioSource ? layer.decodedBuffer ?? null : null;
    if (!audioBuffer) {
      let arrayBuffer;
      const blob = !audioSource ? layer.dataBlob : null;
      let acquiredFromCache = false;
      if (blob) {
        arrayBuffer = await blob.arrayBuffer();
      } else if (!audioSource) {
        const entry = await loadedMedia.acquire(source);
        acquiredFromCache = true;
        arrayBuffer = await entry.blob.arrayBuffer();
      } else {
        const res = await fetch(source);
        arrayBuffer = await res.arrayBuffer();
      }
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      } catch (e) {
        if (acquiredFromCache) loadedMedia.release(source);
        return;
      }
      if (acquiredFromCache) loadedMedia.release(source);
    }
    const bufferSource = audioCtx.createBufferSource();
    const speed = layer.speed;
    if (speed === 0) return;
    if (speed < 0) {
      const reversed = audioCtx.createBuffer(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
      );
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const data = audioBuffer.getChannelData(ch);
        reversed.copyToChannel(new Float32Array(data).reverse(), ch);
      }
      bufferSource.buffer = reversed;
    } else {
      bufferSource.buffer = audioBuffer;
    }
    bufferSource.playbackRate.value = Math.abs(speed);
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 1;
    this.applyAudioKeyframes(layer, "volume", gainNode.gain, audioCtx);
    const panNode = audioCtx.createStereoPanner();
    panNode.pan.value = 0;
    this.applyAudioKeyframes(layer, "pan", panNode.pan, audioCtx);
    bufferSource.connect(gainNode).connect(panNode).connect(audioCtx.destination);
    const whenSec = layer.startTime;
    const sourceStartSec = layer.sourceStart;
    const sourceDurationSec = layer.sourceDuration;
    let offsetSec;
    if (speed < 0) {
      const totalLen = audioBuffer.duration;
      offsetSec = Math.max(0, totalLen - (sourceStartSec + sourceDurationSec));
    } else {
      offsetSec = sourceStartSec;
    }
    bufferSource.start(whenSec, offsetSec, sourceDurationSec);
  }
  /**
   * Apply keyframe automation to an AudioParam from the layer's animations.
   *
   * Keyframes are stored in absolute source seconds; this method projects
   * each one back into timeline seconds for `setValueAtTime`.
   */
  applyAudioKeyframes(layer, property, param, audioCtx) {
    const anim = layer.json.animations.find((a) => a.property === property);
    if (!anim || anim.keyframes.length === 0) return;
    const startTimeSec = layer.startTime;
    const sourceStartSec = layer.sourceStart;
    const sourceDurationSec = layer.sourceDuration;
    const speed = layer.speed;
    const speedAbs = Math.abs(speed) || 1;
    for (const kf of anim.keyframes) {
      const sourceOffsetSec = kf.time - sourceStartSec;
      let timelineSec;
      if (speed < 0) {
        timelineSec = startTimeSec + (sourceDurationSec - sourceOffsetSec) / speedAbs;
      } else {
        timelineSec = startTimeSec + sourceOffsetSec / speedAbs;
      }
      if (!Number.isFinite(timelineSec) || timelineSec < 0) continue;
      param.setValueAtTime(Number(kf.value), timelineSec);
    }
  }
  // -----------------------------------------------------------------------
  //  Video export (MediaBunny)
  // -----------------------------------------------------------------------
  /**
   * Export the full video as an MP4 blob using MediaBunny.
   *
   * When `options.worker` is not `false` (the default), SVG rasterisation and
   * MediaBunny encoding are offloaded to a dedicated Web Worker so that the
   * main thread stays responsive.  Set `worker: false` to encode entirely on
   * the main thread (useful when Workers are unavailable).
   *
   * @param options - Rendering options including abort signal.
   * @returns A Blob containing the MP4 video.
   */
  async exportVideo(options = {}) {
    if (options.worker !== false) {
      return this.exportVideoViaWorker(options);
    }
    return this.exportVideoMainThread(options);
  }
  /**
   * Main-thread export path (no Worker). Used as fallback when
   * `options.worker` is explicitly `false`.
   */
  async exportVideoMainThread(options = {}) {
    const width = this.videoJSON.width;
    const height = this.videoJSON.height;
    const fps = this.videoJSON.fps;
    const nFrames = Math.round(this.videoJSON.duration * fps);
    const signal = options.signal;
    const onProgress = options.onProgress;
    await this.initLayers();
    this.renderCanvas = new OffscreenCanvas(width, height);
    const output = new Output({
      format: new Mp4OutputFormat(),
      target: new BufferTarget()
    });
    const videoSource = new CanvasSource(this.renderCanvas, {
      codec: "avc",
      bitrate: QUALITY_HIGH
    });
    output.addVideoTrack(videoSource, { frameRate: fps });
    const audioSource = new AudioBufferSource({
      codec: "aac",
      bitrate: 192e3
    });
    output.addAudioTrack(audioSource);
    await output.start();
    if (signal?.aborted) throw new DOMException("Render aborted", "AbortError");
    const audioBuffer = await this.renderAudio();
    if (audioBuffer) {
      await audioSource.add(audioBuffer);
    }
    audioSource.close();
    for (let frame = 0; frame < nFrames; frame++) {
      if (signal?.aborted) throw new DOMException("Render aborted", "AbortError");
      await this.captureFrame(frame);
      await videoSource.add(frame / fps, 1 / fps);
      onProgress?.((frame + 1) / nFrames);
    }
    videoSource.close();
    if (signal?.aborted) throw new DOMException("Render aborted", "AbortError");
    await output.finalize();
    return new Blob([output.target.buffer], { type: "video/mp4" });
  }
  // -----------------------------------------------------------------------
  //  Worker-based export
  // -----------------------------------------------------------------------
  /**
   * Export via a dedicated Web Worker.
   *
   * The main thread still owns the DOM and renders each frame to an SVG
   * string (via {@link buildFrameSVG}).  The SVG strings are posted to the
   * worker which rasterises them with `createImageBitmap`, draws to an
   * `OffscreenCanvas`, and feeds MediaBunny for H.264 + AAC encoding.
   *
   * Audio channel data is transferred (zero-copy) to the worker which
   * reconstructs an `AudioBuffer` via `OfflineAudioContext`.
   */
  async exportVideoViaWorker(options = {}) {
    const { width, height, fps } = this.videoJSON;
    const nFrames = Math.round(this.videoJSON.duration * fps);
    const { signal, onProgress } = options;
    await this.initLayers();
    const workerBlob = new Blob([workerBundle_default], { type: "text/javascript" });
    const workerUrl = URL.createObjectURL(workerBlob);
    const worker = new Worker(workerUrl, { type: "module" });
    let framesDone = 0;
    let readyResolve;
    let doneResolve;
    let errorReject;
    const readyPromise = new Promise((r) => {
      readyResolve = r;
    });
    const donePromise = new Promise((resolve, reject) => {
      doneResolve = resolve;
      errorReject = reject;
    });
    worker.onmessage = (e) => {
      switch (e.data.type) {
        case "ready":
          readyResolve();
          break;
        case "frameEncoded":
          framesDone++;
          onProgress?.(framesDone / nFrames);
          break;
        case "done":
          doneResolve(e.data.buffer);
          break;
        case "error":
          errorReject(new Error(e.data.message));
          break;
      }
    };
    worker.onerror = (e) => {
      errorReject(new Error(e.message));
    };
    if (signal?.aborted) {
      worker.terminate();
      throw new DOMException("Render aborted", "AbortError");
    }
    const onAbort = () => {
      worker.postMessage({ type: "abort" });
      worker.terminate();
      errorReject(new DOMException("Render aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      worker.postMessage({ type: "init", width, height, fps });
      await readyPromise;
      this.renderCanvas = new OffscreenCanvas(width, height);
      const audioBuffer = await this.renderAudio();
      if (audioBuffer) {
        const { numberOfChannels, length, sampleRate } = audioBuffer;
        const data = new Float32Array(numberOfChannels * length);
        for (let i = 0; i < numberOfChannels; i++) {
          data.set(audioBuffer.getChannelData(i), i * length);
        }
        worker.postMessage({
          type: "audio",
          data,
          sampleRate,
          numberOfChannels
        }, [data.buffer]);
      } else {
        worker.postMessage({
          type: "audio",
          data: new Float32Array(0),
          sampleRate: 44100,
          numberOfChannels: 0
        });
      }
      for (let frame = 0; frame < nFrames; frame++) {
        if (signal?.aborted) break;
        await new Promise((r) => setTimeout(r, 0));
        await this.captureFrame(frame);
        if (signal?.aborted) break;
        const bitmap = this.renderCanvas.transferToImageBitmap();
        worker.postMessage(
          { type: "frame", bitmap, timestamp: frame / fps, duration: 1 / fps },
          [bitmap]
        );
      }
      if (!signal?.aborted) {
        worker.postMessage({ type: "finalize" });
      }
      const buffer = await donePromise;
      return new Blob([buffer], { type: "video/mp4" });
    } finally {
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
    }
  }
  // -----------------------------------------------------------------------
  //  Font loading
  // -----------------------------------------------------------------------
  /**
   * Load a Google Font by name.
   *
   * Constructs the appropriate Google Fonts CSS2 URL, injects a `<style>`
   * tag, and waits for the font to be available for rendering.
   */
  async loadFont(fontName) {
    if (fontName in this.loadedFonts) return;
    const encoded = fontName.replace(/ /g, "+");
    const href = `https://fonts.googleapis.com/css2?family=${encoded}:ital,wght@0,100..900;1,100..900&display=swap`;
    this.loadedFonts[fontName] = href;
    const sheet = document.createElement("style");
    try {
      const fontSheet = await (await fetch(href, { cache: "force-cache" })).text();
      sheet.textContent = fontSheet;
    } catch {
      const fallbackHref = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
      this.loadedFonts[fontName] = fallbackHref;
      try {
        const fontSheet = await (await fetch(fallbackHref, { cache: "force-cache" })).text();
        sheet.textContent = fontSheet;
      } catch {
        console.error(`Failed to load font "${fontName}"`);
        return;
      }
    }
    document.head.appendChild(sheet);
    try {
      await document.fonts.load(`1em "${fontName}"`);
    } catch {
      console.error(`Failed to load font "${fontName}"`);
    }
  }
  // -----------------------------------------------------------------------
  //  Cleanup
  // -----------------------------------------------------------------------
  /** Remove the hidden container and release all resources. */
  destroy() {
    for (const layer of this.layers) layer.destroy();
    this.$canvas.remove();
    this.renderCanvas = null;
  }
};

// src/renderer-dom/renderer.css.ts
var RENDERER_CSS2 = `
${renderer_css_default}
:host {
	container-type: inline-size;
	display: flex;
    align-items: center;
    justify-content: center;
}
[data-renderer] {
	--project-width: calc(var(--project-width-target) * min(100cqw / (var(--project-width-target) * 1px), 100cqh / (var(--project-height-target) * 1px)));
	--project-height: calc(var(--project-height-target) * min(100cqw / (var(--project-width-target) * 1px), 100cqh / (var(--project-height-target) * 1px)));
}
`;
var renderer_css_default2 = RENDERER_CSS2;

// src/renderer-dom/DomRenderer.ts
var PROPERTIES_BY_TYPE2 = {
  text: TextLayer.propertiesDefinition,
  captions: CaptionsLayer.propertiesDefinition,
  image: ImageLayer.propertiesDefinition,
  video: VideoLayer.propertiesDefinition,
  audio: AudioLayer.propertiesDefinition
};
var DomRenderer = class {
  /** The host element that contains the shadow root. */
  host;
  /** The shadow root for style isolation. */
  shadow;
  /** Container div inside the shadow (mirrors BrowserRenderer.$canvas). */
  $canvas = null;
  /** The loaded VideoJSON. */
  videoJSON = null;
  /** Runtime layer instances. */
  layers = [];
  /** Fast id → runtime layer lookup, kept in sync with `layers`. */
  layerById = /* @__PURE__ */ new Map();
  /** Track whether DOM elements have been set up. */
  elementsSetup = false;
  /**
   * Serializes structural/property mutations so they don't interleave with
   * each other. Each mutation awaits the previous one before running.
   */
  mutationQueue = Promise.resolve();
  /** Current frame rendered. */
  currentFrame = -1;
  rendering = false;
  pendingFrame = false;
  /** Google Fonts already loaded into the shadow DOM. */
  loadedFonts = {};
  /** Whether playback is active. */
  playing = false;
  /**
   * Optional callback fired whenever a new frame is rendered. Set this
   * externally to keep a UI (seek bar, time label, …) in sync with playback.
   */
  onFrame = null;
  /** Audio element for playback sync. */
  audio = null;
  /** Object URL for the audio blob (for cleanup). */
  audioUrl = null;
  constructor(host) {
    this.host = host;
    if (host.shadowRoot) {
      this.shadow = host.shadowRoot;
      this.shadow.innerHTML = "";
    } else {
      this.shadow = host.attachShadow({ mode: "open" });
    }
  }
  // -----------------------------------------------------------------------
  //  ILayerRenderer implementation
  // -----------------------------------------------------------------------
  /** Return the full propertiesDefinition for a layer type. */
  getPropertyDefinition(layerType) {
    return PROPERTIES_BY_TYPE2[layerType];
  }
  /** Load a Google Font and inject it into the shadow DOM. */
  async loadFont(fontName) {
    if (fontName in this.loadedFonts) return;
    const encoded = fontName.replace(/ /g, "+");
    const href = `https://fonts.googleapis.com/css2?family=${encoded}:ital,wght@0,100..900;1,100..900&display=swap`;
    this.loadedFonts[fontName] = href;
    const sheet = document.createElement("style");
    try {
      const fontSheet = await (await fetch(href, { cache: "force-cache" })).text();
      sheet.textContent = fontSheet;
    } catch {
      const fallbackHref = `https://fonts.googleapis.com/css2?family=${encoded}&display=swap`;
      this.loadedFonts[fontName] = fallbackHref;
      try {
        const fontSheet = await (await fetch(fallbackHref, { cache: "force-cache" })).text();
        sheet.textContent = fontSheet;
      } catch {
        console.error(`DomRenderer: Failed to load font "${fontName}"`);
        return;
      }
    }
    this.shadow.insertBefore(sheet, this.shadow.firstChild);
    try {
      await document.fonts.load(`1em "${fontName}"`);
    } catch {
    }
  }
  // -----------------------------------------------------------------------
  //  Public API
  // -----------------------------------------------------------------------
  /**
   * Load a compiled VideoJSON into the renderer.
   *
   * Sets up the shadow DOM, creates runtime layers, initialises media, and
   * renders frame 0.
   *
   * @param videoJSON - Compiled VideoJSON from VideoFlow.compile().
   */
  async loadVideo(videoJSON) {
    this.stop();
    const oldLayers = this.layers;
    const newLayers = videoJSON.layers.map(
      (layerJSON) => createRuntimeLayer(layerJSON, videoJSON.fps, videoJSON.width, videoJSON.height, this)
    );
    await Promise.all(newLayers.map((layer) => layer.initialize()));
    for (const layer of newLayers) layer.resolveMediaTimings();
    this.videoJSON = videoJSON;
    this.layers = newLayers;
    this.layerById = new Map(newLayers.map((l) => [l.json.id, l]));
    this.currentFrame = -1;
    this.elementsSetup = false;
    this.shadow.innerHTML = "";
    const style = document.createElement("style");
    style.textContent = renderer_css_default2;
    this.shadow.appendChild(style);
    this.$canvas = document.createElement("div");
    this.$canvas.toggleAttribute("data-renderer", true);
    this.$canvas.style.setProperty("--project-width-target", String(videoJSON.width));
    this.$canvas.style.setProperty("--project-height-target", String(videoJSON.height));
    this.$canvas.style.backgroundColor = videoJSON.backgroundColor || "#000000";
    this.shadow.appendChild(this.$canvas);
    for (const layer of oldLayers) layer.destroy();
    await this.renderFrame(0, true);
  }
  // -----------------------------------------------------------------------
  //  Incremental mutation API
  //
  //  These methods allow editors to mutate the loaded video without tearing
  //  down and rebuilding the entire Shadow DOM as `loadVideo()` would. Each
  //  mutation is serialized through `mutationQueue` so callers can fire them
  //  without worrying about interleaving, and each one concludes by
  //  re-rendering the current frame so the preview stays in sync.
  //
  //  Property/settings/animation edits are fully in-place: the existing
  //  `$element` is kept and its inline styles / CSS variables are updated.
  //  Structural edits (add/remove/reorder) touch `this.layers` and the
  //  `$canvas` child list but don't rebuild unrelated layers.
  // -----------------------------------------------------------------------
  /**
   * Queue a mutation so it runs after any in-flight mutation completes.
   * The returned promise resolves with the mutation's result (or rejects
   * with its error) but the queue itself is never left in a rejected state.
   */
  enqueueMutation(fn) {
    const run = this.mutationQueue.then(fn, fn);
    this.mutationQueue = run.then(() => {
    }, () => {
    });
    return run;
  }
  /**
   * Apply a property / settings / animations patch to a single layer.
   *
   * - `settings` and `properties` are shallow-merged into `layer.json`.
   * - `animations` replaces the array wholesale (callers hold the diffing
   *   logic because per-keyframe reconciliation is cheap to do in editor
   *   state).
   *
   * If `settings.source` changed, the layer's media is re-initialized via
   * `layer.initialize()` — callers should debounce rapid source swaps.
   *
   * If a text layer's `fontFamily` is among the patched properties, the font
   * is loaded into the shadow DOM before the frame is re-rendered.
   *
   * @param id - The layer id to patch.
   * @param patch - A partial patch. Any subset of settings/properties/animations.
   * @returns Resolves once the patch has been applied and the current frame re-rendered.
   */
  async updateLayer(id, patch) {
    return this.enqueueMutation(async () => {
      const layer = this.layerById.get(id);
      if (!layer) return;
      const prevSource = layer.json.settings.source;
      if (patch.settings) {
        layer.json.settings = { ...layer.json.settings, ...patch.settings };
      }
      if (patch.properties) {
        layer.json.properties = { ...layer.json.properties, ...patch.properties };
      }
      if (patch.animations) {
        layer.json.animations = patch.animations;
      }
      if (patch.settings && "source" in patch.settings && patch.settings.source !== prevSource) {
        await layer.initialize();
        layer.resolveMediaTimings();
      }
      const newFont = patch.properties?.fontFamily;
      if (typeof newFont === "string" && newFont.length > 0) {
        await this.loadFont(newFont);
      }
      await this.renderFrame(this.currentFrame < 0 ? 0 : this.currentFrame, true);
    });
  }
  /**
   * Insert a new layer into the video at the given index (defaults to end).
   *
   * The new layer is constructed, initialized, and mounted into the existing
   * `$canvas` — other layers' DOM elements are left untouched.
   *
   * @param layerJSON - The layer JSON to add. Must include a unique `id`.
   * @param index - The insertion index in `this.layers`. Defaults to appending.
   */
  async addLayer(layerJSON, index) {
    return this.enqueueMutation(async () => {
      if (!this.videoJSON || !this.$canvas) {
        throw new Error("DomRenderer.addLayer: no video loaded. Call loadVideo() first.");
      }
      if (this.layerById.has(layerJSON.id)) {
        throw new Error(`DomRenderer.addLayer: layer id "${layerJSON.id}" already exists.`);
      }
      const insertAt = index === void 0 ? this.layers.length : Math.max(0, Math.min(index, this.layers.length));
      const layer = createRuntimeLayer(
        layerJSON,
        this.videoJSON.fps,
        this.videoJSON.width,
        this.videoJSON.height,
        this
      );
      await layer.initialize();
      layer.resolveMediaTimings();
      this.layers.splice(insertAt, 0, layer);
      this.layerById.set(layerJSON.id, layer);
      this.videoJSON.layers.splice(insertAt, 0, layerJSON);
      if (this.elementsSetup && layer.json.settings.enabled) {
        const $el = await layer.generateElement();
        if ($el) {
          const nextSiblingIndex = insertAt + 1;
          const nextEl = nextSiblingIndex < this.layers.length ? this.layers[nextSiblingIndex].$element : null;
          if (nextEl && nextEl.parentNode === this.$canvas) {
            this.$canvas.insertBefore($el, nextEl);
          } else {
            this.$canvas.appendChild($el);
          }
        }
      }
      await this.renderFrame(this.currentFrame < 0 ? 0 : this.currentFrame, true);
    });
  }
  /**
   * Remove a layer from the video.
   *
   * Destroys the layer (releasing its media ref) and detaches its DOM
   * element. Other layers are untouched.
   */
  async removeLayer(id) {
    return this.enqueueMutation(async () => {
      const layer = this.layerById.get(id);
      if (!layer) return;
      const idx = this.layers.indexOf(layer);
      if (idx === -1) return;
      if (layer.$element && layer.$element.parentNode) {
        layer.$element.parentNode.removeChild(layer.$element);
      }
      this.layers.splice(idx, 1);
      this.layerById.delete(id);
      if (this.videoJSON) {
        const jsonIdx = this.videoJSON.layers.findIndex((l) => l.id === id);
        if (jsonIdx !== -1) this.videoJSON.layers.splice(jsonIdx, 1);
      }
      layer.destroy();
      await this.renderFrame(this.currentFrame < 0 ? 0 : this.currentFrame, true);
    });
  }
  /**
   * Reorder layers to match the given id sequence.
   *
   * The runtime layers and the backing `videoJSON.layers` array are reordered,
   * and the layers' `$element`s are re-appended to `$canvas` in the new order
   * (DOM order drives z-index via the `z-index` style written in
   * `applyProperties`). No media is touched.
   *
   * @param orderedIds - The new layer order. Must contain exactly the set of
   *   currently-loaded layer ids, in any order. Extra/missing ids throw.
   */
  async reorderLayers(orderedIds) {
    return this.enqueueMutation(async () => {
      if (orderedIds.length !== this.layers.length) {
        throw new Error(
          `DomRenderer.reorderLayers: expected ${this.layers.length} ids, got ${orderedIds.length}.`
        );
      }
      const next = [];
      for (const id of orderedIds) {
        const layer = this.layerById.get(id);
        if (!layer) {
          throw new Error(`DomRenderer.reorderLayers: unknown layer id "${id}".`);
        }
        next.push(layer);
      }
      this.layers = next;
      if (this.videoJSON) {
        this.videoJSON.layers = next.map((l) => l.json);
      }
      if (this.elementsSetup && this.$canvas) {
        for (const layer of next) {
          if (layer.$element && layer.$element.parentNode === this.$canvas) {
            this.$canvas.appendChild(layer.$element);
          }
        }
      }
      await this.renderFrame(this.currentFrame < 0 ? 0 : this.currentFrame, true);
    });
  }
  /**
   * Patch top-level video properties (width, height, backgroundColor).
   *
   * `fps` and `duration` changes are not supported here — they invalidate
   * frame numbers across the pipeline and require a full `loadVideo()`.
   */
  async updateVideo(patch) {
    return this.enqueueMutation(async () => {
      if (!this.videoJSON || !this.$canvas) return;
      if (patch.width !== void 0) {
        this.videoJSON.width = patch.width;
        this.$canvas.style.setProperty("--project-width-target", String(patch.width));
      }
      if (patch.height !== void 0) {
        this.videoJSON.height = patch.height;
        this.$canvas.style.setProperty("--project-height-target", String(patch.height));
      }
      if (patch.backgroundColor !== void 0) {
        this.videoJSON.backgroundColor = patch.backgroundColor;
        this.$canvas.style.backgroundColor = patch.backgroundColor;
      }
      if (patch.name !== void 0) {
        this.videoJSON.name = patch.name;
      }
      await this.renderFrame(this.currentFrame < 0 ? 0 : this.currentFrame, true);
    });
  }
  /**
   * Render a specific frame to the DOM.
   *
   * Skips if already at that frame (unless forced), queues if a render is
   * already in progress.
   *
   * @param frame - Frame number to render.
   * @param force - Render even if already at this frame.
   */
  async renderFrame(frame, force = false) {
    if (!this.videoJSON || !this.$canvas) return;
    if (frame < 0) return;
    if (!force && frame === this.currentFrame && this.pendingFrame === false) return;
    if (this.rendering) {
      this.pendingFrame = frame;
      return;
    }
    try {
      this.rendering = true;
      if (!this.elementsSetup) await this.initLayers();
      await Promise.all(
        this.layers.map(async (layer) => {
          if (layer.json.settings.enabled) {
            await layer.renderFrame(frame);
          }
        })
      );
      this.currentFrame = frame;
      await document.fonts.ready;
      this.onFrame?.(frame);
    } catch (e) {
      if (e !== "STOP_RENDERING") throw e;
    } finally {
      this.rendering = false;
      if (this.pendingFrame !== false) {
        const next = this.pendingFrame;
        this.pendingFrame = false;
        await this.renderFrame(next);
      }
    }
  }
  /**
   * Render the full audio track as an AudioBuffer.
   *
   * @returns AudioBuffer, or null if there are no audio layers.
   */
  async renderAudio() {
    if (!this.videoJSON) return null;
    const audioLayers = this.layers.filter((l) => l.hasAudio && l.json.settings.enabled);
    if (audioLayers.length === 0) return null;
    const durationSec = this.videoJSON.duration;
    if (durationSec <= 0) return null;
    const sampleRate = 44100;
    const audioCtx = new OfflineAudioContext(2, Math.ceil(durationSec * sampleRate), sampleRate);
    for (const layer of audioLayers) {
      await this.generateLayerAudio(layer, audioCtx);
    }
    return await audioCtx.startRendering();
  }
  /**
   * Start real-time playback from the current frame with audio sync.
   *
   * Render audio to WAV, create an Audio element, and use
   * requestAnimationFrame to advance frames while adjusting playback rate
   * for A/V sync.
   *
   * @param options - Optional callbacks:
   *   - `fpsCallback(fps)` — fired every animation frame with the current
   *     measured render FPS, useful for a HUD/diagnostic display.
   *
   * To track frame changes, set the public {@link onFrame} property.
   */
  async play(options = {}) {
    const { fpsCallback } = options;
    if (!this.videoJSON) throw new Error("No video loaded. Call loadVideo() first.");
    if (this.playing) return;
    this.playing = true;
    const fps = this.videoJSON.fps;
    const durationSec = this.videoJSON.duration;
    try {
      const startTime = Date.now();
      const startFrame = this.currentFrame < 0 ? 0 : this.currentFrame;
      const startTimeSec = startFrame / fps;
      const audioBuffer = await this.renderAudio();
      if (audioBuffer) {
        const wav = audioBufferToWav(audioBuffer);
        const blob = new Blob([wav], { type: "audio/wav" });
        this.audioUrl = URL.createObjectURL(blob);
        this.audio = new Audio(this.audioUrl);
        this.audio.loop = false;
        this.audio.currentTime = startTimeSec;
        this.audio.play();
      }
      while (this.playing) {
        const renderStart = performance.now();
        const elapsed = (Date.now() - startTime) / 1e3;
        const currentTimeSec = (startTimeSec + elapsed) % durationSec;
        const frame = Math.round(currentTimeSec * fps);
        if (frame !== this.currentFrame) {
          if (this.audio) {
            const audioTime = this.audio.currentTime;
            const syncDiff = currentTimeSec - audioTime;
            if (Math.abs(syncDiff) > 15 / fps) {
              this.audio.currentTime = currentTimeSec;
            } else if (Math.abs(syncDiff) > 4 / fps) {
              this.audio.playbackRate = (1 / (1 - syncDiff)) ** 2;
            } else {
              this.audio.playbackRate = 1;
            }
          }
          await this.renderFrame(frame, true);
        }
        const frameFps = 1e3 / (performance.now() - renderStart);
        fpsCallback?.(frameFps);
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      }
    } catch (e) {
      this.playing = false;
      console.error("DomRenderer playback error:", e);
    }
    this.cleanupAudio();
  }
  /** Stop playback. */
  stop() {
    this.playing = false;
    this.cleanupAudio();
  }
  /**
   * Seek to a frame. Stops playback if active, renders the frame, then
   * restarts playback if it was active.
   */
  async seek(frame) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.stop();
    await this.renderFrame(frame, true);
    if (wasPlaying) await this.play();
  }
  // -----------------------------------------------------------------------
  //  Convenience getters/setters
  // -----------------------------------------------------------------------
  get currentTime() {
    if (!this.videoJSON) return 0;
    return Math.max(0, this.currentFrame) / this.videoJSON.fps;
  }
  set currentTime(time) {
    if (!this.videoJSON) return;
    const frame = Math.round(time * this.videoJSON.fps);
    this.renderFrame(frame, true);
  }
  get totalFrames() {
    if (!this.videoJSON) return 0;
    return Math.round(this.videoJSON.duration * this.videoJSON.fps);
  }
  get duration() {
    return this.videoJSON?.duration ?? 0;
  }
  get fps() {
    return this.videoJSON?.fps ?? 0;
  }
  // -----------------------------------------------------------------------
  //  Destroy
  // -----------------------------------------------------------------------
  /**
   * Destroy the renderer and release all resources.
   *
   * @param clearShadow - Whether to clear the shadow DOM (default true).
   */
  destroy(clearShadow = true) {
    this.stop();
    for (const layer of this.layers) layer.destroy();
    this.layers = [];
    this.layerById.clear();
    this.$canvas = null;
    this.videoJSON = null;
    this.elementsSetup = false;
    this.currentFrame = -1;
    if (clearShadow) this.shadow.innerHTML = "";
  }
  // -----------------------------------------------------------------------
  //  Internal helpers
  // -----------------------------------------------------------------------
  /** Initialise layers and create DOM elements inside the shadow container. */
  async initLayers() {
    if (!this.$canvas) return;
    const defaultFont = "Noto Sans";
    await this.loadFont(defaultFont);
    this.$canvas.style.setProperty("font-family", `"${defaultFont}", sans-serif`);
    await Promise.all(this.layers.map((layer) => layer.initialize()));
    this.$canvas.innerHTML = "";
    for (const layer of this.layers) {
      if (!layer.json.settings.enabled) continue;
      const $el = await layer.generateElement();
      if ($el) this.$canvas.appendChild($el);
    }
    this.elementsSetup = true;
  }
  /** Generate audio for a single layer in the OfflineAudioContext. */
  async generateLayerAudio(layer, audioCtx) {
    const source = layer.json.settings.source;
    if (!source) return;
    let audioBuffer = layer.decodedBuffer ?? null;
    if (!audioBuffer) {
      let arrayBuffer;
      const blob = layer.dataBlob;
      let acquiredFromCache = false;
      if (blob) {
        arrayBuffer = await blob.arrayBuffer();
      } else {
        const entry = await loadedMedia.acquire(source);
        acquiredFromCache = true;
        arrayBuffer = await entry.blob.arrayBuffer();
      }
      try {
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      } catch (e) {
        if (acquiredFromCache) loadedMedia.release(source);
        return;
      }
      if (acquiredFromCache) loadedMedia.release(source);
    }
    const bufferSource = audioCtx.createBufferSource();
    const speed = layer.speed;
    if (speed === 0) return;
    if (speed < 0) {
      const reversed = audioCtx.createBuffer(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
      );
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const data = audioBuffer.getChannelData(ch);
        reversed.copyToChannel(new Float32Array(data).reverse(), ch);
      }
      bufferSource.buffer = reversed;
    } else {
      bufferSource.buffer = audioBuffer;
    }
    bufferSource.playbackRate.value = Math.abs(speed);
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = 1;
    this.applyAudioKeyframes(layer, "volume", gainNode.gain, audioCtx);
    const panNode = audioCtx.createStereoPanner();
    panNode.pan.value = 0;
    this.applyAudioKeyframes(layer, "pan", panNode.pan, audioCtx);
    bufferSource.connect(gainNode).connect(panNode).connect(audioCtx.destination);
    const whenSec = layer.startTime;
    const sourceStartSec = layer.sourceStart;
    const sourceDurationSec = layer.sourceDuration;
    let offsetSec;
    if (speed < 0) {
      const totalLen = audioBuffer.duration;
      offsetSec = Math.max(0, totalLen - (sourceStartSec + sourceDurationSec));
    } else {
      offsetSec = sourceStartSec;
    }
    bufferSource.start(whenSec, offsetSec, sourceDurationSec);
  }
  applyAudioKeyframes(layer, property, param, audioCtx) {
    const anim = layer.json.animations.find((a) => a.property === property);
    if (!anim || anim.keyframes.length === 0) return;
    const startTimeSec = layer.startTime;
    const sourceStartSec = layer.sourceStart;
    const sourceDurationSec = layer.sourceDuration;
    const speed = layer.speed;
    const speedAbs = Math.abs(speed) || 1;
    for (const kf of anim.keyframes) {
      const sourceOffsetSec = kf.time - sourceStartSec;
      let timelineSec;
      if (speed < 0) {
        timelineSec = startTimeSec + (sourceDurationSec - sourceOffsetSec) / speedAbs;
      } else {
        timelineSec = startTimeSec + sourceOffsetSec / speedAbs;
      }
      if (!Number.isFinite(timelineSec) || timelineSec < 0) continue;
      param.setValueAtTime(Number(kf.value), timelineSec);
    }
  }
  cleanupAudio() {
    this.audio?.pause();
    this.audio = null;
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
    }
  }
};

// examples/01-basic-text.ts
function createProject() {
  const $ = new VideoFlow({
    name: "Basic Text",
    width: 1920,
    height: 1080,
    fps: 30
  });
  const title = $.addText({
    text: "Hello, VideoFlow!",
    fontSize: 2.5,
    fontWeight: 800,
    color: "#ffffff"
  });
  title.animate(
    { opacity: 0, scale: 0.8 },
    { opacity: 1, scale: 1 },
    { duration: "1.5s" }
  );
  $.wait("2s");
  title.animate(
    { opacity: 1 },
    { opacity: 0 },
    { duration: "1s" }
  );
  $.wait("500ms");
  return $;
}
if (typeof window === "undefined") {
  await createProject().renderVideo({
    outputType: "file",
    output: "./01-basic-text.mp4",
    verbose: true
  });
  console.log("Done \u2192 01-basic-text.mp4");
}

// examples/02-image-background.ts
function createProject2() {
  const $ = new VideoFlow({
    name: "Image Background",
    width: 1920,
    height: 1080,
    fps: 30
  });
  const bg = $.addImage(
    { fit: "cover" },
    { source: "sample.jpg" }
  );
  bg.animate(
    { filterBlur: 0 },
    { filterBlur: 8 },
    { duration: "4s", wait: false }
  );
  $.wait("500ms");
  const title = $.addText({
    text: "Beautiful Scenery",
    fontSize: 2.3,
    fontWeight: 700,
    color: "#ffffff",
    textShadowColor: "rgba(0,0,0,0.5)",
    textShadowBlur: 10
  });
  title.fadeIn("1s");
  $.wait("3s");
  title.fadeOut("1s");
  $.wait("500ms");
  return $;
}
if (typeof window === "undefined") {
  await createProject2().renderVideo({
    outputType: "file",
    output: "./02-image-background.mp4",
    verbose: true
  });
  console.log("Done \u2192 examples/02-image-background.mp4");
}

// examples/03-video-with-audio.ts
function createProject3() {
  const $ = new VideoFlow({
    name: "Video with Audio",
    width: 1920,
    height: 1080,
    fps: 30
  });
  const music = $.addAudio(
    { volume: 0 },
    { source: "sample.mp3" }
  );
  music.animate(
    { volume: 0 },
    { volume: 0.6 },
    { duration: "2s" }
  );
  $.wait("1s");
  music.animate(
    { volume: 0.6 },
    { volume: 0.2 },
    { duration: "500ms" }
  );
  const video = $.addVideo(
    { fit: "cover", volume: 1 },
    {
      source: "sample.mp4"
    },
    { waitFor: "finish" }
  );
  music.animate(
    { volume: 0.2 },
    { volume: 0.6 },
    { duration: "1s" }
  );
  $.wait("2s");
  music.animate(
    { volume: 0.6 },
    { volume: 0 },
    { duration: "2s" }
  );
  $.wait("500ms");
  return $;
}
if (typeof window === "undefined") {
  await createProject3().renderVideo({
    outputType: "file",
    output: "./03-video-with-audio.mp4",
    verbose: true
  });
  console.log("Done \u2192 examples/03-video-with-audio.mp4");
}

// examples/04-captions.ts
function createProject4() {
  const $ = new VideoFlow({
    name: "Captions Demo",
    width: 1920,
    height: 1080,
    fps: 30,
    backgroundColor: "#1a1a2e"
  });
  const captions = $.addCaptions(
    {
      fontSize: 2,
      fontWeight: 600,
      color: "#ffffff",
      position: [0.5, 0.85],
      textAlign: "center"
    },
    {
      captions: [
        { caption: "Welcome to VideoFlow.", startTime: 0, endTime: 2.5 },
        { caption: "Build videos from code.", startTime: 2.5, endTime: 5 },
        { caption: "No editor required.", startTime: 5, endTime: 7.5 },
        { caption: "Just write TypeScript.", startTime: 7.5, endTime: 10 }
      ],
      maxCharsPerLine: 40,
      maxLines: 2,
      sourceDuration: "10s"
    }
  );
  $.wait("10s");
  return $;
}
if (typeof window === "undefined") {
  await createProject4().renderVideo({
    outputType: "file",
    output: "./04-captions.mp4",
    verbose: true
  });
  console.log("Done \u2192 examples/04-captions.mp4");
}

// examples/05-parallel-animations.ts
function createProject5() {
  const $ = new VideoFlow({
    name: "Parallel Animations",
    width: 1920,
    height: 1080,
    fps: 30,
    backgroundColor: "#0f0f23"
  });
  const line1 = $.addText({
    text: "Design.",
    fontSize: 3,
    fontWeight: 800,
    color: "#ff6b6b",
    position: [0.5, 0.3],
    opacity: 0
  });
  const line2 = $.addText({
    text: "Animate.",
    fontSize: 3,
    fontWeight: 800,
    color: "#4ecdc4",
    position: [0.5, 0.5],
    opacity: 0
  });
  const line3 = $.addText({
    text: "Render.",
    fontSize: 3,
    fontWeight: 800,
    color: "#45b7d1",
    position: [0.5, 0.7],
    opacity: 0
  });
  $.parallel([
    () => {
      line1.animate(
        { opacity: 0, position: [0.3, 0.3] },
        { opacity: 1, position: [0.5, 0.3] },
        { duration: "800ms", easing: "easeOut" }
      );
    },
    () => {
      $.wait("200ms");
      line2.animate(
        { opacity: 0, position: [0.3, 0.5] },
        { opacity: 1, position: [0.5, 0.5] },
        { duration: "800ms", easing: "easeOut" }
      );
    },
    () => {
      $.wait("400ms");
      line3.animate(
        { opacity: 0, position: [0.3, 0.7] },
        { opacity: 1, position: [0.5, 0.7] },
        { duration: "800ms", easing: "easeOut" }
      );
    }
  ]);
  $.wait("3s");
  $.parallel([
    () => {
      line1.fadeOut("500ms");
    },
    () => {
      line2.fadeOut("500ms");
    },
    () => {
      line3.fadeOut("500ms");
    }
  ]);
  $.wait("500ms");
  return $;
}
if (typeof window === "undefined") {
  await createProject5().renderVideo({
    outputType: "file",
    output: "./05-parallel-animations.mp4",
    verbose: true
  });
  console.log("Done \u2192 examples/05-parallel-animations.mp4");
}

// examples/web-player/player.ts
var EXAMPLES = {
  "01 \u2014 Basic Text": createProject,
  "02 \u2014 Image Background": createProject2,
  "03 \u2014 Video with Audio": createProject3,
  "04 \u2014 Captions": createProject4,
  "05 \u2014 Parallel Animations": createProject5
};
var $status = document.getElementById("status");
var $player = document.getElementById("player");
var $btnPlay = document.getElementById("btn-play");
var $btnStop = document.getElementById("btn-stop");
var $seek = document.getElementById("seek");
var $time = document.getElementById("time");
var $fps = document.getElementById("fps-display");
var $select = document.getElementById("example-select");
var $btnDownload = document.getElementById("btn-download");
var $exportModal = document.getElementById("export-modal");
var $exportTitle = document.getElementById("export-title");
var $exportProgressBar = document.getElementById("export-progress-bar");
var $exportProgressText = document.getElementById("export-progress-text");
var $exportCancel = document.getElementById("export-cancel");
var renderer = null;
var currentVideoJSON = null;
async function loadExample(name) {
  const factory = EXAMPLES[name];
  if (!factory) return;
  if (renderer) {
    renderer.stop();
    renderer.destroy();
  }
  $btnPlay.textContent = "Play";
  $btnPlay.classList.remove("active");
  $fps.textContent = "";
  try {
    $status.textContent = "Compiling...";
    const $ = factory();
    const videoJSON = await $.compile();
    console.log("Compiled VideoJSON:", videoJSON);
    currentVideoJSON = videoJSON;
    $status.textContent = "Loading...";
    renderer = new DomRenderer($player);
    renderer.onFrame = () => {
      if (!seeking) {
        $seek.value = String(renderer.currentFrame);
        updateTimeDisplay();
      }
    };
    await renderer.loadVideo(videoJSON);
    $seek.max = String(renderer.totalFrames - 1);
    $seek.value = "0";
    updateTimeDisplay();
    $status.textContent = "Ready";
  } catch (e) {
    console.error(e);
    $status.textContent = `Error: ${e}`;
  }
}
var seeking = false;
$btnPlay.addEventListener("click", togglePlayback);
async function togglePlayback() {
  if (!renderer) return;
  if (renderer.playing) {
    renderer.stop();
    $btnPlay.textContent = "Play";
    $btnPlay.classList.remove("active");
  } else {
    $btnPlay.textContent = "Pause";
    $btnPlay.classList.add("active");
    await renderer.play({
      fpsCallback: (fps) => {
        $fps.textContent = `${Math.min(60, Math.round(fps))} fps`;
      }
    });
    $btnPlay.textContent = "Play";
    $btnPlay.classList.remove("active");
  }
}
$btnStop.addEventListener("click", () => {
  if (!renderer) return;
  renderer.stop();
  $btnPlay.textContent = "Play";
  $btnPlay.classList.remove("active");
  renderer.renderFrame(0);
  $seek.value = "0";
  updateTimeDisplay();
  $fps.textContent = "";
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    togglePlayback();
  }
});
var wasPlayingBeforeSeek = false;
$seek.addEventListener("pointerdown", () => {
  if (!renderer) return;
  seeking = true;
  wasPlayingBeforeSeek = renderer.playing;
  if (wasPlayingBeforeSeek) renderer.stop();
});
$seek.addEventListener("input", () => {
  if (!renderer) return;
  seeking = true;
  renderer.renderFrame(parseInt($seek.value, 10));
  updateTimeDisplay();
});
$seek.addEventListener("change", () => {
  seeking = false;
  if (wasPlayingBeforeSeek && renderer && !renderer.playing) {
    wasPlayingBeforeSeek = false;
    renderer.play({
      fpsCallback: (fps) => {
        $fps.textContent = `${Math.min(60, Math.round(fps))} fps`;
      }
    });
  }
});
$select.addEventListener("change", () => {
  loadExample($select.value);
});
var exportAbortController = null;
$btnDownload.addEventListener("click", startExport);
$exportCancel.addEventListener("click", cancelExport);
$exportModal.addEventListener("click", (e) => {
  if (e.target === $exportModal) cancelExport();
});
async function startExport() {
  if (!currentVideoJSON) return;
  if (renderer?.playing) {
    renderer.stop();
    $btnPlay.textContent = "Play";
    $btnPlay.classList.remove("active");
  }
  exportAbortController = new AbortController();
  $exportModal.hidden = false;
  $exportTitle.textContent = "Exporting video\u2026";
  $exportProgressBar.style.width = "0%";
  $exportProgressText.textContent = "0%";
  $exportCancel.textContent = "Cancel";
  try {
    const blob = await BrowserRenderer.render(currentVideoJSON, {
      signal: exportAbortController.signal,
      onProgress: (progress) => {
        const pct = Math.round(progress * 100);
        $exportProgressBar.style.width = `${pct}%`;
        $exportProgressText.textContent = `${pct}%`;
      }
    });
    const url2 = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url2;
    a.download = `${$select.value.replace(/[^a-zA-Z0-9-_ ]/g, "")}.mp4`;
    a.click();
    URL.revokeObjectURL(url2);
    $exportTitle.textContent = "Export complete!";
    $exportProgressBar.style.width = "100%";
    $exportProgressText.textContent = "100%";
    $exportCancel.textContent = "Close";
  } catch (err) {
    if (err.name === "AbortError" || exportAbortController.signal.aborted) {
      return;
    }
    $exportTitle.textContent = "Export failed";
    $exportProgressText.textContent = String(err.message || err);
    $exportCancel.textContent = "Close";
    console.error("Export error:", err);
  }
}
function cancelExport() {
  if (exportAbortController) {
    exportAbortController.abort();
    exportAbortController = null;
  }
  $exportModal.hidden = true;
}
function updateTimeDisplay() {
  if (!renderer) return;
  const current = formatTime2(renderer.currentTime);
  const total = formatTime2(renderer.duration);
  $time.textContent = `${current} / ${total}`;
}
function formatTime2(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
for (const name of Object.keys(EXAMPLES)) {
  const opt = document.createElement("option");
  opt.value = name;
  opt.textContent = name;
  $select.appendChild(opt);
}
loadExample(Object.keys(EXAMPLES)[0]);
/*! Bundled license information:

mediabunny/dist/modules/src/misc.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/metadata.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/shared/bitstream.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/shared/aac-misc.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/codec.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/shared/ac3-misc.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/codec-data.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/custom-coder.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/packet.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/pcm.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/sample.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/isobmff/isobmff-misc.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/isobmff/isobmff-reader.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/adts/adts-reader.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/reader.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/muxer.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/subtitles.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/isobmff/isobmff-boxes.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/writer.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/target.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/isobmff/isobmff-muxer.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/output-format.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/encode.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/media-source.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/output.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)

mediabunny/dist/modules/src/index.js:
  (*!
   * Copyright (c) 2026-present, Vanilagy and contributors
   *
   * This Source Code Form is subject to the terms of the Mozilla Public
   * License, v. 2.0. If a copy of the MPL was not distributed with this
   * file, You can obtain one at https://mozilla.org/MPL/2.0/.
   *)
*/
//# sourceMappingURL=player.js.map
