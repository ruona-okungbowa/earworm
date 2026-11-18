import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createPitchDetector } from "@earworm/core";
import type { EarwormEvent, Frame } from "@earworm/core";
import { tone, whiteNoise } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 15: Silence and noise produce no Pitch
// **Validates: Requirements 4.6, 4.10**

const SAMPLE_RATE = 48000;
const FRAME_SIZE = 512;
const STEP_MS = (FRAME_SIZE / SAMPLE_RATE) * 1000;

function makeDetector(noiseFloor?: number) {
  const created = createPitchDetector();
  if (!created.ok) throw new Error("detector creation failed");
  if (noiseFloor !== undefined) {
    expect(created.value.setNoiseFloor(noiseFloor).ok).toBe(true);
  }
  return created.value;
}

function run(
  det: ReturnType<typeof makeDetector>,
  frames: Float32Array[],
): EarwormEvent[] {
  const events: EarwormEvent[] = [];
  frames.forEach((samples, i) => {
    const frame: Frame = {
      samples,
      timestamp: i * STEP_MS,
      sampleRate: SAMPLE_RATE,
    };
    events.push(...det.process(frame));
  });
  return events;
}

describe("Property 15: Silence and noise produce no Pitch", () => {
  it("emits no Pitch_Event for all-zero Frames", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 40 }),
        fc.integer({ min: -100, max: -20 }),
        (count, noiseFloor) => {
          const det = makeDetector(noiseFloor);
          const frames = Array.from(
            { length: count },
            () => new Float32Array(FRAME_SIZE),
          );
          expect(run(det, frames).filter((e) => e.type === "pitch")).toEqual(
            [],
          );
        },
      ),
      pbtParams(),
    );
  });

  it("emits no Pitch_Event for a tone whose level is below the Noise_Floor", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -100, max: -30 }),
        fc.double({ min: 100, max: 1800, noNaN: true }),
        fc.integer({ min: 8, max: 20 }),
        (noiseFloor, freq, count) => {
          const det = makeDetector(noiseFloor);
          // A sine of amplitude A has RMS A/√2; keep it 1 dB under the Noise_Floor.
          const amp = Math.SQRT2 * Math.pow(10, (noiseFloor - 1) / 20);
          const frames: Float32Array[] = [];
          for (let i = 0; i < count; i++) {
            frames.push(
              tone(
                freq,
                amp,
                FRAME_SIZE,
                SAMPLE_RATE,
                (2 * Math.PI * freq * i * FRAME_SIZE) / SAMPLE_RATE,
              ),
            );
          }
          expect(run(det, frames).filter((e) => e.type === "pitch")).toEqual(
            [],
          );
        },
      ),
      pbtParams(),
    );
  });

  it("emits no Pitch_Event for seeded white noise above the Noise_Floor", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.double({ min: 0.05, max: 1, noNaN: true }),
        fc.integer({ min: 8, max: 20 }),
        (seed, amp, count) => {
          const det = makeDetector();
          const noise = whiteNoise(seed);
          const frames = Array.from({ length: count }, () =>
            noise(FRAME_SIZE, amp),
          );
          expect(run(det, frames).filter((e) => e.type === "pitch")).toEqual(
            [],
          );
        },
      ),
      pbtParams(),
    );
  });
});
