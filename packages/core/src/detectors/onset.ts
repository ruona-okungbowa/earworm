import { DEFAULTS, resolveConfig } from "../config.js";
import type { PartialConfig } from "../config.js";
import { createFrameGuard, frameLevelDb } from "../detector-utils.js";
import type { Detector, EarwormEvent, Frame } from "../events.js";
import { err, ok } from "../types.js";
import type { Ms, Result } from "../types.js";

export type OnsetDetectorConfig = PartialConfig<typeof DEFAULTS.onset>;

export interface OnsetDetector extends Detector {
  /** Applies the given settings. On error nothing changes. */
  configure(partial: OnsetDetectorConfig): Result<void>;
  /** Sets the Noise_Floor in dBFS. On a non-finite value nothing changes. */
  setNoiseFloor(db: number): Result<void>;
}

/** Drops `undefined` values so they do not override current settings; keeps unknown keys for validation. */
function definedOnly(partial: OnsetDetectorConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

interface Entry {
  readonly timestamp: Ms;
  readonly level: number;
}

/**
 * Emits an Onset_Event when the Frame level rises more than `threshold` dB
 * above both the Noise_Floor and the lowest level in the attack window, while
 * armed and outside the refractory period. The Event Timestamp is the Frame
 * Timestamp.
 */
export function createOnsetDetector(
  config?: OnsetDetectorConfig,
): Result<OnsetDetector> {
  const resolved = resolveConfig(DEFAULTS.onset, config);
  if (!resolved.ok) return resolved;

  const guard = createFrameGuard();
  let { threshold, attackWindow, refractory } = resolved.value;
  let noiseFloor: number = DEFAULTS.noiseFloorDb;

  let armed = true;
  let lastOnsetTs: Ms | null = null;
  // Timestamp of the first accepted Frame since construction or reset().
  let firstTs: Ms | null = null;
  // Highest Frame level since the last Onset (used to re-arm in a noisy room).
  let peakSinceOnset = -Infinity;
  // Levels of recent Frames inside the attack window span.
  let recent: Entry[] = [];

  const detector: OnsetDetector = {
    name: "onset",
    process(frame: Frame): EarwormEvent[] {
      if (!guard.accept(frame)) return [];
      const ts = frame.timestamp;
      const level = frameLevelDb(frame.samples);
      const thr = noiseFloor + threshold;

      // Drop entries older than the attack window span.
      let drop = 0;
      while (
        drop < recent.length &&
        (recent[drop] as Entry).timestamp < ts - attackWindow
      ) {
        drop++;
      }
      if (drop > 0) recent = recent.slice(drop);

      // With no earlier Frame in the attack window, the Noise_Floor is the baseline.
      let minLevel = noiseFloor;
      if (recent.length > 0) {
        minLevel = Infinity;
        for (const e of recent) if (e.level < minLevel) minLevel = e.level;
      }

      if (firstTs === null) firstTs = ts;
      // An Onset needs a full attack window of history.
      const hasHistory = ts - firstTs >= attackWindow;

      const events: EarwormEvent[] = [];
      if (!armed) {
        // Re-arm when the level is back near the floor, or has fallen
        // `threshold` dB below the peak since the last Onset.
        if (level > peakSinceOnset) peakSinceOnset = level;
        if (level <= thr || level <= peakSinceOnset - threshold) armed = true;
      }
      if (level > thr) {
        if (
          armed &&
          hasHistory &&
          level - minLevel > threshold &&
          (lastOnsetTs === null || ts - lastOnsetTs >= refractory)
        ) {
          armed = false;
          lastOnsetTs = ts;
          peakSinceOnset = level;
          events.push({
            type: "onset",
            timestamp: ts,
            source: "mic",
            strength: Math.min(1, (level - noiseFloor) / (threshold + 40)),
          });
        }
      }

      recent.push({ timestamp: ts, level });
      return events;
    },
    reset(): void {
      guard.reset();
      armed = true;
      lastOnsetTs = null;
      firstTs = null;
      peakSinceOnset = -Infinity;
      recent = [];
    },
    flush(): EarwormEvent[] {
      return [];
    },
    configure(partial: OnsetDetectorConfig): Result<void> {
      const next = resolveConfig(DEFAULTS.onset, {
        threshold,
        attackWindow,
        refractory,
        ...definedOnly(partial),
      });
      if (!next.ok) return next;
      ({ threshold, attackWindow, refractory } = next.value);
      return ok(undefined);
    },
    setNoiseFloor(db: number): Result<void> {
      if (typeof db !== "number" || !Number.isFinite(db)) {
        return err("invalid-config", "Noise_Floor must be a finite number", {
          setting: "noiseFloor",
        });
      }
      noiseFloor = db;
      return ok(undefined);
    },
  };
  return ok(detector);
}
