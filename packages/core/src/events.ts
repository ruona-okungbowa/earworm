import type { Ms } from "./types.js";

export type EventSourceName = "mic" | "tap" | "replay" | (string & {});

export interface BaseEvent {
  type: string;
  timestamp: Ms;
  source: EventSourceName;
}

export interface OnsetEvent extends BaseEvent {
  type: "onset";
  strength: number;
}

export interface PitchEvent extends BaseEvent {
  type: "pitch";
  frequency: number;
  midi: number;
  cents: number;
  confidence: number;
}

export interface LevelEvent extends BaseEvent {
  type: "level";
  level: number;
}

export interface ReleaseEvent extends BaseEvent {
  type: "release";
}

export interface EnvelopeEvent extends BaseEvent {
  type: "envelope";
  level: number;
}

export interface SoundStartEvent extends BaseEvent {
  type: "sound-start";
  startTime: Ms;
  level: number;
}

export interface SoundEndEvent extends BaseEvent {
  type: "sound-end";
  endTime: Ms;
  duration: number;
}

export interface SpectrumEvent extends BaseEvent {
  type: "spectrum";
  sampleRate: number;
  fftSize: number;
  magnitudes: Float32Array;
}

export interface BandEvent extends BaseEvent {
  type: "band";
  unit: "dbfs" | "normalised";
  values: Record<string, number>;
}

export interface CustomEvent extends BaseEvent {
  type: `x-${string}`;
  data: Record<string, unknown>;
}

export type EarwormEvent =
  | OnsetEvent
  | PitchEvent
  | LevelEvent
  | ReleaseEvent
  | EnvelopeEvent
  | SoundStartEvent
  | SoundEndEvent
  | SpectrumEvent
  | BandEvent
  | CustomEvent;

export type Unsubscribe = () => void;

export interface EventSource {
  subscribe(listener: (e: EarwormEvent) => void): Unsubscribe;
}

export interface Frame {
  samples: Float32Array;
  timestamp: Ms;
  sampleRate: number;
}

export interface Detector {
  readonly name: string;
  process(frame: Frame): EarwormEvent[];
  reset(): void;
  flush?(): EarwormEvent[];
  /** Onset, Pitch, Sound */
  setNoiseFloor?(db: number): void;
}

export interface Band {
  name: string;
  lowHz: number;
  highHz: number;
}

export interface Recording {
  version: 1;
  events: EarwormEvent[];
}
