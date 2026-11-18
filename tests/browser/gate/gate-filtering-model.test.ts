// Feature: earworm-kit, Property 21: Gate filtering model
// **Validates: Requirements 8.1, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 9.5, 21.1**
import { createGate, type Gate, type GateMode } from "@earworm/browser";
import type { EarwormEvent, EventSource } from "@earworm/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { eventArb, finiteIn } from "../../helpers/events";
import { pbtParams } from "../../helpers/pbt";

interface ModelWindow {
  id: number;
  start: number;
  end: number;
}

/** Small time range so windows, tails and Events overlap and touch often. */
const smallTime = fc.integer({ min: -50, max: 2000 });

const windowArb = fc
  .tuple(smallTime, fc.integer({ min: 0, max: 500 }))
  .map(([start, len]) => ({ start, end: start + len }));

/** An Event whose Timestamp is placed in the small range and whose source favours "mic". */
const placedEventArb: fc.Arbitrary<EarwormEvent> = fc
  .tuple(
    eventArb,
    fc.oneof(smallTime, finiteIn(-50, 3000)),
    fc.oneof(fc.constant("mic"), fc.constant("mic"), fc.constantFrom("tap", "replay", "other")),
  )
  .map(([e, timestamp, source]) => ({ ...e, timestamp, source }) as EarwormEvent);

type Op =
  | { kind: "add"; start: number; end: number }
  | { kind: "cancel"; pick: number }
  | { kind: "mode"; mode: GateMode };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 5, arbitrary: windowArb.map((w) => ({ kind: "add" as const, ...w })) },
  { weight: 2, arbitrary: fc.nat(20).map((pick) => ({ kind: "cancel" as const, pick })) },
  {
    weight: 1,
    arbitrary: fc
      .constantFrom<GateMode>("ignore-synth", "off")
      .map((mode) => ({ kind: "mode" as const, mode })),
  },
);

const tailArb = fc.oneof(fc.constantFrom(0, 5000), fc.integer({ min: 0, max: 5000 }), finiteIn(0, 5000));
const latencyArb = fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 500 }), finiteIn(0, 500));

function mustGate(gate: ReturnType<typeof createGate>): Gate {
  if (!gate.ok) throw new Error(`createGate failed: ${gate.error.code}`);
  return gate.value;
}

describe("Property 21: Gate filtering model", () => {
  it("passes exactly the Events outside every closed window, in order, matching the reference model", () => {
    fc.assert(
      fc.property(
        fc.array(placedEventArb, { maxLength: 30 }),
        fc.array(opArb, { maxLength: 15 }),
        tailArb,
        latencyArb,
        fc.boolean(),
        (events, ops, tailMs, outputLatencyMs, calibrated) => {
          const gate = mustGate(
            createGate({ tailMs, outputLatencyMs, hasCalibration: () => calibrated }),
          );
          const extra = calibrated ? 0 : outputLatencyMs;
          const model: ModelWindow[] = [];
          const ids: number[] = [];
          let mode: GateMode = "ignore-synth";

          for (const op of ops) {
            if (op.kind === "add") {
              const r = gate.addWindow(op.start, op.end);
              expect(r.ok).toBe(true);
              if (!r.ok) return;
              ids.push(r.value.id);
              model.push({ id: r.value.id, start: op.start, end: op.end + tailMs + extra });
            } else if (op.kind === "cancel") {
              if (ids.length === 0) continue;
              const id = ids[op.pick % ids.length] as number;
              gate.cancelWindow(id);
              const at = model.findIndex((w) => w.id === id);
              if (at >= 0) model.splice(at, 1);
            } else {
              gate.setMode(op.mode);
              mode = op.mode;
            }
          }

          const expected = events.filter(
            (e) =>
              mode === "off" ||
              e.source !== "mic" ||
              !model.some((w) => e.timestamp >= w.start && e.timestamp <= w.end),
          );

          // shouldPass filter keeps the original order.
          expect(events.filter((e) => gate.shouldPass(e))).toEqual(expected);

          // wrap() delivers the same Events in the same order, whichever source supplies them.
          const delivered: EarwormEvent[] = [];
          const source: EventSource = {
            subscribe(listener) {
              for (const e of events) listener(e);
              return () => {};
            },
          };
          gate.wrap(source).subscribe((e) => delivered.push(e));
          expect(delivered).toEqual(expected);
        },
      ),
      pbtParams(),
    );
  });

  it("edges of a window are inclusive, including the tail and output latency without Calibration", () => {
    fc.assert(
      fc.property(
        windowArb,
        fc.integer({ min: 0, max: 5000 }),
        fc.integer({ min: 0, max: 500 }),
        fc.boolean(),
        (w, tailMs, outputLatencyMs, calibrated) => {
          const gate = mustGate(
            createGate({ tailMs, outputLatencyMs, hasCalibration: () => calibrated }),
          );
          gate.addWindow(w.start, w.end);
          const last = w.end + tailMs + (calibrated ? 0 : outputLatencyMs);
          const mk = (timestamp: number): EarwormEvent => ({
            type: "onset",
            timestamp,
            source: "mic",
            strength: 1,
          });
          expect(gate.shouldPass(mk(w.start))).toBe(false);
          expect(gate.shouldPass(mk(last))).toBe(false);
          expect(gate.shouldPass(mk(w.start - 1))).toBe(true);
          expect(gate.shouldPass(mk(last + 1))).toBe(true);
        },
      ),
      pbtParams(),
    );
  });

  it("an empty input yields an empty output", () => {
    const gate = mustGate(createGate());
    gate.addWindow(0, 100);
    const delivered: EarwormEvent[] = [];
    gate.wrap({ subscribe: () => () => {} }).subscribe((e) => delivered.push(e));
    expect(delivered).toEqual([]);
    expect([].filter(() => gate.shouldPass({} as EarwormEvent))).toEqual([]);
  });
});
