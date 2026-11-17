// Feature: earworm-kit, Property 41: Framing preserves samples and time
// **Validates: Requirements 14.13, 2.2**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createFramer, frames, type Frame } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt.js";

const samplesArb = fc.float32Array({ maxLength: 2000, noNaN: true, noDefaultInfinity: true });
const startArb = fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true });
const sampleRateArb = fc.oneof(
  fc.constantFrom(8000, 16000, 22050, 44100, 48000, 96000),
  fc.double({ min: 1000, max: 192000, noNaN: true, noDefaultInfinity: true }),
);
const frameSizeArb = fc.constantFrom(128, 512);

function concat(list: Frame[]): number[] {
  const out: number[] = [];
  for (const f of list) for (const s of f.samples) out.push(s);
  return out;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
}

describe("Property 41: Framing preserves samples and time", () => {
  it("concatenates back to the input, carries the sample rate and spaces Timestamps by the frame interval", () => {
    fc.assert(
      fc.property(samplesArb, startArb, sampleRateArb, frameSizeArb, (samples, start, rate, size) => {
        const out = frames(samples, start, rate, size);
        expect(out).toHaveLength(Math.floor(samples.length / size));
        expect(concat(out)).toEqual(Array.from(samples.subarray(0, out.length * size)));
        out.forEach((f, i) => {
          expect(f.samples).toHaveLength(size);
          expect(f.sampleRate).toBe(rate);
          expect(close(f.timestamp, start + ((i * size) / rate) * 1000)).toBe(true);
        });
        // Deterministic.
        expect(frames(samples, start, rate, size)).toEqual(out);
      }),
      pbtParams(),
    );
  });

  it("createFramer fed 128-sample quanta yields the same Frames as frames()", () => {
    fc.assert(
      fc.property(
        fc.array(fc.float32Array({ minLength: 128, maxLength: 128, noNaN: true, noDefaultInfinity: true }), {
          maxLength: 20,
        }),
        fc.nat(1_000_000),
        sampleRateArb,
        frameSizeArb,
        (quanta, startFrame, rate, size) => {
          const framer = createFramer(size, rate);
          if (!framer.ok) throw new Error("createFramer failed");
          const got: Frame[] = [];
          quanta.forEach((q, i) => got.push(...framer.value.push(q, startFrame + i * 128)));

          const all = new Float32Array(quanta.length * 128);
          quanta.forEach((q, i) => all.set(q, i * 128));
          const expected = frames(all, (startFrame / rate) * 1000, rate, size);

          expect(got).toHaveLength(expected.length);
          got.forEach((f, i) => {
            const e = expected[i]!;
            expect(Array.from(f.samples)).toEqual(Array.from(e.samples));
            expect(f.sampleRate).toBe(e.sampleRate);
            expect(close(f.timestamp, e.timestamp)).toBe(true);
          });
        },
      ),
      pbtParams(),
    );
  });

  it("drops a trailing partial Frame and returns nothing for short input", () => {
    expect(frames(new Float32Array(127), 0, 48000, 128)).toEqual([]);
    expect(frames(new Float32Array(300), 10, 48000, 128)).toHaveLength(2);
  });
});
