import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  createCalibrationStore,
  createCalibrator,
  serialiseCalibration,
} from "@earworm/browser";
import type { AudioEngine, Calibration, Synth } from "@earworm/browser";
import type { Detector, EarwormEvent, EventSource } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 59: Calibration updates are all or nothing
// **Validates: Requirements 6.5, 6.6, 6.9, 6.13, 6.14**

type NoisePlan =
  | { kind: "ok"; level: number; count: number }
  | { kind: "loud"; level: number }
  | { kind: "silent" };

type LatencyPlan =
  | { kind: "ok"; latency: number }
  | { kind: "too-few" }
  | { kind: "negative"; latency: number }
  | { kind: "synth-rejects" };

type Attempt =
  | { type: "calibrate"; noise: NoisePlan; latency: LatencyPlan }
  | { type: "load-valid"; calibration: Calibration }
  | { type: "load-invalid"; text: string };

const noiseArb: fc.Arbitrary<NoisePlan> = fc.oneof(
  fc.record({
    kind: fc.constant("ok" as const),
    level: fc.integer({ min: -100, max: -31 }),
    count: fc.integer({ min: 1, max: 5 }),
  }),
  fc.record({
    kind: fc.constant("loud" as const),
    level: fc.integer({ min: -29, max: 0 }),
  }),
  fc.constant({ kind: "silent" as const }),
);

const latencyArb: fc.Arbitrary<LatencyPlan> = fc.oneof(
  fc.record({
    kind: fc.constant("ok" as const),
    latency: fc.integer({ min: 0, max: 250 }),
  }),
  fc.constant({ kind: "too-few" as const }),
  fc.record({
    kind: fc.constant("negative" as const),
    latency: fc.integer({ min: -250, max: -1 }),
  }),
  fc.constant({ kind: "synth-rejects" as const }),
);

const calibrationArb: fc.Arbitrary<Calibration> = fc.record({
  noiseFloorDb: fc.integer({ min: -1200, max: 0 }).map((n) => n / 10),
  latencyMs: fc.integer({ min: 0, max: 500 }),
});

const invalidTextArb: fc.Arbitrary<string> = fc.constantFrom(
  "not json",
  "",
  "[]",
  "null",
  "{}",
  JSON.stringify({ noiseFloorDb: -40 }),
  JSON.stringify({ latencyMs: 20 }),
  JSON.stringify({ noiseFloorDb: "-40", latencyMs: 20 }),
  JSON.stringify({ noiseFloorDb: 1, latencyMs: 20 }),
  JSON.stringify({ noiseFloorDb: -121, latencyMs: 20 }),
  JSON.stringify({ noiseFloorDb: -40, latencyMs: 501 }),
  JSON.stringify({ noiseFloorDb: -40, latencyMs: -1 }),
);

const attemptArb: fc.Arbitrary<Attempt> = fc.oneof(
  fc.record({
    type: fc.constant("calibrate" as const),
    noise: noiseArb,
    latency: latencyArb,
  }),
  fc.record({
    type: fc.constant("load-valid" as const),
    calibration: calibrationArb,
  }),
  fc.record({
    type: fc.constant("load-invalid" as const),
    text: invalidTextArb,
  }),
);

interface Rig {
  store: ReturnType<typeof createCalibrationStore>;
  calibrator: ReturnType<typeof createCalibrator>;
  floorCalls: number[][];
  notifications: (Calibration | null)[];
  /** Plans for the next `calibrate()` call. */
  script: { noise: NoisePlan; latency: LatencyPlan };
}

