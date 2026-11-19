import type { Ms, Pattern } from "@earworm/core";
import { planPlayback, type PlayPlan } from "../playback.js";

export interface HoldPlan {
  readonly plays: readonly PlayPlan[]; // in story order
  readonly silenceStartMs: Ms; // last knock of the last plan + KNOCK_DURATION_MS
}

/** G7: the first Pattern starts patternGapMs after the introduction ends; later gaps run from the previous end. */
export function planHold(
  patterns: readonly Pattern[],
  introEndMs: Ms,
  patternGapMs: number,
): HoldPlan {
  const plays: PlayPlan[] = [];
  let startMs = introEndMs + patternGapMs;
  for (const p of patterns) {
    const plan = planPlayback(p, startMs);
    plays.push(plan);
    startMs = plan.endMs + patternGapMs;
  }
  return {
    plays,
    silenceStartMs: plays[plays.length - 1]?.endMs ?? introEndMs,
  };
}
