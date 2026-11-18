/**
 * Recorded_Fixture runner (Req 14.13, 16.10 to 16.12, 3.7, 3.10, 4.8, 18.18, 18.19,
 * 21.11, 21.12). Reads `fixtures/recorded/manifest.json`, reads each WAV, frames it with
 * the Core `frames` function, runs the Detectors, flushes them and compares the emitted
 * Events with the manifest. It reads no clock; all times come from the WAV sample index.
 *
 * Frame size is 128 samples. The Pitch_Detector perf check (tests/core/perf) passes at 128,
 * so the 512 fallback of Assumption 25 was not taken.
 *
 * Tolerances: onset 12 ms; sound start 15 ms (startTime) and end 30 ms (endTime);
 * envelope 1.0 dB; band 1.5 dB; spectrum peak bin within one bin; pitch median within
 * 20 cents of the expected Hz (the harmonic-tone tolerance of Req 4.9), with every
 * Pitch_Event inside an expected span widened by the sound tolerances.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BAND_PRESET,
  createBandDetector,
  createEnvelopeDetector,
  createOnsetDetector,
  createPitchDetector,
  createSoundDetector,
  createSpectrumDetector,
  flushDetectors,
  frames,
} from "@earworm/core";
import type {
  BandEvent,
  Detector,
  EarwormEvent,
  EnvelopeEvent,
  PitchEvent,
  Result,
  SoundEndEvent,
  SoundStartEvent,
  SpectrumEvent,
  WindowName,
} from "@earworm/core";
import { it } from "vitest";
import { readWav } from "./wav";

export const FIXTURE_FRAME_SIZE = 128;
export const FIXTURE_DIR = fileURLToPath(
  new URL("../../fixtures/recorded/", import.meta.url),
);

export const TOLERANCE = {
  onsetMs: 12,
  soundStartMs: 15,
  soundEndMs: 30,
  envelopeDb: 1.0,
  bandDb: 1.5,
  spectrumBins: 1,
  pitchCents: 20,
} as const;

/** Largest distance in ms between an expected time and the nearest envelope, band or spectrum Event. */
const SAMPLE_POINT_WINDOW_MS = 20;

export interface ExpectedOnset {
  t: number;
}
export interface ExpectedSound {
  startTime: number;
  endTime: number;
}
export interface ExpectedPitch {
  startTime: number;
  endTime: number;
  hz: number;
}
export interface ExpectedEnvelope {
  t: number;
  level: number;
  attackMs?: number;
  releaseMs?: number;
  frameSize?: number;
}
export interface ExpectedBands {
  t: number;
  values: Record<string, number>;
  fftSize?: number;
  window?: WindowName;
  bands?: string;
  unit?: "dbfs" | "normalised";
  frameSize?: number;
}
export interface ExpectedSpectrum {
  t: number;
  bin: number;
  fftSize?: number;
  window?: WindowName;
  frameSize?: number;
}

export interface FixtureExpected {
  onsets?: ExpectedOnset[];
  maxOnsets?: number;
  sounds?: ExpectedSound[];
  pitches?: ExpectedPitch[];
  envelope?: ExpectedEnvelope[];
  bands?: ExpectedBands[];
  spectrum?: ExpectedSpectrum[];
}

export interface FixtureEntry {
  name: string;
  file: string;
  kind: string;
  expected: FixtureExpected;
  noiseFloorDb?: number;
  /** When set, the fixture is skipped (listed but not run). The text is the reason, e.g. "re-record". */
  pending?: string;
}

/** Which Noise_Floor a run uses: the manifest's measured value, or the Detector default (no setNoiseFloor call). */
export type NoiseFloorMode = "manifest" | "default";

export interface RunOptions {
  noiseFloor?: NoiseFloorMode;
}

export function isPending(entry: FixtureEntry): boolean {
  return typeof entry.pending === "string";
}

/**
 * Registers a test for a fixture. A pending fixture is registered with `it.skip` and the
 * reason in the title, so it stays visible in the report.
 */
export function fixtureTest(
  entry: FixtureEntry,
  title: string,
  fn: () => void,
): void {
  if (isPending(entry))
    it.skip(`${title} (skipped: pending ${entry.pending})`, fn);
  else it(title, fn);
}

export interface Manifest {
  fixtures: FixtureEntry[];
}

export interface Mismatch {
  fixture: string;
  /** What differs, naming the first differing Event. */
  message: string;
}

