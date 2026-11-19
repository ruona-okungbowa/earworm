import type { Ms, Pattern } from "@earworm/core";
import type { RandomSource } from "./types.js";

export type SpotBuild =
  | {
      kind: "built";
      target: Pattern;
      extraIndex: number;
      extraAtMs: Ms;
      intervalIndex: number;
    }
  | { kind: "too-short" } // fewer than 2 hits
  | { kind: "no-eligible-interval" };

/**
 * Builds the Sitting 3 target: the player's pattern (relative to its first hit)
 * with one Extra_Knock inserted inside a randomly chosen eligible interval.
 * Pure. Draws r1 then r2 once, only when an eligible interval exists, so a
 * re-listen ("again" or "slower") draws nothing.
 */
export function buildSpotTarget(
  hits: readonly Ms[],
  minGapMs: number,
  random: RandomSource,
): SpotBuild {
  if (hits.length < 2) return { kind: "too-short" };
  const p = hits.map((h) => h - hits[0]!);
  const eligible: number[] = [];
  for (let i = 0; i < p.length - 1; i++) {
    if (p[i + 1]! - p[i]! >= 2 * minGapMs) eligible.push(i);
  }
  if (eligible.length === 0) return { kind: "no-eligible-interval" };

  const r1 = random();
  const r2 = random();
  // min() keeps a faulty source value of 1 or more in range.
  const intervalIndex = eligible[Math.min(eligible.length - 1, Math.floor(r1 * eligible.length))]!;
  const gap = p[intervalIndex + 1]! - p[intervalIndex]!;
  // D4 (G1): the requirement formula can exceed gap - minGap when the gap is not an
  // integer, so clamp. Identical to the requirement for integer-ms gaps.
  const offset = Math.min(gap - minGapMs, minGapMs + Math.floor(r2 * (gap - 2 * minGapMs + 1)));
  const extraAtMs = p[intervalIndex]! + offset;
  const extraIndex = intervalIndex + 1;
  const target = [...p.slice(0, extraIndex), extraAtMs, ...p.slice(extraIndex)];
  return { kind: "built", target, extraIndex, extraAtMs, intervalIndex };
}
