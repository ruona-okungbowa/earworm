import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { spectrum } from "@earworm/core";
import type { WindowName } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 49: Spectrum shape, bounds and determinism
// **Validates: Requirements 19.1, 19.8, 19.9, 19.12, 19.13**

const sizeArb = fc.constantFrom(256, 512, 1024, 2048);
const windowArb = fc.constantFrom<WindowName>("hann", "hamming", "blackman", "rectangular");
const rateArb = fc.constantFrom(8000, 16000, 44100, 48000, 192000);
const sampleArb = fc.float({ min: -2, max: 2, noNaN: true, noDefaultInfinity: true });

const scenarioArb = sizeArb.chain((size) =>
  fc.record({
    size: fc.constant(size),
    window: windowArb,
    rate: rateArb,
    samples: fc
      .array(sampleArb, { minLength: 1, maxLength: size * 2 + 50 })
      .map((a) => Float32Array.from(a)),
  }),
);

describe("Property 49: spectrum shape, bounds and determinism", () => {
  it("has size/2 bins, all within -120..+6 dBFS", () => {
    fc.assert(
      fc.property(scenarioArb, ({ size, window, rate, samples }) => {
        const r = spectrum(samples, rate, size, window);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(r.value.length).toBe(size / 2);
        for (const v of r.value) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(-120);
          expect(v).toBeLessThanOrEqual(6);
        }
      }),
      pbtParams(),
    );
  });

  it("is deterministic and does not modify its input", () => {
    fc.assert(
      fc.property(scenarioArb, ({ size, window, rate, samples }) => {
        const before = Float32Array.from(samples);
        const a = spectrum(samples, rate, size, window);
        const b = spectrum(samples, rate, size, window);
        expect(Array.from(samples)).toEqual(Array.from(before));
        expect(a.ok && b.ok).toBe(true);
        if (a.ok && b.ok) expect(Array.from(a.value)).toEqual(Array.from(b.value));
      }),
      pbtParams(),
    );
  });

  it("uses only the last `size` samples of a longer buffer", () => {
    fc.assert(
      fc.property(
        sizeArb.chain((size) =>
          fc.record({
            size: fc.constant(size),
            window: windowArb,
            rate: rateArb,
            extra: fc.array(sampleArb, { minLength: 1, maxLength: 300 }).map((a) => Float32Array.from(a)),
            tail: fc.array(sampleArb, { minLength: size, maxLength: size }).map((a) => Float32Array.from(a)),
          }),
        ),
        ({ size, window, rate, extra, tail }) => {
          const long = new Float32Array(extra.length + tail.length);
          long.set(extra, 0);
          long.set(tail, extra.length);
          const a = spectrum(long, rate, size, window);
          const b = spectrum(tail, rate, size, window);
          expect(a.ok && b.ok).toBe(true);
          if (a.ok && b.ok) expect(Array.from(a.value)).toEqual(Array.from(b.value));
        },
      ),
      pbtParams(),
    );
  });

  it("reads silence as the -120 dBFS floor", () => {
    const r = spectrum(new Float32Array(512), 48000, 256, "hann");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.length).toBe(128);
      expect(r.value.every((v) => v === -120)).toBe(true);
    }
  });
});
