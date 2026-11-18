import { describe, expect, it } from "vitest";
import { BAND_PRESET, createBandDetector } from "@earworm/core";

// Perf tests are the only tests that read a real clock (performance.now).
// Requirements 20.20, 20.23.

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 2048;
const WARM_UP = 20;
const TIMED = 200;
const MEDIAN_BUDGET_MS = 6;
// Far above the 1/maxRate gate interval, so every call computes bands.
const STEP_MS = 1000;

/** One 2048-sample Frame of finite samples: 440 Hz plus a 3 kHz overtone. */
function makeSamples(): Float32Array {
  const samples = new Float32Array(FFT_SIZE);
  for (let i = 0; i < FFT_SIZE; i++) {
    const t = i / SAMPLE_RATE;
    samples[i] =
      0.5 * Math.sin(2 * Math.PI * 440 * t) +
      0.2 * Math.sin(2 * Math.PI * 3000 * t);
  }
  return samples;
}

describe("band detector performance", () => {
  it("processes a 2048-sample hann Frame in at most 6 ms (median)", () => {
    const created = createBandDetector({
      sampleRate: SAMPLE_RATE,
      fftSize: FFT_SIZE,
      window: "hann",
      bands: BAND_PRESET,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const detector = created.value;

    const samples = makeSamples();
    let ts = 0;
    const next = () => ({
      samples,
      timestamp: (ts += STEP_MS),
      sampleRate: SAMPLE_RATE,
    });

    const first = detector.process(next());
    expect(first).toHaveLength(1);
    expect(first[0]?.type).toBe("band");

    for (let i = 0; i < WARM_UP; i++) {
      detector.process(next());
    }

    const durations: number[] = [];
    for (let i = 0; i < TIMED; i++) {
      const frame = next();
      const t0 = performance.now();
      const events = detector.process(frame);
      durations.push(performance.now() - t0);
      expect(events).toHaveLength(1);
    }

    durations.sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)] as number;
    console.log(`band perf median: ${median.toFixed(3)} ms per call`);
    expect(
      median,
      `median ${median.toFixed(4)} ms per call, budget ${MEDIAN_BUDGET_MS} ms`,
    ).toBeLessThanOrEqual(MEDIAN_BUDGET_MS);
  });
});
