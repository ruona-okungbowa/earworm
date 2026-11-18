import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createPitchDetector } from "@earworm/core";
import type { Frame, PitchDetector } from "@earworm/core";
import { pbtParams } from "../../../helpers/pbt";
import { frameSequence } from "../../../helpers/generators";

// Feature: earworm-kit, Property 58: Sample_History stays within its capacity
// **Validates: Requirements 4.14**

const CAPACITY = 2048;

function make(): PitchDetector {
  const r = createPitchDetector();
  if (!r.ok) throw new Error("detector creation failed");
  return r.value;
}

/** Independent model of Frame validity: non-empty, finite samples and Timestamp, not earlier than the last valid Timestamp. */
function isValid(frame: Frame, last: number | null): boolean {
  if (frame.samples.length === 0) return false;
  if (!Number.isFinite(frame.timestamp)) return false;
  if (last !== null && frame.timestamp < last) return false;
  for (let i = 0; i < frame.samples.length; i++) {
    if (!Number.isFinite(frame.samples[i])) return false;
  }
  return true;
}

const scenarioArb = fc
  .record({
    // Sizes below, at and above the 2048 capacity.
    frameSize: fc.constantFrom(1, 100, 700, 2047, 2048, 2500, 5000),
    resetChance: fc.constantFrom(0, 0.15, 0.4),
  })
  .chain(({ frameSize, resetChance }) =>
    fc.record({
      items: frameSequence({
        frameSize,
        minLength: 1,
        maxLength: 12,
        inject: ["empty", "non-finite-sample", "stale-timestamp"],
      }),
      resets: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
        minLength: 12,
        maxLength: 12,
      }),
      resetChance: fc.constant(resetChance),
    }),
  );

describe("Property 58: Sample_History stays within its capacity", () => {
  it("historyLength is at most 2048 and equals min(2048, valid samples since construction or last reset)", () => {
    fc.assert(
      fc.property(scenarioArb, ({ items, resets, resetChance }) => {
        const d = make();
        let valid = 0;
        let last: number | null = null;
        expect(d.historyLength).toBe(0);

        items.forEach(({ frame }, i) => {
          if ((resets[i] as number) < resetChance) {
            d.reset();
            valid = 0;
            last = null;
            expect(d.historyLength).toBe(0);
          }

          // Silence keeps analysis cheap; NaN and Infinity stay non-finite when scaled.
          const quiet: Frame = {
            ...frame,
            samples: frame.samples.map((s) => s * 0),
          };
          if (isValid(quiet, last)) {
            valid += quiet.samples.length;
            last = quiet.timestamp;
          }
          d.process(quiet);

          expect(d.historyLength).toBeLessThanOrEqual(CAPACITY);
          expect(d.historyLength).toBe(Math.min(CAPACITY, valid));
        });
      }),
      pbtParams(),
    );
  });

  it("a single Frame longer than 2048 fills the history to exactly 2048", () => {
    const d = make();
    d.process({
      samples: new Float32Array(5000),
      timestamp: 0,
      sampleRate: 48000,
    });
    expect(d.historyLength).toBe(CAPACITY);
    d.reset();
    expect(d.historyLength).toBe(0);
  });
});
