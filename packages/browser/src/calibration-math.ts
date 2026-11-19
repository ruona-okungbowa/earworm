import { err, ok } from "@earworm/core";
import type { LevelEvent, Ms, Result } from "@earworm/core";

/** Length of the sliding window used for the short-term level. */
export const SHORT_TERM_WINDOW_MS = 100;

/** Latency must lie in this range, inclusive (Req 6.11). */
export const MIN_LATENCY_MS = 0;
export const MAX_LATENCY_MS = 500;

/** Fewest matched clicks that still give a Latency (Req 6.10). */
export const MIN_MATCHED_CLICKS = 3;

/**
 * Highest short-term level, in dBFS, of the Level_Events.
 *
 * The short-term level is the power-average of the Level_Events inside a
 * sliding 100 ms window `[t, t + 100)`, with one window starting at each
 * Event. Returns `calibration-failed` with no usable Events and
 * `room-too-loud` when the floor exceeds `maxQuietLevel`.
 */
export function noiseFloorFromLevels(
  levelEvents: readonly Pick<LevelEvent, "timestamp" | "level">[],
  maxQuietLevel: number,
): Result<number> {
  const usable = levelEvents
    .filter(
      (e) =>
        Number.isFinite(e.timestamp) &&
        !Number.isNaN(e.level) &&
        e.level < Infinity,
    )
    .map((e) => ({ t: e.timestamp, power: Math.pow(10, e.level / 10) }))
    .sort((a, b) => a.t - b.t);

  if (usable.length === 0) {
    return err(
      "calibration-failed",
      "No level events were observed during the quiet period",
    );
  }

  let best = 0;
  // Recompute each window from scratch to keep the arithmetic exact.
  for (let i = 0; i < usable.length; i++) {
    const start = usable[i]!.t;
    // Events sharing a timestamp share one window [t, t + 100), which the
    // first of them already covered. Skipping keeps the result order-independent.
    if (i > 0 && usable[i - 1]!.t === start) continue;
    let sum = 0;
    let count = 0;
    for (
      let j = i;
      j < usable.length && usable[j]!.t < start + SHORT_TERM_WINDOW_MS;
      j++
    ) {
      sum += usable[j]!.power;
      count++;
    }
    const avg = sum / count;
    if (avg > best) best = avg;
  }

  const floorDb = best > 0 ? 10 * Math.log10(best) : -Infinity;
  if (floorDb > maxQuietLevel) {
    return err(
      "room-too-loud",
      `Room is too loud: ${floorDb.toFixed(1)} dBFS exceeds ${maxQuietLevel} dBFS`,
    );
  }
  return ok(floorDb);
}

/**
 * Median of `detected − scheduled` over matched clicks.
 *
 * Each detected click is matched to the scheduled click nearest to it, each
 * click used at most once, and only when the distance is at most
 * `maxMatchMs`. Pairs are taken in order of smallest distance first.
 * Returns `calibration-failed` with fewer than 3 matches or a median outside
 * 0 to 500 ms inclusive.
 */
export function medianLatency(
  scheduled: readonly Ms[],
  detected: readonly Ms[],
  maxMatchMs: Ms,
): Result<number> {
  const pairs: { s: number; d: number; dist: number }[] = [];
  for (let s = 0; s < scheduled.length; s++) {
    for (let d = 0; d < detected.length; d++) {
      const dist = Math.abs(detected[d]! - scheduled[s]!);
      if (Number.isFinite(dist) && dist <= maxMatchMs)
        pairs.push({ s, d, dist });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist || a.s - b.s || a.d - b.d);

  const usedS = new Set<number>();
  const usedD = new Set<number>();
  const diffs: number[] = [];
  for (const p of pairs) {
    if (usedS.has(p.s) || usedD.has(p.d)) continue;
    usedS.add(p.s);
    usedD.add(p.d);
    diffs.push(detected[p.d]! - scheduled[p.s]!);
  }

  if (diffs.length < MIN_MATCHED_CLICKS) {
    return err(
      "calibration-failed",
      `Only ${diffs.length} of ${scheduled.length} clicks were matched; at least ${MIN_MATCHED_CLICKS} are needed`,
    );
  }

  diffs.sort((a, b) => a - b);
  const mid = diffs.length >> 1;
  const median =
    diffs.length % 2 === 1 ? diffs[mid]! : (diffs[mid - 1]! + diffs[mid]!) / 2;

  if (median < MIN_LATENCY_MS || median > MAX_LATENCY_MS) {
    return err(
      "calibration-failed",
      `Latency ${median} ms is outside ${MIN_LATENCY_MS} to ${MAX_LATENCY_MS} ms`,
    );
  }
  return ok(median);
}
