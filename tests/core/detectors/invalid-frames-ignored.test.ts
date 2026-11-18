import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  createBandDetector,
  createEnvelopeDetector,
  createLevelDetector,
  createOnsetDetector,
  createPitchDetector,
  createSoundDetector,
  createSpectrumDetector,
} from "@earworm/core";
import type { Detector, Result } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";
import { frameSequence } from "../../helpers/generators";

// Feature: earworm-kit, Property 6: Invalid Frames are ignored
// **Validates: Requirements 3.8, 4.13, 5.8, 17.8, 18.14, 19.16, 20.14**

const factories: Record<string, () => Result<Detector>> = {
  level: () => createLevelDetector(),
  envelope: () => createEnvelopeDetector(),
  onset: () => createOnsetDetector(),
  sound: () => createSoundDetector(),
  pitch: () => createPitchDetector(),
  band: () => createBandDetector({ fftSize: 256 }),
  spectrum: () => createSpectrumDetector({ fftSize: 256 }),
};

function make(name: string): Detector {
  const r = factories[name]!();
  if (!r.ok) throw new Error(`cannot create ${name} detector`);
  return r.value;
}

const seqArb = fc.record({
  items: frameSequence({
    frameSize: 128,
    minLength: 1,
    maxLength: 30,
    inject: ["empty", "non-finite-sample", "stale-timestamp"],
  }),
  // Alternate loud and quiet sections so state (envelopes, hangover) matters.
  gains: fc.array(fc.constantFrom(0, 0.02, 0.3, 1), {
    minLength: 30,
    maxLength: 30,
  }),
});

describe("Property 6: Invalid Frames are ignored", () => {
  for (const name of Object.keys(factories)) {
    it(`${name} detector: invalid Frames emit nothing and leave state unchanged`, () => {
      fc.assert(
        fc.property(seqArb, ({ items, gains }) => {
          const withInvalid = make(name);
          const validOnly = make(name);

          const scaled = items.map((t, i) => ({
            ...t,
            frame: {
              ...t.frame,
              // NaN and Infinity stay non-finite when scaled.
              samples: t.frame.samples.map((s) => s * (gains[i] as number)),
            },
          }));

          const outA: unknown[] = [];
          const outB: unknown[] = [];
          for (const t of scaled) {
            const events = withInvalid.process(t.frame);
            if (!t.valid) {
              expect(events).toEqual([]);
            }
            outA.push(events);
            if (t.valid) outB.push(validOnly.process(t.frame));
          }

          const validOutA = outA.filter((_, i) => scaled[i]!.valid);
          expect(validOutA).toEqual(outB);
        }),
        pbtParams(),
      );
    });
  }

  it("generator injects every invalid kind", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(seqArb, ({ items }) => {
        for (const t of items) seen.add(t.kind);
      }),
      { numRuns: 100 },
    );
    expect(seen).toContain("empty");
    expect(seen).toContain("non-finite-sample");
    expect(seen).toContain("stale-timestamp");
  });
});
