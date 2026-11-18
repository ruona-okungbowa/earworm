import { err, ok } from "./types.js";
import type { Ms, Result } from "./types.js";

const MAX_DURATIONS = 1000;
const TIE_RELATIVE = 1e-12;
const TIE_FLOOR = 1e-20;

export interface ClassifyItem {
  classIndex: number;
  deviation: number;
}

export interface ClassifyResult {
  unit: Ms;
  items: ClassifyItem[];
}

function isPositiveFinite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Class of a duration for a unit: the class whose nominal is nearest on a log
 * scale. d² ≤ nominal_c · nominal_{c+1} goes to the lower class.
 */
function classOf(d: number, unit: number, ratios: readonly number[]): number {
  const x = d / unit;
  const last = ratios.length - 1;
  for (let c = 0; c < last; c++) {
    if (x * x <= (ratios[c] as number) * (ratios[c + 1] as number)) return c;
  }
  return last;
}

function median(sorted: readonly number[]): number {
  const n = sorted.length;
  const mid = n >> 1;
  if (n % 2 === 1) return sorted[mid] as number;
  const a = sorted[mid - 1] as number;
  const b = sorted[mid] as number;
  return a + (b - a) / 2;
}

function build(
  durations: readonly number[],
  ratios: readonly number[],
  unit: number,
  classes: readonly number[],
): ClassifyResult {
  const items = durations.map((d, i) => {
    const classIndex = classes[i] as number;
    return {
      classIndex,
      deviation: d / (unit * (ratios[classIndex] as number)),
    };
  });
  return { unit, items };
}

/**
 * Assign durations to classes of a Ratio_Set relative to an estimated unit.
 * Never throws.
 */
export function classify(
  durations: readonly Ms[],
  ratios: readonly number[],
  opts?: { priorUnit?: number },
): Result<ClassifyResult> {
  if (!Array.isArray(ratios) || ratios.length === 0) {
    return err("invalid-ratios", "ratios must be a non-empty array");
  }
  for (let i = 0; i < ratios.length; i++) {
    const r: unknown = ratios[i];
    if (!isPositiveFinite(r)) {
      return err(
        "invalid-ratios",
        "every ratio must be a positive finite number",
      );
    }
    if (i === 0 && r !== 1) {
      return err("invalid-ratios", "the first ratio must be 1");
    }
    if (i > 0 && r <= (ratios[i - 1] as number)) {
      return err("invalid-ratios", "ratios must be strictly increasing");
    }
  }
  if (
    !Array.isArray(durations) ||
    durations.length < 1 ||
    durations.length > MAX_DURATIONS
  ) {
    return err(
      "invalid-duration",
      `durations must be an array of 1 to ${MAX_DURATIONS} numbers`,
    );
  }
  for (const d of durations) {
    if (!isPositiveFinite(d)) {
      return err(
        "invalid-duration",
        "every duration must be a positive finite number",
      );
    }
  }

  const prior = opts?.priorUnit;
  const priorUnit = isPositiveFinite(prior) ? prior : undefined;

  const sorted = [...durations].sort((a, b) => a - b);
  const shortest = sorted[0] as number;

  // Candidate units d_i / r_c, ascending, deduplicated.
  const candidateSet = new Set<number>();
  for (const d of sorted) {
    for (const r of ratios) {
      const u = d / r;
      if (!isPositiveFinite(u)) continue;
      // Without a valid prior, the shortest duration anchors class 0.
      if (priorUnit === undefined && classOf(shortest, u, ratios) !== 0) {
        continue;
      }
      candidateSet.add(u);
    }
  }
  const candidates = [...candidateSet].sort((a, b) => a - b);

  const costs: number[] = [];
  let minCost = Infinity;
  for (const u of candidates) {
    let cost = 0;
    for (const d of sorted) {
      const c = classOf(d, u, ratios);
      const e = Math.log(d / (u * (ratios[c] as number)));
      cost += e * e;
    }
    costs.push(cost);
    if (cost < minCost) minCost = cost;
  }

  let fitUnit: number | undefined;
  if (candidates.length > 0) {
    const tol = TIE_RELATIVE * Math.max(minCost, TIE_FLOOR);
    for (let i = 0; i < candidates.length; i++) {
      if ((costs[i] as number) <= minCost + tol) {
        fitUnit = candidates[i];
        break;
      }
    }
  }

  let fitClasses: number[] | undefined;
  let usable = false;
  if (fitUnit !== undefined) {
    fitClasses = durations.map((d) => classOf(d, fitUnit as number, ratios));
    const occupied = new Set(fitClasses);
    usable = occupied.has(0) && occupied.size >= 2;
  }

  if (usable && fitUnit !== undefined && fitClasses !== undefined) {
    return ok(build(durations, ratios, fitUnit, fitClasses));
  }

  if (priorUnit !== undefined) {
    const classes = durations.map((d) => classOf(d, priorUnit, ratios));
    return ok(build(durations, ratios, priorUnit, classes));
  }

  // No usable fit and no prior.
  if (fitUnit !== undefined && fitClasses !== undefined) {
    const occupied = new Set(fitClasses);
    if (occupied.size >= 2) {
      return ok(build(durations, ratios, fitUnit, fitClasses));
    }
  }
  const unit = median(sorted);
  const classes = durations.map(() => 0);
  return ok(build(durations, ratios, unit, classes));
}
