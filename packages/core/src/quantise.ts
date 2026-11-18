import { err, ok } from "./types.js";
import type { Ms, Result } from "./types.js";

/** A beat grid: a start time, a tempo in beats per minute and subdivisions per beat. */
export interface BeatGrid {
  originMs: Ms;
  bpm: number;
  subdivision: number;
}

/**
 * Snap a timestamp to the nearest grid position. A tie goes to the earlier
 * position. Never throws.
 */
export function quantise(
  t: Ms,
  grid: BeatGrid,
): Result<{ time: Ms; index: number }> {
  if (typeof t !== "number" || !Number.isFinite(t)) {
    return err("invalid-timestamp", "timestamp must be a finite number");
  }
  if (grid === null || typeof grid !== "object") {
    return err("invalid-grid", "grid must be an object");
  }
  const { originMs, bpm, subdivision } = grid;
  if (typeof bpm !== "number" || !Number.isFinite(bpm) || bpm <= 0) {
    return err("invalid-grid", "bpm must be a positive finite number");
  }
  if (typeof originMs !== "number" || !Number.isFinite(originMs)) {
    return err("invalid-grid", "originMs must be a finite number");
  }
  if (
    typeof subdivision !== "number" ||
    !Number.isInteger(subdivision) ||
    subdivision <= 0
  ) {
    return err("invalid-grid", "subdivision must be a positive integer");
  }
  const step = 60000 / (bpm * subdivision);
  if (!Number.isFinite(step) || step <= 0) {
    return err("invalid-grid", "grid step is not a positive finite number");
  }
  const x = (t - originMs) / step;
  // `+ 0` turns -0 into 0.
  const index = Math.ceil(x - 0.5) + 0;
  const time = originMs + index * step;
  if (!Number.isFinite(index) || !Number.isFinite(time)) {
    return err("invalid-timestamp", "timestamp is out of range for this grid");
  }
  return ok({ time, index });
}