function buildRig(initial: Calibration | null): Rig {
  let clock = 1000;
  const listeners = new Set<(e: EarwormEvent) => void>();
  const emit = (e: EarwormEvent): void => {
    for (const l of [...listeners]) l(e);
  };
  const source: EventSource = {
    subscribe(l) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };

  const scheduled: number[] = [];
  const script: Rig["script"] = {
    noise: { kind: "silent" },
    latency: { kind: "synth-rejects" },
  };
  let waits = 0;

  const synth = {
    schedule(_voice: string, atMs: number) {
      if (script.latency.kind === "synth-rejects") {
        return Promise.reject({ code: "calibration-failed", message: "no synth" });
      }
      scheduled.push(atMs);
      return Promise.resolve({ startMs: atMs, endMs: atMs + 5 });
    },
    registerVoice() {},
    stop() {},
  } as unknown as Synth;

  const engine = { now: () => clock } as unknown as AudioEngine;

  const wait = (ms: number): Promise<void> => {
    clock += ms;
    waits++;
    if (waits % 2 === 1) {
      const n = script.noise;
      if (n.kind === "ok") {
        for (let i = 0; i < n.count; i++) {
          emit({ type: "level", timestamp: clock - 1000 + i * 10, source: "mic", level: n.level });
        }
      } else if (n.kind === "loud") {
        emit({ type: "level", timestamp: clock - 1000, source: "mic", level: n.level });
      }
    } else {
      const l = script.latency;
      const matches =
        l.kind === "ok" ? scheduled.slice() : l.kind === "negative" ? scheduled.slice() : scheduled.slice(0, 2);
      const lat = l.kind === "ok" || l.kind === "negative" ? l.latency : 0;
      for (const s of matches) {
        emit({ type: "onset", timestamp: s + lat, source: "mic", strength: 1 });
      }
      scheduled.length = 0;
    }
    return Promise.resolve();
  };

  const floorCalls: number[][] = [[], []];
  const detectors: Detector[] = floorCalls.map((calls, i) => ({
    name: `fake-${i}`,
    process: () => [],
    reset() {},
    setNoiseFloor(db: number) {
      calls.push(db);
    },
  }));

  const store = createCalibrationStore();
  if (initial !== null) store.set(initial);
  const notifications: (Calibration | null)[] = [];
  store.subscribe((c) => notifications.push(c));

  const calibrator = createCalibrator({ engine, synth, source, store, detectors, wait });
  const rig: Rig = { store, calibrator, floorCalls, notifications, script };
  // Wait counter must restart per calibrate(); a failing noise step skips the latency wait.
  const original = calibrator.calibrate.bind(calibrator);
  calibrator.calibrate = async (opts) => {
    waits = 0;
    scheduled.length = 0;
    return original(opts);
  };
  return rig;
}

describe("Property 59: Calibration updates are all or nothing", () => {
  it("the store equals the last successful attempt, and setNoiseFloor runs once per success", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.option(calibrationArb, { nil: null }),
        fc.array(attemptArb, { minLength: 1, maxLength: 8 }),
        async (initial, attempts) => {
          const rig = buildRig(initial);
          const baseNotifications = rig.notifications.length;
          let expected: Calibration | null = initial;
          let successes = 0;

          for (const a of attempts) {
            const before = rig.store.get();
            let result: Calibration | null = null;

            if (a.type === "calibrate") {
              rig.script.noise = a.noise;
              rig.script.latency = a.latency;
              const noiseOk = a.noise.kind === "ok";
              const latencyOk = a.latency.kind === "ok";
              try {
                result = await rig.calibrator.calibrate();
                expect(noiseOk && latencyOk).toBe(true);
              } catch (e) {
                expect(noiseOk && latencyOk).toBe(false);
                expect((e as { code: string }).code).toMatch(
                  /calibration-failed|room-too-loud/,
                );
              }
            } else if (a.type === "load-valid") {
              result = await rig.calibrator.load(serialiseCalibration(a.calibration));
              expect(result).toEqual(a.calibration);
            } else {
              await expect(rig.calibrator.load(a.text)).rejects.toMatchObject({
                code: "invalid-calibration",
              });
            }

            if (result !== null) {
              successes++;
              expected = result;
              expect(rig.store.get()).toEqual(result);
              if (a.type === "calibrate" && a.noise.kind === "ok" && a.latency.kind === "ok") {
                expect(result.noiseFloorDb).toBeCloseTo(a.noise.level, 6);
                expect(result.latencyMs).toBe(a.latency.latency);
              }
            } else {
              expect(rig.store.get()).toEqual(before);
            }
            expect(rig.store.get()).toEqual(expected);

            for (const calls of rig.floorCalls) {
              expect(calls.length).toBe(successes);
              if (successes > 0) expect(calls[calls.length - 1]).toBe(expected!.noiseFloorDb);
            }
            expect(rig.notifications.length - baseNotifications).toBe(successes);
          }
        },
      ),
      pbtParams(),
    );
  });

  it("leaves Detectors untouched and the store unset when the first calibrate() fails", async () => {
    const rig = buildRig(null);
    rig.script.noise = { kind: "ok", level: -60, count: 3 };
    rig.script.latency = { kind: "too-few" };
    await expect(rig.calibrator.calibrate()).rejects.toMatchObject({
      code: "calibration-failed",
    });
    expect(rig.store.get()).toBeNull();
    expect(rig.floorCalls).toEqual([[], []]);
  });
});
