import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BAND_PRESET,
  bands,
  createBandDetector,
  createPitchDetector,
  createSpectrumDetector,
  spectrum,
} from "@earworm/core";
import type { Frame } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";
import { harmonicTone, whiteNoise } from "../../helpers/generators";

// Feature: earworm-kit, Property 31: Sample history semantics
// **Validates: Requirements 4.11, 4.12, 19.19, 19.20, 20.22**

const SR = 48_000;
const PITCH_WINDOW = 2048;
/** Timestamps this far apart always pass the rate gate. */
const STEP_MS = 1000;
/** Far below any Frame level, so the level gate allows every Frame. */
const LOW_FLOOR = -1e9;

interface Scenario {
  fftSize: number;
  window: "hann" | "hamming" | "blackman" | "rectangular";
  chunks: Float32Array[];
}

/** A signal (tone plus noise) cut into Frames of varied sizes. */
function chunksArb(
  minSize: number,
  maxSize: number,
  maxFrames: number,
): fc.Arbitrary<Float32Array[]> {
  return fc
    .record({
      sizes: fc.array(fc.integer({ min: minSize, max: maxSize }), {
        minLength: 1,
        maxLength: maxFrames,
      }),
      seed: fc.integer({ min: 0, max: 0xffffffff }),
      f0: fc.integer({ min: 100, max: 1500 }),
      amp: fc.double({ min: 0.05, max: 0.5, noNaN: true }),
    })
    .map(({ sizes, seed, f0, amp }) => {
      const total = sizes.reduce((a, b) => a + b, 0);
      const t = harmonicTone(f0, [amp, amp / 2], total, SR);
      const n = whiteNoise(seed)(total, 0.02);
      const all = t.map((v, i) => v + (n[i] as number));
      const out: Float32Array[] = [];
      let at = 0;
      for (const s of sizes) {
        out.push(all.slice(at, at + s));
        at += s;
      }
      return out;
    });
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  fftSize: fc.constantFrom(256, 512, 1024, 2048),
  window: fc.constantFrom("hann", "hamming", "blackman", "rectangular"),
  chunks: chunksArb(1, 700, 10),
});

const frameAt = (samples: Float32Array, i: number): Frame => ({
  samples,
  timestamp: i * STEP_MS,
  sampleRate: SR,
});

