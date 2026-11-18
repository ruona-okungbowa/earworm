import { describe, expect, it } from "vitest";
import { BAND_PRESET, createBandDetector } from "@earworm/core";
import type { Frame } from "@earworm/core";

// Perf tests are the only tests that read a real clock (performance.now).
// Requirements 20.20, 20.23.

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 2048;
const WARM_UP = 20;
const TIMED = 200;
const F0 = 220;
const MEDIAN_BUDGET_MS = 6;

/** Harmonic tone, finite values. Frames are 2048 samples (about 42.7 ms), so the 30/s rate gate passes each one. */
function makeFrame(index: number): Frame {
  const samples = new Float32Array(FFT_SIZE);
  const start = index * FFT_SIZE;
  for (let i = 0; i < FFT_SIZE; i++) {
    const t = (start + i) / SAMPLE_RATE;
    samples[i] =
      0.3 * Math.sin(2 * Math.PI * F0 * t) +
      0.15 * Math.sin(2 * Math.PI * 2 * F0 * t) +
      0.05 * Math.sin(2 * Math.PI * 3 * F0 * t);
  }
  return {
    samples,
    timestamp: (start / SAMPLE_RATE) * 1000,
    sampleRate: SAMPLE_RATE,
  };
}

describe("Band_Detector performance", () => {
  it("processes a 2048-sample Frame in at most 6 ms (median)", () => {
    const created = createBandDetector({
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
      window: "hann",
      bands: BAND_PRESET,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const detector = created.value;

    const total = WARM_UP + TIMED;
    const frames: Frame[] = [];
    for (let i = 0; i < total; i++) frames.push(makeFrame(i));

    // The first warm-up call must run the analysis and return a Band_Event.
    const first = detector.process(frames[0] as Frame);
    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe("band");

    for (let i = 1; i < WARM_UP; i++) detector.process(frames[i] as Frame);

    const durations: number[] = [];
    let bandEvents = 0;
    for (let i = WARM_UP; i < total; i++) {
      const frame = frames[i] as Frame;
      const t0 = performance.now();
      const events = detector.process(frame);
      durations.push(performance.now() - t0);
      for (const e of events) if (e.type === "band") bandEvents++;
    }

    // Every timed call must have run the full analysis.
    expect(bandEvents).toBe(TIMED);

    durations.sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)] as number;
    console.log(`band perf median: ${median.toFixed(3)} ms per Frame`);
    expect(
      median,
      `median ${median.toFixed(4)} ms per Frame, budget ${MEDIAN_BUDGET_MS} ms`,
    ).toBeLessThanOrEqual(MEDIAN_BUDGET_MS);
  });
});
