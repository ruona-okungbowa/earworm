import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  parseRecording,
  serialiseRecording,
  type EarwormEvent,
} from "@earworm/core";
import {
  bandEventArb,
  finiteIn,
  recordingEventsArb,
  soundEndEventArb,
  soundStartEventArb,
  spectrumEventArb,
} from "../../helpers/events.js";
import { pbtParams } from "../../helpers/pbt.js";

// Feature: earworm-kit, Property 39: Recording parser rejects invalid input
// **Validates: Requirements 14.4, 14.5, 14.6, 21.6**

type Plain = Record<string, unknown>;

/** Plain JSON form of valid Events, as the serialiser writes them. */
function plainEvents(events: EarwormEvent[]): Plain[] {
  const parsed = JSON.parse(
    serialiseRecording({ version: 1, events }),
  ) as { events: Plain[] };
  return parsed.events;
}

/** Text of a version 1 Recording whose Events are the prefix followed by `bad`. */
function textWith(prefix: EarwormEvent[], bad: Plain): string {
  return JSON.stringify({ version: 1, events: [...plainEvents(prefix), bad] });
}

function expectInvalid(text: string, field: string): void {
  const r = parseRecording(text);
  expect(r.ok).toBe(false);
  if (r.ok) return;
  expect(r.error.code).toBe("invalid-recording");
  expect(r.error.field).toBe(field);
}

const isNotJson = (s: string): boolean => {
  try {
    JSON.parse(s);
    return false;
  } catch {
    return true;
  }
};

const notJsonArb = fc.oneof(
  fc.constantFrom("", " ", "{", "[1,", "undefined", "{'a':1}", "NaN", "{\"version\":1,}"),
  fc.string().filter(isNotJson),
);

