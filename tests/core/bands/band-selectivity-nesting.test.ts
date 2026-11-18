import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { bands, spectrum, WINDOW_NAMES } from "@earworm/core";
import type { Band } from "@earworm/core";
import { tone } from "../../helpers/generators";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 54: Band selectivity and nesting
// **Validates: Requirements 20.17, 20.18**

const SAMPLE_RATE = 48000;
const SIZE = 2048;
const NYQUIST = SAMPLE_RATE / 2;
const BIN_HZ = SAMPLE_RATE / SIZE;

const windowArb = fc.constantFrom(...WINDOW_NAMES);

function bandLevels(
  samples: Float32Array,
  window: (typeof WINDOW_NAMES)[number],
  list: readonly Band[],
): Record<string, number> {
  const spec = spectrum(samples, SAMPLE_RATE, SIZE, window);
  if (!spec.ok) throw new Error("spectrum failed");
  const result = bands(spec.value, SAMPLE_RATE, SIZE, window, list, "dbfs");
  if (!result.ok) throw new Error("bands failed");
  return result.value;
}

describe("Property 54: Band selectivity and nesting", () => {
  it("a sine inside exactly one of several non-overlapping Bands gives that Band the highest level", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: NYQUIST - 1 }), {
          minLength: 1,
          maxLength: 5,
        }),
        fc.nat(),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }),
        windowArb,
        (cuts, pick, frac, amp, phase, window) => {
          const edges = [0, ...[...cuts].sort((a, b) => a - b), NYQUIST];
          const list: Band[] = [];
          for (let i = 0; i + 1 < edges.length; i++) {
            list.push({
              name: `b${i}`,
              lowHz: edges[i] as number,
              highHz: edges[i + 1] as number,
            });
          }
          const target = list[pick % list.length] as Band;
          const usable = target.highHz - target.lowHz - 4 * BIN_HZ;
          fc.pre(usable > 0);
          const freq = target.lowHz + 2 * BIN_HZ + frac * usable;

          const levels = bandLevels(
            tone(freq, amp, SIZE, SAMPLE_RATE, phase),
            window,
            list,
          );
          const best = levels[target.name] as number;
          for (const band of list) {
            if (band.name === target.name) continue;
            expect(best).toBeGreaterThan(levels[band.name] as number);
          }
        },
      ),
      pbtParams(),
    );
  });

  it("an inner Band never has more linear energy than the Band that contains it", () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: -1, max: 1, noNaN: true }), {
          minLength: SIZE,
          maxLength: SIZE,
        }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0.001, max: 1, noNaN: true }),
        windowArb,
        (values, a, b, c, d, scale, window) => {
          const [o1, o2] = [a, b].sort((x, y) => x - y) as [number, number];
          const [i1, i2] = [c, d].sort((x, y) => x - y) as [number, number];
          const outerLow = o1 * NYQUIST;
          const outerHigh = Math.max(o2 * NYQUIST, outerLow + 1);
          fc.pre(outerHigh <= NYQUIST);
          const innerLow = outerLow + i1 * (outerHigh - outerLow);
          const innerHigh = Math.max(
            outerLow + i2 * (outerHigh - outerLow),
            innerLow + 1e-3,
          );
          fc.pre(innerHigh <= outerHigh);
          const list: Band[] = [
            { name: "outer", lowHz: outerLow, highHz: outerHigh },
            { name: "inner", lowHz: innerLow, highHz: innerHigh },
          ];
          const samples = Float32Array.from(values, (v) => v * scale);

          const levels = bandLevels(samples, window, list);
          const outer = Math.pow(10, (levels["outer"] as number) / 10);
          const inner = Math.pow(10, (levels["inner"] as number) / 10);
          expect(outer).toBeGreaterThanOrEqual(inner * (1 - 1e-9));
        },
      ),
      pbtParams(),
    );
  });
});
