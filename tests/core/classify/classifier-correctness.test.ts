import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { classify } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 36: Duration classifier correctness
// **Validates: Requirements 13.1, 13.2, 13.5**
describe("Property 36: Duration classifier correctness", () => {
  // Adjacent ratios differ by at least 2.4x, so ±20% perturbation (a 1.5x spread
  // at most, 2.25x between neighbouring worst cases) cannot cross a class boundary.
  const ratioSet = fc
    .array(
      fc.double({ min: 2.4, max: 5, noNaN: true, noDefaultInfinity: true }),
      {
        minLength: 1,
        maxLength: 4,
      },
    )
    .map((steps) => {
      const ratios = [1];
      for (const s of steps)
        ratios.push((ratios[ratios.length - 1] as number) * s);
      return ratios;
    });

  const scenario = ratioSet.chain((ratios) =>
    fc.record({
      ratios: fc.constant(ratios),
      unit: fc.double({
        min: 10,
        max: 1000,
        noNaN: true,
        noDefaultInfinity: true,
      }),
      // Entries 0 and 1 force class 0 and one other class; the tail is free.
      otherClass: fc.integer({ min: 1, max: ratios.length - 1 }),
      tail: fc.array(
        fc.record({
          cls: fc.integer({ min: 0, max: ratios.length - 1 }),
          perturb: fc.double({
            min: 0.8,
            max: 1.2,
            noNaN: true,
            noDefaultInfinity: true,
          }),
        }),
        { maxLength: 60 },
      ),
      head: fc.tuple(
        fc.double({ min: 0.8, max: 1.2, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.8, max: 1.2, noNaN: true, noDefaultInfinity: true }),
      ),
    }),
  );

  it("returns one class and deviation per duration, in input order, matching the unperturbed classes", () => {
    fc.assert(
      fc.property(scenario, ({ ratios, unit, otherClass, tail, head }) => {
        const specs = [
          { cls: 0, perturb: head[0] },
          { cls: otherClass, perturb: head[1] },
          ...tail,
        ];
        const durations = specs.map(
          (s) => unit * (ratios[s.cls] as number) * s.perturb,
        );

        const result = classify(durations, ratios);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { unit: estimated, items } = result.value;

        expect(items).toHaveLength(durations.length);
        expect(estimated).toBeGreaterThan(0);
        expect(Number.isFinite(estimated)).toBe(true);
        items.forEach((item, i) => {
          const d = durations[i] as number;
          expect(item.classIndex).toBe((specs[i] as { cls: number }).cls);
          const expected =
            d / (estimated * (ratios[item.classIndex] as number));
          expect(Math.abs(item.deviation - expected)).toBeLessThanOrEqual(
            1e-9 * Math.abs(expected),
          );
        });
      }),
      pbtParams(),
    );
  });

  it("assigns a duration to the log-nearest class, and the geometric midpoint to the lower class", () => {
    fc.assert(
      fc.property(
        ratioSet,
        fc.double({ min: 10, max: 1000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.5, max: 8, noNaN: true, noDefaultInfinity: true }),
        (ratios, unit, factor) => {
          // Anchor the unit with an exact class 0 and an exact top-class duration.
          const top = ratios.length - 1;
          const probe = unit * factor;
          const durations = [unit, unit * (ratios[top] as number), probe];
          const result = classify(durations, ratios);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const u = result.value.unit;
          const got = result.value.items[2]?.classIndex as number;
          const x = probe / u;
          const bestDist = Math.min(
            ...ratios.map((r) => Math.abs(Math.log(x / r))),
          );
          const gotDist = Math.abs(Math.log(x / (ratios[got] as number)));
          expect(gotDist).toBeLessThanOrEqual(bestDist + 1e-9);
        },
      ),
      pbtParams(),
    );
  });

  it("puts a duration exactly at the geometric midpoint into the lower class", () => {
    const result = classify([1, 4, 2], [1, 4]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.unit).toBe(1);
    expect(result.value.items.map((i) => i.classIndex)).toEqual([0, 1, 0]);
  });
});
