import { DEFAULTS, resolveConfig } from "../config.js";
import type { PartialConfig, Resolved } from "../config.js";
import { createFrameGuard, frameLevelDb } from "../detector-utils.js";
import type { Detector, EarwormEvent, Frame } from "../events.js";
import { err, ok } from "../types.js";
import type { Ms, Result } from "../types.js";

export type SoundDetectorConfig = PartialConfig<typeof DEFAULTS.sound>;

export interface SoundDetector extends Detector {
  /** Applies the given settings. On error nothing changes. */
  configure(partial: SoundDetectorConfig): Result<void>;
  /** Sets the Noise_Floor in dBFS. On a non-finite value nothing changes. */
  setNoiseFloor(db: number): Result<void>;
}

type SoundSettings = Resolved<typeof DEFAULTS.sound>;

/** Drops `undefined` values so they do not override current settings; keeps unknown keys for validation. */
function definedOnly(partial: SoundDetectorConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** Resolves ranges, then checks that the end threshold is below the start threshold. */
function resolveSound(partial?: SoundDetectorConfig): Result<SoundSettings> {
  const resolved = resolveConfig(DEFAULTS.sound, partial);
  if (!resolved.ok) return resolved;
  if (resolved.value.endThreshold >= resolved.value.startThreshold) {
    return err(
      "invalid-config",
      "Setting \"endThreshold\" must be lower than \"startThreshold\"",
      { setting: "endThreshold" },
    );
  }
  return resolved;
}

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "pending"; readonly t0: Ms }
  | {
      readonly kind: "open";
      readonly startTime: Ms;
      readonly belowSince: Ms | null;
    };

/**
 * Reports sounds as sound-start / sound-end pairs using the Frame level
 * against the Noise_Floor plus a start and an end threshold. A sound starts
 * once the level has stayed above the start threshold for `minHold`, and ends
 * once it has stayed below the end threshold for `hangover`.
 */
export function createSoundDetector(
  config?: SoundDetectorConfig,
): Result<SoundDetector> {
  const resolved = resolveSound(config);
  if (!resolved.ok) return resolved;

  const guard = createFrameGuard();
  let settings: SoundSettings = resolved.value;
  let noiseFloor: number = DEFAULTS.noiseFloorDb;

  let state: State = { kind: "idle" };
  let lastTs: Ms | null = null;

  const detector: SoundDetector = {
    name: "sound",
    process(frame: Frame): EarwormEvent[] {
      if (!guard.accept(frame)) return [];
      const ts = frame.timestamp;
      lastTs = ts;
      const level = frameLevelDb(frame.samples);
      const startAt = noiseFloor + settings.startThreshold;
      const endAt = noiseFloor + settings.endThreshold;
      const events: EarwormEvent[] = [];

      if (state.kind === "idle") {
        if (level > startAt) state = { kind: "pending", t0: ts };
      } else if (state.kind === "pending") {
        if (level <= startAt) state = { kind: "idle" };
      } else if (level < endAt) {
        if (state.belowSince === null) {
          state = { kind: "open", startTime: state.startTime, belowSince: ts };
        }
      } else if (state.belowSince !== null) {
        state = { kind: "open", startTime: state.startTime, belowSince: null };
      }

      // A pending run may complete on the Frame that created it (minHold 0).
      if (state.kind === "pending" && ts - state.t0 >= settings.minHold) {
        events.push({
          type: "sound-start",
          timestamp: ts,
          source: "mic",
          startTime: state.t0,
          level,
        });
        state = { kind: "open", startTime: state.t0, belowSince: null };
        // The opening Frame is above the start threshold, so no hangover run begins.
      } else if (
        state.kind === "open" &&
        state.belowSince !== null &&
        ts - state.belowSince >= settings.hangover
      ) {
        events.push({
          type: "sound-end",
          timestamp: ts,
          source: "mic",
          endTime: state.belowSince,
          duration: state.belowSince - state.startTime,
        });
        state = { kind: "idle" };
      }
      return events;
    },
    reset(): void {
      guard.reset();
      state = { kind: "idle" };
      lastTs = null;
    },
    flush(): EarwormEvent[] {
      if (state.kind !== "open" || lastTs === null) return [];
      const events: EarwormEvent[] = [
        {
          type: "sound-end",
          timestamp: lastTs,
          source: "mic",
          endTime: lastTs,
          duration: lastTs - state.startTime,
        },
      ];
      state = { kind: "idle" };
      return events;
    },
    configure(partial: SoundDetectorConfig): Result<void> {
      const next = resolveSound({ ...settings, ...definedOnly(partial) });
      if (!next.ok) return next;
      settings = next.value;
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
