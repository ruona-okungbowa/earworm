import { DEFAULTS, resolveConfig } from "./config.js";
import type {
  OnsetEvent,
  PitchEvent,
  ReleaseEvent,
  SoundEndEvent,
  SoundStartEvent,
} from "./events.js";
import { err, ok } from "./types.js";
import type { Ms, Result } from "./types.js";

/** A timed segment: start Timestamp and duration in milliseconds. No class. */
export interface Mark {
  start: Ms;
  duration: number;
}

export type SegmentInput =
  | { kind: "pitch"; events: PitchEvent[]; gatedSpans?: Array<[Ms, Ms]> }
  | { kind: "sound"; events: Array<SoundStartEvent | SoundEndEvent> }
  | { kind: "tap"; events: Array<OnsetEvent | ReleaseEvent> };

export interface SegmentConfig {
  /** Frame duration in ms (frameSize / sampleRate × 1000). Required for `pitch` input. */
  frameInterval?: number | undefined;
  /** Largest gap (after subtracting `frameInterval`) inside one Mark, ms. Default 25. */
  maxGap?: number | undefined;
  /** Shortest Mark kept, ms. Default 30. */
  minDuration?: number | undefined;
  /** Largest distance from the run median, in cents. Default 50. */
  steadiness?: number | undefined;
  /** End a Mark when the pitch jumps by more than `pitchSplitThreshold`. Default false. */
  pitchSplit?: boolean | undefined;
  /** Pitch jump that splits a Mark, in cents. Default 100. */
  pitchSplitThreshold?: number | undefined;
}

const SETTING_SPEC = {
  maxGap: DEFAULTS.segmenter.maxGap,
  minDuration: DEFAULTS.segmenter.minDuration,
  steadiness: DEFAULTS.segmenter.steadiness,
  pitchSplitThreshold: DEFAULTS.segmenter.pitchSplit,
} as const;

function cents(a: number, b: number): number {
  return Math.abs(1200 * Math.log2(a / b));
}

