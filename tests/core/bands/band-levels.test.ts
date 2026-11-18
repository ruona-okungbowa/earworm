import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  BAND_PRESET,
  WINDOW_NAMES,
  bands,
  spectrum,
  windowCoefficients,
} from "@earworm/core";
import type { Band, WindowName } from "@earworm/core";
import { energyCheckFrame, tone } from "../../helpers/generators";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 53: Band levels
// **Validates: Requirements 20.5, 20.6, 20.7, 20.16**

const SAMPLE_RATE = 48000;
const NYQUIST = SAMPLE_RATE / 2;
const SIZES = [256, 512, 1024, 2048] as const;

const windowArb = fc.constantFrom<WindowName>(...WINDOW_NAMES);

/** 1 to 4 valid Bands, unique names, some narrow enough to hold no bin. */
const bandListArb: fc.Arbitrary<Band[]> = fc
  .array(
    fc.integer({ min: 0, max: NYQUIST - 1 }).chain((lowHz) =>
      fc
        .oneof(
          fc.integer({ min: 1, max: 20 }),
          fc.integer({ min: 1, max: NYQUIST }),
        )
        .map((width) => ({
          lowHz,
          highHz: Math.min(NYQUIST, lowHz + width),
        })),
    ),
    { minLength: 1, maxLength: 4 },
  )
  .map((edges) => edges.map((e, i) => ({ name: `b${i}`, ...e })));

function reference(
  spec: Float32Array,
  size: number,
  window: WindowName,
  band: Band,
): number {
  const w = windowCoefficients(window, size);
  if (!w.ok) throw new Error("window failed");
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < size; i++) {
    sum += w.value[i]!;
    sumSq += w.value[i]! * w.value[i]!;
  }
  const wMean = sum / size;
  const wMeanSq = sumSq / size;
  let total = 0;
  let any = false;
  for (let k = 0; k < spec.length; k++) {
    const f = (k * SAMPLE_RATE) / size;
    if (f >= band.lowHz && f < band.highHz) {
      const m = Math.pow(10, spec[k]! / 20);
      // A bin at or below -120 dBFS counts as zero power (Req 20.16).
      if (spec[k]! <= -120) {
        any = true;
        continue;
      }
      total += k === 0 ? (m * wMean) ** 2 : (m * m * wMean * wMean) / 2;
      any = true;
    }
  }
  if (!any || !(total > 0)) return -120;
  return Math.max(-120, 10 * Math.log10(total / wMeanSq));
}

describe("Property 53: Band levels", () => {
  it("each Band level equals 10·log10(Σ bin power / mean(w²)) over its bins, floored at -120", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SIZES),
        windowArb,
        bandListArb,
        fc.integer({ min: 0, max: 2 ** 31 - 1 }),
        fc.constantFrom("dbfs", "normalised"),
        (size, window, bandList, seed, unit) => {
          // Spectrum values in [-120, 6], with some bins at the floor.
          let s = seed >>> 0;
          const next = (): number => {
            s = (s + 0x6d2b79f5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
          };
          const spec = new Float32Array(size / 2);
          for (let k = 0; k < spec.length; k++) {
            spec[k] = next() < 0.2 ? -120 : -120 + next() * 126;
          }
          const r = bands(spec, SAMPLE_RATE, size, window, bandList, unit);
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          for (const band of bandList) {
            const db = reference(spec, size, window, band);
            const expected =
              unit === "dbfs" ? db : Math.min(1, Math.max(0, (db + 120) / 120));
            expect(r.value[band.name]).toBeCloseTo(expected, 8);
            if (unit === "normalised") {
              expect(r.value[band.name]).toBeGreaterThanOrEqual(0);
              expect(r.value[band.name]).toBeLessThanOrEqual(1);
            }
          }
        },
      ),
      pbtParams(),
    );
  });

  it("a Band covering 0 Hz to Nyquist reads mean((x·w)²) / mean(w²) within 1e-3 relative", () => {
    fc.assert(
      fc.property(energyCheckFrame(), windowArb, (frame, window) => {
        const spec = spectrum(frame.samples, SAMPLE_RATE, frame.size, window);
        expect(spec.ok).toBe(true);
        if (!spec.ok) return;
        const all: Band[] = [{ name: "all", lowHz: 0, highHz: NYQUIST }];
        const r = bands(spec.value, SAMPLE_RATE, frame.size, window, all);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const w = windowCoefficients(window, frame.size);
        expect(w.ok).toBe(true);
        if (!w.ok) return;
        let ms = 0;
        let wms = 0;
        for (let i = 0; i < frame.size; i++) {
          const wi = w.value[i]!;
          const xw = frame.samples[i]! * wi;
          ms += xw * xw;
          wms += wi * wi;
        }
        ms /= wms;
        const measured = Math.pow(10, r.value["all"]! / 10);
        expect(Math.abs(measured - ms) / ms).toBeLessThan(1e-3);

        const n = bands(
          spec.value,
          SAMPLE_RATE,
          frame.size,
          window,
          all,
          "normalised",
        );
        expect(n.ok).toBe(true);
        if (n.ok) {
          const expected = Math.min(
            1,
            Math.max(0, (r.value["all"]! + 120) / 120),
          );
          expect(n.value["all"]).toBeCloseTo(expected, 10);
        }
      }),
      pbtParams(),
    );
  });

  it("a full-scale sine at least 3 bins from 0 Hz and Nyquist reads -3.01 dBFS within 0.5 dB for each window", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SIZES),
        windowArb,
        fc.integer({ min: 3, max: 100 }),
        (size, window, binRaw) => {
          // At least 3 bins from 0 Hz and from Nyquist (bin size / 2).
          const bin = Math.min(binRaw, size / 2 - 3);
          const freq = (bin * SAMPLE_RATE) / size;
          const spec = spectrum(
            tone(freq, 1, size, SAMPLE_RATE),
            SAMPLE_RATE,
            size,
            window,
          );
          expect(spec.ok).toBe(true);
          if (!spec.ok) return;
          const r = bands(spec.value, SAMPLE_RATE, size, window, [
            { name: "all", lowHz: 0, highHz: NYQUIST },
          ]);
          expect(r.ok).toBe(true);
          if (r.ok) expect(Math.abs(r.value["all"]! + 3.01)).toBeLessThan(0.5);
        },
      ),
      pbtParams(),
    );
  });

  it("all-zero input gives -120 dBFS (0 normalised) in every Band", () => {
    for (const window of WINDOW_NAMES) {
      const spec = spectrum(new Float32Array(1024), SAMPLE_RATE, 1024, window);
      expect(spec.ok).toBe(true);
      if (!spec.ok) continue;
      const db = bands(spec.value, SAMPLE_RATE, 1024, window, BAND_PRESET);
      const nm = bands(
        spec.value,
        SAMPLE_RATE,
        1024,
        window,
        BAND_PRESET,
        "normalised",
      );
      expect(db.ok && nm.ok).toBe(true);
      if (!db.ok || !nm.ok) continue;
      for (const b of BAND_PRESET) {
        expect(db.value[b.name]).toBe(-120);
        expect(nm.value[b.name]).toBe(0);
      }
    }
  });
});
