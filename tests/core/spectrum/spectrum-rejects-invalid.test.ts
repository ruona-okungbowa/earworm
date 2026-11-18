import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { SUPPORTED_FFT_SIZES, spectrum } from "@earworm/core";
import type { WindowName } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 50: Spectrum rejects invalid input
// **Validates: Requirements 19.2, 19.3, 19.4, 19.5**

const validSize = fc.constantFrom(...SUPPORTED_FFT_SIZES);
const validRate = fc.double({ min: 8000, max: 192_000, noNaN: true });
const validSamples = fc
  .array(fc.float({ min: -1, max: 1, noNaN: true }), {
    minLength: 1,
    maxLength: 600,
  })
  .map((a) => Float32Array.from(a));

const invalidSize = fc.oneof(
  fc.integer({ min: -10_000, max: 20_000 }).filter((n) => !SUPPORTED_FFT_SIZES.includes(n)),
  fc.constantFrom(NaN, Infinity, -Infinity, 0, 128, 16_384, 300.5),
  fc.double().filter((n) => !SUPPORTED_FFT_SIZES.includes(n)),
);
const invalidRate = fc.oneof(
  fc.constantFrom(NaN, Infinity, -Infinity, 0, 7999.99, 192_000.01, -48_000),
  fc.double({ min: -1e9, max: 7999.999, noNaN: true }),
  fc.double({ min: 192_000.001, max: 1e9, noNaN: true }),
);
const unknownWindow = fc
  .string()
  .filter((s) => !["hann", "hamming", "blackman", "rectangular"].includes(s));
const badSample = fc.constantFrom(NaN, Infinity, -Infinity);
const badSamples = fc
  .tuple(validSamples, badSample, fc.nat())
  .map(([s, bad, i]) => {
    const copy = Float32Array.from(s);
    copy[i % copy.length] = bad;
    return copy;
  });

function code(r: ReturnType<typeof spectrum>): string | undefined {
  return r.ok ? undefined : r.error.code;
}

describe("Property 50: Spectrum rejects invalid input", () => {
  it("rejects a size that is not a supported power of two", () => {
    fc.assert(
      fc.property(validSamples, validRate, invalidSize, (s, r, size) => {
        const res = spectrum(s, r, size);
        expect(res.ok).toBe(false);
        expect(code(res)).toBe("invalid-fft-size");
      }),
      pbtParams(),
    );
  });

  it("rejects a non-finite or out-of-range sample rate", () => {
    fc.assert(
      fc.property(validSamples, invalidRate, validSize, (s, r, size) => {
        const res = spectrum(s, r, size);
        expect(res.ok).toBe(false);
        expect(code(res)).toBe("invalid-sample-rate");
      }),
      pbtParams(),
    );
  });

  it("rejects an unknown window name", () => {
    fc.assert(
      fc.property(validSamples, validRate, validSize, unknownWindow, (s, r, size, w) => {
        const res = spectrum(s, r, size, w as WindowName);
        expect(res.ok).toBe(false);
        expect(code(res)).toBe("invalid-window");
      }),
      pbtParams(),
    );
  });

  it("uses hann when no window is given", () => {
    fc.assert(
      fc.property(validSamples, validRate, validSize, (s, r, size) => {
        const a = spectrum(s, r, size);
        const b = spectrum(s, r, size, "hann");
        expect(a.ok).toBe(true);
        expect(b.ok).toBe(true);
        if (a.ok && b.ok) expect(Array.from(a.value)).toEqual(Array.from(b.value));
      }),
      pbtParams(),
    );
  });

  it("rejects empty samples", () => {
    fc.assert(
      fc.property(validRate, validSize, (r, size) => {
        const res = spectrum(new Float32Array(0), r, size);
        expect(res.ok).toBe(false);
        expect(code(res)).toBe("invalid-samples");
      }),
      pbtParams(),
    );
  });

  it("rejects any NaN or infinite sample", () => {
    fc.assert(
      fc.property(badSamples, validRate, validSize, (s, r, size) => {
        const res = spectrum(s, r, size);
        expect(res.ok).toBe(false);
        expect(code(res)).toBe("invalid-samples");
      }),
      pbtParams(),
    );
  });

  it("reports the first failing check in order: size, sample rate, window, samples", () => {
    const bad = new Float32Array([NaN]);
    const empty = new Float32Array(0);
    const badWin = "nope" as WindowName;
    fc.assert(
      fc.property(fc.constantFrom(bad, empty), (s) => {
        expect(code(spectrum(s, NaN, 100, badWin))).toBe("invalid-fft-size");
        expect(code(spectrum(s, NaN, 1024, badWin))).toBe("invalid-sample-rate");
        expect(code(spectrum(s, 48_000, 1024, badWin))).toBe("invalid-window");
        expect(code(spectrum(s, 48_000, 1024, "hann"))).toBe("invalid-samples");
      }),
      pbtParams(),
    );
  });

  it("never throws, whatever the arguments", () => {
    fc.assert(
      fc.property(
        fc.anything(),
        fc.anything(),
        fc.anything(),
        fc.anything(),
        (s, r, size, w) => {
          const res = spectrum(s as Float32Array, r as number, size as number, w as WindowName);
          if (!res.ok) expect(typeof res.error.code).toBe("string");
        },
      ),
      pbtParams(),
    );
  });
});