export interface FixtureReport {
  name: string;
  events: EarwormEvent[];
  mismatch: Mismatch | null;
}

function fail(name: string, message: string): Mismatch {
  return { fixture: name, message };
}

function unwrap<T>(r: Result<T>, what: string): T {
  if (!r.ok) throw new Error(`Could not create ${what}: ${r.error.message}`);
  return r.value;
}

/**
 * Loads the manifest and checks the directory. Throws an error containing
 * "no fixtures found" when the directory has no WAV file or the manifest lists no fixture
 * (Req 16.12). Throws a plain error for a missing or malformed manifest.
 */
export function loadManifest(dir: string = FIXTURE_DIR): Manifest {
  let wavs: string[] = [];
  try {
    wavs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".wav"));
  } catch {
    wavs = [];
  }
  if (wavs.length === 0) {
    throw new Error(`no fixtures found: ${dir} contains no WAV file`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  } catch (cause) {
    throw new Error(
      `no fixtures found: cannot read manifest.json in ${dir} (${(cause as Error).message})`,
    );
  }
  const list = (raw as { fixtures?: unknown } | null)?.fixtures;
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      `no fixtures found: manifest.json in ${dir} lists no fixture`,
    );
  }
  return { fixtures: list as FixtureEntry[] };
}

// ---------------------------------------------------------------------------
// Running the Detectors
// ---------------------------------------------------------------------------

/** Frames the samples, runs the Detectors the entry needs, flushes them, returns all Events. */
export function runDetectors(
  entry: FixtureEntry,
  samples: Float32Array,
  sampleRate: number,
  options: RunOptions = {},
): EarwormEvent[] {
  const exp = entry.expected;
  const noiseFloor =
    (options.noiseFloor ?? "manifest") === "manifest"
      ? entry.noiseFloorDb
      : undefined;

  const onset = unwrap(createOnsetDetector(), "Onset_Detector");
  const pitch = unwrap(createPitchDetector(), "Pitch_Detector");
  const sound = unwrap(createSoundDetector(), "Sound_Detector");
  if (noiseFloor !== undefined) {
    unwrap(onset.setNoiseFloor(noiseFloor), "Onset_Detector Noise_Floor");
    unwrap(pitch.setNoiseFloor(noiseFloor), "Pitch_Detector Noise_Floor");
    unwrap(sound.setNoiseFloor(noiseFloor), "Sound_Detector Noise_Floor");
  }
  const detectors: Detector[] = [onset, pitch, sound];

  const env = exp.envelope?.[0];
  if (env) {
    detectors.push(
      unwrap(
        createEnvelopeDetector({
          attack: env.attackMs,
          release: env.releaseMs,
          maxRate: 100,
        }),
        "Envelope_Detector",
      ),
    );
  }
  const band = exp.bands?.[0];
  if (band) {
    detectors.push(
      unwrap(
        createBandDetector({
          sampleRate,
          fftSize: band.fftSize,
          window: band.window,
          bands: BAND_PRESET,
          unit: band.unit,
          maxRate: 100,
        }),
        "Band_Detector",
      ),
    );
  }
  const spec = exp.spectrum?.[0];
  if (spec) {
    detectors.push(
      unwrap(
        createSpectrumDetector({
          sampleRate,
          fftSize: spec.fftSize,
          window: spec.window,
          maxRate: 100,
        }),
        "Spectrum_Detector",
      ),
    );
  }

  const events: EarwormEvent[] = [];
  for (const frame of frames(samples, 0, sampleRate, FIXTURE_FRAME_SIZE)) {
    for (const d of detectors) events.push(...d.process(frame));
  }
  events.push(...flushDetectors(detectors));
  return events;
}

// ---------------------------------------------------------------------------
// Comparing
// ---------------------------------------------------------------------------

const fmt = (n: number): string => (Math.round(n * 100) / 100).toString();

/**
 * One-to-one match of two time lists within `tol` ms. Returns a description of the first
 * differing Event, or null when every Event matches and none is extra or unmatched.
 */
