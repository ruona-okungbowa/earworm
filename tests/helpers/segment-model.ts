import type { Mark, PitchEvent } from "@earworm/core";

export interface PitchSegmentModelConfig {
  frameInterval: number;
  maxGap: number;
  minDuration: number;
  steadiness: number;
  pitchSplit: boolean;
  pitchSplitThreshold: number;
}

function centsApart(a: number, b: number): number {
  return Math.abs(1200 * Math.log2(a / b));
}

/** Median by repeated selection: the middle value(s) of the sorted list. */
function medianOf(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 1) return sorted[(n - 1) / 2] as number;
  return ((sorted[n / 2 - 1] as number) + (sorted[n / 2] as number)) / 2;
}

/**
 * Naive reference for pitch segmentation (no gated spans).
 * Marks a run boundary between consecutive events, then keeps runs that are steady and long enough.
 */
export function referencePitchSegments(events: PitchEvent[], cfg: PitchSegmentModelConfig): Mark[] {
  const marks: Mark[] = [];
  let start = 0;
  for (let i = 1; i <= events.length; i++) {
    let boundary = i === events.length;
    if (!boundary) {
      const prev = events[i - 1] as PitchEvent;
      const cur = events[i] as PitchEvent;
      const gap = cur.timestamp - prev.timestamp - cfg.frameInterval;
      boundary = gap > cfg.maxGap;
      if (!boundary && cfg.pitchSplit) {
        boundary = centsApart(cur.frequency, prev.frequency) > cfg.pitchSplitThreshold;
      }
    }
    if (!boundary) continue;
    const run = events.slice(start, i);
    start = i;
    if (run.length === 0) continue;
    const med = medianOf(run.map((e) => e.frequency));
    let steady = true;
    for (const e of run) {
      if (centsApart(e.frequency, med) > cfg.steadiness) steady = false;
    }
    if (!steady) continue;
    const first = run[0] as PitchEvent;
    const last = run[run.length - 1] as PitchEvent;
    const duration = last.timestamp - first.timestamp + cfg.frameInterval;
    if (duration >= cfg.minDuration && duration > 0) marks.push({ start: first.timestamp, duration });
  }
  return marks;
}