function median(values: number[]): number {
  const sorted = [...values].sort((x, y) => x - y);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function segmentPitch(
  events: PitchEvent[],
  gatedSpans: Array<[Ms, Ms]>,
  cfg: SegmentConfig,
): Result<Mark[]> {
  const frameInterval = cfg.frameInterval;
  if (
    typeof frameInterval !== "number" ||
    !Number.isFinite(frameInterval) ||
    frameInterval <= 0
  ) {
    return err(
      "invalid-config",
      "frameInterval must be a positive finite number",
      {
        setting: "frameInterval",
      },
    );
  }
  const resolved = resolveConfig(SETTING_SPEC, {
    maxGap: cfg.maxGap,
    minDuration: cfg.minDuration,
    steadiness: cfg.steadiness,
    pitchSplitThreshold: cfg.pitchSplitThreshold,
  });
  if (!resolved.ok) return resolved;
  const { maxGap, minDuration, steadiness, pitchSplitThreshold } =
    resolved.value;
  const split = cfg.pitchSplit === true;

  if (!Array.isArray(events)) {
    return err("invalid-config", "events must be an array", {
      setting: "events",
    });
  }
  for (const e of events) {
    if (
      e === null ||
      typeof e !== "object" ||
      typeof e.timestamp !== "number" ||
      !Number.isFinite(e.timestamp)
    ) {
      return err(
        "invalid-timestamp",
        "event timestamp must be a finite number",
      );
    }
    if (
      typeof e.frequency !== "number" ||
      !Number.isFinite(e.frequency) ||
      e.frequency <= 0
    ) {
      return err(
        "invalid-frequency",
        "event frequency must be a positive finite number",
      );
    }
  }
  for (let i = 1; i < events.length; i++) {
    if (
      (events[i] as PitchEvent).timestamp <
      (events[i - 1] as PitchEvent).timestamp
    ) {
      return err(
        "invalid-ordering",
        "events must be in ascending timestamp order",
      );
    }
  }
  const spans: Ms[] = [];
  for (const s of Array.isArray(gatedSpans) ? gatedSpans : []) {
    if (Array.isArray(s) && typeof s[0] === "number" && Number.isFinite(s[0]))
      spans.push(s[0]);
  }

  // Split into runs.
  const runs: PitchEvent[][] = [];
  let run: PitchEvent[] = [];
  for (const e of events) {
    const prev = run[run.length - 1];
    if (prev !== undefined) {
      const gapEnds = e.timestamp - prev.timestamp - frameInterval > maxGap;
      const pitchEnds =
        split && cents(e.frequency, prev.frequency) > pitchSplitThreshold;
      const gateEnds = spans.some(
        (s) => s > prev.timestamp && s <= e.timestamp,
      );
      if (gapEnds || pitchEnds || gateEnds) {
        runs.push(run);
        run = [];
      }
    }
    run.push(e);
  }
  if (run.length > 0) runs.push(run);

  const marks: Mark[] = [];
  for (const r of runs) {
    const med = median(r.map((e) => e.frequency));
    if (r.some((e) => cents(e.frequency, med) > steadiness)) continue;
    const first = r[0] as PitchEvent;
    const last = r[r.length - 1] as PitchEvent;
    const duration = last.timestamp - first.timestamp + frameInterval;
    if (duration < minDuration || !(duration > 0)) continue;
    marks.push({ start: first.timestamp, duration });
  }
  return ok(marks);
}

function resolveMinDuration(cfg: SegmentConfig): Result<number> {
  const resolved = resolveConfig(
    { minDuration: DEFAULTS.segmenter.minDuration },
    { minDuration: cfg.minDuration },
  );
  return resolved.ok ? ok(resolved.value.minDuration) : resolved;
}

function checkAscending(events: Array<{ timestamp: Ms }>): Result<void> {
  if (!Array.isArray(events)) {
    return err("invalid-config", "events must be an array", {
      setting: "events",
    });
  }
  for (const e of events) {
    if (
      e === null ||
      typeof e !== "object" ||
      typeof e.timestamp !== "number" ||
      !Number.isFinite(e.timestamp)
    ) {
      return err(
        "invalid-timestamp",
        "event timestamp must be a finite number",
      );
    }
  }
  for (let i = 1; i < events.length; i++) {
    if (
      (events[i] as { timestamp: Ms }).timestamp <
      (events[i - 1] as { timestamp: Ms }).timestamp
    ) {
      return err(
        "invalid-ordering",
        "events must be in ascending timestamp order",
      );
    }
  }
  return ok(undefined);
}

/**
 * Pair each sound-start with the next sound-end. An end with no open start is
 * discarded; a start with no end gives no Mark. A second start while one is
 * open replaces it (the earlier start never got an end).
 */
function segmentSound(
  events: Array<SoundStartEvent | SoundEndEvent>,
  cfg: SegmentConfig,
): Result<Mark[]> {
  const min = resolveMinDuration(cfg);
  if (!min.ok) return min;
  const ordered = checkAscending(events);
  if (!ordered.ok) return ordered;

  const marks: Mark[] = [];
  let open: SoundStartEvent | undefined;
  for (const e of events) {
    if (e.type === "sound-start") {
      if (typeof e.startTime !== "number" || !Number.isFinite(e.startTime)) {
        return err("invalid-timestamp", "startTime must be a finite number");
      }
      open = e;
    } else if (e.type === "sound-end") {
      if (typeof e.endTime !== "number" || !Number.isFinite(e.endTime)) {
        return err("invalid-timestamp", "endTime must be a finite number");
      }
      if (open === undefined) continue;
      if (e.endTime < open.startTime) {
        return err(
          "invalid-ordering",
          "endTime must not precede its startTime",
        );
      }
      const duration = e.duration;
      if (typeof duration !== "number" || !Number.isFinite(duration)) {
        return err("invalid-duration", "duration must be a finite number");
      }
      if (duration >= min.value && duration > 0)
        marks.push({ start: open.startTime, duration });
      open = undefined;
    }
  }
  return ok(marks);
}

/**
 * Pair a `source: "tap"` Onset with the next Release. Onsets from other
 * sources are ignored. A repeated press while one is open is ignored.
 */
function segmentTap(
  events: Array<OnsetEvent | ReleaseEvent>,
  cfg: SegmentConfig,
): Result<Mark[]> {
  const min = resolveMinDuration(cfg);
  if (!min.ok) return min;
  const ordered = checkAscending(events);
  if (!ordered.ok) return ordered;

  const marks: Mark[] = [];
  let press: Ms | undefined;
  for (const e of events) {
    if (e.type === "onset") {
      if (e.source === "tap" && press === undefined) press = e.timestamp;
    } else if (e.type === "release") {
      if (press === undefined) continue;
      const duration = e.timestamp - press;
      if (duration >= min.value && duration > 0)
        marks.push({ start: press, duration });
      press = undefined;
    }
  }
  return ok(marks);
}

/**
 * Turn Events into timed Marks. Pure; never throws.
 */
export function segment(
  input: SegmentInput,
  cfg?: SegmentConfig,
): Result<Mark[]> {
  if (input === null || typeof input !== "object") {
    return err("invalid-config", "input must be an object", {
      setting: "input",
    });
  }
  const config: SegmentConfig =
    cfg !== null && typeof cfg === "object" ? cfg : {};
  switch (input.kind) {
    case "pitch":
      return segmentPitch(input.events, input.gatedSpans ?? [], config);
    case "sound":
      return segmentSound(input.events, config);
    case "tap":
      return segmentTap(input.events, config);
    default:
      return err("invalid-config", "unknown input kind", { setting: "kind" });
  }
}
