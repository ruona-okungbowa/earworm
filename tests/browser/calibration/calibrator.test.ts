import { describe, expect, it } from "vitest";
import {
  createCalibrationStore,
  createCalibrator,
  serialiseCalibration,
} from "@earworm/browser";
import type { AudioEngine, Synth } from "@earworm/browser";
import { createOnsetDetector } from "@earworm/core";
import type { Detector, EarwormEvent, EventSource, Ms } from "@earworm/core";

// Feature: earworm-kit, Calibrator with fakes
// **Validates: Requirements 6.2, 6.3, 6.5, 6.6, 6.9, 6.10, 6.11, 6.12, 6.13, 6.14, 18.15**

const NOW = 1000;

interface Rig {
  calibrator: ReturnType<typeof createCalibrator>;
  store: ReturnType<typeof createCalibrationStore>;
  detectors: FakeDetector[];
  scheduled: { voice: string; atMs: Ms; opts: unknown }[];
  waits: Ms[];
}

interface FakeDetector extends Detector {
  calls: number[];
}

function fakeDetector(name: string): FakeDetector {
  const calls: number[] = [];
  return {
    name,
    calls,
    process: () => [],
    reset: () => {},
    setNoiseFloor: (db: number) => {
      calls.push(db);
    },
  };
}

/**
 * `phases[i]` runs inside the i-th `wait` call and may emit events. The
 * noise-floor measurement waits first, the latency measurement second.
 */
