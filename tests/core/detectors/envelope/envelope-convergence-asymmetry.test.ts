import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createEnvelopeDetector } from "@earworm/core";
import type { EarwormEvent } from "@earworm/core";
import { tone } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 46: Envelope convergence and asymmetry
// **Validates: Requirements 17.10, 17.11**

const SAMPLE_RATE = 48000;

/** Independent Frame level: 20·log10(RMS), floored at -120. */
function refLevel(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / samples.length);
  return rms === 0 ? -120 : Math.max(-120, 20 * Math.log10(rms));
}

function envelopeLevel(ev: EarwormEvent): number {
  if (ev.type !== "envelope") throw new Error("unexpected event");
  return ev.level;
}

describe("Property 46: Envelope convergence and asymmetry", () => {
  it("a constant sine converges to within 0.5 dB after 6 attack time constants", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -60, max: -3.1, noNaN: true }),
        fc.constantFrom(128, 256, 512, 1024),
        fc.integer({ min: 1, max: 1000 }),
        fc.double({ min: 100, max: 2000, noNaN: true }),
        (targetDb, frameSize, attack, freq) => {
          const amp = Math.SQRT2 * 10 ** (targetDb / 20);
          const samples = tone(freq, amp, frameSize, SAMPLE_RATE);
          const frameLevel = refLevel(samples);

          const created = createEnvelopeDetector({
            attack,
            maxRate: 100,
          });
          if (!created.ok) throw new Error("detector creation failed");
          const detector = created.value;

          const step = (frameSize / SAMPLE_RATE) * 1000;
          // Elapsed time at frame k is (k + 1) · step: the first Frame covers one step.
          const settleMs = 6 * attack;
          const endMs = settleMs + 30;
          let checked = 0;
          for (let k = 0; (k + 1) * step <= endMs + step; k++) {
            const events = detector.process({
              samples,
              timestamp: k * step,
              sampleRate: SAMPLE_RATE,
            });
            if ((k + 1) * step < settleMs) continue;
            for (const ev of events) {
              expect(Math.abs(envelopeLevel(ev) - frameLevel)).toBeLessThanOrEqual(
                0.5,
              );
              checked++;
            }
          }
          expect(checked).toBeGreaterThan(0);
        },
      ),
      pbtParams(),
    );
  });

  it("with attack shorter than release, half of an upward step is faster than half of a downward step", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 6, max: 57 }),
        fc.integer({ min: 40, max: 200 }),
        fc.double({ min: 2, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (d, attack, releaseFactor, loPick) => {
          // Release is at least twice the attack; with a 100 Hz Event limit this keeps
          // the 10 ms Event spacing smaller than the expected time difference.
          const release = Math.min(600, Math.round(attack * releaseFactor));
          fc.pre(release >= 2 * attack);
          const lo = -60 + loPick * (57 - d); // Lo in [-60, -3 - d] so Hi = Lo + d <= -3
          const hi = lo + d;

          const created = createEnvelopeDetector({
            attack,
            release,
            maxRate: 100,
          });
          if (!created.ok) throw new Error("detector creation failed");
          const detector = created.value;

          const frameSize = 128;
          const step = (frameSize / SAMPLE_RATE) * 1000;
          const loFrame = new Float32Array(frameSize).fill(10 ** (lo / 20));
          const hiFrame = new Float32Array(frameSize).fill(10 ** (hi / 20));
          let k = 0;
          const feed = (samples: Float32Array): EarwormEvent[] =>
            detector.process({
              samples,
              timestamp: k++ * step,
              sampleRate: SAMPLE_RATE,
            });

          const settleFrames = Math.ceil((15 * attack) / step);
          for (let i = 0; i < settleFrames; i++) feed(loFrame);

          // Upward step: time until the level covers half of D.
          const upStart = k * step;
          const upTarget = lo + d / 2;
          let upTime: number | null = null;
          for (let i = 0; i < settleFrames && upTime === null; i++) {
            const t = k * step;
            for (const ev of feed(hiFrame)) {
              if (upTime === null && envelopeLevel(ev) >= upTarget) {
                upTime = t - upStart;
              }
            }
          }
          expect(upTime).not.toBeNull();

          // Settle at Hi, then step down.
          for (let i = 0; i < settleFrames; i++) feed(hiFrame);
          const downStart = k * step;
          const downTarget = hi - d / 2;
          const downFrames = Math.ceil((12 * release) / step);
          let downTime: number | null = null;
          for (let i = 0; i < downFrames && downTime === null; i++) {
            const t = k * step;
            for (const ev of feed(loFrame)) {
              if (downTime === null && envelopeLevel(ev) <= downTarget) {
                downTime = t - downStart;
              }
            }
          }
          expect(downTime).not.toBeNull();
          expect(upTime!).toBeLessThan(downTime!);
        },
      ),
      pbtParams(),
    );
  });
});
