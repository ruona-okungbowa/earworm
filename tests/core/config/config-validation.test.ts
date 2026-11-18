import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  DEFAULTS,
  createBandDetector,
  createEnvelopeDetector,
  createLevelDetector,
  createOnsetDetector,
  createPitchDetector,
  createSoundDetector,
  createSpectrumDetector,
  resolveConfig,
} from "@earworm/core";
import type {
  ConfigSpec,
  Detector,
  EarwormEvent,
  Frame,
  Result,
  SettingSpec,
} from "@earworm/core";
import { pbtParams } from "../../helpers/pbt";

// Feature: earworm-kit, Property 44: Configuration validation
// **Validates: Requirements 16.16, 16.17, 17.2, 17.3, 18.2, 19.14, 20.12**

/** Settings groups that go through `resolveConfig`. */
const GROUPS: Record<string, ConfigSpec> = {
  onset: DEFAULTS.onset,
  pitch: DEFAULTS.pitch,
  calibration: DEFAULTS.calibration,
  gate: DEFAULTS.gate,
  segmenter: DEFAULTS.segmenter,
  level: DEFAULTS.level,
  envelope: DEFAULTS.envelope,
  sound: DEFAULTS.sound,
  spectrum: DEFAULTS.spectrum,
  band: DEFAULTS.band,
};

const groupArb = fc.constantFrom(...Object.keys(GROUPS));

/** A value that is valid for the setting. */
function inRange(s: SettingSpec): fc.Arbitrary<number> {
  return fc.double({ min: s.min, max: s.max, noNaN: true }).map((v) => v + 0); // turns -0 into 0
}

/** A value that is non-finite or outside the range of the setting. */
function badValue(s: SettingSpec): fc.Arbitrary<number> {
  return fc.oneof(
    fc.constantFrom(NaN, Infinity, -Infinity),
    fc.double({ min: s.max + 1e-3, max: s.max + 1e6, noNaN: true }),
    fc.double({ min: s.min - 1e6, max: s.min - 1e-3, noNaN: true }),
  );
}

/** A group, a setting name in it and a bad value for that setting. */
const badSettingArb = groupArb.chain((group) => {
  const spec = GROUPS[group] as ConfigSpec;
  return fc.constantFrom(...Object.keys(spec)).chain((name) =>
    badValue(spec[name] as SettingSpec).map((value) => ({
      group,
      name,
      value,
    })),
  );
});