function makeRig(
  phases: ((emit: (e: EarwormEvent) => void) => void)[],
  previous?: { noiseFloorDb: number; latencyMs: number },
): Rig {
  const listeners = new Set<(e: EarwormEvent) => void>();
  const source: EventSource = {
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
  const emit = (e: EarwormEvent): void => {
    for (const l of [...listeners]) l(e);
  };
  const scheduled: Rig["scheduled"] = [];
  const synth: Synth = {
    schedule(voice, atMs, opts) {
      scheduled.push({ voice, atMs, opts });
      return Promise.resolve({ startMs: atMs, endMs: atMs + 10 });
    },
    registerVoice: () => {},
    stop: () => {},
  };
  const engine = { now: () => NOW } as unknown as AudioEngine;
  const waits: Ms[] = [];
  let i = 0;
  const wait = (ms: Ms): Promise<void> => {
    waits.push(ms);
    phases[i++]?.(emit);
    return Promise.resolve();
  };
  const store = createCalibrationStore();
  if (previous) store.set(previous);
  const detectors = [fakeDetector("a"), fakeDetector("b")];
  const calibrator = createCalibrator({
    engine,
    synth,
    source,
    store,
    detectors,
    wait,
  });
  // Ignore the writes made while seeding the previous Calibration.
  for (const d of detectors) d.calls.length = 0;
  return { calibrator, store, detectors, scheduled, waits };
}

const quiet =
  (db: number) =>
  (emit: (e: EarwormEvent) => void): void => {
    for (let t = 0; t < 2000; t += 20) {
      emit({ type: "level", timestamp: t, source: "mic", level: db });
    }
  };

/** Onsets `lag` ms after each of the first `n` scheduled clicks. */
const clicks =
  (n: number, lag: number) =>
  (emit: (e: EarwormEvent) => void): void => {
    for (let i = 0; i < n; i++) {
      emit({
        type: "onset",
        timestamp: NOW + 100 + i * 500 + lag,
        source: "mic",
        strength: 1,
      });
    }
  };

const PREVIOUS = { noiseFloorDb: -55, latencyMs: 40 };

async function rejection(p: Promise<unknown>): Promise<{ code: string }> {
  try {
    await p;
  } catch (e) {
    return e as { code: string };
  }
  throw new Error("expected rejection");
}

describe("Calibrator", () => {
  it("success stores both values and updates every Detector Noise_Floor", async () => {
    const rig = makeRig([quiet(-70), clicks(4, 30)]);
    const c = await rig.calibrator.calibrate();
    expect(c.noiseFloorDb).toBeCloseTo(-70, 6);
    expect(c.latencyMs).toBe(30);
    expect(rig.store.get()).toEqual(c);
    for (const d of rig.detectors) expect(d.calls).toEqual([c.noiseFloorDb]);
  });

  it("measureNoiseFloor and measureLatency never write the store", async () => {
    const rig = makeRig([quiet(-70), clicks(4, 30)]);
    await rig.calibrator.measureNoiseFloor();
    await rig.calibrator.measureLatency();
    expect(rig.store.get()).toBeNull();
    for (const d of rig.detectors) expect(d.calls).toEqual([]);
  });

  it("rejects when no clicks are detected before the timeout, keeping the previous Calibration", async () => {
    const rig = makeRig([quiet(-70), clicks(0, 0)], PREVIOUS);
    const e = await rejection(rig.calibrator.calibrate());
    expect(e.code).toBe("calibration-failed");
    expect(rig.store.get()).toEqual(PREVIOUS);
    for (const d of rig.detectors) expect(d.calls).toEqual([]);
  });

  it("times out 3,000 ms after the first scheduled click by default", async () => {
    const rig = makeRig([quiet(-70), clicks(4, 30)]);
    await rig.calibrator.calibrate();
    // First click at NOW + 100, so the wait is 100 + 3000.
    expect(rig.waits[1]).toBe(3100);
    const custom = makeRig([quiet(-70), clicks(4, 30)]);
    await custom.calibrator.calibrate({ timeoutMs: 5000 });
    expect(custom.waits[1]).toBe(5100);
  });

  it("rejects with fewer than 3 matched clicks and leaves the store unset", async () => {
    const rig = makeRig([quiet(-70), clicks(2, 30)]);
    const e = await rejection(rig.calibrator.calibrate());
    expect(e.code).toBe("calibration-failed");
    expect(rig.store.get()).toBeNull();
  });

  it("accepts exactly 3 matched clicks", async () => {
    const rig = makeRig([quiet(-70), clicks(3, 30)]);
    const c = await rig.calibrator.calibrate();
    expect(c.latencyMs).toBe(30);
  });

  it("rejects a loud room and keeps the previous Calibration", async () => {
    const rig = makeRig([quiet(-20), clicks(4, 30)], PREVIOUS);
    const e = await rejection(rig.calibrator.calibrate());
    expect(e.code).toBe("room-too-loud");
    expect(rig.store.get()).toEqual(PREVIOUS);
    // The clicks are never played once the room check fails.
    expect(rig.scheduled).toHaveLength(0);
    for (const d of rig.detectors) expect(d.calls).toEqual([]);
  });

  it("a latency failure after a good Noise_Floor leaves the previous Calibration whole", async () => {
    const rig = makeRig([quiet(-70), clicks(1, 30)], PREVIOUS);
    const e = await rejection(rig.calibrator.calibrate());
    expect(e.code).toBe("calibration-failed");
    expect(rig.store.get()).toEqual(PREVIOUS);
    for (const d of rig.detectors) expect(d.calls).toEqual([]);
  });

  it("a latency failure after a good Noise_Floor leaves an unset store unset", async () => {
    const rig = makeRig([quiet(-70), clicks(0, 0)]);
    await rejection(rig.calibrator.calibrate());
    expect(rig.store.get()).toBeNull();
    for (const d of rig.detectors) expect(d.calls).toEqual([]);
  });

  it("rejects a Latency outside 0 to 500 ms", async () => {
    const rig = makeRig([quiet(-70), clicks(4, -10)], PREVIOUS);
    const e = await rejection(rig.calibrator.calibrate());
    expect(e.code).toBe("calibration-failed");
    expect(rig.store.get()).toEqual(PREVIOUS);
  });

  it("load keeps the previous Calibration on invalid input", async () => {
    const rig = makeRig([], PREVIOUS);
    for (const text of [
      "not json",
      "[]",
      JSON.stringify({ noiseFloorDb: -55 }),
      JSON.stringify({ noiseFloorDb: 5, latencyMs: 40 }),
      JSON.stringify({ noiseFloorDb: -55, latencyMs: 501 }),
    ]) {
      const e = await rejection(rig.calibrator.load(text));
      expect(e.code).toBe("invalid-calibration");
      expect(rig.store.get()).toEqual(PREVIOUS);
    }
    for (const d of rig.detectors) expect(d.calls).toEqual([]);
  });

  it("load stores valid input and updates Detector Noise_Floors", async () => {
    const rig = makeRig([]);
    const c = await rig.calibrator.load(
      serialiseCalibration({ noiseFloorDb: -48, latencyMs: 25 }),
    );
    expect(c).toEqual({ noiseFloorDb: -48, latencyMs: 25 });
    expect(rig.store.get()).toEqual(c);
    for (const d of rig.detectors) expect(d.calls).toEqual([-48]);
  });

  it("schedules four ungated clicks 500 ms apart", async () => {
    const rig = makeRig([quiet(-70), clicks(4, 30)]);
    await rig.calibrator.calibrate();
    expect(rig.scheduled).toHaveLength(4);
    rig.scheduled.forEach((s, i) => {
      expect(s.voice).toBe("click");
      expect(s.atMs).toBe(NOW + 100 + i * 500);
      expect(s.opts).toMatchObject({ ungated: true });
    });
  });

  it("Req 6.14: a failed first calibrate leaves the store null and Onset_Detectors use -60 dBFS", async () => {
    const made = createOnsetDetector();
    if (!made.ok) throw new Error("onset detector failed to build");
    const onset = made.value;
    const events: EarwormEvent[] = [];
    const listeners = new Set<(e: EarwormEvent) => void>();
    const source: EventSource = {
      subscribe(l) {
        listeners.add(l);
        return () => listeners.delete(l);
      },
    };
    const store = createCalibrationStore();
    const calibrator = createCalibrator({
      engine: { now: () => NOW } as unknown as AudioEngine,
      synth: {
        schedule: (_v, atMs) => Promise.resolve({ startMs: atMs, endMs: atMs }),
        registerVoice: () => {},
        stop: () => {},
      },
      source,
      store,
      detectors: [onset],
      // A loud room: the first wait emits loud level events.
      wait: () => {
        for (let t = 0; t < 2000; t += 20) {
          for (const l of listeners) {
            l({ type: "level", timestamp: t, source: "mic", level: -10 });
          }
        }
        return Promise.resolve();
      },
    });
    await rejection(calibrator.calibrate());
    expect(store.get()).toBeNull();

    // Amplitude 0.01 is -40 dBFS: 20 dB over the default -60 floor, so it
    // clears the 10 dB threshold. A floor moved to -10 would not.
    const frame = (timestamp: number, amp: number) => ({
      samples: new Float32Array(128).fill(amp),
      timestamp,
      sampleRate: 48000,
    });
    events.push(...onset.process(frame(0, 0)));
    events.push(...onset.process(frame(40, 0.01)));
    expect(events.some((e) => e.type === "onset")).toBe(true);
  });
});
