// Feature: earworm-kit, Property 28: Quantise nearest-position model
// **Validates: Requirements 11.1, 11.2, 11.3, 11.5**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { quantise } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt.js";

const gridArb = fc.record({
  originMs: fc.double({ min: -1e5, max: 1e5, noNaN: true }),
  bpm: fc.double({ min: 20, max: 400, noNaN: true }),
  subdivision: fc.integer({ min: 1, max: 16 }),
});

const timeArb = fc.double({ min: -1e6, max: 1e6, noNaN: true });

describe("Property 28: Quantise nearest-position model", () => {
  it("returns index ceil(x - 0.5), time = origin + index * step, within half a step", () => {
    fc.assert(
      fc.property(timeArb, gridArb, (t, grid) => {
        const result = quantise(t, grid);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const step = 60000 / (grid.bpm * grid.subdivision);
        const { index, time } = result.value;
        expect(Number.isInteger(index)).toBe(true);
        // `+ 0` normalises -0 to 0, as the Kit does.
        expect(index).toBe(Math.ceil((t - grid.originMs) / step - 0.5) + 0);
        expect(time).toBe(grid.originMs + index * step);
        const tolerance = 1e-9 * Math.max(1, Math.abs(t), Math.abs(time));
        expect(Math.abs(t - time)).toBeLessThanOrEqual(step / 2 + tolerance);
      }),
      pbtParams(),
    );
  });

  it("sends an exact midpoint to the earlier position", () => {
    // bpm 60 and a power-of-two subdivision give an exactly representable step.
    fc.assert(
      fc.property(
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        fc.constantFrom(1, 2, 4, 8, 16),
        (originMs, k, subdivision) => {
          const grid = { originMs, bpm: 60, subdivision };
          const step = 1000 / subdivision;
          const t = originMs + (k + 0.5) * step;
          const result = quantise(t, grid);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.value.index).toBe(k);
          expect(result.value.time).toBe(originMs + k * step);
        },
      ),
      pbtParams(),
    );
  });
});