describe("Property 44: Configuration validation", () => {
  describe("resolveConfig", () => {
    it("omitted settings take their defaults and given in-range settings are kept", () => {
      fc.assert(
        fc.property(
          groupArb.chain((group) => {
            const spec = GROUPS[group] as ConfigSpec;
            const entries = Object.keys(spec).map((name) =>
              fc.option(inRange(spec[name] as SettingSpec), { nil: undefined }),
            );
            return fc.tuple(fc.constant(group), fc.tuple(...entries));
          }),
          ([group, values]) => {
            const spec = GROUPS[group] as ConfigSpec;
            const names = Object.keys(spec);
            const partial: Record<string, number | undefined> = {};
            const expected: Record<string, number> = {};
            names.forEach((name, i) => {
              const v = values[i];
              partial[name] = v;
              expected[name] = v ?? (spec[name] as SettingSpec).default;
            });
            const result = resolveConfig(spec, partial);
            expect(result.ok).toBe(true);
            if (result.ok) expect(result.value).toEqual(expected);
          },
        ),
        pbtParams(),
      );
    });

    it("an empty or missing config gives all defaults", () => {
      for (const spec of Object.values(GROUPS)) {
        const expected = Object.fromEntries(
          Object.entries(spec).map(([k, s]) => [k, s.default]),
        );
        for (const r of [resolveConfig(spec), resolveConfig(spec, {})]) {
          expect(r.ok).toBe(true);
          if (r.ok) expect(r.value).toEqual(expected);
        }
      }
    });

    it("a non-finite or out-of-range value gives invalid-config naming the setting", () => {
      fc.assert(
        fc.property(badSettingArb, ({ group, name, value }) => {
          const spec = GROUPS[group] as ConfigSpec;
          const result = resolveConfig(spec, { [name]: value });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("invalid-config");
            expect(result.error.setting).toBe(name);
          }
        }),
        pbtParams(),
      );
    });

    it("range limits themselves are accepted", () => {
      for (const spec of Object.values(GROUPS)) {
        for (const [name, s] of Object.entries(spec)) {
          expect(resolveConfig(spec, { [name]: s.min }).ok).toBe(true);
          expect(resolveConfig(spec, { [name]: s.max }).ok).toBe(true);
        }
      }
    });
  });

  interface Configurable extends Detector {
    configure(partial: Record<string, unknown>): Result<void>;
    readonly historyLength?: number;
  }

  interface Entry {
    readonly name: string;
    readonly group: string;
    readonly create: (config: Record<string, unknown>) => Result<Detector>;
  }

  const FACTORIES: readonly Entry[] = [
    {
      name: "level",
      group: "level",
      create: (c) => createLevelDetector(c as never),
    },
    {
      name: "onset",
      group: "onset",
      create: (c) => createOnsetDetector(c as never),
    },
    {
      name: "envelope",
      group: "envelope",
      create: (c) => createEnvelopeDetector(c as never),
    },
    {
      name: "sound",
      group: "sound",
      create: (c) => createSoundDetector(c as never),
    },
    {
      name: "pitch",
      group: "pitch",
      create: (c) => createPitchDetector(c as never),
    },
    {
      name: "spectrum",
      group: "spectrum",
      create: (c) => createSpectrumDetector(c as never),
    },
    {
      name: "band",
      group: "band",
      create: (c) => createBandDetector(c as never),
    },
  ];

  const CONFIGURABLE = FACTORIES.filter((f) => f.name !== "band");

  /** A factory, a setting of its group and a bad value for it. */
  const factoryBadArb = fc.constantFrom(...FACTORIES).chain((entry) => {
    const spec = GROUPS[entry.group] as ConfigSpec;
    return fc.constantFrom(...Object.keys(spec)).chain((name) =>
      badValue(spec[name] as SettingSpec).map((value) => ({
        entry,
        name,
        value,
      })),
    );
  });

  describe("Detector factories", () => {
    it("return invalid-config with the setting for a bad value", () => {
      fc.assert(
        fc.property(factoryBadArb, ({ entry, name, value }) => {
          const result = entry.create({ [name]: value });
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error.code).toBe("invalid-config");
            expect(result.error.setting).toBe(name);
          }
        }),
        pbtParams(),
      );
    });

    it("create a detector from an empty config and from in-range values", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...FACTORIES).chain((entry) => {
            const spec = GROUPS[entry.group] as ConfigSpec;
            const name = Object.keys(spec)[0] as string;
            return fc.tuple(
              fc.constant(entry),
              fc.constant(name),
              inRange(spec[name] as SettingSpec),
            );
          }),
          ([entry, name, value]) => {
            expect(entry.create({}).ok).toBe(true);
            // Sound: a start threshold at or below the default end threshold is an ordering error, not a range error.
            if (entry.name === "sound" && name === "startThreshold") return;
            expect(entry.create({ [name]: value }).ok).toBe(true);
          },
        ),
        pbtParams(),
      );
    });

    it("Sound_Detector rejects an end threshold that is not below the start threshold", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 59 }),
          fc.integer({ min: 0, max: 30 }),
          (start, extra) => {
            const end = Math.min(59, start + extra);
            const result = createSoundDetector({
              startThreshold: start,
              endThreshold: end,
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.code).toBe("invalid-config");
              expect(result.error.setting).toBe("endThreshold");
            }
          },
        ),
        pbtParams(),
      );
    });
  });

  /** Frames of a 440 Hz tone at the given amplitudes, 10 ms apart. */
  function framesOf(amplitudes: readonly number[], offset: number): Frame[] {
    return amplitudes.map((amp, k) => {
      const samples = new Float32Array(128);
      for (let i = 0; i < samples.length; i++) {
        samples[i] =
          amp * Math.sin((2 * Math.PI * 440 * (k * 128 + i)) / 48000);
      }
      return { samples, timestamp: (offset + k) * 10, sampleRate: 48000 };
    });
  }

  function run(detector: Detector, frames: readonly Frame[]): EarwormEvent[] {
    const out: EarwormEvent[] = [];
    for (const f of frames) out.push(...detector.process(f));
    out.push(...(detector.flush?.() ?? []));
    return out;
  }

  function build(entry: Entry): Configurable {
    const created = entry.create({});
    if (!created.ok) throw new Error(`${entry.name} creation failed`);
    return created.value as Configurable;
  }

  describe("configure", () => {
    const ampsArb = fc.array(fc.double({ min: 0, max: 1, noNaN: true }), {
      minLength: 3,
      maxLength: 12,
    });

    const configureArb = fc.constantFrom(...CONFIGURABLE).chain((entry) => {
      const spec = GROUPS[entry.group] as ConfigSpec;
      return fc.constantFrom(...Object.keys(spec)).chain((name) =>
        badValue(spec[name] as SettingSpec).map((value) => ({
          entry,
          name,
          value,
        })),
      );
    });

    it("returns invalid-config with the setting and leaves settings and state unchanged", () => {
      fc.assert(
        fc.property(
          configureArb,
          ampsArb,
          ampsArb,
          ({ entry, name, value }, before, after) => {
            const tested = build(entry);
            const control = build(entry);
            const warm = framesOf(before, 0);
            const later = framesOf(after, before.length);

            // Same history, so the detectors hold the same state.
            const warmTested: EarwormEvent[] = [];
            const warmControl: EarwormEvent[] = [];
            for (const f of warm) {
              warmTested.push(...tested.process(f));
              warmControl.push(...control.process(f));
            }
            const lengthBefore = tested.historyLength;

            const result = tested.configure({ [name]: value });
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.code).toBe("invalid-config");
              expect(result.error.setting).toBe(name);
            }
            expect(tested.historyLength).toBe(lengthBefore);

            expect(warmTested).toEqual(warmControl);
            expect(run(tested, later)).toEqual(run(control, later));
          },
        ),
        pbtParams(),
      );
    });

    it("applies none of a config when one of its settings is bad", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...CONFIGURABLE).chain((entry) => {
            const spec = GROUPS[entry.group] as ConfigSpec;
            const names = Object.keys(spec);
            // Valid values for every setting but the last, which is bad.
            const badName = names[names.length - 1] as string;
            const good = names.slice(0, -1);
            return fc.tuple(
              fc.constant(entry),
              fc.constant(badName),
              badValue(spec[badName] as SettingSpec),
              fc.tuple(
                ...good.map((n) =>
                  inRange(spec[n] as SettingSpec).map((v) => [n, v] as const),
                ),
              ),
            );
          }),
          ampsArb,
          ([entry, badName, badVal, goods], amps) => {
            const tested = build(entry);
            const control = build(entry);
            const config: Record<string, number> = Object.fromEntries(goods);
            config[badName] = badVal;

            const result = tested.configure(config);
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.code).toBe("invalid-config");
            }
            const frames = framesOf(amps, 0);
            expect(run(tested, frames)).toEqual(run(control, frames));
          },
        ),
        pbtParams(),
      );
    });

    it("Sound_Detector.configure rejects an end threshold not below the start threshold and keeps its settings", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 59 }),
          fc.integer({ min: 0, max: 30 }),
          ampsArb,
          (start, extra, amps) => {
            const entry = FACTORIES.find((f) => f.name === "sound") as Entry;
            const tested = build(entry);
            const control = build(entry);
            const result = tested.configure({
              startThreshold: start,
              endThreshold: Math.min(59, start + extra),
            });
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.code).toBe("invalid-config");
              expect(result.error.setting).toBe("endThreshold");
            }
            const frames = framesOf(amps, 0);
            expect(run(tested, frames)).toEqual(run(control, frames));
          },
        ),
        pbtParams(),
      );
    });

    it("Spectrum_Detector.configure with a bad maxRate keeps the FFT_Size and Sample_History", () => {
      fc.assert(
        fc.property(
          badValue(DEFAULTS.spectrum.maxRate),
          ampsArb,
          (value, amps) => {
            const created = createSpectrumDetector({ fftSize: 512 });
            if (!created.ok) throw new Error("creation failed");
            const det = created.value;
            for (const f of framesOf(amps, 0)) det.process(f);
            const before = det.historyLength;
            // A valid new FFT_Size alongside a bad rate must not take effect.
            const result = det.configure({ fftSize: 1024, maxRate: value });
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.error.code).toBe("invalid-config");
              expect(result.error.setting).toBe("maxRate");
            }
            expect(det.historyLength).toBe(before);
            const events = det.process(framesOf([0.5], 100)[0] as Frame);
            for (const e of events) {
              if (e.type === "spectrum") expect(e.fftSize).toBe(512);
            }
          },
        ),
        pbtParams(),
      );
    });
  });
});
