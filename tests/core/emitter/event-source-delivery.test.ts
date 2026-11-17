// Feature: earworm-kit, Property 3: Event source delivery model
// **Validates: Requirements 1.2, 1.3, 1.4, 1.5**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { createEmitter, type EarwormEvent, type Unsubscribe } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt.js";

type Op =
  | { kind: "subscribe"; throws: boolean; kill: number | null }
  | { kind: "unsubscribe"; target: number; times: number }
  | { kind: "emit" };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.record({
    kind: fc.constant("subscribe" as const),
    throws: fc.boolean(),
    // When set, the listener unsubscribes subscriber `kill % count` while it is being dispatched to.
    kill: fc.option(fc.nat(50), { nil: null }),
  }) },
  { weight: 2, arbitrary: fc.record({
    kind: fc.constant("unsubscribe" as const),
    target: fc.nat(50),
    times: fc.integer({ min: 1, max: 3 }),
  }) },
  { weight: 4, arbitrary: fc.record({ kind: fc.constant("emit" as const) }) },
);

function makeEvent(id: number): EarwormEvent {
  return { type: "onset", timestamp: id, source: "tap", strength: 1 };
}

describe("Property 3: Event source delivery model", () => {
  it("matches a simple model for subscribe, unsubscribe and emit sequences", () => {
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 40 }), fc.boolean(), (ops, onErrorThrows) => {
        // Real emitter.
        const errors: unknown[] = [];
        const emitter = createEmitter({
          onError: (error) => {
            errors.push(error);
            if (onErrorThrows) throw new Error("onError failure");
          },
        });
        const received: number[][] = [];
        const unsubs: Unsubscribe[] = [];

        // Model.
        const active: boolean[] = [];
        const expected: number[][] = [];
        const throwsOf: boolean[] = [];
        const killOf: (number | null)[] = [];
        let expectedErrors = 0;

        let nextId = 0;
        for (const op of ops) {
          if (op.kind === "subscribe") {
            const idx = received.length;
            received.push([]);
            expected.push([]);
            active.push(true);
            throwsOf.push(op.throws);
            killOf.push(op.kill);
            unsubs.push(
              emitter.subscribe((e) => {
                received[idx]!.push(e.timestamp);
                if (op.kill !== null) {
                  unsubs[op.kill % unsubs.length]!();
                }
                if (op.throws) throw new Error(`listener ${idx} failure`);
              }),
            );
          } else if (op.kind === "unsubscribe") {
            if (unsubs.length === 0) continue;
            const t = op.target % unsubs.length;
            for (let i = 0; i < op.times; i++) {
              expect(() => unsubs[t]!()).not.toThrow();
            }
            active[t] = false;
          } else {
            const id = nextId++;
            const snapshot = active.flatMap((a, i) => (a ? [i] : []));
            for (const i of snapshot) {
              if (!active[i]) continue;
              expected[i]!.push(id);
              const kill = killOf[i];
              if (kill !== null && kill !== undefined) active[kill % active.length] = false;
              if (throwsOf[i]) expectedErrors++;
            }
            expect(() => emitter.emit(makeEvent(id))).not.toThrow();
          }
        }

        expect(received).toEqual(expected);
        expect(errors.length).toBe(expectedErrors);
      }),
      pbtParams(),
    );
  });

  it("delivers to the other subscribers when one throws, and reports each error once", () => {
    const errors: unknown[] = [];
    const emitter = createEmitter({ onError: (e) => errors.push(e) });
    const seen: number[] = [];
    emitter.subscribe(() => {
      throw new Error("boom");
    });
    emitter.subscribe((e) => seen.push(e.timestamp));
    emitter.emit(makeEvent(1));
    emitter.emit(makeEvent(2));
    expect(seen).toEqual([1, 2]);
    expect(errors).toHaveLength(2);
  });
});
