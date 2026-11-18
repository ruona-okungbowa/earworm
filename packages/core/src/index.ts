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
export { createPitchDetector } from "./detectors/pitch.js";
export type { PitchDetector, PitchDetectorConfig } from "./detectors/pitch.js";
export { createSoundDetector } from "./detectors/sound.js";
export type { SoundDetector, SoundDetectorConfig } from "./detectors/sound.js";
export { createBandDetector } from "./detectors/band.js";
export type { BandDetector, BandDetectorConfig } from "./detectors/band.js";
export { createSpectrumDetector } from "./detectors/spectrum.js";
export type {
  SpectrumDetector,
  SpectrumDetectorConfig,
} from "./detectors/spectrum.js";
export {
  fft,
  windowCoefficients,
  SUPPORTED_FFT_SIZES,
  WINDOW_NAMES,
} from "./fft.js";
export type { WindowName } from "./fft.js";
export { spectrum } from "./spectrum.js";
export { bands, BAND_PRESET } from "./bands.js";
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
