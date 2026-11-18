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
import type { Detector, EarwormEvent, Frame, Result } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";
import { frameSequence, tone } from "../../helpers/generators";

// Feature: earworm-kit, Property 5: Detector determinism and reset equivalence
// **Validates: Requirements 3.5, 17.12, 18.16, 19.17, 20.15**

const FRAME_SIZE = 1024;
const SAMPLE_RATE = 48000;

type Factory = (variant: number) => Result<Detector>;

function pick<T>(items: readonly T[], variant: number): T {
  return items[variant % items.length] as T;
}

const factories: Record<string, Factory> = {
  level: (v) => createLevelDetector({ maxRate: pick([1, 30, 100], v) }),
  onset: (v) =>
    createOnsetDetector({
      threshold: pick([3, 10, 25], v),
      refractory: pick([0, 60, 500], v),
    }),
  envelope: (v) =>
    createEnvelopeDetector({
      attack: pick([0, 10, 500], v),
      release: pick([0, 300, 2000], v),
      maxRate: pick([1, 30, 100], v),
    }),
  sound: (v) =>
    createSoundDetector({
      startThreshold: pick([3, 12, 30], v),
      endThreshold: pick([1, 2, 6], v),
      minHold: pick([0, 30, 150], v),
      hangover: pick([0, 100, 1000], v),
    }),
  pitch: (v) =>
    createPitchDetector({ confidenceThreshold: pick([0, 0.5, 0.8], v) }),
  spectrum: (v) =>
    createSpectrumDetector({
      fftSize: pick([256, 1024, 2048], v),
      maxRate: pick([1, 30, 100], v),
    }),
  band: (v) =>
    createBandDetector({
      fftSize: pick([256, 1024, 2048], v),
      unit: pick(["dbfs", "normalised"] as const, v),
      maxRate: pick([1, 30, 100], v),
    }),
};

function make(name: string, variant: number): Detector {
  const r = (factories[name] as Factory)(variant);
  if (!r.ok) throw new Error(`${name} creation failed`);
  return r.value;
}

/** Processes every Frame, then flushes if the Detector supports it. */
function run(d: Detector, frames: readonly Frame[]): EarwormEvent[] {
  const out: EarwormEvent[] = [];
  for (const f of frames) out.push(...d.process(f));
  if (d.flush) out.push(...d.flush());
  return out;
}

const scenarioArb = fc.record({
  variant: fc.nat({ max: 8 }),
  items: frameSequence({
    frameSize: FRAME_SIZE,
    sampleRate: SAMPLE_RATE,
    minLength: 1,
    maxLength: 25,
    inject: ["empty", "non-finite-sample", "stale-timestamp"],
  }),
  // Per-Frame gain, so loud and quiet stretches alternate and Events occur.
  gains: fc.array(fc.constantFrom(0, 0.001, 0.02, 0.3, 1), {
    minLength: 25,
    maxLength: 25,
  }),
  freq: fc.double({ min: 80, max: 1500, noNaN: true }),
  withTone: fc.boolean(),
});

describe("Property 5: Detector determinism and reset equivalence", () => {
  for (const name of Object.keys(factories)) {
    it(`${name}: same Events from a fresh state twice, and after reset()`, () => {
      fc.assert(
        fc.property(
          scenarioArb,
          ({ variant, items, gains, freq, withTone }) => {
            const frames: Frame[] = items.map(({ frame }, i) => {
              const gain = gains[i] as number;
              const carrier = withTone
                ? tone(freq, 0.8, frame.samples.length, SAMPLE_RATE)
                : null;
              return {
                ...frame,
                // NaN and Infinity stay non-finite; empty stays empty.
                samples: frame.samples.map(
                  (s, j) => (s + (carrier ? (carrier[j] as number) : 0)) * gain,
                ),
              };
            });

            const first = run(make(name, variant), frames);
            const second = run(make(name, variant), frames);
            expect(second).toStrictEqual(first);

            // Reset after a partial run on the same Detector, then rerun everything.
            const reused = make(name, variant);
            run(reused, frames.slice(0, Math.ceil(frames.length / 2)));
            reused.reset();
            expect(run(reused, frames)).toStrictEqual(first);

            // Reset right after a full run too.
            reused.reset();
            expect(run(reused, frames)).toStrictEqual(first);
          },
        ),
        pbtParams(),
      );
    });
  }

  it("a freshly built Detector and a reset Detector agree on a loud then silent example", () => {
    const loud: Frame = {
      samples: tone(440, 0.8, FRAME_SIZE, SAMPLE_RATE),
      timestamp: 0,
      sampleRate: SAMPLE_RATE,
    };
    const silent: Frame = {
      samples: new Float32Array(FRAME_SIZE),
      timestamp: 1000,
      sampleRate: SAMPLE_RATE,
    };
    for (const name of Object.keys(factories)) {
      const fresh = run(make(name, 0), [loud, silent]);
      const d = make(name, 0);
      run(d, [loud, silent]);
      d.reset();
      expect(run(d, [loud, silent])).toStrictEqual(fresh);
    }
  });
});
