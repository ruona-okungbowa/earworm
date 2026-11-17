import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createEnvelopeDetector } from "@earworm/core";
import type { EarwormEvent } from "@earworm/core";
import { frameSequence } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 45: Envelope matches the recurrence
// **Validates: Requirements 17.1, 17.2, 17.4, 17.7, 17.9**

const FRAME_SIZE = 128;
const SAMPLE_RATE = 48000;

/** Independent Frame level: 20·log10(RMS), floored at -120. */
function refLevel(samples: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  const rms = Math.sqrt(sum / samples.length);
  if (rms === 0) return -120;
  return Math.max(-120, 20 * Math.log10(rms));
}

const gainArb = fc.oneof(
  fc.constant(0),
  fc.constant(1),
  fc.double({ min: 0, max: 1, noNaN: true }),
  fc.double({ min: -6, max: 0, noNaN: true }).map((e) => 10 ** e),
);

const timeConstantArb = fc.oneof(
  fc.constant(0),
  fc.constant(10000),
  fc.integer({ min: 0, max: 10000 }),
);

describe("Property 45: Envelope matches the recurrence", () => {
  it("emitted levels equal the reference recurrence and stay bounded", () => {
    fc.assert(
      fc.property(
        frameSequence({
          frameSize: FRAME_SIZE,
          sampleRate: SAMPLE_RATE,
          minLength: 1,
          maxLength: 40,
          inject: ["empty", "non-finite-sample", "stale-timestamp"],
        }),
        fc.array(gainArb, { minLength: 40, maxLength: 40 }),
        timeConstantArb,
        timeConstantArb,
        (tagged, gains, attack, release) => {
          const created = createEnvelopeDetector({
            attack,
            release,
            maxRate: 100,
          });
          if (!created.ok) throw new Error("detector creation failed");
          const detector = created.value;

          let s = -120;
          let prev: number | null = null;
          let maxLevel = -Infinity;

          tagged.forEach((t, i) => {
            if (t.valid) {
              const g = gains[i]!;
              for (let k = 0; k < t.frame.samples.length; k++) {
                t.frame.samples[k] = t.frame.samples[k]! * g;
              }
            }
            const events: EarwormEvent[] = detector.process(t.frame);
            if (!t.valid) {
              // Invalid Frames emit nothing and leave state unchanged.
              expect(events).toEqual([]);
              return;
            }

            const level = refLevel(t.frame.samples);
            const dt =
              prev === null
                ? (t.frame.samples.length / t.frame.sampleRate) * 1000
                : t.frame.timestamp - prev;
            prev = t.frame.timestamp;
            const tau = level > s ? attack : release;
            const step = tau === 0 ? 1 : 1 - Math.exp(-dt / tau);
            s += (level - s) * step;
            s = Math.min(0, Math.max(-120, s));
            maxLevel = Math.max(maxLevel, level);

            for (const ev of events) {
              if (ev.type !== "envelope") throw new Error("unexpected event");
              expect(ev.level).toBeCloseTo(s, 6);
              expect(ev.level).toBeGreaterThanOrEqual(-120);
              expect(ev.level).toBeLessThanOrEqual(0);
              // Never exceeds the highest Frame level so far (tolerance for rounding).
              expect(ev.level).toBeLessThanOrEqual(
                Math.max(-120, maxLevel) + 1e-6,
              );
            }
          });
        },
      ),
      pbtParams(),
    );
  });

  it("all-zero input moves toward -120 and never goes below it", () => {
    fc.assert(
      fc.property(
        timeConstantArb,
        timeConstantArb,
        fc.integer({ min: 1, max: 30 }),
        (attack, release, count) => {
          const created = createEnvelopeDetector({
            attack,
            release,
            maxRate: 100,
          });
          if (!created.ok) throw new Error("detector creation failed");
          const detector = created.value;
          const stepMs = (FRAME_SIZE / SAMPLE_RATE) * 1000 + 10;
          // Raise the level first, then feed silence.
          const loud = new Float32Array(FRAME_SIZE).fill(0.5);
          detector.process({
            samples: loud,
            timestamp: 0,
            sampleRate: SAMPLE_RATE,
          });
          let last = Infinity;
          for (let i = 1; i <= count; i++) {
            const events = detector.process({
              samples: new Float32Array(FRAME_SIZE),
              timestamp: i * stepMs,
              sampleRate: SAMPLE_RATE,
            });
            for (const ev of events) {
              if (ev.type !== "envelope") throw new Error("unexpected event");
              expect(ev.level).toBeGreaterThanOrEqual(-120);
              expect(ev.level).toBeLessThanOrEqual(last + 1e-9);
              last = ev.level;
            }
          }
        },
      ),
      pbtParams(),
    );
  });

  it("starts at -120: a first all-zero Frame emits -120", () => {
    const created = createEnvelopeDetector();
    if (!created.ok) throw new Error("detector creation failed");
    const events = created.value.process({
      samples: new Float32Array(FRAME_SIZE),
      timestamp: 0,
      sampleRate: SAMPLE_RATE,
    });
    expect(events).toHaveLength(1);
    expect((events[0] as { level: number }).level).toBe(-120);
  });
});
