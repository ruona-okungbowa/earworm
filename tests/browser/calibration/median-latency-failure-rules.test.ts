import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { medianLatency } from "@earworm/browser";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 18: Median latency and failure rules
// **Validates: Requirements 6.3, 6.10, 6.11**

const MAX_MATCH_MS = 1000;
const SPACING_MS = 3000;

/** Four scheduled clicks, SPACING_MS apart, so matching is unambiguous. */
const scheduledArb = fc
  .integer({ min: 0, max: 10_000 })
  .map((start) => [0, 1, 2, 3].map((i) => start + i * SPACING_MS));

/** Per click: an integer offset in ms, or null when the click is not detected. */
const offsetsArb = fc.array(
  fc.option(fc.integer({ min: -300, max: 800 }), { nil: null }),
  { minLength: 4, maxLength: 4 },
);

/** Detections further than MAX_MATCH_MS from every scheduled click. */
function farFrom(scheduled: number[]): fc.Arbitrary<number[]> {
  return fc.array(
    fc
      .integer({ min: -20_000, max: 40_000 })
      .filter((t) => scheduled.every((s) => Math.abs(t - s) > MAX_MATCH_MS)),
    { maxLength: 6 },
  );
}

function expectedMedian(diffs: number[]): number {
  const sorted = [...diffs].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function detectedFrom(
  scheduled: number[],
  offsets: (number | null)[],
): number[] {
  const out: number[] = [];
  offsets.forEach((o, i) => {
    if (o !== null) out.push(scheduled[i]! + o);
  });
  return out;
}

describe("Property 18: Median latency and failure rules", () => {
  it("returns the median of matched differences, or calibration-failed", () => {
    fc.assert(
      fc.property(scheduledArb, offsetsArb, (scheduled, offsets) => {
        const detected = detectedFrom(scheduled, offsets);
        const diffs = offsets.filter((o): o is number => o !== null);
        const result = medianLatency(scheduled, detected, MAX_MATCH_MS);

        if (diffs.length < 3) {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.code).toBe("calibration-failed");
          return;
        }
        const median = expectedMedian(diffs);
        if (median < 0 || median > 500) {
          expect(result.ok).toBe(false);
          if (!result.ok) expect(result.error.code).toBe("calibration-failed");
        } else {
          expect(result).toEqual({ ok: true, value: median });
        }
      }),
      pbtParams(),
    );
  });

  it("is unchanged by extra detections far from any click", () => {
    fc.assert(
      fc.property(
        scheduledArb.chain((scheduled) =>
          fc.tuple(fc.constant(scheduled), offsetsArb, farFrom(scheduled)),
        ),
        ([scheduled, offsets, extras]) => {
          const detected = detectedFrom(scheduled, offsets);
          const base = medianLatency(scheduled, detected, MAX_MATCH_MS);
          const withExtras = medianLatency(
            scheduled,
            [...detected, ...extras],
            MAX_MATCH_MS,
          );
          expect(withExtras.ok).toBe(base.ok);
          if (base.ok && withExtras.ok) {
            expect(withExtras.value).toBe(base.value);
          }
          if (!base.ok && !withExtras.ok) {
            expect(withExtras.error.code).toBe(base.error.code);
          }
        },
      ),
      pbtParams(),
    );
  });

  it("uses each click at most once: duplicate detections do not add matches", () => {
    const scheduled = [0, 3000, 6000, 9000];
    // Four detections all near the first click can match only one click.
    const result = medianLatency(scheduled, [10, 20, 30, 40], MAX_MATCH_MS);
    expect(result.ok).toBe(false);
  });

  it("accepts the 0 and 500 ms boundaries and rejects just outside", () => {
    const scheduled = [0, 3000, 6000, 9000];
    const at = (o: number) =>
      medianLatency(scheduled, scheduled.map((s) => s + o), MAX_MATCH_MS);
    expect(at(0)).toEqual({ ok: true, value: 0 });
    expect(at(500)).toEqual({ ok: true, value: 500 });
    expect(at(-1).ok).toBe(false);
    expect(at(501).ok).toBe(false);
  });
});
