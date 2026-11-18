import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createPitchDetector, frames } from "@earworm/core";
import { harmonicTone } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 14: Harmonic tones report the fundamental
// **Validates: Requirements 4.9**

const PITCH_WINDOW = 2048;
const FRAME_SIZE = 128;
const MAX_CENTS = 20;
const TONE_SAMPLES = 8192;

const caseArb = fc.record({
  f0: fc.double({ min: 80, max: 1000, noNaN: true }),
  // At least 4 harmonics. Amplitudes sum to at most 0.88, so samples stay in [-1, 1]
  // and the level stays far above the default Noise_Floor.
  amps: fc.array(fc.double({ min: 0.05, max: 0.11, noNaN: true }), {
    minLength: 4,
    maxLength: 8,
  }),
  sampleRate: fc.constantFrom(44100, 48000),
});

function centsFrom(f: number, f0: number): number {
  return 1200 * Math.log2(f / f0);
}

describe("Property 14: Harmonic tones report the fundamental", () => {
  it("reports every frequency within 20 cents of the fundamental, never an octave off", () => {
    fc.assert(
      fc.property(caseArb, ({ f0, amps, sampleRate }) => {
        const created = createPitchDetector();
        if (!created.ok) throw new Error(created.error.message);
        const detector = created.value;

        const samples = harmonicTone(f0, amps, TONE_SAMPLES, sampleRate);
        let reported = 0;
        for (const frame of frames(samples, 0, sampleRate, FRAME_SIZE)) {
          const events = detector.process(frame);
          // Before the history is full, zero padding is part of the signal.
          if (detector.historyLength < PITCH_WINDOW) continue;
          for (const event of events) {
            if (event.type !== "pitch") continue;
            reported++;
            const cents = centsFrom(event.frequency, f0);
            expect(Math.abs(cents)).toBeLessThanOrEqual(MAX_CENTS);
            // Explicitly never an octave above or below.
            expect(Math.abs(Math.abs(cents) - 1200)).toBeGreaterThan(MAX_CENTS);
          }
        }
        expect(reported).toBeGreaterThan(0);
      }),
      pbtParams(),
    );
  });

  it("reports 220 Hz with 5 harmonics at 48 kHz", () => {
    const created = createPitchDetector();
    if (!created.ok) throw new Error(created.error.message);
    const samples = harmonicTone(220, [0.2, 0.15, 0.1, 0.1, 0.05], 4096, 48000);
    const freqs: number[] = [];
    for (const frame of frames(samples, 0, 48000, FRAME_SIZE)) {
      for (const e of created.value.process(frame)) {
        if (e.type === "pitch") freqs.push(e.frequency);
      }
    }
    expect(freqs.length).toBeGreaterThan(0);
    for (const f of freqs) {
      expect(Math.abs(centsFrom(f, 220))).toBeLessThanOrEqual(MAX_CENTS);
    }
  });
});
