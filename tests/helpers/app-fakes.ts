import fc from "fast-check";
import { createReplaySource, intervalsToPattern } from "@earworm/core";
import type {
  EarwormEvent,
  EventSource,
  Ms,
  OnsetEvent,
  Pattern,
  Recording,
} from "@earworm/core";
import type { Gate, ScheduleOptions } from "@earworm/browser";

/* Shared fakes and generators for the app specs. Nothing here reads a clock. */

/** Random_Source in [0, 1). */
export type RandomSource = () => number;

/** Returns `values` in order, then 0.5 forever. `draws()` counts every call. */
export function sequenceRandom(
  values: readonly number[],
): RandomSource & { draws(): number } {
  let n = 0;
  const f = (): number => {
    const v = n < values.length ? values[n] : 0.5;
    n++;
    return v ?? 0.5;
  };
  return Object.assign(f, { draws: () => n });
}

export interface ScheduleCall {
  voice: string;
  atMs: Ms;
  opts: ScheduleOptions;
}

/** Records schedule calls. Like the real Synth, it opens a Gate window of 120 ms unless `ungated`. */
export class FakeSynth {
  readonly calls: ScheduleCall[] = [];
  constructor(private readonly gate: Gate) {}

  schedule(
    voice: string,
    atMs: Ms,
    opts: ScheduleOptions = {},
  ): Promise<{ startMs: Ms; endMs: Ms }> {
    this.calls.push({ voice, atMs, opts });
    const endMs = atMs + 120;
    if (!opts.ungated) this.gate.addWindow(atMs, endMs);
    return Promise.resolve({ startMs: atMs, endMs });
  }

  /** Gain of every call, in call order. Missing gain is the Synth default, 1. */
  gains(): number[] {
    return this.calls.map((c) => c.opts.gain ?? 1);
  }

  registerVoice(): void {}
  stop(): void {}
}

/** Onset Events at each hit of `pattern` plus `offsetMs`. */
export function onsetsAt(
  pattern: Pattern,
  offsetMs = 0,
  source: "mic" | "tap" = "mic",
): OnsetEvent[] {
  return pattern.map((t) => ({
    type: "onset" as const,
    timestamp: t + offsetMs,
    source,
    strength: 1,
  }));
}

/** Recording of a pattern given as inter-hit intervals. */
export function recordingFromIntervals(
  intervals: readonly number[],
  offsetMs = 0,
  source: "mic" | "tap" = "mic",
): Recording {
  return {
    version: 1,
    events: onsetsAt(intervalsToPattern(intervals), offsetMs, source),
  };
}

export function replayFromEvents(
  events: EarwormEvent[],
): EventSource & { advance(nowMs: Ms): void } {
  return createReplaySource({ version: 1, events });
}

/** Pattern from 2 to 7 intervals of 100 to 1500 ms, total 1,500 to 6,000 ms (3 to 8 hits). */
export const intervalsArb: fc.Arbitrary<number[]> = fc
  .array(fc.integer({ min: 100, max: 1500 }), { minLength: 2, maxLength: 7 })
  .filter((a) => {
    const s = a.reduce((x, y) => x + y, 0);
    return s >= 1500 && s <= 6000;
  });

export const knockPatternArb: fc.Arbitrary<Pattern> =
  intervalsArb.map(intervalsToPattern);

/** Values in [0, 1) for `sequenceRandom`. */
export const randomValuesArb: fc.Arbitrary<number[]> = fc.array(
  fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }),
);

export interface OnsetLike {
  timestamp: Ms;
  source: string;
}

/** Onset stream sorted by Timestamp, source from mic, tap, replay. */
export const onsetStreamArb: fc.Arbitrary<OnsetLike[]> = fc
  .array(
    fc.record({
      timestamp: fc.integer({ min: 0, max: 120_000 }),
      source: fc.constantFrom("mic", "tap", "replay"),
    }),
    { maxLength: 30 },
  )
  .map((a) => a.sort((x, y) => x.timestamp - y.timestamp));
