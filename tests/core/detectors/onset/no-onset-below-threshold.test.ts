import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createOnsetDetector } from "@earworm/core";
import type { Frame } from "@earworm/core";
import { whiteNoise } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 10: No Onset at or below the threshold
// **Validates: Requirements 3.3**

const SAMPLE_RATE = 48000;
const FRAME_SIZE = 128;
const STEP_MS = (FRAME_SIZE / SAMPLE_RATE) * 1000;
/** Margin in dB that absorbs Float32 rounding when a Frame sits at the bound. */
const MARGIN_DB = 0.01;

/** Constant-amplitude (DC) Frame whose level is `db` dBFS. */
function dcFrame(db: number, timestamp: number): Frame {
  const amp = Math.pow(10, db / 20);
  return {
    samples: new Float32Array(FRAME_SIZE).fill(amp),
    timestamp,
    sampleRate: SAMPLE_RATE,
  };
}

const scenarioArb = fc.record({
  threshold: fc.integer({ min: 3, max: 40 }),
  noiseFloor: fc.integer({ min: -100, max: -20 }),
  // Fractions of the allowed range [-120, bound] for each Frame; 1 = exactly at the bound.
  fractions: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
    minLength: 1,
    maxLength: 60,
  }),
  gaps: fc.array(fc.double({ min: 0, max: 20, noNaN: true }), {
    minLength: 60,
    maxLength: 60,
  }),
  attackWindow: fc.integer({ min: 5, max: 100 }),
  refractory: fc.integer({ min: 0, max: 200 }),
});

describe("Property 10: No Onset at or below the threshold", () => {
  it("emits no Onset_Event while every Frame level is at or below Noise_Floor + threshold", () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const created = createOnsetDetector({
          threshold: s.threshold,
          attackWindow: s.attackWindow,
          refractory: s.refractory,
        });
        if (!created.ok) throw new Error("detector creation failed");
        const det = created.value;
        expect(det.setNoiseFloor(s.noiseFloor).ok).toBe(true);

        const bound = Math.min(0, s.noiseFloor + s.threshold) - MARGIN_DB;
        let ts = 0;
        s.fractions.forEach((f, i) => {
          const level = -120 + f * (bound + 120);
          ts += i === 0 ? 0 : STEP_MS + s.gaps[i]!;
          expect(det.process(dcFrame(level, ts))).toEqual([]);
        });
      }),
      pbtParams(),
    );
  });

  it("emits no Onset_Event for steady noise whose level stays below the bound", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 3, max: 40 }),
        fc.integer({ min: -100, max: -20 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 1, max: 40 }),
        (threshold, noiseFloor, seed, count) => {
          const created = createOnsetDetector({ threshold });
          if (!created.ok) throw new Error("detector creation failed");
          const det = created.value;
          det.setNoiseFloor(noiseFloor);
          // Uniform noise in [-a, a] has RMS a/√3; keep that at least 1 dB under the bound.
          const bound = Math.min(0, noiseFloor + threshold) - 1;
          const amp = Math.sqrt(3) * Math.pow(10, bound / 20);
          const noise = whiteNoise(seed);
          for (let i = 0; i < count; i++) {
            const frame: Frame = {
              samples: noise(FRAME_SIZE, Math.min(1, amp)),
              timestamp: i * STEP_MS,
              sampleRate: SAMPLE_RATE,
            };
            // Skip Frames whose realised level exceeds the bound (short-frame variance).
            let sum = 0;
            for (const x of frame.samples) sum += x * x;
            const lvl = 10 * Math.log10(sum / FRAME_SIZE + 1e-12);
            if (lvl > bound + 0.5) continue;
            expect(det.process(frame)).toEqual([]);
          }
        },
      ),
      pbtParams(),
    );
  });
});