function concat(chunks: readonly Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((a, c) => a + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** Reference history: last `size` samples, zero-padded after the samples until full. */
function referenceHistory(
  chunks: readonly Float32Array[],
  size: number,
): Float32Array {
  const all = concat(chunks);
  const tail = all.slice(Math.max(0, all.length - size));
  const out = new Float32Array(size);
  out.set(tail, 0);
  return out;
}

describe("Property 31: Sample history semantics", () => {
  it("Spectrum_Detector output equals spectrum of the reference history after every Frame", () => {
    fc.assert(
      fc.property(scenarioArb, ({ fftSize, window, chunks }) => {
        const r = createSpectrumDetector({ fftSize, window, sampleRate: SR });
        if (!r.ok) throw new Error("detector creation failed");
        chunks.forEach((c, i) => {
          const events = r.value.process(frameAt(c, i));
          const ref = spectrum(
            referenceHistory(chunks.slice(0, i + 1), fftSize),
            SR,
            fftSize,
            window,
          );
          if (!ref.ok) throw new Error("reference spectrum failed");
          expect(events).toHaveLength(1);
          const ev = events[0];
          if (ev?.type !== "spectrum") throw new Error("wrong event type");
          expect(Array.from(ev.magnitudes)).toEqual(Array.from(ref.value));
        });
      }),
      pbtParams(),
    );
  });

  it("Band_Detector output equals bands of the reference history after every Frame", () => {
    fc.assert(
      fc.property(scenarioArb, ({ fftSize, window, chunks }) => {
        const r = createBandDetector({ fftSize, window, sampleRate: SR });
        if (!r.ok) throw new Error("detector creation failed");
        chunks.forEach((c, i) => {
          const events = r.value.process(frameAt(c, i));
          const mags = spectrum(
            referenceHistory(chunks.slice(0, i + 1), fftSize),
            SR,
            fftSize,
            window,
          );
          if (!mags.ok) throw new Error("reference spectrum failed");
          const ref = bands(
            mags.value,
            SR,
            fftSize,
            window,
            BAND_PRESET,
            "dbfs",
          );
          if (!ref.ok) throw new Error("reference bands failed");
          expect(events).toHaveLength(1);
          const ev = events[0];
          if (ev?.type !== "band") throw new Error("wrong event type");
          expect(ev.values).toEqual(ref.value);
        });
      }),
      pbtParams(),
    );
  });

  it("Pitch_Detector emits nothing before 2048 samples, then matches a fresh Detector fed the 2048-sample history as one Frame", () => {
    fc.assert(
      fc.property(chunksArb(64, 1100, 10), (chunks) => {
        const r = createPitchDetector();
        if (!r.ok) throw new Error("detector creation failed");
        const d = r.value;
        expect(d.setNoiseFloor(LOW_FLOOR).ok).toBe(true);

        let received = 0;
        chunks.forEach((c, i) => {
          const events = d.process(frameAt(c, i));
          received += c.length;
          if (received < PITCH_WINDOW) {
            expect(events).toEqual([]);
            return;
          }
          const fr = createPitchDetector();
          if (!fr.ok) throw new Error("detector creation failed");
          expect(fr.value.setNoiseFloor(LOW_FLOOR).ok).toBe(true);
          const history = referenceHistory(
            chunks.slice(0, i + 1),
            PITCH_WINDOW,
          );
          expect(fr.value.process(frameAt(history, i))).toEqual(events);
        });
      }),
      pbtParams(),
    );
  });

  it("reset() clears the history; later output matches a fresh Detector", () => {
    fc.assert(
      fc.property(
        scenarioArb,
        chunksArb(1, 700, 5),
        ({ fftSize, window, chunks }, after) => {
          const mk = () => {
            const r = createSpectrumDetector({
              fftSize,
              window,
              sampleRate: SR,
            });
            if (!r.ok) throw new Error("detector creation failed");
            return r.value;
          };
          const used = mk();
          chunks.forEach((c, i) => used.process(frameAt(c, i)));
          used.reset();
          expect(used.historyLength).toBe(0);

          const fresh = mk();
          after.forEach((c, i) => {
            const f = frameAt(c, i);
            expect(used.process(f)).toEqual(fresh.process(f));
          });
          expect(used.historyLength).toBe(fresh.historyLength);

          // Band and Pitch Detectors clear the same way.
          const b = createBandDetector({ fftSize, window, sampleRate: SR });
          const p = createPitchDetector();
          if (!b.ok || !p.ok) throw new Error("detector creation failed");
          chunks.forEach((c, i) => {
            b.value.process(frameAt(c, i));
            p.value.process(frameAt(c, i));
          });
          b.value.reset();
          p.value.reset();
          expect(b.value.historyLength).toBe(0);
          expect(p.value.historyLength).toBe(0);
        },
      ),
      pbtParams(),
    );
  });

  it("flush() returns no events and leaves the history unchanged", () => {
    fc.assert(
      fc.property(scenarioArb, ({ fftSize, window, chunks }) => {
        const s = createSpectrumDetector({ fftSize, window, sampleRate: SR });
        const b = createBandDetector({ fftSize, window, sampleRate: SR });
        const p = createPitchDetector();
        if (!s.ok || !b.ok || !p.ok) throw new Error("creation failed");
        for (const d of [s.value, b.value, p.value]) {
          chunks.forEach((c, i) => d.process(frameAt(c, i)));
          const before = d.historyLength;
          expect(d.flush?.()).toEqual([]);
          expect(d.historyLength).toBe(before);
        }
      }),
      pbtParams(),
    );
  });

  it("Pitch_Detector reaches 2048 samples exactly at the gate", () => {
    const r = createPitchDetector();
    if (!r.ok) throw new Error("detector creation failed");
    r.value.setNoiseFloor(LOW_FLOOR);
    const tone1 = harmonicTone(440, [0.4], PITCH_WINDOW, SR);
    expect(r.value.process(frameAt(tone1.slice(0, 2047), 0))).toEqual([]);
    expect(r.value.historyLength).toBe(2047);
    r.value.process(frameAt(tone1.slice(2047), 1));
    expect(r.value.historyLength).toBe(PITCH_WINDOW);
  });
});
