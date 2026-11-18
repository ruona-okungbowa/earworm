import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createOnsetDetector } from "@earworm/core";
import type { EarwormEvent, Frame } from "@earworm/core";
import { frameSequence } from "../../../helpers/generators";
import { pbtParams } from "../../../helpers/pbt";

// Feature: earworm-kit, Property 9: Onset refractory spacing and strength
// **Validates: Requirements 3.2, 3.4, 3.6**

const NOISE_FLOOR_DB = -60;
const THRESHOLD_DB = 10;

function makeDetector(refractory?: number) {
  const created = createOnsetDetector(
    refractory === undefined ? {} : { refractory },
  );
  if (!created.ok) throw new Error("detector creation failed");
  created.value.setNoiseFloor(NOISE_FLOOR_DB);
  return created.value;
}

function constantFrame(db: number, timestamp: number): Frame {
  const amp = Math.pow(10, db / 20);
  return {
    samples: new Float32Array(128).fill(amp),
    timestamp,
    sampleRate: 48000,
  };
}

function onsetsOf(events: EarwormEvent[]) {
  return events.flatMap((e) => (e.type === "onset" ? [e] : []));
}

describe("Property 9: Onset refractory spacing and strength", () => {
  it("consecutive onsets are at least the refractory apart and strength is in (0, 1]", () => {
    fc.assert(
      fc.property(
        frameSequence({ minLength: 1, maxLength: 200 }),
        fc.array(fc.double({ min: -90, max: 0, noNaN: true }), {
          minLength: 200,
          maxLength: 200,
        }),
        fc.integer({ min: 0, max: 1000 }),
        (tagged, levelsDb, refractory) => {
          const detector = makeDetector(refractory);
          const onsets: ReturnType<typeof onsetsOf> = [];
          tagged.forEach(({ frame }, i) => {
            const amp = Math.pow(10, levelsDb[i]! / 20);
            const scaled: Frame = {
              ...frame,
              samples: frame.samples.map((s) => s * amp),
            };
            onsets.push(...onsetsOf(detector.process(scaled)));
          });
          for (let i = 1; i < onsets.length; i++) {
            expect(
              onsets[i]!.timestamp - onsets[i - 1]!.timestamp,
            ).toBeGreaterThanOrEqual(refractory);
          }
          for (const o of onsets) {
            expect(o.strength).toBeGreaterThan(0);
            expect(o.strength).toBeLessThanOrEqual(1);
          }
        },
      ),
      pbtParams(),
    );
  });

  it("strength is in (0, 1] and non-decreasing as the rise above the Noise_Floor grows", () => {
    const aboveThreshold = fc.double({
      min: NOISE_FLOOR_DB + THRESHOLD_DB + 0.5,
      max: 0,
      noNaN: true,
    });
    fc.assert(
      fc.property(aboveThreshold, aboveThreshold, (a, b) => {
        const [lowDb, highDb] = a <= b ? [a, b] : [b, a];
        const strengthAt = (db: number): number => {
          // A quiet lead-in gives the Frame under test a full attack window of history.
          const detector = makeDetector();
          detector.process({
            samples: new Float32Array(128),
            timestamp: 0,
            sampleRate: 48000,
          });
          const events = onsetsOf(detector.process(constantFrame(db, 31)));
          expect(events).toHaveLength(1);
          return events[0]!.strength;
        };
        const low = strengthAt(lowDb);
        const high = strengthAt(highDb);
        expect(low).toBeGreaterThan(0);
        expect(high).toBeLessThanOrEqual(1);
        expect(high).toBeGreaterThanOrEqual(low);
      }),
      pbtParams(),
    );
  });
});
