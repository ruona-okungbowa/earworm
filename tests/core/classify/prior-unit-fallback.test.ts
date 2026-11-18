import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { classify } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt.js";

// Feature: earworm-kit, Property 56: Prior unit fallback
// Validates: Requirements 13.6, 13.9, 13.10

/** Valid Ratio_Set: starts at 1, strictly increasing. */
const ratiosArb = fc
  .array(fc.double({ min: 0.05, max: 4, noNaN: true, noDefaultInfinity: true }), {
    minLength: 0,
    maxLength: 6,
  })
  .map((steps) => {
    const out = [1];
    for (const s of steps) out.push((out[out.length - 1] as number) + s);
    return out;
  });

/** Positive finite prior units that are not round numbers. */
const priorArb = fc
  .double({ min: 0.5, max: 5000, noNaN: true, noDefaultInfinity: true })
  .filter((p) => !Number.isInteger(p * 1000));

/** One cluster: every duration equal, so the fit occupies fewer than two classes. */
const clusterArb = fc.tuple(
  fc.double({ min: 0.1, max: 100_000, noNaN: true, noDefaultInfinity: true }),
  fc.integer({ min: 1, max: 20 }),
);

describe("Property 56: Prior unit fallback", () => {
  it("returns the prior unit exactly and classifies against it", () => {
    fc.assert(
      fc.property(ratiosArb, priorArb, clusterArb, (ratios, priorUnit, [d, n]) => {
        const durations = Array.from({ length: n }, () => d);
        const res = classify(durations, ratios, { priorUnit });
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(Object.is(res.value.unit, priorUnit)).toBe(true);
        expect(res.value.items).toHaveLength(n);

        res.value.items.forEach((item, i) => {
          const dur = durations[i] as number;
          const ratio = ratios[item.classIndex];
          expect(ratio).toBeDefined();
          expect(item.deviation).toBe(dur / (priorUnit * (ratio as number)));

          // Log-nearest class for the prior unit.
          const err = (r: number) => Math.abs(Math.log(dur / (priorUnit * r)));
          const best = Math.min(...ratios.map(err));
          expect(err(ratio as number)).toBeLessThanOrEqual(best + 1e-9);
        });
      }),
      pbtParams(),
    );
  });

  it("without a prior, the same durations give the single-cluster result", () => {
    fc.assert(
      fc.property(ratiosArb, clusterArb, (ratios, [d, n]) => {
        const durations = Array.from({ length: n }, () => d);
        const res = classify(durations, ratios);
        expect(res.ok).toBe(true);
        if (!res.ok) return;
        expect(res.value.unit).toBe(d);
        for (const item of res.value.items) {
          expect(item.classIndex).toBe(0);
          expect(item.deviation).toBe(1);
        }
      }),
      pbtParams(),
    );
  });
});
