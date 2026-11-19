import type { Ms, Pattern } from "@earworm/core";
import { KNOCK_DURATION_MS } from "./constants.js";

export interface PlayPlan {
  readonly hits: readonly Ms[]; // absolute start Timestamps of each knock
  readonly endMs: Ms; // last hit + KNOCK_DURATION_MS
}

/** Shifts the pattern to start at firstAtMs; every interval is preserved exactly. */
export function planPlayback(pattern: Pattern, firstAtMs: Ms): PlayPlan {
  const first = pattern[0];
  if (first === undefined) return { hits: [], endMs: firstAtMs };
  const hits = pattern.map((t) => firstAtMs + (t - first));
  return { hits, endMs: (hits[hits.length - 1] ?? firstAtMs) + KNOCK_DURATION_MS };
}
