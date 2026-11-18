import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createSpectrumDetector } from "@earworm/core";
import type { Frame, SpectrumDetector } from "@earworm/core";
import { pbtParams } from "../../../helpers/pbt";
import { frameSequence } from "../../../helpers/generators";

// Feature: earworm-kit, Property 58: Sample_History stays within its capacity
// **Validates: Requirements 19.21**

function make(fftSize: number): SpectrumDetector {
  const r = createSpectrumDetector({ fftSize });
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
    fftSize: fc.constantFrom(256, 512, 1024, 2048, 4096, 8192),
    frameScale: fc.constantFrom(0.01, 0.3, 0.99, 1, 1.5, 3),
    resetChance: fc.constantFrom(0, 0.15, 0.4),
  })
  .chain(({ fftSize, frameScale, resetChance }) =>
    fc.record({
      fftSize: fc.constant(fftSize),
      items: frameSequence({
        frameSize: Math.max(1, Math.round(fftSize * frameScale)),
        minLength: 1,
        maxLength: 10,
        inject: ["empty", "non-finite-sample", "stale-timestamp"],
      }),
      resets: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
        minLength: 10,
        maxLength: 10,
      }),
      resetChance: fc.constant(resetChance),
    }),
  );

describe("Property 58: Sample_History stays within its capacity", () => {
  it("historyLength is at most FFT_Size and equals min(FFT_Size, valid samples since construction or last reset)", () => {
    fc.assert(
      fc.property(scenarioArb, ({ fftSize, items, resets, resetChance }) => {
        const d = make(fftSize);
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

          // NaN and Infinity stay non-finite when scaled.
          const quiet: Frame = {
            ...frame,
            samples: frame.samples.map((s) => s * 0),
          };
          if (isValid(quiet, last)) {
            valid += quiet.samples.length;
            last = quiet.timestamp;
          }
          d.process(quiet);

          expect(d.historyLength).toBeLessThanOrEqual(fftSize);
          expect(d.historyLength).toBe(Math.min(fftSize, valid));
        });
      }),
      pbtParams(),
    );
  });

  it("a single Frame longer than FFT_Size fills the history to exactly FFT_Size", () => {
    const d = make(256);
    d.process({
      samples: new Float32Array(1000),
      timestamp: 0,
      sampleRate: 48000,
    });
    expect(d.historyLength).toBe(256);
    d.reset();
    expect(d.historyLength).toBe(0);
  });
});
