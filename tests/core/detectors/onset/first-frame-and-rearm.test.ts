import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createOnsetDetector } from "@earworm/core";
import type { Frame, OnsetDetector } from "@earworm/core";
import { pbtParams } from "../../../helpers/pbt";

// Regression tests for task 18A.1.
// **Validates: Requirements 3.2, 3.7, 3.10**

const SR = 48000;
const N = 128;

function make(cfg?: Parameters<typeof createOnsetDetector>[0]): OnsetDetector {
  const r = createOnsetDetector(cfg);
  if (!r.ok) throw new Error("detector creation failed");
  return r.value;
}

/** A Frame of constant samples at the given dBFS level (0 dB gives amplitude 1). */
function frameAt(timestamp: number, db: number): Frame {
  return {
    samples: new Float32Array(N).fill(10 ** (db / 20)),
    timestamp,
    sampleRate: SR,
  };
}

function onsets(d: OnsetDetector, fs: readonly Frame[]): number[] {
  const out: number[] = [];
  for (const f of fs) {
    for (const e of d.process(f)) if (e.type === "onset") out.push(e.timestamp);
  }
  return out;
}

describe("refractory default", () => {
  it("is 100 ms: a second onset 90 ms later is suppressed, one at 100 ms is not", () => {
    // Quiet, loud (onset), quiet, loud again.
    const run = (gapMs: number) => {
      const d = make();
      return onsets(d, [
        frameAt(0, -90),
        frameAt(40, -90),
        frameAt(50, -10), // onset at 50
        frameAt(50 + gapMs - 10, -90),
        frameAt(50 + gapMs, -10),
      ]);
    };
    expect(run(90)).toEqual([50]);
    expect(run(100)).toEqual([50, 150]);
  });
});

describe("no Onset on the first Frame", () => {
  it("a loud first Frame emits nothing", () => {
    const d = make();
    expect(onsets(d, [frameAt(0, -10)])).toEqual([]);
  });

  it("needs a full attack window of history, and reset() clears it", () => {
    const d = make({ attackWindow: 30 });
    expect(onsets(d, [frameAt(0, -90), frameAt(29, -10)])).toEqual([]);

    d.reset();
    expect(onsets(d, [frameAt(1000, -90), frameAt(1030, -10)])).toEqual([1030]);

    d.reset();
    expect(onsets(d, [frameAt(2000, -10)])).toEqual([]);
  });

  it("property: no Onset fires earlier than attackWindow after the first Frame", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 100 }),
        fc.double({ min: -5000, max: 5000, noNaN: true }),
        fc.array(
          fc.record({
            dt: fc.double({ min: 0, max: 20, noNaN: true }),
            db: fc.double({ min: -100, max: 0, noNaN: true }),
          }),
          { minLength: 1, maxLength: 30 },
        ),
        (attackWindow, start, steps) => {
          const d = make({ attackWindow });
          let t = start;
          const fs: Frame[] = [];
          for (const s of steps) {
            fs.push(frameAt(t, s.db));
            t += s.dt;
          }
          for (const ts of onsets(d, fs)) {
            expect(ts - start).toBeGreaterThanOrEqual(attackWindow);
          }
        },
      ),
      pbtParams(),
    );
  });
});

describe("re-arm after an Onset", () => {
  it("re-arms in a -43 dBFS room with the default -60 dBFS floor", () => {
    // Room at -43 dBFS is above floor + threshold (-50), so the old rule never re-armed.
    const d = make({ refractory: 100 });
    const fs: Frame[] = [];
    for (let t = 0; t < 100; t += 10) fs.push(frameAt(t, -43));
    fs.push(frameAt(100, -10)); // knock 1 (rise from -43)
    for (let t = 110; t < 300; t += 10) fs.push(frameAt(t, -43));
    fs.push(frameAt(300, -10)); // knock 2
    for (let t = 310; t < 400; t += 10) fs.push(frameAt(t, -43));
    expect(onsets(d, fs)).toEqual([100, 300]);
  });

  it("does not re-arm while the level stays within threshold of the peak and above floor + threshold", () => {
    const d = make({ refractory: 0 });
    const fs = [
      frameAt(0, -90),
      frameAt(40, -90),
      frameAt(50, -10), // onset
      frameAt(60, -15), // within 10 dB of the peak: still disarmed
      frameAt(70, -10),
    ];
    expect(onsets(d, fs)).toEqual([50]);
  });

  it("property: falling at least `threshold` dB below the peak re-arms", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 3, max: 40, noNaN: true }),
        fc.double({ min: -45, max: -20, noNaN: true }),
        (threshold, roomDb) => {
          // Keep the peak well above the room so a second rise is possible.
          const peak = -3;
          const d = make({ threshold, refractory: 0 });
          const dropTo = Math.min(roomDb, peak - threshold - 0.5);
          const fs = [
            frameAt(0, dropTo),
            frameAt(20, dropTo),
            frameAt(40, dropTo),
            frameAt(50, peak), // onset (rise from the lead-in is above threshold)
            frameAt(60, dropTo), // at least threshold below the peak: re-arms
            frameAt(70, peak),
          ];
          const got = onsets(d, fs);
          // Rise from dropTo to peak must exceed the threshold for the test to be meaningful.
          fc.pre(peak - dropTo > threshold && peak > -60 + threshold);
          expect(got).toEqual([50, 70]);
        },
      ),
      pbtParams(),
    );
  });
});
