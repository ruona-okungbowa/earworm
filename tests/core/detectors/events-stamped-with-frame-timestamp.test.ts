import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createBandDetector,
  createEnvelopeDetector,
  createLevelDetector,
  createOnsetDetector,
  createPitchDetector,
  createSoundDetector,
  createSpectrumDetector,
} from "@earworm/core";
import type { Detector, EarwormEvent, Frame } from "@earworm/core";
import { tone, whiteNoise } from "../../helpers/generators";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 8: Detector Events are stamped with the Frame Timestamp
// **Validates: Requirements 1.12, 5.3, 17.6, 18.3, 18.4, 18.10**

const SAMPLE_RATE = 48000;
const FRAME_SIZE = 512;
const STEP_MS = (FRAME_SIZE / SAMPLE_RATE) * 1000;

const AMPLITUDES = [0, 1e-5, 0.003, 0.05, 0.5, 0.9];

const sequenceArb = fc.record({
  amps: fc.array(fc.constantFrom(...AMPLITUDES), {
    minLength: 1,
    maxLength: 80,
  }),
  gaps: fc.array(fc.double({ min: 0, max: 40, noNaN: true }), {
    minLength: 80,
    maxLength: 80,
  }),
  startMs: fc.double({ min: 0, max: 10_000, noNaN: true }),
  freq: fc.double({ min: 100, max: 1500, noNaN: true }),
  noisy: fc.boolean(),
  seed: fc.integer({ min: 0, max: 0xffffffff }),
});

function makeDetectors(): Detector[] {
  const created = [
    createLevelDetector(),
    createEnvelopeDetector(),
    createOnsetDetector(),
    createPitchDetector(),
    createSoundDetector({ minHold: 0, hangover: 20 }),
    createSpectrumDetector({ fftSize: 512, maxRate: 100 }),
    createBandDetector({ fftSize: 512, maxRate: 100 }),
  ];
  return created.map((r) => {
    if (!r.ok) throw new Error("detector creation failed");
    return r.value;
  });
}

describe("Property 8: Detector Events are stamped with the Frame Timestamp", () => {
  it("stamps every Event with its Frame's timestamp and keeps Events non-decreasing", () => {
    let totalEvents = 0;
    fc.assert(
      fc.property(
        sequenceArb,
        ({ amps, gaps, startMs, freq, noisy, seed }) => {
          const detectors = makeDetectors();
          const noise = whiteNoise(seed);
          const all: EarwormEvent[] = [];
          let ts = startMs;
          amps.forEach((amp, i) => {
            ts += i === 0 ? 0 : STEP_MS + (gaps[i] ?? 0);
            const samples = noisy
              ? noise(FRAME_SIZE, amp)
              : tone(freq, amp, FRAME_SIZE, SAMPLE_RATE, i);
            const frame: Frame = {
              samples,
              timestamp: ts,
              sampleRate: SAMPLE_RATE,
            };
            for (const d of detectors) {
              for (const ev of d.process(frame)) {
                expect(ev.timestamp).toBe(frame.timestamp);
                if (ev.type === "sound-start") {
                  expect(ev.startTime).toBeLessThanOrEqual(ev.timestamp);
                }
                if (ev.type === "sound-end") {
                  expect(ev.endTime).toBeLessThanOrEqual(ev.timestamp);
                }
                all.push(ev);
              }
            }
          });
          totalEvents += all.length;
          for (let i = 1; i < all.length; i++) {
            expect(all[i]!.timestamp).toBeGreaterThanOrEqual(
              all[i - 1]!.timestamp,
            );
          }
        },
      ),
      pbtParams(),
    );
    expect(totalEvents).toBeGreaterThan(0);
  });
});
