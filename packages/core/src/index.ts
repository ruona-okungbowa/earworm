export type { Ms, KitError, KitErrorCode, Result } from "./types.js";
export { ok, err } from "./types.js";
export { secondsToMs, msToSeconds } from "./clock.js";
export {
  frames,
  createFramer,
  frameIntervalMs,
  DEFAULT_FRAME_SIZE,
  SUPPORTED_FRAME_SIZES,
} from "./framing.js";
export type { Framer } from "./framing.js";
export { DEFAULTS, resolveConfig } from "./config.js";
export type {
  ConfigSpec,
  PartialConfig,
  Resolved,
  SettingSpec,
} from "./config.js";
export { frameLevelDb } from "./detector-utils.js";
export { createLevelDetector } from "./detectors/level.js";
export type { LevelDetector, LevelDetectorConfig } from "./detectors/level.js";
export { createEnvelopeDetector } from "./detectors/envelope.js";
export type {
  EnvelopeDetector,
  EnvelopeDetectorConfig,
} from "./detectors/envelope.js";
export { createOnsetDetector } from "./detectors/onset.js";
export type { OnsetDetector, OnsetDetectorConfig } from "./detectors/onset.js";
export { createEmitter } from "./emitter.js";
export type { Emitter, EmitterOptions } from "./emitter.js";
export type {
  Band,
  BandEvent,
  BaseEvent,
  CustomEvent,
  Detector,
  EarwormEvent,
  EnvelopeEvent,
  EventSource,
  EventSourceName,
  Frame,
  LevelEvent,
  OnsetEvent,
  PitchEvent,
  Recording,
  ReleaseEvent,
  SoundEndEvent,
  SoundStartEvent,
  SpectrumEvent,
  Unsubscribe,
} from "./events.js";
