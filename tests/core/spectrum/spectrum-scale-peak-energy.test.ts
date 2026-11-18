import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { spectrum } from "@earworm/core";
import type { WindowName } from "@earworm/core";
import { energyCheckFrame, tone } from "../../helpers/generators";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 51: Spectrum scale, peak and energy
// **Validates: Requirements 19.6, 19.7, 19.10, 19.11**

const WINDOWS: readonly WindowName[] = [
  "hann",
  "hamming",
  "blackman",
  "rectangular",
];

/** Window coefficients from their textbook definitions (periodic form), independent of the library. */
function windowOf(name: WindowName, size: number): Float64Array {
  const w = new Float64Array(size);
  for (let i = 0; i < size; i++) {
    const x = (2 * Math.PI * i) / size;
    switch (name) {
      case "hann":
        w[i] = 0.5 - 0.5 * Math.cos(x);
        break;
      case "hamming":
        w[i] = 0.54 - 0.46 * Math.cos(x);
        break;
      case "blackman":
        w[i] = 0.42 - 0.5 * Math.cos(x) + 0.08 * Math.cos(2 * x);
        break;
      default:
        w[i] = 1;
    }
  }
  return w;
}

describe("Property 51: Spectrum scale, peak and energy", () => {
  it("a bin-centre sine peaks within one bin and reads its amplitude in dBFS (hann)", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(256, 512, 1024, 2048, 4096, 8192),
        fc.constantFrom(8000, 44100, 48000, 192000),
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (size, sampleRate, amp, phase, binPick) => {
          const bin = 2 + Math.floor(binPick * (size / 2 - 3)); // 2 .. size/2 - 2
          const freq = (bin * sampleRate) / size;
          const samples = tone(freq, amp, size, sampleRate, phase);
          const result = spectrum(samples, sampleRate, size, "hann");
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const mags = result.value;

          let peak = 0;
          for (let k = 1; k < mags.length; k++) {
            if ((mags[k] as number) > (mags[peak] as number)) peak = k;
          }
          const ctx = `size=${size} sr=${sampleRate} bin=${bin} amp=${amp} peak=${peak}`;
          expect(Math.abs(peak - bin), ctx).toBeLessThanOrEqual(1);
          const expected = 20 * Math.log10(amp);
          expect(
            Math.abs((mags[bin] as number) - expected),
            `${ctx} got=${mags[bin]} expected=${expected}`,
          ).toBeLessThanOrEqual(0.5);
        },
      ),
      pbtParams(),
    );
  });

  it("bin power, scaled back and normalised by window power, equals the mean square of the windowed samples", () => {
    fc.assert(
      fc.property(
        energyCheckFrame(),
        fc.constantFrom(...WINDOWS),
        ({ samples, size, sampleRate }, windowName) => {
          const result = spectrum(samples, sampleRate, size, windowName);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          const mags = result.value;

          const w = windowOf(windowName, size);
          let sumW = 0;
          let meanSquare = 0;
          for (let i = 0; i < size; i++) {
            sumW += w[i] as number;
            const v = (samples[i] as number) * (w[i] as number);
            meanSquare += v * v;
          }
          meanSquare /= size;

          // Bin 0 reads |X0|/Σw and the others 2|Xk|/Σw. Parseval over the full
          // two-sided spectrum gives Σ|X|² = |X0|² + 2·Σ|Xk|² (k ≥ 1, energy
          // below Nyquist), and mean square = Σ|X|² / N².
          let binPower = 0;
          for (let k = 0; k < mags.length; k++) {
            const linear = Math.pow(10, (mags[k] as number) / 20);
            binPower += k === 0 ? linear * linear : (linear * linear) / 2;
          }
          const energy = (binPower * sumW * sumW) / (size * size);

          const relative = Math.abs(energy - meanSquare) / meanSquare;
          expect(
            relative,
            `size=${size} window=${windowName} energy=${energy} meanSquare=${meanSquare}`,
          ).toBeLessThanOrEqual(1e-3);
        },
      ),
      pbtParams(),
    );
  });
});
