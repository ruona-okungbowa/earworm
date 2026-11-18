// Feature: earworm-kit, Property 43: Latest-value store
// **Validates: Requirements 21.14, 21.16**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { EarwormEvent } from "@earworm/core";
import { createLatestValueStore, latestOfType } from "@earworm/ui";
import { pbtParams } from "../../helpers/pbt";

const source = fc.constantFrom("mic", "tap", "replay");
const timestamp = fc.double({ min: 0, max: 1e6, noNaN: true });
const num = fc.double({ min: -200, max: 10, noNaN: true });

const eventArb: fc.Arbitrary<EarwormEvent> = fc.oneof(
  fc.record({ type: fc.constant("envelope" as const), timestamp, source, level: num }),
  fc.record({
    type: fc.constant("spectrum" as const),
    timestamp,
    source,
    sampleRate: fc.constant(48000),
    fftSize: fc.constant(4),
    magnitudes: fc.array(fc.float({ noNaN: true }), { maxLength: 4 }).map((a) => new Float32Array(a)),
  }),
  fc.record({
    type: fc.constant("band" as const),
    timestamp,
    source,
    unit: fc.constantFrom("dbfs" as const, "normalised" as const),
    values: fc.dictionary(fc.string({ minLength: 1, maxLength: 4 }), num),
  }),
  fc.record({ type: fc.constant("onset" as const), timestamp, source, strength: num }),
  fc.record({ type: fc.constant("level" as const), timestamp, source, level: num }),
  fc.record({ type: fc.constant("release" as const), timestamp, source }),
  fc.record({
    type: fc.constant("pitch" as const),
    timestamp,
    source,
    frequency: num,
    midi: num,
    cents: num,
    confidence: num,
  }),
) as fc.Arbitrary<EarwormEvent>;

const eventsArb = fc.array(eventArb, { maxLength: 30 });

function lastOf(events: readonly EarwormEvent[], type: string): EarwormEvent | null {
  const m = events.filter((e) => e.type === type);
  return m.length ? m[m.length - 1]! : null;
}

describe("Property 43: Latest-value store", () => {
  it("latestOfType returns the last matching event, null if none", () => {
    fc.assert(
      fc.property(eventsArb, fc.constantFrom("envelope", "spectrum", "band", "onset", "pitch"), (events, type) => {
        expect(latestOfType(events, type as EarwormEvent["type"])).toBe(lastOf(events, type));
      }),
      pbtParams(),
    );
  });

  it("store values equal the last matching event and are null until the first match", () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const store = createLatestValueStore();
        expect(store.getSnapshot()).toEqual({ envelope: null, spectrum: null, bands: null });
        for (const e of events) store.push(e);
        const snap = store.getSnapshot();
        const env = lastOf(events, "envelope") as { level: number } | null;
        const spec = lastOf(events, "spectrum") as { magnitudes: Float32Array } | null;
        const band = lastOf(events, "band") as { values: Record<string, number> } | null;
        expect(snap.envelope).toBe(env ? env.level : null);
        expect(snap.spectrum).toBe(spec ? spec.magnitudes : null);
        expect(snap.bands).toBe(band ? band.values : null);
      }),
      pbtParams(),
    );
  });

  it("other event types (including tap-source events) leave the snapshot and listeners untouched", () => {
    fc.assert(
      fc.property(eventsArb, eventsArb, (setup, rest) => {
        const store = createLatestValueStore();
        for (const e of setup) store.push(e);
        const before = store.getSnapshot();
        let calls = 0;
        store.subscribe(() => calls++);
        const others = rest.filter((e) => !["envelope", "spectrum", "band"].includes(e.type));
        for (const e of others) store.push(e);
        expect(store.getSnapshot()).toBe(before);
        expect(calls).toBe(0);
      }),
      pbtParams(),
    );
  });

  it("tap-source onset events do not change values", () => {
    const store = createLatestValueStore();
    store.push({ type: "envelope", timestamp: 1, source: "mic", level: -30 });
    const before = store.getSnapshot();
    store.push({ type: "onset", timestamp: 2, source: "tap", strength: 1 });
    expect(store.getSnapshot()).toBe(before);
    expect(store.getSnapshot().envelope).toBe(-30);
  });
});
