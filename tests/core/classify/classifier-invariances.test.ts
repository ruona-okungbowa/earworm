import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { classify } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 35: Duration classifier invariances
// **Validates: Requirements 13.3, 13.4**

const ratioSets = fc.constantFrom<number[]>(
  [1, 3],
  [1, 3, 7],
  [1, 2, 4],
  [1, 2, 3, 5],
);

const structured = ratioSets
  .chain((ratios) =>
    fc.record({
      ratios: fc.constant(ratios),
      durations: fc.array(
        fc.record({
          cls: fc.integer({ min: 0, max: ratios.length - 1 }),
          jitter: fc.double({ min: 0.85, max: 1.15, noNaN: true }),
        }),
        { minLength: 2, maxLength: 40 },
      ),
      unit: fc.double({ min: 20, max: 500, noNaN: true }),
    }),
  )
  .map(({ ratios, durations, unit }) => ({
    ratios,
    durations: durations.map(
      (d) => unit * (ratios[d.cls] as number) * d.jitter,
    ),
  }));

/** Arbitrary positive durations with no structure. */
const arbitrary = fc.record({
  ratios: ratioSets,
  durations: fc.array(fc.double({ min: 1, max: 5000, noNaN: true }), {
    minLength: 1,
    maxLength: 40,
  }),
});

const scenario = fc.oneof(structured, arbitrary);

describe("Property 35: Duration classifier invariances", () => {
  it("scaling all durations leaves classes unchanged and scales the unit", () => {
    fc.assert(
      fc.property(
        scenario,
        fc.double({ min: 0.1, max: 10, noNaN: true }),
        ({ ratios, durations }, factor) => {
          const a = classify(durations, ratios);
          const b = classify(
            durations.map((d) => d * factor),
            ratios,
          );
          expect(a.ok).toBe(true);
          expect(b.ok).toBe(true);
          if (!a.ok || !b.ok) return;
          expect(
            Math.abs(b.value.unit / (a.value.unit * factor) - 1),
          ).toBeLessThanOrEqual(0.001);
          a.value.items.forEach((item, i) => {
            const other = b.value.items[i]!;
            expect(other.classIndex).toBe(item.classIndex);
            expect(
              Math.abs(other.deviation - item.deviation),
            ).toBeLessThanOrEqual(0.001);
          });
        },
      ),
      pbtParams(),
    );
  });

  it("reordering the input permutes the output the same way", () => {
    fc.assert(
      fc.property(
        scenario.chain((s) =>
          fc.record({
            s: fc.constant(s),
            perm: fc.shuffledSubarray(
              s.durations.map((_, i) => i),
              { minLength: s.durations.length, maxLength: s.durations.length },
            ),
          }),
        ),
        ({ s, perm }) => {
          const a = classify(s.durations, s.ratios);
          const b = classify(
            perm.map((i) => s.durations[i] as number),
            s.ratios,
          );
          expect(a.ok).toBe(true);
          expect(b.ok).toBe(true);
          if (!a.ok || !b.ok) return;
          expect(b.value.unit).toBe(a.value.unit);
          perm.forEach((orig, j) => {
            const x = a.value.items[orig]!;
            const y = b.value.items[j]!;
            expect(y.classIndex).toBe(x.classIndex);
            expect(y.deviation).toBe(x.deviation);
          });
        },
      ),
      pbtParams(),
    );
  });
});
