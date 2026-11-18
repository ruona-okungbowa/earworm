import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { bands, spectrum } from "@earworm/core";
import type { Band } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";
import { whiteNoise } from "../../helpers/generators";

// Feature: earworm-kit, Property 55: White noise spreads evenly across Bands

const SAMPLE_RATE = 48_000;
const NYQUIST = SAMPLE_RATE / 2;
const FFT_SIZE = 1024;
const FRAME_COUNT = 64; // 64 * 1024 = 65,536 samples
const SIXTEENTH = NYQUIST / 16;

/** Sixteen equal Bands, a few wider ones, and the full band. */
const BAND_LIST: Band[] = [
  ...Array.from({ length: 16 }, (_, i) => ({
    name: `s${i}`,
    lowHz: i * SIXTEENTH,
    highHz: (i + 1) * SIXTEENTH,
  })),
  { name: "lowHalf", lowHz: 0, highHz: NYQUIST / 2 },
  { name: "upperHalf", lowHz: NYQUIST / 2, highHz: NYQUIST },
  { name: "middle", lowHz: 3 * SIXTEENTH, highHz: 9 * SIXTEENTH },
  { name: "full", lowHz: 0, highHz: NYQUIST },
];

const linear = (dbfs: number): number => Math.pow(10, dbfs / 10);

function averageEnergies(seed: number): Record<string, number> {
  const next = whiteNoise(seed);
  const sums: Record<string, number> = {};
  for (const b of BAND_LIST) sums[b.name] = 0;
  for (let f = 0; f < FRAME_COUNT; f++) {
    const frame = next(FFT_SIZE);
    const spec = spectrum(frame, SAMPLE_RATE, FFT_SIZE, "hann");
    if (!spec.ok) throw new Error(`spectrum failed: ${spec.error.message}`);
    const levels = bands(spec.value, SAMPLE_RATE, FFT_SIZE, "hann", BAND_LIST);
    if (!levels.ok) throw new Error(`bands failed: ${levels.error.message}`);
    for (const b of BAND_LIST) {
      sums[b.name] = (sums[b.name] as number) + linear(levels.value[b.name] as number);
    }
  }
  const out: Record<string, number> = {};
  for (const b of BAND_LIST) out[b.name] = (sums[b.name] as number) / FRAME_COUNT;
  return out;
}

describe("Property 55: White noise spreads evenly across Bands", () => {
  it("each Band at least 1/16 of the Nyquist wide holds its share of the full-band energy within 25%", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        const avg = averageEnergies(seed);
        const full = avg["full"] as number;
        expect(full).toBeGreaterThan(0);
        for (const b of BAND_LIST) {
          if (b.highHz - b.lowHz < SIXTEENTH) continue;
          const expected = ((b.highHz - b.lowHz) / NYQUIST) * full;
          const actual = avg[b.name] as number;
          expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(0.25);
        }
      }),
      pbtParams(),
    );
  });

  it("uses 65,536 samples as 64 Frames of 1024 for a fixed seed", () => {
    const avg = averageEnergies(12345);
    const full = avg["full"] as number;
    for (let i = 0; i < 16; i++) {
      const rel = Math.abs((avg[`s${i}`] as number) - full / 16) / (full / 16);
      expect(rel).toBeLessThanOrEqual(0.25);
    }
  });
});
