// Feature: earworm-kit, Property 23: Synth input validation
// **Validates: Requirements 7.2, 7.6, 7.14**
import { createAudioEngine, createGate, createSynth, validateScheduleRequest } from "@earworm/browser";
import fc from "fast-check";
import { describe, expect, it, vi } from "vitest";
import { pbtParams } from "../../helpers/pbt";

const nonFinite = fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY);

const badFrequency = fc.oneof(
  nonFinite,
  fc.double({ min: -1e9, max: 19.999, noNaN: true }),
  fc.double({ min: 20_000.001, max: 1e9, noNaN: true }),
);
const badDuration = fc.oneof(
  nonFinite,
  fc.double({ min: -1e9, max: 0.999, noNaN: true }),
  fc.double({ min: 60_000.001, max: 1e9, noNaN: true }),
);
const badGain = fc.oneof(
  nonFinite,
  fc.double({ min: -1e9, max: -Number.MIN_VALUE, noNaN: true }),
  fc.double({ min: 1.0000001, max: 1e9, noNaN: true }),
);

const goodFrequency = fc.double({ min: 20, max: 20_000, noNaN: true });
const goodDuration = fc.double({ min: 1, max: 60_000, noNaN: true });
const goodGain = fc.double({ min: 0, max: 1, noNaN: true });

/** Each field is either valid or invalid; at least one is invalid. */
const invalidRequest = fc
  .record({
    frequency: fc.oneof(goodFrequency, badFrequency),
    durationMs: fc.oneof(goodDuration, badDuration),
    gain: fc.oneof(goodGain, badGain),
  })
  .filter(
    (o) =>
      !validateScheduleRequest("sine", o).ok,
  );

function expectedCode(o: { frequency: number; durationMs: number; gain: number }): string {
  const f = Number.isFinite(o.frequency) && o.frequency >= 20 && o.frequency <= 20_000;
  if (!f) return "invalid-frequency";
  const d = Number.isFinite(o.durationMs) && o.durationMs >= 1 && o.durationMs <= 60_000;
  if (!d) return "invalid-duration";
  return "invalid-gain";
}

/** A context that records every call to a node factory or property read. */
function spyContext() {
  const touched: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        touched.push(String(prop));
        if (prop === "currentTime") return 0;
        return () => {
          throw new Error(`unexpected ${String(prop)}`);
        };
      },
    },
  ) as unknown as BaseAudioContext;
  return { ctx, touched };
}

describe("Property 23: Synth input validation", () => {
  it("reports the first failing field in order frequency, duration, gain", () => {
    fc.assert(
      fc.property(invalidRequest, (o) => {
        const r = validateScheduleRequest("sine", o);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe(expectedCode(o));
      }),
      pbtParams(),
    );
  });

  it("accepts any finite gain 0..1 with valid frequency and duration", () => {
    fc.assert(
      fc.property(goodFrequency, goodDuration, goodGain, (frequency, durationMs, gain) => {
        const r = validateScheduleRequest("sine", { frequency, durationMs, gain });
        expect(r.ok).toBe(true);
        if (r.ok) {
          expect(r.value.frequency).toBe(frequency);
          expect(r.value.durationMs).toBe(durationMs);
          expect(r.value.gain).toBe(gain);
        }
      }),
      pbtParams(),
    );
  });

  it("schedule rejects with the same error, creating no node and no window", async () => {
    const created = createGate();
    if (!created.ok) throw new Error("gate creation failed");
    const gate = created.value;
    const addWindow = vi.spyOn(gate, "addWindow");
    const { ctx, touched } = spyContext();
    const synth = createSynth(createAudioEngine(ctx), { gate });

    await fc.assert(
      fc.asyncProperty(invalidRequest, fc.boolean(), async (o, ungated) => {
        const expected = validateScheduleRequest("sine", { ...o, ungated });
        if (expected.ok) throw new Error("generator produced a valid request");
        touched.length = 0;
        await expect(synth.schedule("sine", 0, { ...o, ungated })).rejects.toEqual(
          expected.error,
        );
        expect(touched).toEqual([]);
        expect(addWindow).not.toHaveBeenCalled();
      }),
      pbtParams(),
    );
  });
});
