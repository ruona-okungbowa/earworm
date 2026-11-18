// Feature: earworm-kit, Property 52: Band validation
// **Validates: Requirements 20.2, 20.3, 20.4, 20.8, 20.9, 20.11, 20.21**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { BAND_PRESET, bands } from "@earworm/core";
import type { Band } from "@earworm/core";
import { pbtParams } from "../../helpers/pbt.js";

const SIZE = 1024;
const SAMPLE_RATE = 16_000;
const NYQUIST = SAMPLE_RATE / 2;
const spec = new Float32Array(SIZE / 2).fill(-60);

type Out = ReturnType<typeof bands>;

function call(
  list: unknown,
  opts: {
    spectrum?: Float32Array;
    sampleRate?: number;
    size?: number;
    window?: unknown;
    unit?: unknown;
  } = {},
): Out {
  return bands(
    opts.spectrum ?? spec,
    opts.sampleRate ?? SAMPLE_RATE,
    opts.size ?? SIZE,
    ("window" in opts ? opts.window : "hann") as never,
    list as readonly Band[],
    ("unit" in opts ? opts.unit : "dbfs") as never,
  );
}

function expectCode(result: Out, code: string): void {
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe(code);
}

const nameArb = fc.string({ minLength: 1, maxLength: 8 });

/** A valid band: 0 <= lowHz < highHz <= Nyquist. */
const validBand = (name: string): fc.Arbitrary<Band> =>
  fc
    .tuple(
      fc.integer({ min: 0, max: NYQUIST - 1 }),
      fc.integer({ min: 1, max: NYQUIST }),
    )
    .map(([a, b]) => {
      const lo = Math.min(a, b === a ? a + 1 : b);
      const hi = Math.max(a, b === a ? a + 1 : b);
      return { name, lowHz: lo, highHz: Math.min(hi, NYQUIST) };
    })
    .filter((b) => b.lowHz < b.highHz);

const validList = fc
  .uniqueArray(nameArb, { minLength: 1, maxLength: 32 })
  .chain((names) => fc.tuple(...names.map(validBand)));

describe("Property 52: Band validation", () => {
  it("accepts valid lists, including overlapping bands", () => {
    fc.assert(
      fc.property(validList, (list) => {
        const r = call(list);
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(Object.keys(r.value).sort()).toEqual(
          list.map((b) => b.name).sort(),
        );
      }),
      pbtParams(),
    );
    expect(call(BAND_PRESET).ok).toBe(true);
    expect(
      call([
        { name: "a", lowHz: 0, highHz: 1000 },
        { name: "b", lowHz: 500, highHz: 1500 },
      ]).ok,
    ).toBe(true);
  });

  it("rejects an empty list", () => {
    expectCode(call([]), "invalid-band");
  });

  it("rejects more than 32 bands", () => {
    fc.assert(
      fc.property(fc.integer({ min: 33, max: 60 }), (n) => {
        const list = Array.from({ length: n }, (_, i) => ({
          name: `b${i}`,
          lowHz: 0,
          highHz: 100,
        }));
        expectCode(call(list), "invalid-band");
      }),
      pbtParams(),
    );
  });

  it("rejects duplicate names", () => {
    fc.assert(
      fc.property(validList, fc.nat(), (list, pick) => {
        const dup = list[pick % list.length] as Band;
        expectCode(call([...list, { ...dup }].slice(0, 33)), "invalid-band");
      }),
      pbtParams(),
    );
  });

  it("rejects a bad band and names it", () => {
    const bad = (name: string): fc.Arbitrary<Band> =>
      fc.oneof(
        fc
          .integer({ min: 1, max: 5000 })
          .map((n) => ({ name, lowHz: -n, highHz: 100 })),
        fc
          .integer({ min: 1, max: 5000 })
          .map((n) => ({ name, lowHz: 0, highHz: NYQUIST + n })),
        fc
          .tuple(
            fc.integer({ min: 0, max: 7000 }),
            fc.integer({ min: 0, max: 7000 }),
          )
          .map(([a, d]) => ({ name, lowHz: a + d, highHz: a })),
        fc
          .constantFrom(NaN, Infinity, -Infinity)
          .map((v) => ({ name, lowHz: v, highHz: 100 })),
        fc
          .constantFrom(NaN, Infinity, -Infinity)
          .map((v) => ({ name, lowHz: 0, highHz: v })),
      );
    fc.assert(
      fc.property(validList, fc.nat(), nameArb, (list, pos, badName) => {
        fc.pre(!list.some((b) => b.name === badName));
        const bb = fc.sample(bad(badName), 1)[0] as Band;
        const copy = [...list.slice(0, 31)];
        copy.splice(pos % (copy.length + 1), 0, bb);
        const r = call(copy);
        expectCode(r, "invalid-band");
        if (!r.ok) {
          expect(r.error.field).toBe(badName);
          expect(r.error.message).toContain(badName);
        }
      }),
      pbtParams(),
    );
  });

  it("rejects empty or non-string names", () => {
    for (const name of ["", 5, null, undefined, {}]) {
      expectCode(call([{ name, lowHz: 0, highHz: 100 }]), "invalid-band");
    }
  });

  it("rejects units other than dbfs and normalised", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.constant(null)),
        (unit) => {
          fc.pre(unit !== "dbfs" && unit !== "normalised");
          expectCode(call(BAND_PRESET, { unit }), "invalid-unit");
        },
      ),
      pbtParams(),
    );
    expect(call(BAND_PRESET, { unit: "normalised" }).ok).toBe(true);
  });

  it("rejects wrong spectrum length, invalid size or sample rate", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2000 }), (len) => {
        fc.pre(len !== SIZE / 2);
        expectCode(
          call(BAND_PRESET, { spectrum: new Float32Array(len) }),
          "invalid-spectrum",
        );
      }),
      pbtParams(),
    );
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: -10, max: 20000 }),
          fc.constantFrom(NaN, Infinity),
        ),
        (size) => {
          fc.pre(![256, 512, 1024, 2048, 4096, 8192].includes(size));
          expectCode(call(BAND_PRESET, { size }), "invalid-spectrum");
        },
      ),
      pbtParams(),
    );
    fc.assert(
      fc.property(
        fc.oneof(
          fc.double({ min: -1e6, max: 7999, noNaN: true }),
          fc.double({ min: 192_001, max: 1e7, noNaN: true }),
          fc.constantFrom(NaN, Infinity, -Infinity),
        ),
        (sampleRate) => {
          expectCode(call(BAND_PRESET, { sampleRate }), "invalid-spectrum");
        },
      ),
      pbtParams(),
    );
  });

  it("rejects unknown windows", () => {
    fc.assert(
      fc.property(fc.string(), (window) => {
        fc.pre(
          !["hann", "hamming", "blackman", "rectangular"].includes(window),
        );
        expectCode(call(BAND_PRESET, { window }), "invalid-window");
      }),
      pbtParams(),
    );
  });
});
