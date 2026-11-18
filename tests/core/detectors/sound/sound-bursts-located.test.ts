import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createSoundDetector, frames } from "@earworm/core";
import type { EarwormEvent } from "@earworm/core";
import { burstTrain, whiteNoise } from "../../../helpers/generators";
import type { Burst } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 48: Sound bursts are located
// **Validates: Requirements 18.17**

const LEAD_MS = 50;
const TAIL_MS = 400;
const MIN_HOLD_MS = 30; // default Min_Hold
const HANGOVER_MS = 100; // default Hangover
const START_TOLERANCE_MS = 15;
const END_TOLERANCE_MS = 30;
const EPS = 1e-6; // absorbs floating-point error in Timestamps

const burstArb = fc.record({
  durationMs: fc.integer({ min: 100, max: 2000 }),
  levelDb: fc.double({ min: -40, max: -6, noNaN: true }),
  freq: fc.integer({ min: 300, max: 3000 }),
  // Silence before the next burst, on top of Hangover + 100 ms.
  extraGapMs: fc.integer({ min: 0, max: 400 }),
});

const caseArb = fc.record({
  bursts: fc.array(burstArb, { minLength: 1, maxLength: 4 }),
  // The Framing_Function supports exactly these sizes, the ends of the 128 to 512 range.
  frameSize: fc.constantFrom(128, 512),
  sampleRate: fc.constantFrom(44100, 48000),
  noiseOffsetDb: fc.double({ min: 20, max: 30, noNaN: true }),
  seed: fc.integer({ min: 0, max: 0xffffffff }),
});

describe("Property 48: Sound bursts are located", () => {
  it("emits one start and one end per burst at the right times", () => {
    fc.assert(
      fc.property(
        caseArb,
        ({ bursts, frameSize, sampleRate, noiseOffsetDb, seed }) => {
          const placed: Burst[] = [];
          let cursor = LEAD_MS;
          for (const b of bursts) {
            placed.push({
              startMs: cursor,
              durationMs: b.durationMs,
              freq: b.freq,
              amp: 10 ** (b.levelDb / 20),
            });
            cursor += b.durationMs + HANGOVER_MS + 100 + b.extraGapMs;
          }
          const n = Math.round(((cursor + TAIL_MS) * sampleRate) / 1000);
          const signal = burstTrain(placed, n, sampleRate);

          // Noise at least 20 dB below the quietest burst (peak amplitudes).
          const quietest = Math.min(...bursts.map((b) => b.levelDb));
          const noiseAmp = 10 ** ((quietest - noiseOffsetDb) / 20);
          const noise = whiteNoise(seed)(n, noiseAmp);
          for (let i = 0; i < n; i++)
            signal[i] = (signal[i] ?? 0) + (noise[i] ?? 0);

          const created = createSoundDetector();
          if (!created.ok) throw new Error("detector creation failed");
          // Store the noise RMS level as the Noise_Floor, as Calibration would (Req 18.15).
          const floor = created.value.setNoiseFloor(
            20 * Math.log10(noiseAmp / Math.sqrt(3)),
          );
          if (!floor.ok) throw new Error("setNoiseFloor failed");
          const starts: Extract<EarwormEvent, { type: "sound-start" }>[] = [];
          const ends: Extract<EarwormEvent, { type: "sound-end" }>[] = [];
          for (const frame of frames(signal, 0, sampleRate, frameSize)) {
            for (const ev of created.value.process(frame)) {
              if (ev.type === "sound-start") starts.push(ev);
              else if (ev.type === "sound-end") ends.push(ev);
            }
          }

          const frameMs = (frameSize / sampleRate) * 1000;
          expect(starts).toHaveLength(placed.length);
          expect(ends).toHaveLength(placed.length);
          placed.forEach((b, i) => {
            const s = starts[i]!;
            const e = ends[i]!;
            expect(Math.abs(s.startTime - b.startMs)).toBeLessThanOrEqual(
              START_TOLERANCE_MS,
            );
            expect(s.timestamp).toBeGreaterThanOrEqual(
              s.startTime + MIN_HOLD_MS - EPS,
            );
            expect(s.timestamp).toBeLessThan(
              s.startTime + MIN_HOLD_MS + frameMs + EPS,
            );

            const trueEnd = b.startMs + b.durationMs;
            expect(Math.abs(e.endTime - trueEnd)).toBeLessThanOrEqual(
              END_TOLERANCE_MS,
            );
            expect(e.timestamp).toBeGreaterThanOrEqual(
              e.endTime + HANGOVER_MS - EPS,
            );
            expect(e.timestamp).toBeLessThan(
              e.endTime + HANGOVER_MS + frameMs + EPS,
            );
          });
        },
      ),
      pbtParams(),
    );
  });
});
