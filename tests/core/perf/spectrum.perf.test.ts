import { describe, expect, it } from "vitest";
import { spectrum } from "@earworm/core";

// Perf tests are the only tests that read a real clock (performance.now).
// Requirements 19.18, 19.22.

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 2048;
const WARM_UP = 20;
const TIMED = 200;
const MEDIAN_BUDGET_MS = 5;

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

describe("spectrum performance", () => {
  it("computes a 2048-sample hann spectrum in at most 5 ms (median)", () => {
    const samples = makeSamples();

    const first = spectrum(samples, SAMPLE_RATE, FFT_SIZE, "hann");
    expect(first.ok).toBe(true);

    for (let i = 0; i < WARM_UP; i++) {
      spectrum(samples, SAMPLE_RATE, FFT_SIZE, "hann");
    }

    const durations: number[] = [];
    for (let i = 0; i < TIMED; i++) {
      const t0 = performance.now();
      spectrum(samples, SAMPLE_RATE, FFT_SIZE, "hann");
      durations.push(performance.now() - t0);
    }

    durations.sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)] as number;
    console.log(`spectrum perf median: ${median.toFixed(3)} ms per call`);
    expect(
      median,
      `median ${median.toFixed(4)} ms per call, budget ${MEDIAN_BUDGET_MS} ms`,
    ).toBeLessThanOrEqual(MEDIAN_BUDGET_MS);
  });
});
