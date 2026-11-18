// Feature: earworm-kit, Property 4: Custom Events keep their type and data
// **Validates: Requirements 1.11, 21.10**
import { createGate } from "@earworm/browser";
import {
  createReplaySource,
  parseRecording,
  serialiseRecording,
  shiftEvent,
  type EarwormEvent,
} from "@earworm/core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { customEventArb, finiteIn } from "../../helpers/events";
import { pbtParams } from "../../helpers/pbt";

const windowArb = fc
  .tuple(finiteIn(-1e6, 1e9), finiteIn(0, 1e6))
  .map(([start, len]) => ({ start, end: start + len }));

describe("Property 4: Custom Events keep their type and data", () => {
  it("shift, gate, serialise/parse and replay change only the timestamp", () => {
    fc.assert(
      fc.property(
        customEventArb,
        finiteIn(-1e6, 1e6),
        windowArb,
        fc.constantFrom("ignore-synth" as const, "off" as const),
        fc.boolean(),
        (event, delta, win, mode, aimWindowAtEvent) => {
          const shifted = shiftEvent(event, delta);
          expect(shifted.type).toBe(event.type);
          expect(shifted.source).toBe(event.source);
          expect(shifted.data).toEqual(event.data);
          expect(shifted.timestamp).toBe(event.timestamp + delta);

          const gateResult = createGate({ tailMs: 0 });
          if (!gateResult.ok) throw new Error("gate creation failed");
          const gate = gateResult.value;
          gate.setMode(mode);
          const w = aimWindowAtEvent
            ? { start: shifted.timestamp - 1, end: shifted.timestamp + 1 }
            : win;
          expect(gate.addWindow(w.start, w.end).ok).toBe(true);

          // The Gate treats a Custom_Event like any Event with the same source and timestamp.
          const twin: EarwormEvent = {
            type: "onset",
            timestamp: shifted.timestamp,
            source: shifted.source,
            strength: 1,
          };
          const passes = gate.shouldPass(shifted);
          expect(passes).toBe(gate.shouldPass(twin));

          const passed: EarwormEvent[] = [];
          gate
            .wrap({
              subscribe: (listener) => {
                listener(shifted);
                return () => undefined;
              },
            })
            .subscribe((e) => passed.push(e));
          expect(passed.length).toBe(passes ? 1 : 0);
          if (!passes) return;

          const parsed = parseRecording(
            serialiseRecording({ version: 1, events: passed }),
          );
          if (!parsed.ok) throw new Error("parse failed");

          const replayed: EarwormEvent[] = [];
          const replay = createReplaySource(parsed.value);
          replay.subscribe((e) => replayed.push(e));
          replay.advance(Number.POSITIVE_INFINITY);

          expect(replayed.length).toBe(1);
          const out = replayed[0];
          expect(out).toBeDefined();
          if (out === undefined || !out.type.startsWith("x-")) {
            throw new Error("expected a Custom_Event");
          }
          expect(out.type).toBe(event.type);
          expect(out.source).toBe(event.source);
          expect(out.timestamp).toBe(shifted.timestamp);
          expect("data" in out ? out.data : undefined).toEqual(event.data);
        },
      ),
      pbtParams(),
    );
  });
});
