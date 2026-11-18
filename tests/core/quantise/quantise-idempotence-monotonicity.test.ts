import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quantise } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 29: Quantise idempotence and monotonicity
// **Validates: Requirements 11.4, 11.6**

const gridArb = fc.record({
  originMs: fc.double({ min: -10_000, max: 10_000, noNaN: true }),
  bpm: fc.double({ min: 20, max: 300, noNaN: true }),
  subdivision: fc.integer({ min: 1, max: 8 }),
});
const timeArb = fc.double({ min: -100_000, max: 100_000, noNaN: true });

describe("Property 29: Quantise idempotence and monotonicity", () => {
  it("quantising a snapped timestamp returns the same time and index", () => {
    fc.assert(
      fc.property(timeArb, gridArb, (t, grid) => {
        const first = quantise(t, grid);
        expect(first.ok).toBe(true);
        if (!first.ok) return;
        const second = quantise(first.value.time, grid);
        expect(second.ok).toBe(true);
        if (!second.ok) return;
        expect(second.value.time).toBe(first.value.time);
        expect(second.value.index).toBe(first.value.index);
      }),
      pbtParams(),
    );
  });

  it("non-decreasing timestamps yield non-decreasing indices", () => {
    fc.assert(
      fc.property(
        fc.array(timeArb, { maxLength: 30 }),
        gridArb,
        (times, grid) => {
          const sorted = [...times].sort((a, b) => a - b);
          let prev = -Infinity;
          for (const t of sorted) {
            const r = quantise(t, grid);
            expect(r.ok).toBe(true);
            if (!r.ok) return;
            expect(r.value.index).toBeGreaterThanOrEqual(prev);
            prev = r.value.index;
          }
        },
      ),
      pbtParams(),
    );
  });
});
