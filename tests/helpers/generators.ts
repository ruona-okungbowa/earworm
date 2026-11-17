import fc from "fast-check";
import type { Frame, Ms } from "@earworm/core";

/*
 * Signal and Frame generators. Every time is a parameter; nothing here reads a clock.
 * All randomness comes from a seeded PRNG so shrinking is reproducible.
 */

/** Seeded PRNG (mulberry32). Returns a function yielding floats in [0, 1). */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sine of `n` samples: `amp · sin(2π · freq · i / sampleRate + phase)`. */
export function tone(
  freq: number,
  amp: number,
  n: number,
  sampleRate: number,
  phase = 0,
): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate + phase);
  }
  return out;
}

/** Sum of harmonics of `f0`. `amps[k]` is the amplitude of harmonic `k + 1`. */
export function harmonicTone(
  f0: number,
  amps: readonly number[],
  n: number,
  sampleRate: number,
): Float32Array {
  const out = new Float32Array(n);
  amps.forEach((amp, k) => {
    const f = f0 * (k + 1);
    for (let i = 0; i < n; i++) {
      out[i] =
        (out[i] ?? 0) + amp * Math.sin((2 * Math.PI * f * i) / sampleRate);
    }
  });
  return out;
}

/**
 * Seeded white noise source. Each call to the returned function yields the next `n`
 * uniform samples in [-amp, amp]; the same seed gives the same sequence.
 */
export function whiteNoise(
  seed: number,
): (n: number, amp?: number) => Float32Array {
  const rng = createRng(seed);
  return (n, amp = 1) => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = (rng() * 2 - 1) * amp;
    return out;
  };
}

/**
 * Impulses of height `amp` at each time in `timesMs` (ms from sample 0). By default each
 * is a single sample. With `widthMs` > 0 each is a rectangular pulse of that width, which
 * keeps the click's Frame level well above the Noise_Floor at larger frame sizes.
 */
export function clickTrain(
  timesMs: readonly Ms[],
  amp: number,
  n: number,
  sampleRate: number,
  widthMs = 0,
): Float32Array {
  const out = new Float32Array(n);
  const width = Math.max(1, Math.round((widthMs * sampleRate) / 1000));
  for (const t of timesMs) {
    const start = Math.round((t * sampleRate) / 1000);
    for (let j = 0; j < width; j++) {
      const i = start + j;
      if (i >= 0 && i < n) out[i] = amp;
    }
  }
  return out;
}

export interface Burst {
  startMs: Ms;
  durationMs: Ms;
  freq: number;
  amp: number;
}

/** Tone bursts with 1 ms linear attack and release, placed by time in ms from sample 0. */
export function burstTrain(
  bursts: readonly Burst[],
  n: number,
  sampleRate: number,
): Float32Array {
  const out = new Float32Array(n);
  const ramp = Math.max(1, Math.round(sampleRate / 1000));
  for (const b of bursts) {
    const start = Math.round((b.startMs * sampleRate) / 1000);
    const len = Math.round((b.durationMs * sampleRate) / 1000);
    for (let j = 0; j < len; j++) {
      const i = start + j;
      if (i < 0 || i >= n) continue;
      const env = Math.min(1, (j + 1) / ramp, (len - j) / ramp);
      out[i] =
        (out[i] ?? 0) +
        env * b.amp * Math.sin((2 * Math.PI * b.freq * j) / sampleRate);
    }
  }
  return out;
}

export interface EnergyCheckFrame {
  samples: Float32Array;
  size: number;
  sampleRate: number;
  /** Bin indices of the sines, ascending. Bin 0 is a DC offset. */
  bins: number[];
  /** Amplitude of each sine, same order as `bins`. */
  amps: number[];
  /** Frequency of each sine in Hz (`bin · sampleRate / size`). */
  freqs: number[];
}

export interface EnergyCheckOptions {
  sizes?: readonly number[];
  sampleRate?: number;
}

/**
 * Energy-check generator (Req 19.11, 20.6): 1 to 8 bin-centre sines from bin 0 (DC)
 * up to `0.9 × size/2`. Amplitudes sum to at most 0.99, so samples stay in [-1, 1], and
 * each is at least a quarter of an equal share, which keeps the Frame level above -50 dBFS.
 */
