import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { classify } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 37: Duration classifier rejects invalid input
// **Validates: Requirements 13.7, 13.8**

const validDuration = fc.double({
  min: 1,
  max: 10_000,
  noNaN: true,
});

const validRatios = fc
  .uniqueArray(fc.integer({ min: 2, max: 50 }), { minLength: 1, maxLength: 5 })
  .map((xs) => [1, ...[...xs].sort((a, b) => a - b)]);

const badDuration = fc.oneof(
  fc.constant(0),
  fc.constant(-0),
  fc.constant(NaN),
  fc.constant(Infinity),
  fc.constant(-Infinity),
  fc.double({ max: -Number.MIN_VALUE, noNaN: true, noDefaultInfinity: true }),
);

const badRatios: fc.Arbitrary<number[]> = fc.oneof(
  // empty
  fc.constant<number[]>([]),
  // does not start at 1
  fc
    .tuple(
      fc.oneof(
        fc.double({ min: 1.001, max: 100, noNaN: true }),
        fc.double({ min: 0.001, max: 0.999, noNaN: true }),
      ),
      validRatios,
    )
    .map(([first, rest]) => [first, ...rest.slice(1)]),
  // not strictly increasing: duplicate or descending element
  validRatios
    .filter((r) => r.length >= 2)
    .chain((r) =>
      fc.integer({ min: 1, max: r.length - 1 }).chain((i) =>
        fc.boolean().map((dup) => {
          const out = [...r];
          out[i] = dup ? (r[i - 1] as number) : (r[i - 1] as number) / 2;
          return out;
        }),
      ),
    ),
  // non-finite or non-positive entries
  validRatios.chain((r) =>
    fc
      .tuple(
        fc.integer({ min: 0, max: r.length - 1 }),
        fc.constantFrom(NaN, Infinity, -Infinity, 0, -1),
      )
      .map(([i, bad]) => {
        const out = [...r];
        out[i] = bad;
        return out;
      }),
  ),
);

describe("Property 37: Duration classifier rejects invalid input", () => {
  it("returns invalid-duration when any duration is not positive and finite", () => {
    fc.assert(
      fc.property(
        fc.array(validDuration, { maxLength: 10 }),
        badDuration,
        fc.array(validDuration, { maxLength: 10 }),
        validRatios,
        (before, bad, after, ratios) => {
          const r = classify([...before, bad, ...after], ratios);
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error.code).toBe("invalid-duration");
        },
      ),
      pbtParams(),
    );
  });

  it("returns invalid-ratios for an empty, non-unit-start or non-increasing Ratio_Set", () => {
    fc.assert(
      fc.property(
        fc.array(validDuration, { minLength: 1, maxLength: 20 }),
        badRatios,
        (durations, ratios) => {
          const r = classify(durations, ratios);
          expect(r.ok).toBe(false);
          if (!r.ok) expect(r.error.code).toBe("invalid-ratios");
        },
      ),
      pbtParams(),
    );
  });
});
