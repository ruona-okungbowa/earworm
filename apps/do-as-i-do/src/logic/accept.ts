import type { Ms } from "@earworm/core";
import type { InputMode, OnsetLike } from "./types.js";

export interface Counting {
  readonly fromMs: Ms; // inclusive
  readonly toMs: Ms | null; // exclusive, null = open ended
  readonly lastAcceptedMs: Ms | null;
}

/** The one definition of Accepted_Onset. A rejected event leaves `counting` unchanged. */
export function acceptOnset(
  counting: Counting,
  mode: InputMode,
  e: OnsetLike,
  debounceMs: number,
): { accepted: boolean; counting: Counting } {
  const t = e.timestamp;
  const accepted =
    e.source === mode &&
    t >= counting.fromMs &&
    (counting.toMs === null || t < counting.toMs) &&
    (counting.lastAcceptedMs === null ||
      t - counting.lastAcceptedMs >= debounceMs);
  return accepted
    ? { accepted, counting: { ...counting, lastAcceptedMs: t } }
    : { accepted, counting };
}