export function firstTimeDifference(
  label: string,
  expected: readonly number[],
  actual: readonly number[],
  tol: number,
): string | null {
  const exp = [...expected].sort((a, b) => a - b);
  const act = [...actual].sort((a, b) => a - b);
  let i = 0;
  let j = 0;
  while (i < exp.length || j < act.length) {
    const e = exp[i];
    const a = act[j];
    if (e !== undefined && a !== undefined && Math.abs(a - e) <= tol) {
      i++;
      j++;
    } else if (a !== undefined && (e === undefined || a < e)) {
      return `${label} extra: emitted at ${fmt(a)} ms, no expected Event within ${tol} ms`;
    } else if (e !== undefined) {
      const near =
        a === undefined ? "none emitted" : `next emitted at ${fmt(a)} ms`;
      return `${label} unmatched: expected at ${fmt(e)} ms (${near}, tolerance ${tol} ms)`;
    }
  }
  return null;
}

function nearest<E extends EarwormEvent>(
  events: readonly E[],
  t: number,
): E | undefined {
  let best: E | undefined;
  for (const e of events) {
    if (
      best === undefined ||
      Math.abs(e.timestamp - t) < Math.abs(best.timestamp - t)
    )
      best = e;
  }
  return best && Math.abs(best.timestamp - t) <= SAMPLE_POINT_WINDOW_MS
    ? best
    : undefined;
}

function ofType<T extends EarwormEvent["type"]>(
  events: readonly EarwormEvent[],
  type: T,
): Extract<EarwormEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<EarwormEvent, { type: T }> => e.type === type,
  );
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1
    ? (s[mid] as number)
    : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

function comparePitch(
  expected: ExpectedPitch[],
  events: PitchEvent[],
): string | null {
  const inSpan = (t: number): boolean =>
    expected.some(
      (p) =>
        t >= p.startTime - TOLERANCE.soundStartMs &&
        t <= p.endTime + TOLERANCE.soundEndMs,
    );
  const stray = events.find((e) => !inSpan(e.timestamp));
  if (stray) {
    return `pitch extra: Pitch_Event at ${fmt(stray.timestamp)} ms (${fmt(stray.frequency)} Hz) is outside every expected span`;
  }
  for (const p of expected) {
    const inside = events.filter(
      (e) =>
        e.timestamp >= p.startTime - TOLERANCE.soundStartMs &&
        e.timestamp <= p.endTime + TOLERANCE.soundEndMs,
    );
    if (inside.length === 0) {
      return `pitch unmatched: no Pitch_Event in ${fmt(p.startTime)} to ${fmt(p.endTime)} ms (expected ${fmt(p.hz)} Hz)`;
    }
    const hz = median(inside.map((e) => e.frequency));
    const cents = 1200 * Math.log2(hz / p.hz);
    if (Math.abs(cents) > TOLERANCE.pitchCents) {
      return `pitch differs: median ${fmt(hz)} Hz in ${fmt(p.startTime)} to ${fmt(p.endTime)} ms, expected ${fmt(p.hz)} Hz (${fmt(cents)} cents off, tolerance ${TOLERANCE.pitchCents})`;
    }
  }
  return null;
}

function compareEnvelope(
  expected: ExpectedEnvelope[],
  events: EnvelopeEvent[],
): string | null {
  for (const x of expected) {
    const e = nearest(events, x.t);
    if (!e)
      return `envelope unmatched: no Envelope_Event within ${SAMPLE_POINT_WINDOW_MS} ms of ${fmt(x.t)} ms`;
    if (Math.abs(e.level - x.level) > TOLERANCE.envelopeDb) {
      return `envelope differs at ${fmt(x.t)} ms: emitted ${fmt(e.level)} dB, expected ${fmt(x.level)} dB (tolerance ${TOLERANCE.envelopeDb})`;
    }
  }
  return null;
}

function compareBands(
  expected: ExpectedBands[],
  events: BandEvent[],
): string | null {
  for (const x of expected) {
    const e = nearest(events, x.t);
    if (!e)
      return `band unmatched: no Band_Event within ${SAMPLE_POINT_WINDOW_MS} ms of ${fmt(x.t)} ms`;
    for (const [name, level] of Object.entries(x.values)) {
      const got = e.values[name];
      if (got === undefined || Math.abs(got - level) > TOLERANCE.bandDb) {
        return `band "${name}" differs at ${fmt(x.t)} ms: emitted ${got === undefined ? "nothing" : fmt(got)} dB, expected ${fmt(level)} dB (tolerance ${TOLERANCE.bandDb})`;
      }
    }
  }
  return null;
}

