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

export type LevelDetectorConfig = PartialConfig<typeof DEFAULTS.level>;

export interface LevelDetector extends Detector {
  /** Applies the given settings. On error nothing changes. */
  configure(partial: LevelDetectorConfig): Result<void>;
}

/** Drops `undefined` values so they do not override current settings; keeps unknown keys for validation. */
function definedOnly(partial: LevelDetectorConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(partial ?? {})) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/**
 * Emits a Level_Event (dBFS, floor -120) per valid Frame, limited to `maxRate`
 * Events per second. The Event Timestamp is the Frame Timestamp.
 */
export function createLevelDetector(
  config?: LevelDetectorConfig,
): Result<LevelDetector> {
  const resolved = resolveConfig(DEFAULTS.level, config);
  if (!resolved.ok) return resolved;

  const guard = createFrameGuard();
  let maxRate = resolved.value.maxRate;
  let gate = createRateGate(maxRate);
  let lastEmitted: Ms | null = null;

  const detector: LevelDetector = {
    name: "level",
    process(frame: Frame): EarwormEvent[] {
      if (!guard.accept(frame)) return [];
      if (!gate.allow(frame.timestamp)) return [];
      lastEmitted = frame.timestamp;
      return [
        {
          type: "level",
          timestamp: frame.timestamp,
          source: "mic",
          level: frameLevelDb(frame.samples),
        },
      ];
    },
    reset(): void {
      guard.reset();
      gate.reset();
      lastEmitted = null;
    },
    flush(): EarwormEvent[] {
      return [];
    },
    configure(partial: LevelDetectorConfig): Result<void> {
      const next = resolveConfig(DEFAULTS.level, {
        maxRate,
        ...definedOnly(partial),
      });
      if (!next.ok) return next;
      maxRate = next.value.maxRate;
      gate = createRateGate(maxRate);
      // Seed the new gate so the last emitted Event still counts.
      if (lastEmitted !== null) gate.allow(lastEmitted);
      return ok(undefined);
    },
  };
  return ok(detector);
}
