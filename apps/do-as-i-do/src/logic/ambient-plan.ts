import type { Ms } from "@earworm/core";
import {
  AMBIENT_MAX_GAIN,
  AMBIENT_MIN_RAMP_MS,
  AMBIENT_STOP_RAMP_MS,
} from "./constants.js";

export interface Ramp {
  readonly fromMs: Ms;
  readonly toMs: Ms; // toMs - fromMs >= 1000
  readonly fromGain: number;
  readonly toGain: number; // 0 .. 0.15
}
export interface AmbientState {
  readonly gain: number; // value at the end of the last ramp
  readonly ramp: Ramp | null; // in flight or finished
  readonly stopped: boolean;
}

// NaN counts as silence.
const clampGain = (x: number): number =>
  Number.isNaN(x) ? 0 : Math.min(AMBIENT_MAX_GAIN, Math.max(0, x));

export function initialAmbient(startGain: number): AmbientState {
  return { gain: clampGain(startGain), ramp: null, stopped: false };
}

export function gainAt(s: AmbientState, tMs: Ms): number {
  const r = s.ramp;
  if (r === null || tMs >= r.toMs) return s.gain;
  if (tMs <= r.fromMs) return r.fromGain;
  return r.fromGain + ((r.toGain - r.fromGain) * (tMs - r.fromMs)) / (r.toMs - r.fromMs);
}

function startRamp(
  s: AmbientState,
  nowMs: Ms,
  toGain: number,
  durationMs: number,
  stopped: boolean,
): { state: AmbientState; ramp: Ramp } {
  const ramp: Ramp = {
    fromMs: nowMs,
    toMs: nowMs + durationMs,
    fromGain: gainAt(s, nowMs), // continue from where an interrupted ramp is
    toGain,
  };
  return { state: { gain: toGain, ramp, stopped }, ramp };
}

export function onDread(
  s: AmbientState,
  nowMs: Ms,
  targetGain: number,
  rampMs: number,
): { state: AmbientState; ramp: Ramp } {
  // A stopped plan always holds its stop ramp.
  if (s.stopped && s.ramp !== null) return { state: s, ramp: s.ramp };
  const dur = Number.isNaN(rampMs) ? AMBIENT_MIN_RAMP_MS : Math.max(AMBIENT_MIN_RAMP_MS, rampMs);
  return startRamp(s, nowMs, clampGain(targetGain), dur, false);
}

export function onStop(
  s: AmbientState,
  nowMs: Ms,
): { state: AmbientState; ramp: Ramp } {
  if (s.stopped && s.ramp !== null) return { state: s, ramp: s.ramp };
  return startRamp(s, nowMs, 0, AMBIENT_STOP_RAMP_MS, true);
}
