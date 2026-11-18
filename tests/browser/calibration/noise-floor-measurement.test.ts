import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { noiseFloorFromLevels } from "@earworm/browser";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 17: Noise floor measurement
// **Validates: Requirements 6.1, 6.6**

interface Lvl {
  timestamp: number;
  level: number;
}

const levelsArb: fc.Arbitrary<Lvl[]> = fc.array(
  fc.record({
    timestamp: fc.integer({ min: 0, max: 2000 }),
    level: fc.integer({ min: -900, max: 0 }).map((n) => n / 10),
  }),
  { minLength: 1, maxLength: 40 },
);

/** Reference model: highest power-average over [t, t + 100) anchored at each event. */
function expectedFloor(events: Lvl[]): number {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);
  let best = -Infinity;
  for (const start of sorted) {
    const inWin = sorted.filter(
      (e) => e.timestamp >= start.timestamp && e.timestamp < start.timestamp + 100,
    );
    const mean =
      inWin.reduce((s, e) => s + Math.pow(10, e.level / 10), 0) / inWin.length;
    best = Math.max(best, 10 * Math.log10(mean));
  }
  return best;
}

describe("Property 17: Noise floor measurement", () => {
  it("equals the highest 100 ms power-average, or room-too-loud above the maximum", () => {
    fc.assert(
      fc.property(
        levelsArb,
        fc.integer({ min: -1000, max: 100 }).map((n) => n / 10),
        (events, maxQuiet) => {
          const expected = expectedFloor(events);
          const result = noiseFloorFromLevels(events, maxQuiet);
          if (expected > maxQuiet + 1e-9) {
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.code).toBe("room-too-loud");
          } else if (expected < maxQuiet - 1e-9) {
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.value).toBeCloseTo(expected, 6);
          }
        },
      ),
      pbtParams(),
    );
  });

  it("is independent of input order", () => {
    fc.assert(
      fc.property(
        levelsArb.chain((events) =>
          fc.tuple(fc.constant(events), fc.shuffledSubarray(events, { minLength: events.length })),
        ),
        ([events, shuffled]) => {
          const a = noiseFloorFromLevels(events, 0);
          const b = noiseFloorFromLevels(shuffled, 0);
          expect(a.ok).toBe(true);
          expect(b.ok).toBe(true);
          if (a.ok && b.ok) expect(b.value).toBeCloseTo(a.value, 6);
        },
      ),
      pbtParams(),
    );
  });

  it("fails with calibration-failed when there are no events", () => {
    const result = noiseFloorFromLevels([], -30);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("calibration-failed");
  });
});
