import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  createBandDetector,
  createEnvelopeDetector,
  createLevelDetector,
  createSpectrumDetector,
} from "@earworm/core";
import type { Detector, Result } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";
import { frameSequence } from "../../helpers/generators";

// Feature: earworm-kit, Property 7: Rate limits hold
// **Validates: Requirements 5.2, 17.5, 19.15, 20.13**

const EPS = 1e-6;

const makers: Record<string, (maxRate: number) => Result<Detector>> = {
  level: (maxRate) => createLevelDetector({ maxRate }),
  envelope: (maxRate) => createEnvelopeDetector({ maxRate }),
  spectrum: (maxRate) => createSpectrumDetector({ maxRate, fftSize: 256 }),
  band: (maxRate) => createBandDetector({ maxRate, fftSize: 256 }),
};

const scenarioArb = fc
  .record({
    maxRate: fc.integer({ min: 1, max: 100 }),
    // Frame spacing of about 1.3 ms, 10 ms and 50 ms, plus random gaps.
    frameSize: fc.constantFrom(64, 480, 2400),
  })
  .chain(({ maxRate, frameSize }) =>
    fc.record({
      maxRate: fc.constant(maxRate),
      frames: frameSequence({ frameSize, minLength: 1, maxLength: 80 }),
    }),
  );

describe("Property 7: Rate limits hold", () => {
  for (const [name, make] of Object.entries(makers)) {
    it(`${name} detector emits at most maxRate Events in any 1000 ms window`, () => {
      fc.assert(
        fc.property(scenarioArb, ({ maxRate, frames }) => {
          const r = make(maxRate);
          if (!r.ok) throw new Error("detector creation failed");
          const times: number[] = [];
          for (const { frame } of frames) {
            for (const e of r.value.process(frame)) times.push(e.timestamp);
          }

          const minGap = 1000 / maxRate;
          for (let i = 1; i < times.length; i++) {
            expect(times[i]! - times[i - 1]!).toBeGreaterThanOrEqual(
              minGap - EPS,
            );
          }
          // Sliding window: Events within a span shorter than 1000 ms.
          let lo = 0;
          for (let hi = 0; hi < times.length; hi++) {
            while (times[hi]! - times[lo]! >= 1000 - EPS) lo++;
            expect(hi - lo + 1).toBeLessThanOrEqual(maxRate);
          }
        }),
        pbtParams(),
      );
    });
  }

  it("a 100 Frame/s stream at maxRate 10 yields 10 Events per second", () => {
    const r = createLevelDetector({ maxRate: 10 });
    if (!r.ok) throw new Error("detector creation failed");
    let count = 0;
    for (let i = 0; i < 200; i++) {
      count += r.value.process({
        samples: new Float32Array(480).fill(0.1),
        timestamp: i * 10,
        sampleRate: 48000,
      }).length;
    }
    expect(count).toBe(20);
  });
});
