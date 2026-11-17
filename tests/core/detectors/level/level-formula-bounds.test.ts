import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createLevelDetector } from "@earworm/core";
import type { Frame } from "@earworm/core";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 16: Level formula and bounds
// **Validates: Requirements 5.1, 5.4, 5.5, 5.6, 5.7**

function levelOf(samples: Float32Array): number {
  const created = createLevelDetector();
  if (!created.ok) throw new Error("detector creation failed");
  const frame: Frame = { samples, timestamp: 0, sampleRate: 48000 };
  const events = created.value.process(frame);
  expect(events).toHaveLength(1);
  const ev = events[0]!;
  if (ev.type !== "level") throw new Error("expected a level event");
  return ev.level;
}

function expectedDb(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(0, Math.max(-120, 20 * Math.log10(rms)));
}

const sampleArb = fc.float({
  min: -1,
  max: 1,
  noNaN: true,
  noDefaultInfinity: true,
});
const framesArb = fc
  .array(sampleArb, { minLength: 1, maxLength: 512 })
  .map((a) => Float32Array.from(a));

describe("Property 16: Level formula and bounds", () => {
  it("level equals 20·log10(RMS) clamped to [-120, 0]", () => {
    fc.assert(
      fc.property(framesArb, (samples) => {
        const level = levelOf(samples);
        expect(Math.abs(level - expectedDb(samples))).toBeLessThan(1e-6);
      }),
      pbtParams(),
    );
  });

  it("level is always within [-120, 0]", () => {
    fc.assert(
      fc.property(
        framesArb,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (samples, gain) => {
          const scaled = samples.map((s) => s * gain);
          const level = levelOf(scaled);
          expect(level).toBeGreaterThanOrEqual(-120);
          expect(level).toBeLessThanOrEqual(0);
        },
      ),
      pbtParams(),
    );
  });

  it("full-scale sine is within 0.5 dB of -3.01 dBFS", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(256, 512, 1024, 2048),
        fc.integer({ min: 1, max: 100 }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        (n, cycles, phase) => {
          const samples = new Float32Array(n);
          for (let i = 0; i < n; i++)
            samples[i] = Math.sin((2 * Math.PI * cycles * i) / n + phase);
          expect(Math.abs(levelOf(samples) - -3.01)).toBeLessThanOrEqual(0.5);
        },
      ),
      pbtParams(),
    );
  });

  it("full-scale square is 0 dBFS", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1024 }),
        fc.boolean(),
        (n, startHigh) => {
          const samples = new Float32Array(n);
          for (let i = 0; i < n; i++)
            samples[i] = (i % 2 === 0) === startHigh ? 1 : -1;
          expect(Math.abs(levelOf(samples))).toBeLessThan(1e-9);
        },
      ),
      pbtParams(),
    );
  });

  it("all-zero Frame gives exactly -120", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2048 }), (n) => {
        expect(levelOf(new Float32Array(n))).toBe(-120);
      }),
      pbtParams(),
    );
  });

  it("tiny non-zero Frame floors at -120", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 512 }),
        fc.double({ min: 1e-37, max: 1e-7, noNaN: true }),
        (n, amp) => {
          const samples = new Float32Array(n).fill(amp);
          expect(levelOf(samples)).toBe(-120);
        },
      ),
      pbtParams(),
    );
  });
});