function compareSpectrum(
  expected: ExpectedSpectrum[],
  events: SpectrumEvent[],
): string | null {
  for (const x of expected) {
    const e = nearest(events, x.t);
    if (!e)
      return `spectrum unmatched: no Spectrum_Event within ${SAMPLE_POINT_WINDOW_MS} ms of ${fmt(x.t)} ms`;
    let peak = 0;
    for (let k = 1; k < e.magnitudes.length; k++) {
      if ((e.magnitudes[k] as number) > (e.magnitudes[peak] as number))
        peak = k;
    }
    if (Math.abs(peak - x.bin) > TOLERANCE.spectrumBins) {
      return `spectrum differs at ${fmt(x.t)} ms: peak bin ${peak}, expected ${x.bin} (tolerance ${TOLERANCE.spectrumBins} bin)`;
    }
  }
  return null;
}

/** Compares emitted Events with the entry's expected Events. Only listed expectations are checked. */
export function compareEvents(
  entry: FixtureEntry,
  events: readonly EarwormEvent[],
): Mismatch | null {
  const exp = entry.expected;
  const checks: Array<() => string | null> = [];

  if (exp.onsets) {
    const onsets = exp.onsets;
    checks.push(() =>
      firstTimeDifference(
        "onset",
        onsets.map((o) => o.t),
        ofType(events, "onset").map((e) => e.timestamp),
        TOLERANCE.onsetMs,
      ),
    );
  }
  if (exp.maxOnsets !== undefined) {
    const max = exp.maxOnsets;
    checks.push(() => {
      const onsets = ofType(events, "onset");
      return onsets.length > max
        ? `onset extra: emitted ${onsets.length}, at most ${max} allowed (first extra at ${fmt((onsets[max] as { timestamp: number }).timestamp)} ms)`
        : null;
    });
  }
  if (exp.sounds) {
    const sounds = exp.sounds;
    checks.push(() =>
      firstTimeDifference(
        "sound-start",
        sounds.map((s) => s.startTime),
        ofType(events, "sound-start").map((e: SoundStartEvent) => e.startTime),
        TOLERANCE.soundStartMs,
      ),
    );
    checks.push(() =>
      firstTimeDifference(
        "sound-end",
        sounds.map((s) => s.endTime),
        ofType(events, "sound-end").map((e: SoundEndEvent) => e.endTime),
        TOLERANCE.soundEndMs,
      ),
    );
  }
  if (exp.pitches) {
    const pitches = exp.pitches;
    checks.push(() => comparePitch(pitches, ofType(events, "pitch")));
  }
  if (exp.envelope) {
    const envelope = exp.envelope;
    checks.push(() => compareEnvelope(envelope, ofType(events, "envelope")));
  }
  if (exp.bands) {
    const b = exp.bands;
    checks.push(() => compareBands(b, ofType(events, "band")));
  }
  if (exp.spectrum) {
    const s = exp.spectrum;
    checks.push(() => compareSpectrum(s, ofType(events, "spectrum")));
  }

  for (const check of checks) {
    const message = check();
    if (message) return fail(entry.name, message);
  }
  return null;
}

/** Formats a mismatch as the failure text: fixture name first, then the first differing Event. */
export function describeMismatch(m: Mismatch): string {
  return `Fixture "${m.fixture}": ${m.message}`;
}

/** Reads the entry's WAV, runs the Detectors and compares. Never throws for a mismatch. */
export function runFixture(
  entry: FixtureEntry,
  dir: string = FIXTURE_DIR,
  options: RunOptions = {},
): FixtureReport {
  let wav;
  try {
    wav = readWav(new Uint8Array(readFileSync(join(dir, entry.file))));
  } catch (cause) {
    return {
      name: entry.name,
      events: [],
      mismatch: fail(
        entry.name,
        `cannot read ${entry.file}: ${(cause as Error).message}`,
      ),
    };
  }
  const events = runDetectors(entry, wav.samples, wav.sampleRate, options);
  return { name: entry.name, events, mismatch: compareEvents(entry, events) };
}

/** Runs one fixture by name from the manifest; throws "no fixtures found" or an unknown-name error. */
export function runFixtureByName(
  name: string,
  dir: string = FIXTURE_DIR,
): FixtureReport {
  const entry = loadManifest(dir).fixtures.find((f) => f.name === name);
  if (!entry)
    throw new Error(`Fixture "${name}" is not listed in manifest.json`);
  return runFixture(entry, dir);
}
