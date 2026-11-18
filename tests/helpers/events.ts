import fc from "fast-check";
import type {
  BandEvent,
  CustomEvent,
  EarwormEvent,
  EnvelopeEvent,
  LevelEvent,
  Ms,
  OnsetEvent,
  PitchEvent,
  ReleaseEvent,
  SoundEndEvent,
  SoundStartEvent,
  SpectrumEvent,
} from "@earworm/core";

/*
 * Event arbitraries. Every number is finite and never -0 (Events require finite numbers
 * and serialisation writes -0 as 0). Nothing here reads a clock.
 */

/** Replace -0 with 0. */
const noNegZero = (n: number): number => (Object.is(n, -0) ? 0 : n);

/** Finite double in [min, max], never -0. */
export function finiteIn(min: number, max: number): fc.Arbitrary<number> {
  return fc
    .double({ min, max, noNaN: true, noDefaultInfinity: true })
    .map(noNegZero);
}

/** Timestamp in milliseconds on the audio clock. */
export const timestampArb: fc.Arbitrary<Ms> = finiteIn(-1e6, 1e9);

/** Source string: the three Kit sources or any short string. */
export const sourceArb: fc.Arbitrary<string> = fc.oneof(
  fc.constantFrom("mic", "tap", "replay"),
  fc.string({ minLength: 1, maxLength: 12 }),
);

const dbfsArb = finiteIn(-120, 6);

/** Keys that would change object shape or break JSON round trips. */
const safeKey = fc
  .string({ minLength: 1, maxLength: 8 })
  .filter((k) => k !== "__proto__");

const base = { timestamp: timestampArb, source: sourceArb };

export const onsetEventArb: fc.Arbitrary<OnsetEvent> = fc.record({
  type: fc.constant("onset" as const),
  ...base,
  strength: finiteIn(0, 1e3),
});

export const pitchEventArb: fc.Arbitrary<PitchEvent> = fc.record({
  type: fc.constant("pitch" as const),
  ...base,
  frequency: finiteIn(80, 2000),
  midi: fc.integer({ min: 0, max: 127 }),
  cents: finiteIn(-50, 50),
  confidence: finiteIn(0, 1),
});

export const levelEventArb: fc.Arbitrary<LevelEvent> = fc.record({
  type: fc.constant("level" as const),
  ...base,
  level: dbfsArb,
});

export const releaseEventArb: fc.Arbitrary<ReleaseEvent> = fc.record({
  type: fc.constant("release" as const),
  ...base,
});

export const envelopeEventArb: fc.Arbitrary<EnvelopeEvent> = fc.record({
  type: fc.constant("envelope" as const),
  ...base,
  level: dbfsArb,
});

/** startTime is at or before the Timestamp (Min_Hold has elapsed by the Timestamp). */
export const soundStartEventArb: fc.Arbitrary<SoundStartEvent> = fc
  .record({
    startTime: timestampArb,
    held: finiteIn(0, 200),
    source: sourceArb,
    level: dbfsArb,
  })
  .map(({ startTime, held, source, level }) => ({
    type: "sound-start" as const,
    timestamp: noNegZero(startTime + held),
    source,
    startTime,
    level,
  }));

/** endTime is at or before the Timestamp; duration is finite and not negative. */
export const soundEndEventArb: fc.Arbitrary<SoundEndEvent> = fc
  .record({
    endTime: timestampArb,
    hangover: finiteIn(0, 2000),
    source: sourceArb,
    duration: finiteIn(0, 1e6),
  })
  .map(({ endTime, hangover, source, duration }) => ({
    type: "sound-end" as const,
    timestamp: noNegZero(endTime + hangover),
    source,
    endTime,
    duration,
  }));

/** Power-of-two FFT size from 256 to 8192. */
export const fftSizeArb: fc.Arbitrary<number> = fc.constantFrom(
  256,
  512,
  1024,
  2048,
  4096,
  8192,
);

/** Float32Array of `length` values in [-120, +6] dBFS, never -0. */
export function magnitudesArb(length: number): fc.Arbitrary<Float32Array> {
  return fc
    .array(finiteIn(-120, 6), { minLength: length, maxLength: length })
    .map((a) => {
      const out = new Float32Array(length);
      for (let i = 0; i < length; i++) {
        // Float32 rounding of a value in range stays in range, because -120 and 6 are exact.
        // Check -0 after rounding: a tiny negative double rounds to Float32 -0.
        out[i] = a[i] ?? 0;
        out[i] = noNegZero(out[i] ?? 0);
      }
      return out;
    });
}

export const spectrumEventArb: fc.Arbitrary<SpectrumEvent> = fftSizeArb.chain(
  (fftSize) =>
    fc.record({
      type: fc.constant("spectrum" as const),
      ...base,
      sampleRate: fc.integer({ min: 8000, max: 192000 }),
      fftSize: fc.constant(fftSize),
      magnitudes: magnitudesArb(fftSize / 2),
    }),
);

export const bandEventArb: fc.Arbitrary<BandEvent> = fc.record({
  type: fc.constant("band" as const),
  ...base,
  unit: fc.constantFrom("dbfs" as const, "normalised" as const),
  values: fc.dictionary(safeKey, finiteIn(-120, 6), { maxKeys: 6 }),
});

/** JSON-safe value tree for Custom_Event data: finite numbers, no -0. */
const jsonValueArb: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  value: fc.oneof(
    { depthSize: "small", maxDepth: 2 },
    fc.string({ maxLength: 12 }),
    finiteIn(-1e9, 1e9),
    fc.boolean(),
    fc.constant(null),
    fc.array(tie("value"), { maxLength: 3 }),
    fc.dictionary(safeKey, tie("value"), { maxKeys: 3 }),
  ),
})).value;

export const customEventArb: fc.Arbitrary<CustomEvent> = fc.record({
  type: fc
    .string({ minLength: 1, maxLength: 10 })
    .map((s): `x-${string}` => `x-${s}`),
  ...base,
  data: fc.dictionary(safeKey, jsonValueArb, { maxKeys: 4 }) as fc.Arbitrary<
    Record<string, unknown>
  >,
});

/** Any Event type, including Custom_Events and Spectrum_Events. */
export const eventArb: fc.Arbitrary<EarwormEvent> = fc.oneof(
  onsetEventArb,
  pitchEventArb,
  levelEventArb,
  releaseEventArb,
  envelopeEventArb,
  soundStartEventArb,
  soundEndEventArb,
  spectrumEventArb,
  bandEventArb,
  customEventArb,
);

/** Event list for a whole Recording, in any order. Spectrum Events are kept few for speed. */
export const recordingEventsArb: fc.Arbitrary<EarwormEvent[]> = fc.array(
  eventArb,
  { maxLength: 20 },
);
