import { match, type Pattern } from "@earworm/core";

export type Reason =
  | "ok"
  | "too-many"
  | "too-few"
  | "timing"
  | "too-short"
  | "silence";

export interface Judgement {
  readonly success: boolean;
  readonly score: number;
  readonly reason: Reason;
}

export function judge(
  target: Pattern,
  reply: Pattern,
  passThreshold: number,
): Judgement {
  if (reply.length === 0) return { success: false, score: 0, reason: "silence" };
  if (reply.length < 2 && target.length >= 2)
    return { success: false, score: 0, reason: "too-short" };
  // G3 / D3: the hit-count rule applies to Sitting 2 as well as 3. `match` can
  // score 0.875 for one missing hit in eight, which would pass a 0.8 threshold.
  if (reply.length > target.length)
    return { success: false, score: 0, reason: "too-many" };
  if (reply.length < target.length)
    return { success: false, score: 0, reason: "too-few" };
  const { score } = match(target, reply);
  return score >= passThreshold
    ? { success: true, score, reason: "ok" }
    : { success: false, score, reason: "timing" };
}
