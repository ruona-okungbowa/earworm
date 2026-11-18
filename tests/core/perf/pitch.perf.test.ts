import { describe, expect, it } from "vitest";
import { createPitchDetector } from "@earworm/core";
import type { Frame } from "@earworm/core";

// Perf tests are the only tests that read a real clock (performance.now).
// Requirements 2.3, 14.13.

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 128;
const HISTORY = 2048;
const WARM_UP = 20;
const TIMED = 200;
const F0 = 220;
const MEDIAN_BUDGET_MS = 1;

/** Harmonic tone, 220 Hz plus two overtones, peak about 0.5 (well above the Noise_Floor). */
function makeFrame(index: number): Frame {
  const samples = new Float32Array(FRAME_SIZE);
  const start = index * FRAME_SIZE;
  for (let i = 0; i < FRAME_SIZE; i++) {
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

describe("Pitch_Detector performance", () => {
  it("processes a 128-sample Frame in under 1 ms (median) with a full history", () => {
    const created = createPitchDetector();
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const detector = created.value;

    const fill = HISTORY / FRAME_SIZE;
    const total = fill + WARM_UP + TIMED;
    const frames: Frame[] = [];
    for (let i = 0; i < total; i++) frames.push(makeFrame(i));

    // Fill the Sample_History.
    for (let i = 0; i < fill; i++) detector.process(frames[i] as Frame);
    expect(detector.historyLength).toBe(HISTORY);

    for (let i = fill; i < fill + WARM_UP; i++) {
      detector.process(frames[i] as Frame);
    }

    const durations: number[] = [];
    let pitchEvents = 0;
    for (let i = fill + WARM_UP; i < total; i++) {
      const frame = frames[i] as Frame;
      const t0 = performance.now();
      const events = detector.process(frame);
      durations.push(performance.now() - t0);
      for (const e of events) if (e.type === "pitch") pitchEvents++;
    }

    // The timed path is the full YIN path only if the tone yields Pitch_Events.
    expect(pitchEvents).toBeGreaterThan(0);

    durations.sort((a, b) => a - b);
    const median = durations[Math.floor(durations.length / 2)] as number;
    console.log(`pitch perf median: ${median.toFixed(3)} ms per Frame`);
    expect(
      median,
      `median ${median.toFixed(4)} ms per Frame, budget ${MEDIAN_BUDGET_MS} ms`,
    ).toBeLessThan(MEDIAN_BUDGET_MS);
  });
});
