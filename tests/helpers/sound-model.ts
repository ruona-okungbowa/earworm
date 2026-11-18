/*
 * Reference model of the Sound_Detector state machine (Requirement 18). It is written from
 * the acceptance criteria, not from the detector source. Time is always a parameter.
 */

export interface SoundModelConfig {
  startThreshold: number;
  endThreshold: number;
  minHold: number;
  hangover: number;
  noiseFloor: number;
}

export type ModelEvent =
  | { type: "sound-start"; timestamp: number; startTime: number; level: number }
  | {
      type: "sound-end";
      timestamp: number;
      endTime: number;
      duration: number;
    };

export interface ModelFrame {
  samples: ArrayLike<number>;
  timestamp: number;
}

export interface SoundModel {
  process(frame: ModelFrame): ModelEvent[];
  flush(): ModelEvent[];
  reset(): void;
  /** "idle", "pending" (run above the start threshold) or "open". */
  state(): "idle" | "pending" | "open";
}

function levelDb(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  if (sum === 0) return -120;
  return Math.max(-120, 20 * Math.log10(Math.sqrt(sum / samples.length)));
}

function isValid(frame: ModelFrame, previous: number | null): boolean {
  if (frame.samples.length === 0) return false;
  if (!Number.isFinite(frame.timestamp)) return false;
  if (previous !== null && frame.timestamp < previous) return false;
  for (let i = 0; i < frame.samples.length; i++) {
    if (!Number.isFinite(frame.samples[i])) return false;
  }
  return true;
}

export function createSoundModel(cfg: SoundModelConfig): SoundModel {
  let previous: number | null = null; // Timestamp of the last valid Frame
  let runStart: number | null = null; // first Frame above the start threshold, before the sound opens
  let openStart: number | null = null; // startTime of the open sound
  let belowStart: number | null = null; // first Frame of the current run below the end threshold

  const clearAll = (): void => {
    runStart = null;
    openStart = null;
    belowStart = null;
  };

  return {
    process(frame) {
      if (!isValid(frame, previous)) return [];
      previous = frame.timestamp;
      const ts = frame.timestamp;
      const level = levelDb(frame.samples);
      const aboveStart = level > cfg.noiseFloor + cfg.startThreshold;
      const belowEnd = level < cfg.noiseFloor + cfg.endThreshold;
      const out: ModelEvent[] = [];

      if (openStart === null) {
        if (!aboveStart) {
          runStart = null; // 18.7: a short run reports nothing
          return out;
        }
        runStart ??= ts;
        if (ts - runStart >= cfg.minHold) {
          out.push({
            type: "sound-start",
            timestamp: ts,
            startTime: runStart,
            level,
          });
          openStart = runStart;
          runStart = null;
          belowStart = null;
        }
        return out;
      }

      // Open: only a run below the end threshold can close it (18.5, 18.6).
      if (!belowEnd) {
        belowStart = null;
        return out;
      }
      belowStart ??= ts;
      if (ts - belowStart >= cfg.hangover) {
        out.push({
          type: "sound-end",
          timestamp: ts,
          endTime: belowStart,
          duration: belowStart - openStart,
        });
        clearAll();
      }
      return out;
    },
    flush() {
      if (openStart === null || previous === null) return [];
      const ev: ModelEvent = {
        type: "sound-end",
        timestamp: previous,
        endTime: previous,
        duration: previous - openStart,
      };
      clearAll();
      return [ev];
    },
    reset() {
      clearAll();
      previous = null;
    },
    state() {
      if (openStart !== null) return "open";
      return runStart !== null ? "pending" : "idle";
    },
  };
}
