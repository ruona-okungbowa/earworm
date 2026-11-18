import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createPitchDetector, frames } from "@earworm/core";
import type { EarwormEvent } from "@earworm/core";
import { harmonicTone, whiteNoise } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 12: Pitch Events are well formed and confident
// **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.7**

type PitchEvent = Extract<EarwormEvent, { type: "pitch" }>;

const caseArb = fc.record({
  // Includes frequencies outside 80..2000 Hz.
  freq: fc.double({ min: 40, max: 3000, noNaN: true }),
  harmonics: fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
    minLength: 0,
    maxLength: 3,
  }),
  amp: fc.double({ min: 0.05, max: 0.5, noNaN: true }),
  noiseRatio: fc.double({ min: 0, max: 1.5, noNaN: true }),
  threshold: fc.double({ min: 0, max: 1, noNaN: true }),
  frameSize: fc.constantFrom(128, 512),
  sampleRate: fc.constantFrom(44100, 48000),
  startMs: fc.integer({ min: 0, max: 100000 }),
  seed: fc.integer({ min: 0, max: 0xffffffff }),
});

describe("Property 12: Pitch Events are well formed and confident", () => {
  it("every emitted Pitch_Event is in range, confident and carries the Frame Timestamp", () => {
    fc.assert(
      fc.property(
        caseArb,
        ({
          freq,
          harmonics,
          amp,
          noiseRatio,
          threshold,
          frameSize,
          sampleRate,
          startMs,
          seed,
        }) => {
          const n = Math.round(sampleRate * 0.12);
          const signal = harmonicTone(
            freq,
            [amp, ...harmonics.map((h) => h * amp)],
            n,
            sampleRate,
          );
          const noise = whiteNoise(seed)(n, amp * noiseRatio);
          for (let i = 0; i < n; i++)
            signal[i] = (signal[i] ?? 0) + (noise[i] ?? 0);

          const created = createPitchDetector({
            confidenceThreshold: threshold,
          });
          if (!created.ok) throw new Error("detector creation failed");

          for (const frame of frames(signal, startMs, sampleRate, frameSize)) {
            const events = created.value.process(frame);
            expect(events.length).toBeLessThanOrEqual(1);
            for (const ev of events) {
              expect(ev.type).toBe("pitch");
              const p = ev as PitchEvent;
              expect(p.frequency).toBeGreaterThanOrEqual(80);
              expect(p.frequency).toBeLessThanOrEqual(2000);
              expect(Number.isInteger(p.midi)).toBe(true);
              expect(p.midi).toBeGreaterThanOrEqual(0);
              expect(p.midi).toBeLessThanOrEqual(127);
              expect(p.cents).toBeGreaterThanOrEqual(-50);
              expect(p.cents).toBeLessThanOrEqual(50);
              expect(p.confidence).toBeGreaterThanOrEqual(0);
              expect(p.confidence).toBeLessThanOrEqual(1);
              expect(p.confidence).toBeGreaterThanOrEqual(threshold);
              expect(p.timestamp).toBe(frame.timestamp);
            }
          }
        },
      ),
      pbtParams(),
    );
  }, 120_000);

  it("a pure tone emits at least one event at a low threshold", () => {
    const sampleRate = 48000;
    const signal = harmonicTone(440, [0.5], sampleRate / 4, sampleRate);
    const created = createPitchDetector({ confidenceThreshold: 0.5 });
    if (!created.ok) throw new Error("detector creation failed");
    let count = 0;
    for (const frame of frames(signal, 0, sampleRate, 512)) {
      count += created.value.process(frame).length;
    }
    expect(count).toBeGreaterThan(0);
  });
});
