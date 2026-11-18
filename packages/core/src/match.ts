import type { Ms } from "./types.js";

/** An ordered list of hit Timestamps in milliseconds. */
export type Pattern = readonly Ms[];

export interface MatchResult {
  score: number;
  missed: number;
  extra: number;
  /** Target hit index, 0 to target.length - 1. Null only when the target has no hits. */
  largestError: { ms: number; index: number } | null;
  tempoRatio: number | null;
}

/**
 * Converts a list of intervals between consecutive hits into a Pattern.
 * The first hit is at 0 and each later hit is the running sum of the intervals.
 * Does not validate: a bad interval yields a Pattern that `match` scores 0.
 */
export function intervalsToPattern(intervals: readonly number[]): Pattern {
  const out: number[] = [0];
  let t = 0;
  for (const interval of intervals) {
    t += interval;
    out.push(t);
  }
  return out;
}

function isValid(p: Pattern): boolean {
  let prev = -Infinity;
  for (const t of p) {
    if (typeof t !== "number" || !Number.isFinite(t) || t < prev) return false;
    prev = t;
  }
  return true;
}

function clamp01(x: number): number {
  return Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0;
}

/** Aligns every hit of `a` (the shorter) to a distinct hit of `b`, in order. */
function align(a: readonly number[], b: readonly number[]): number[] {
  const k = a.length;
  const L = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= k; i++) {
    dp.push(new Array<number>(L + 1).fill(i === 0 ? 0 : Infinity));
  }
  for (let i = 1; i <= k; i++) {
    for (let j = i; j <= L; j++) {
      const d = (a[i - 1] as number) - (b[j - 1] as number);
      const take = (dp[i - 1] as number[])[j - 1]! + d * d;
      const skip = (dp[i] as number[])[j - 1]!;
      (dp[i] as number[])[j] = Math.min(take, skip);
    }
  }
  // partner[i] = index in b matched to a[i]
  const partner = new Array<number>(k).fill(0);
  let i = k;
  let j = L;
  while (i > 0 && j > 0) {
    const d = (a[i - 1] as number) - (b[j - 1] as number);
    const take = (dp[i - 1] as number[])[j - 1]! + d * d;
    const skip = j > i ? (dp[i] as number[])[j - 1]! : Infinity;
    if (take <= skip) {
      partner[i - 1] = j - 1;
      i--;
    }
    j--;
  }
  return partner;
}

/**
 * Scores how closely `reply` copies `target`, ignoring start time and overall
 * speed. Pure, deterministic, never throws, never mutates its inputs.
 */
export function match(target: Pattern, reply: Pattern): MatchResult {
  const n = target.length;
  const m = reply.length;
  const missed = Math.max(0, n - m);
  const extra = Math.max(0, m - n);
  const zeroError = n === 0 ? null : { ms: 0, index: 0 };

  const degenerate = (score: number): MatchResult => ({
    score,
    missed,
    extra,
    largestError: zeroError,
    tempoRatio: null,
  });

  if (!isValid(target) || !isValid(reply)) return degenerate(0);
  if (n < 2 || m < 2) return degenerate(n === m ? 1 : 0);

  const t0 = target[0] as number;
  const r0 = reply[0] as number;
  const targetDur = (target[n - 1] as number) - t0;
  const replyDur = (reply[m - 1] as number) - r0;
  if (!Number.isFinite(targetDur) || !Number.isFinite(replyDur)) {
    return degenerate(0);
  }
  if (targetDur === 0 || replyDur === 0) {
    return degenerate(targetDur === 0 && replyDur === 0 && n === m ? 1 : 0);
  }

  const tp = target.map((t) => (t - t0) / targetDur);
  const rp = reply.map((t) => (t - r0) / replyDur);

  // Pairs of [targetIndex, replyIndex].
  let pairs: Array<[number, number]>;
  if (n === m) {
    pairs = tp.map((_, i) => [i, i]);
  } else if (n < m) {
    pairs = align(tp, rp).map((rj, ti) => [ti, rj]);
  } else {
    pairs = align(rp, tp).map((ti, rj) => [ti, rj]);
  }

  let sum = 0;
  let largestMs = 0;
  let largestIndex = 0;
  let first = true;
  for (const [ti, ri] of pairs) {
    const e = Math.abs((rp[ri] as number) - (tp[ti] as number)) * targetDur;
    sum += e;
    if (first || e > largestMs) {
      largestMs = e;
      largestIndex = ti;
      first = false;
    }
  }
  const meanError = sum / pairs.length;
  const meanInterval = targetDur / (n - 1);
  const term = 1 - Math.min(1, meanError / meanInterval);
  const score = clamp01(term * (pairs.length / Math.max(n, m)));
  const ratio = replyDur / targetDur;

  return {
    score,
    missed,
    extra,
    largestError: {
      ms: Number.isFinite(largestMs) ? largestMs : 0,
      index: largestIndex,
    },
    tempoRatio: Number.isFinite(ratio) ? ratio : null,
  };
}