describe("Property 39: Recording parser rejects invalid input", () => {
  it("returns malformed-json for text that is not JSON", () => {
    fc.assert(
      fc.property(notJsonArb, (text) => {
        const r = parseRecording(text);
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error.code).toBe("malformed-json");
      }),
      pbtParams(),
    );
  });

  it("returns unsupported-version naming the version", () => {
    const versionArb = fc.oneof(
      fc.integer().filter((n) => n !== 1),
      finiteIn(-1e6, 1e6).filter((n) => n !== 1),
      fc.string({ maxLength: 10 }),
      fc.boolean(),
      fc.constant(null),
      fc.constant("1"),
    );
    fc.assert(
      fc.property(versionArb, recordingEventsArb, (version, events) => {
        const text = JSON.stringify({ version, events: plainEvents(events) });
        const r = parseRecording(text);
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error.code).toBe("unsupported-version");
        expect(r.error.message).toContain(JSON.stringify(version));
      }),
      pbtParams(),
    );
  });

  it("returns unsupported-version for a missing version", () => {
    fc.assert(
      fc.property(recordingEventsArb, (events) => {
        const r = parseRecording(
          JSON.stringify({ events: plainEvents(events) }),
        );
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error.code).toBe("unsupported-version");
        expect(r.error.message).toContain("missing");
      }),
      pbtParams(),
    );
  });

  it("returns invalid-recording for a non-object top level or missing Event list", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant(undefined),
          fc.constant(null),
          fc.integer(),
          fc.string({ maxLength: 8 }),
          fc.dictionary(fc.string({ maxLength: 4 }), fc.integer(), {
            maxKeys: 2,
          }),
        ),
        (events) => {
          const text = JSON.stringify({ version: 1, events });
          expectInvalid(text, "events");
        },
      ),
      pbtParams(),
    );
    for (const text of ["[]", "1", "null", '"x"', "true"]) {
      expectInvalid(text, "recording");
    }
  });

  it("names the field of an Event that is not an object, lacks a type, or has an unknown type", () => {
    fc.assert(
      fc.property(
        recordingEventsArb,
        fc.oneof(fc.integer(), fc.constant(null), fc.string(), fc.constant([])),
        (prefix, bad) => {
          const path = `events[${prefix.length}]`;
          expectInvalid(
            JSON.stringify({
              version: 1,
              events: [...plainEvents(prefix), bad],
            }),
            path,
          );
        },
      ),
      pbtParams(),
    );
    fc.assert(
      fc.property(
        recordingEventsArb,
        fc.string({ minLength: 1, maxLength: 8 }).filter(
          (s) =>
            !s.startsWith("x-") &&
            ![
              "onset",
              "pitch",
              "level",
              "release",
              "envelope",
              "sound-start",
              "sound-end",
              "spectrum",
              "band",
            ].includes(s),
        ),
        (prefix, type) => {
          expectInvalid(
            textWith(prefix, { type, timestamp: 0, source: "mic" }),
            `events[${prefix.length}].type`,
          );
        },
      ),
      pbtParams(),
    );
  });

  it("names the missing or non-finite field of any Event", () => {
    const eventsWithFields = recordingEventsArb.chain((prefix) =>
      fc
        .oneof(spectrumEventArb, soundStartEventArb, soundEndEventArb, bandEventArb)
        .map((e) => ({ prefix, e })),
    );
    fc.assert(
      fc.property(
        eventsWithFields,
        fc.constantFrom("timestamp", "source"),
        fc.constantFrom<unknown>(undefined, null, "x", true),
        ({ prefix, e }, key, junk) => {
          const plain = plainEvents([e])[0] as Plain;
          if (key === "source" && typeof junk === "string") return;
          if (junk === undefined) delete plain[key];
          else plain[key] = junk;
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].${key}`,
          );
        },
      ),
      pbtParams(),
    );
  });

  it("rejects a Spectrum with magnitudes of the wrong length", () => {
    fc.assert(
      fc.property(
        recordingEventsArb,
        spectrumEventArb,
        fc.integer({ min: -3, max: 40 }),
        (prefix, e, delta) => {
          fc.pre(delta !== 0);
          const plain = plainEvents([e])[0] as Plain;
          const mags = plain["magnitudes"] as number[];
          plain["magnitudes"] =
            delta < 0
              ? mags.slice(0, Math.max(0, mags.length + delta))
              : [...mags, ...Array.from({ length: delta }, () => 0)];
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].magnitudes`,
          );
        },
      ),
      pbtParams(),
    );
  });

  it("rejects a Spectrum whose magnitudes are not an array", () => {
    fc.assert(
      fc.property(
        recordingEventsArb,
        spectrumEventArb,
        fc.constantFrom<unknown>(null, "abc", 5, {}),
        (prefix, e, junk) => {
          const plain = plainEvents([e])[0] as Plain;
          plain["magnitudes"] = junk;
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].magnitudes`,
          );
        },
      ),
      pbtParams(),
    );
  });

  it("rejects a Spectrum with a non-finite magnitude entry", () => {
    fc.assert(
      fc.property(
        recordingEventsArb,
        spectrumEventArb,
        fc.nat(),
        fc.constantFrom<unknown>(null, "NaN", "Infinity", true, {}),
        (prefix, e, pick, junk) => {
          const plain = plainEvents([e])[0] as Plain;
          const mags = plain["magnitudes"] as unknown[];
          const j = pick % mags.length;
          mags[j] = junk;
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].magnitudes[${j}]`,
          );
        },
      ),
      pbtParams(),
    );
  });

  it("rejects a Spectrum whose text holds an overflowing number", () => {
    const text =
      '{"version":1,"events":[{"type":"spectrum","timestamp":0,"source":"mic",' +
      '"sampleRate":48000,"fftSize":2,"magnitudes":[1e999]}]}';
    expectInvalid(text, "events[0].magnitudes[0]");
  });

  it("rejects a Sound_Start with a bad startTime", () => {
    fc.assert(
      fc.property(
        recordingEventsArb,
        soundStartEventArb,
        finiteIn(1, 1e6),
        (prefix, e, delta) => {
          const plain = plainEvents([e])[0] as Plain;
          plain["startTime"] = e.timestamp + delta;
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].startTime`,
          );
        },
      ),
      pbtParams(),
    );
    fc.assert(
      fc.property(
        recordingEventsArb,
        soundStartEventArb,
        fc.constantFrom<unknown>(null, "x", true, undefined),
        (prefix, e, junk) => {
          const plain = plainEvents([e])[0] as Plain;
          if (junk === undefined) delete plain["startTime"];
          else plain["startTime"] = junk;
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].startTime`,
          );
        },
      ),
      pbtParams(),
    );
  });

  it("rejects a Sound_End with a bad endTime or a negative or non-finite duration", () => {
    fc.assert(
      fc.property(
        recordingEventsArb,
        soundEndEventArb,
        finiteIn(1, 1e6),
        (prefix, e, delta) => {
          const plain = plainEvents([e])[0] as Plain;
          plain["endTime"] = e.timestamp + delta;
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].endTime`,
          );
        },
      ),
      pbtParams(),
    );
    fc.assert(
      fc.property(
        recordingEventsArb,
        soundEndEventArb,
        fc.oneof(
          finiteIn(-1e6, -1e-3),
          fc.constantFrom<unknown>(null, "x", true, undefined),
        ),
        (prefix, e, junk) => {
          const plain = plainEvents([e])[0] as Plain;
          if (junk === undefined) delete plain["duration"];
          else plain["duration"] = junk;
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].duration`,
          );
        },
      ),
      pbtParams(),
    );
  });

  it("rejects a Band with a bad unit, missing values, or a bad value", () => {
    fc.assert(
      fc.property(
        recordingEventsArb,
        bandEventArb,
        fc.oneof(
          fc.string({ maxLength: 8 }).filter((s) => s !== "dbfs" && s !== "normalised"),
          fc.integer(),
          fc.constant(null),
          fc.constant(undefined),
        ),
        (prefix, e, unit) => {
          const plain = plainEvents([e])[0] as Plain;
          if (unit === undefined) delete plain["unit"];
          else plain["unit"] = unit;
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].unit`,
          );
        },
      ),
      pbtParams(),
    );
    fc.assert(
      fc.property(
        recordingEventsArb,
        bandEventArb,
        fc.constantFrom<unknown>(null, "x", 5, [], undefined),
        (prefix, e, junk) => {
          const plain = plainEvents([e])[0] as Plain;
          if (junk === undefined) delete plain["values"];
          else plain["values"] = junk;
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].values`,
          );
        },
      ),
      pbtParams(),
    );
    fc.assert(
      fc.property(
        recordingEventsArb,
        bandEventArb.filter((e) => Object.keys(e.values).length > 0),
        fc.nat(),
        fc.constantFrom<unknown>(null, "x", true, {}),
        (prefix, e, pick, junk) => {
          const plain = plainEvents([e])[0] as Plain;
          const values = plain["values"] as Plain;
          const keys = Object.keys(values);
          const key = keys[pick % keys.length] as string;
          Object.defineProperty(values, key, {
            value: junk,
            enumerable: true,
            writable: true,
            configurable: true,
          });
          expectInvalid(
            textWith(prefix, plain),
            `events[${prefix.length}].values.${key}`,
          );
        },
      ),
      pbtParams(),
    );
  });

  it("never throws and never returns a Recording for a failure", () => {
    const anyText = fc.oneof(
      fc.string(),
      fc.json(),
      fc.anything().map((v) => JSON.stringify(v) ?? "undefined"),
      fc
        .tuple(fc.anything(), fc.anything())
        .map(([version, events]) =>
          JSON.stringify({ version, events }) ?? "{}",
        ),
    );
    fc.assert(
      fc.property(anyText, (text) => {
        const r = parseRecording(text);
        if (r.ok) {
          expect(r.value.version).toBe(1);
          expect(Array.isArray(r.value.events)).toBe(true);
        } else {
          expect([
            "malformed-json",
            "unsupported-version",
            "invalid-recording",
          ]).toContain(r.error.code);
          expect("value" in r).toBe(false);
        }
      }),
      pbtParams(),
    );
  });
});
