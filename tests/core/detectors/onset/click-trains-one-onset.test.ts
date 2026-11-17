import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createOnsetDetector, frames } from "@earworm/core";
import type { EarwormEvent } from "@earworm/core";
import { clickTrain, whiteNoise } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 11: Click trains yield one Onset per click
// **Validates: Requirements 3.1, 3.9**

const LEAD_MS = 50;
const TAIL_MS = 200;
const CLICK_WIDTH_MS = 5;
const NOISE_AMP = 1e-4; // about -85 dBFS
const TOLERANCE_MS = 12;

const trainArb = fc.record({
  gaps: fc.array(fc.integer({ min: 120, max: 1000 }), {
    minLength: 0,
    maxLength: 11,
  }),
  levelDb: fc.double({ min: -30, max: -6, noNaN: true }),
  frameSize: fc.constantFrom(128, 512),
  sampleRate: fc.constantFrom(44100, 48000),
  seed: fc.integer({ min: 0, max: 0xffffffff }),
});

describe("Property 11: Click trains yield one Onset per click", () => {
  it("emits exactly one Onset within 12 ms of each click", () => {
    fc.assert(
      fc.property(
        trainArb,
        ({ gaps, levelDb, frameSize, sampleRate, seed }) => {
          const times: number[] = [LEAD_MS];
          for (const g of gaps) times.push(times[times.length - 1]! + g);
          const lastMs = times[times.length - 1]!;
          const n = Math.round(((lastMs + TAIL_MS) * sampleRate) / 1000);

          const amp = 10 ** (levelDb / 20);
          const signal = clickTrain(times, amp, n, sampleRate, CLICK_WIDTH_MS);
          const noise = whiteNoise(seed)(n, NOISE_AMP);
          for (let i = 0; i < n; i++)
            signal[i] = (signal[i] ?? 0) + (noise[i] ?? 0);

          const created = createOnsetDetector();
          if (!created.ok) throw new Error("detector creation failed");
          const onsets: EarwormEvent[] = [];
          for (const frame of frames(signal, 0, sampleRate, frameSize)) {
            for (const ev of created.value.process(frame)) {
              if (ev.type === "onset") onsets.push(ev);
            }
          }

          expect(onsets).toHaveLength(times.length);
          onsets.forEach((ev, i) => {
            expect(Math.abs(ev.timestamp - times[i]!)).toBeLessThanOrEqual(
              TOLERANCE_MS,
            );
          });
        },
      ),
      pbtParams(),
    );
  });
});
