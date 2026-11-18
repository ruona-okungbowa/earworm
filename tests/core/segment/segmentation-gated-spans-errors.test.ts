// Feature: earworm-kit, Property 33: Segmentation of gated spans and ordering errors
// **Validates: Requirements 12.9, 12.12, 12.13**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { segment } from "@earworm/core";
import type { PitchEvent } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

function pitch(timestamp: number, frequency = 440): PitchEvent {
  return { type: "pitch", timestamp, source: "mic", frequency, midi: 69, cents: 0, confidence: 0.9 };
}

describe("Property 33: Segmentation of gated spans and ordering errors", () => {
  it("a gated span beginning inside a tone ends the Mark at the last Pitch_Event before it", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 5, max: 40 }),
        fc.integer({ min: 4, max: 39 }),
        fc.integer({ min: 1, max: 10 }),
        (t0, n, kRaw, offset) => {
          const frameInterval = 10;
          const k = Math.min(kRaw, n - 1); // span falls between events k-1 and k
          const events = Array.from({ length: n }, (_, i) => pitch(t0 + i * frameInterval));
          const spanStart = t0 + (k - 1) * frameInterval + offset; // in (t[k-1], t[k]]
          const result = segment(
            { kind: "pitch", events, gatedSpans: [[spanStart, spanStart + 500]] },
            { frameInterval },
          );
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const first = result.value[0];
          expect(first).toBeDefined();
          expect(first?.start).toBe(t0);
          expect(first?.duration).toBe((k - 1) * frameInterval + frameInterval);
          // No Mark crosses the span start.
          for (const m of result.value) {
            const lastEvent = m.start + m.duration - frameInterval;
            expect(m.start >= spanStart || lastEvent < spanStart).toBe(true);
          }
        },
      ),
      pbtParams(),
    );
  });

  it("returns invalid-ordering and no Marks for descending Events", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 2, max: 30 }),
        fc.integer({ min: 0, max: 28 }),
        (t0, n, iRaw) => {
          const events = Array.from({ length: n }, (_, i) => pitch(t0 + i * 10));
          const i = Math.min(iRaw, n - 2);
          const a = events[i] as PitchEvent;
          events[i] = events[i + 1] as PitchEvent;
          events[i + 1] = a;
          const result = segment({ kind: "pitch", events }, { frameInterval: 10 });
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.code).toBe("invalid-ordering");
        },
      ),
      pbtParams(),
    );
  });

  it("returns invalid-config naming frameInterval when it is missing, non-positive or non-finite", () => {
    const bad = fc.oneof(
      fc.constant(undefined),
      fc.constant(0),
      fc.constant(-0),
      fc.constant(Number.NaN),
      fc.constant(Number.POSITIVE_INFINITY),
      fc.constant(Number.NEGATIVE_INFINITY),
      fc.double({ max: -Number.MIN_VALUE, noNaN: true, noDefaultInfinity: true }),
    );
    fc.assert(
      fc.property(
        bad,
        fc.array(fc.integer({ min: 0, max: 5000 }), { maxLength: 20 }),
        (frameInterval, times) => {
          const events = [...times].sort((a, b) => a - b).map((t) => pitch(t));
          const result = segment({ kind: "pitch", events }, { frameInterval });
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.error.code).toBe("invalid-config");
          expect(result.error.setting).toBe("frameInterval");
        },
      ),
      pbtParams(),
    );
  });

  it("returns invalid-config when no config is given at all", () => {
    const result = segment({ kind: "pitch", events: [pitch(0)] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.setting).toBe("frameInterval");
  });
});
