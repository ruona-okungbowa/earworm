import { DEFAULTS, resolveConfig } from "../config.js";
import type { PartialConfig } from "../config.js";
import {
  createFrameGuard,
  createRateGate,
  frameLevelDb,
} from "../detector-utils.js";
import type { Detector, EarwormEvent, Frame } from "../events.js";
import { ok } from "../types.js";
import type { Ms, Result } from "../types.js";

export type EnvelopeDetectorConfig = PartialConfig<typeof DEFAULTS.envelope>;

export interface EnvelopeDetector extends Detector {
  /** Applies the given settings. On error nothing changes. */
  configure(partial: EnvelopeDetectorConfig): Result<void>;
}

const FLOOR_DB = -120;
const CEILING_DB = 0;

/** Drops `undefined` values so they do not override current settings; keeps unknown keys for validation. */
function definedOnly(partial: EnvelopeDetectorConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Smooths the Frame level with separate attack and release time constants and
 * emits an Envelope_Event per valid Frame, limited to `maxRate` Events per
 * second. The smoothed level updates on every valid Frame. The Event Timestamp
 * is the Frame Timestamp.
 */
export function createEnvelopeDetector(
  config?: EnvelopeDetectorConfig,
): Result<EnvelopeDetector> {
  const resolved = resolveConfig(DEFAULTS.envelope, config);
  if (!resolved.ok) return resolved;

  const guard = createFrameGuard();
  let attack = resolved.value.attack;
  let release = resolved.value.release;
  let maxRate = resolved.value.maxRate;
  let gate = createRateGate(maxRate);
  let lastEmitted: Ms | null = null;
  let previous: Ms | null = null;
  let smoothed = FLOOR_DB;

  const detector: EnvelopeDetector = {
    name: "envelope",
    process(frame: Frame): EarwormEvent[] {
      if (!guard.accept(frame)) return [];

      const level = frameLevelDb(frame.samples);
      const dt =
        previous === null
          ? (frame.samples.length / frame.sampleRate) * 1000
          : frame.timestamp - previous;
      previous = frame.timestamp;

      const tau = level > smoothed ? attack : release;
      const step = tau === 0 ? 1 : 1 - Math.exp(-dt / tau);
      smoothed += (level - smoothed) * step;
      smoothed = Math.min(CEILING_DB, Math.max(FLOOR_DB, smoothed));

      if (!gate.allow(frame.timestamp)) return [];
      lastEmitted = frame.timestamp;
      return [
        {
          type: "envelope",
          timestamp: frame.timestamp,
          source: "mic",
          level: smoothed,
        },
      ];
    },
    reset(): void {
      guard.reset();
      gate.reset();
      lastEmitted = null;
      previous = null;
      smoothed = FLOOR_DB;
    },
    flush(): EarwormEvent[] {
      return [];
    },
    configure(partial: EnvelopeDetectorConfig): Result<void> {
      const next = resolveConfig(DEFAULTS.envelope, {
        attack,
        release,
        maxRate,
        ...definedOnly(partial),
      });
      if (!next.ok) return next;
      attack = next.value.attack;
      release = next.value.release;
      if (next.value.maxRate !== maxRate) {
        maxRate = next.value.maxRate;
        gate = createRateGate(maxRate);
        // Seed the new gate so the last emitted Event still counts.
        if (lastEmitted !== null) gate.allow(lastEmitted);
      }
      return ok(undefined);
    },
  };
  return ok(detector);
}
