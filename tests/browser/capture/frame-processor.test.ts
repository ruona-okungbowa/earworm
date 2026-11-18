import { createFrameProcessor } from "@earworm/browser";
import type { Detector, EarwormEvent, Frame } from "@earworm/core";
import { describe, expect, it } from "vitest";

const SAMPLE_RATE = 48_000;
const FRAME_SIZE = 2048;

function frame(timestamp: number, samples: Float32Array): Frame {
  return { samples, timestamp, sampleRate: SAMPLE_RATE };
}

function silence(): Float32Array {
  return new Float32Array(FRAME_SIZE);
}

function sine(hz: number, amp: number): Float32Array {
  const out = new Float32Array(FRAME_SIZE);
  for (let i = 0; i < FRAME_SIZE; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SAMPLE_RATE);
  }
  return out;
}

function fake(
  name: string,
  onProcess: (f: Frame) => EarwormEvent[],
  onFlush?: () => EarwormEvent[],
): Detector {
  const d: Detector = {
    name,
    process: onProcess,
    reset: () => undefined,
  };
  if (onFlush) d.flush = onFlush;
  return d;
}

function collect(): { events: EarwormEvent[]; emit: (e: EarwormEvent) => void } {
  const events: EarwormEvent[] = [];
  return { events, emit: (e) => events.push(e) };
}

describe("createFrameProcessor", () => {
  it("runs Onset, Pitch and Level only by default", () => {
    const { events, emit } = collect();
    const p = createFrameProcessor({ emit });
    p.process(frame(0, silence()));
    p.process(frame(43, silence()));
    for (let i = 0; i < 20; i++) {
      p.process(frame(86 + i * 43, sine(440, 0.8)));
    }
    p.close();

    const types = new Set(events.map((e) => e.type));
    expect(types.has("level")).toBe(true);
    for (const t of types) {
      expect(["onset", "pitch", "level"]).toContain(t);
    }
  });

  it("runs exactly the supplied Detectors, in order", () => {
    const { events, emit } = collect();
    const calls: string[] = [];
    const a = fake("a", (f) => {
      calls.push("a");
      return [{ type: "onset", timestamp: f.timestamp, source: "x", strength: 1 }];
    });
    const b = fake("b", (f) => {
      calls.push("b");
      return [{ type: "level", timestamp: f.timestamp, source: "x", level: -10 }];
    });
    const p = createFrameProcessor({ detectors: [a, b], emit });
    p.process(frame(100, sine(440, 0.5)));

    expect(calls).toEqual(["a", "b"]);
    expect(events.map((e) => e.type)).toEqual(["onset", "level"]);
  });

  it("emits nothing for an empty Detector list", () => {
    const { events, emit } = collect();
    const p = createFrameProcessor({ detectors: [], emit });
    p.process(frame(0, sine(440, 0.5)));
    p.close();
    expect(events).toEqual([]);
  });

  it('tags every Event with source "mic", including flushed ones', () => {
    const { events, emit } = collect();
    const d = fake(
      "d",
      (f) => [{ type: "onset", timestamp: f.timestamp, source: "replay", strength: 1 }],
      () => [{ type: "release", timestamp: 500, source: "tap" }],
    );
    const p = createFrameProcessor({ detectors: [d], emit });
    p.process(frame(10, silence()));
    p.close();

    expect(events).toHaveLength(2);
    for (const e of events) expect(e.source).toBe("mic");
  });

  it("subtracts Latency from Timestamp, startTime and endTime, keeping duration", () => {
    const { events, emit } = collect();
    const d = fake(
      "d",
      (f) => [
        { type: "onset", timestamp: f.timestamp, source: "mic", strength: 1 },
        {
          type: "sound-start",
          timestamp: f.timestamp,
          source: "mic",
          startTime: f.timestamp,
          level: -20,
        },
        {
          type: "sound-end",
          timestamp: f.timestamp,
          source: "mic",
          endTime: f.timestamp,
          duration: 120,
        },
      ],
    );
    const p = createFrameProcessor({
      detectors: [d],
      calibration: { get: () => ({ noiseFloorDb: -60, latencyMs: 40 }) },
      emit,
    });
    p.process(frame(1000, silence()));

    expect(events).toEqual([
      { type: "onset", timestamp: 960, source: "mic", strength: 1 },
      {
        type: "sound-start",
        timestamp: 960,
        source: "mic",
        startTime: 960,
        level: -20,
      },
      {
        type: "sound-end",
        timestamp: 960,
        source: "mic",
        endTime: 960,
        duration: 120,
      },
    ]);
  });

  it("leaves times unchanged without Calibration", () => {
    const { events, emit } = collect();
    const d = fake("d", (f) => [
      { type: "onset", timestamp: f.timestamp, source: "mic", strength: 1 },
    ]);
    const p = createFrameProcessor({ detectors: [d], emit });
    p.process(frame(1000, silence()));
    expect(events[0]?.timestamp).toBe(1000);
  });

  it("leaves times unchanged when Calibration is null", () => {
    const { events, emit } = collect();
    const d = fake("d", (f) => [
      { type: "onset", timestamp: f.timestamp, source: "mic", strength: 1 },
    ]);
    const p = createFrameProcessor({
      detectors: [d],
      calibration: { get: () => null },
      emit,
    });
    p.process(frame(1000, silence()));
    expect(events[0]?.timestamp).toBe(1000);
  });

  it("reads Latency at delivery time, so a later calibration applies", () => {
    const { events, emit } = collect();
    let latencyMs = 10;
    const d = fake("d", (f) => [
      { type: "onset", timestamp: f.timestamp, source: "mic", strength: 1 },
    ]);
    const p = createFrameProcessor({
      detectors: [d],
      calibration: { get: () => ({ noiseFloorDb: -60, latencyMs }) },
      emit,
    });
    p.process(frame(100, silence()));
    latencyMs = 30;
    p.process(frame(200, silence()));
    expect(events.map((e) => e.timestamp)).toEqual([90, 170]);
  });

  it("close() delivers flush() Events, shifted by Latency, and skips Detectors without flush", () => {
    const { events, emit } = collect();
    const withFlush = fake(
      "f",
      () => [],
      () => [
        {
          type: "sound-end",
          timestamp: 800,
          source: "mic",
          endTime: 800,
          duration: 300,
        },
      ],
    );
    const without = fake("n", () => []);
    const p = createFrameProcessor({
      detectors: [without, withFlush],
      calibration: { get: () => ({ noiseFloorDb: -60, latencyMs: 25 }) },
      emit,
    });
    p.process(frame(0, silence()));
    expect(events).toEqual([]);

    p.close();
    expect(events).toEqual([
      {
        type: "sound-end",
        timestamp: 775,
        source: "mic",
        endTime: 775,
        duration: 300,
      },
    ]);
  });
});
