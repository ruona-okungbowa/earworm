import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { createOnsetDetector } from "@earworm/core";
import type { EarwormEvent, Frame, OnsetDetector } from "@earworm/core";
import { pbtParams } from "../../../helpers/pbt";
import { frameSequence } from "../../../helpers/generators";

// Feature: earworm-kit, Property 57: No refractory suppression before the first Onset
// **Validates: Requirements 3.11**

function make(refractory: number): OnsetDetector {
  const r = createOnsetDetector({ refractory });
  if (!r.ok) throw new Error("detector creation failed");
  return r.value;
}

function firstOnset(d: OnsetDetector, frames: readonly Frame[]): EarwormEvent | undefined {
  for (const f of frames) {
    const ev = d.process(f).find((e) => e.type === "onset");
    if (ev) return ev;
  }
  return undefined;
}

const GAINS = [0, 0.0005, 0.01, 0.3, 1] as const;

/** Frame sequences with varied levels, optionally starting at a negative Timestamp. */
const framesArb = fc
  .record({
    startMs: fc.double({ min: -5000, max: 5000, noNaN: true }),
    gains: fc.array(fc.constantFrom(...GAINS), { minLength: 1, maxLength: 20 }),
  })
  .chain(({ startMs, gains }) =>
    frameSequence({
      startMs,
      minLength: gains.length,
      maxLength: gains.length,
    }).map((seq) =>
      seq.map(({ frame }, i): Frame => {
        const g = gains[i] as number;
        const samples = frame.samples.map((s) => s * g);
        return { ...frame, samples };
      }),
    ),
  );

const refractoryArb = fc.double({ min: 0, max: 1000, noNaN: true });

describe("Property 57: No refractory suppression before the first Onset", () => {
  it("first Onset matches a refractory-0 detector, fresh and after reset", () => {
    fc.assert(
      fc.property(framesArb, refractoryArb, (frames, refractory) => {
        const expected = firstOnset(make(0), frames);

        const d = make(refractory);
        expect(firstOnset(d, frames)).toEqual(expected);

        d.reset();
        expect(firstOnset(d, frames)).toEqual(expected);
      }),
      pbtParams(),
    );
  });

  it("reset clears suppression from a pre-reset Onset within R of the first post-reset Frame", () => {
    fc.assert(
      fc.property(
        framesArb,
        fc.double({ min: 1, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 0.99, noNaN: true }),
        (frames, refractory, fraction) => {
          const first = frames[0] as Frame;
          const expected = firstOnset(make(0), frames);

          // A loud Frame placed within R before the first post-reset Frame.
          const loud = new Float32Array(first.samples.length).fill(1);
          const pre: Frame = {
            samples: loud,
            timestamp: first.timestamp - refractory * fraction,
            sampleRate: first.sampleRate,
          };

          const d = make(refractory);
          const preEvents = d.process(pre).filter((e) => e.type === "onset");
          expect(preEvents.length).toBe(1);

          d.reset();
          expect(firstOnset(d, frames)).toEqual(expected);
        },
      ),
      pbtParams(),
    );
  });

  it("negative Timestamps: first Onset is not suppressed", () => {
    const loud = (timestamp: number): Frame => ({
      samples: new Float32Array(128).fill(1),
      timestamp,
      sampleRate: 48000,
    });
    const d = make(1000);
    const ev = d.process(loud(-500));
    expect(ev.map((e) => e.type)).toEqual(["onset"]);
    expect(ev[0]?.timestamp).toBe(-500);
  });
});
