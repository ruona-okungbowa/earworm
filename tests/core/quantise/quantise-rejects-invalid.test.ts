// Feature: earworm-kit, Property 30: Quantise rejects invalid input
// **Validates: Requirements 11.7, 11.8**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quantise } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt.js";

const nonFinite = fc.constantFrom(
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
);

const badBpm = fc.oneof(
  nonFinite,
  fc.constant(0),
  fc.constant(-0),
  fc.double({ max: 0, noNaN: true, maxExcluded: false }),
);

const goodTime = fc.double({ min: -1e6, max: 1e6, noNaN: true });
const goodGrid = fc.record({
  originMs: fc.double({ min: -1e6, max: 1e6, noNaN: true }),
  bpm: fc.double({ min: 20, max: 300, noNaN: true }),
  subdivision: fc.integer({ min: 1, max: 16 }),
});

function expectRejected(
  result: ReturnType<typeof quantise>,
  code: "invalid-grid" | "invalid-timestamp",
): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe(code);
  expect("value" in result).toBe(false);
}

describe("Property 30: Quantise rejects invalid input", () => {
  it("returns invalid-grid for a zero, negative, NaN or infinite tempo", () => {
    fc.assert(
      fc.property(goodTime, goodGrid, badBpm, (t, grid, bpm) => {
        expectRejected(quantise(t, { ...grid, bpm }), "invalid-grid");
      }),
      pbtParams(),
    );
  });

  it("returns invalid-timestamp for a NaN or infinite timestamp", () => {
    fc.assert(
      fc.property(nonFinite, goodGrid, (t, grid) => {
        expectRejected(quantise(t, grid), "invalid-timestamp");
      }),
      pbtParams(),
    );
  });
});
