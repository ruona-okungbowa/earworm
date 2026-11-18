import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createPitchDetector, frames } from "@earworm/core";
import type { Frame, PitchEvent } from "@earworm/core";
import { tone } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 13: Sine pitch accuracy
// **Validates: Requirements 4.5, 4.11**

const WINDOW = 2048;
const EDGE_LOW = 80 * Math.pow(2, 10 / 1200);
const EDGE_HIGH = 2000 * Math.pow(2, -10 / 1200);

describe("Property 13: Sine pitch accuracy", () => {
  it("every Pitch_Event is within 10 cents, and none is emitted before 2048 samples", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 80, max: 2000, noNaN: true }),
        fc.double({ min: 0.05, max: 0.9, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.constantFrom(128, 512),
        fc.constantFrom(44100, 48000),
        fc.integer({ min: 20, max: 40 }),
        fc.boolean(),
        (freq, amp, phase, frameSize, sampleRate, frameCount, withReset) => {
          const created = createPitchDetector();
          if (!created.ok) throw new Error("detector creation failed");
          const detector = created.value;

          const samples = tone(
            freq,
            amp,
            frameCount * frameSize,
            sampleRate,
            phase,
          );
          const fs = frames(samples, 0, sampleRate, frameSize);
          expect(fs.length).toBe(frameCount);
          expect(frameCount * frameSize).toBeGreaterThan(WINDOW);

          const run = (list: Frame[]): number => {
            let valid = 0;
            let pitchEvents = 0;
            list.forEach((frame, index) => {
              valid += frame.samples.length;
              const events = detector.process(frame);
              if (valid < WINDOW) {
                expect(
                  events,
                  `event before ${WINDOW} samples: frame=${index} valid=${valid}`,
                ).toEqual([]);
              }
              for (const event of events) {
                if (event.type !== "pitch") continue;
                pitchEvents++;
                const pitch = event as PitchEvent;
                const centsOff = Math.abs(
                  1200 * Math.log2(pitch.frequency / freq),
                );
                expect(
                  centsOff,
                  `freq=${freq} sr=${sampleRate} size=${frameSize} frame=${index} got=${pitch.frequency}`,
                ).toBeLessThanOrEqual(10);
              }
            });
            return pitchEvents;
          };

          // Within 10 cents of a band edge an accurate estimate may fall just
          // outside 80..2000 Hz and Req 4.7 drops it, so only require events
          // for tones further inside the band.
          const inside = freq >= EDGE_LOW && freq <= EDGE_HIGH;

          const first = run(fs);
          if (inside) expect(first).toBeGreaterThan(0);

          if (withReset) {
            // reset() restarts the gate.
            detector.reset();
            expect(detector.historyLength).toBe(0);
            const second = run(fs);
            if (inside) expect(second).toBeGreaterThan(0);
          }
        },
      ),
      pbtParams(),
    );
  });
});