export function energyCheckFrame(
  options: EnergyCheckOptions = {},
): fc.Arbitrary<EnergyCheckFrame> {
  const sizes = options.sizes ?? [256, 512, 1024, 2048];
  const sampleRate = options.sampleRate ?? 48000;
  return fc.constantFrom(...sizes).chain((size) => {
    const maxBin = Math.floor(0.9 * (size / 2));
    return fc
      .uniqueArray(fc.integer({ min: 0, max: maxBin }), {
        minLength: 1,
        maxLength: 8,
      })
      .chain((rawBins) =>
        fc
          .tuple(
            fc.array(fc.double({ min: 0.25, max: 1, noNaN: true }), {
              minLength: rawBins.length,
              maxLength: rawBins.length,
            }),
            fc.array(fc.double({ min: 0, max: 2 * Math.PI, noNaN: true }), {
              minLength: rawBins.length,
              maxLength: rawBins.length,
            }),
          )
          .map(([weights, phases]) => {
            const order = rawBins
              .map((_, i) => i)
              .sort((a, b) => rawBins[a]! - rawBins[b]!);
            const bins = order.map((i) => rawBins[i]!);
            const sum = weights.reduce((s, w) => s + w, 0);
            const amps = order.map((i) => (weights[i]! / sum) * 0.99);
            const samples = new Float32Array(size);
            bins.forEach((k, j) => {
              const a = amps[j]!;
              // DC has no phase: a cosine phase would shrink its level.
              const phase = k === 0 ? 0 : phases[order[j]!]!;
              for (let i = 0; i < size; i++) {
                samples[i] =
                  (samples[i] ?? 0) +
                  (k === 0
                    ? a
                    : a * Math.sin((2 * Math.PI * k * i) / size + phase));
              }
            });
            return {
              samples,
              size,
              sampleRate,
              bins,
              amps,
              freqs: bins.map((k) => (k * sampleRate) / size),
            };
          }),
      );
  });
}

export type InvalidFrameKind =
  | "empty"
  | "non-finite-sample"
  | "stale-timestamp";
export type FrameKind = "valid" | InvalidFrameKind;

export interface TaggedFrame {
  frame: Frame;
  kind: FrameKind;
  /** True when a Frame guard should accept the Frame. */
  valid: boolean;
}

export interface FrameSequenceOptions {
  /** Samples per Frame. Default 128. */
  frameSize?: number;
  /** Sample rate used to space valid Timestamps. Default 48000. */
  sampleRate?: number;
  /** Timestamp of the first Frame, in ms. Default 0. */
  startMs?: Ms;
  minLength?: number;
  maxLength?: number;
  /** Invalid kinds to inject. Empty or omitted gives only valid Frames. */
  inject?: readonly InvalidFrameKind[];
}

/**
 * Sequence of Frames. Valid Frames have finite samples in [-1, 1] and non-decreasing
 * Timestamps. With `inject`, some Frames are replaced by an empty Frame, a Frame with a
 * non-finite sample, or a Frame whose Timestamp is earlier than the previous valid
 * Frame's. The first Frame is always valid so a previous Timestamp exists.
 */
export function frameSequence(
  options: FrameSequenceOptions = {},
): fc.Arbitrary<TaggedFrame[]> {
  const frameSize = options.frameSize ?? 128;
  const sampleRate = options.sampleRate ?? 48000;
  const startMs = options.startMs ?? 0;
  const inject = options.inject ?? [];
  const step = (frameSize / sampleRate) * 1000;

  const kindArb: fc.Arbitrary<FrameKind> =
    inject.length === 0
      ? fc.constant<FrameKind>("valid")
      : fc.oneof(
          { arbitrary: fc.constant<FrameKind>("valid"), weight: 3 },
          { arbitrary: fc.constantFrom<FrameKind>(...inject), weight: 2 },
        );

  const item = fc.record({
    kind: kindArb,
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    gapMs: fc.double({ min: 0, max: 5, noNaN: true }),
    badIndex: fc.nat({ max: Math.max(0, frameSize - 1) }),
    badValue: fc.constantFrom(NaN, Infinity, -Infinity),
    staleByMs: fc.double({ min: 0.001, max: 50, noNaN: true }),
  });

  return fc
    .array(item, {
      minLength: options.minLength ?? 1,
      maxLength: options.maxLength ?? 20,
    })
    .map((items) => {
      const out: TaggedFrame[] = [];
      let lastValid = startMs - step;
      items.forEach((it, idx) => {
        const kind: FrameKind = idx === 0 ? "valid" : it.kind;
        const rng = createRng(it.seed);
        const samples = new Float32Array(kind === "empty" ? 0 : frameSize);
        for (let i = 0; i < samples.length; i++) samples[i] = rng() * 2 - 1;
        let timestamp: Ms;
        if (kind === "stale-timestamp") {
          timestamp = lastValid - it.staleByMs;
        } else {
          timestamp = idx === 0 ? startMs : lastValid + step + it.gapMs;
        }
        if (kind === "non-finite-sample" && samples.length > 0) {
          samples[it.badIndex % samples.length] = it.badValue;
        }
        if (kind === "valid") lastValid = timestamp;
        out.push({
          frame: { samples, timestamp, sampleRate },
          kind,
          valid: kind === "valid",
        });
      });
      return out;
    });
}
