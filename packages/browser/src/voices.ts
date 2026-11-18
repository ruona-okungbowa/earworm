/** What a Voice builder receives. Times are in seconds on the context clock. */
export interface VoiceParams {
  frequency: number;
  durationMs: number;
  /** Peak level scale, 0 to 1. The builder applies it to its output level. */
  gain: number;
  startSec: number;
}

/** A built, not yet started sound. */
export interface BuiltVoice {
  /** Length of the sound in ms. The Gate window is `[start, start + durationMs]`. */
  durationMs: number;
  /** Starts every source at `params.startSec`. Called after the Gate is notified. */
  start(): void;
  /** Every source, so `stop` can silence them. */
  sources: AudioScheduledSourceNode[];
}

/**
 * Create nodes and connect the sound to `output`. Must not call `start()` on any
 * source. Stop times for sources are set by the builder inside `start()`.
 */
export type VoiceBuilder = (
  ctx: BaseAudioContext,
  params: VoiceParams,
  output: AudioNode,
) => BuiltVoice;

/** Built-in Voices made from Web Audio nodes only. No audio files are loaded. */

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** One second of white noise from a fixed-seed generator, cached per context. */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const cached = noiseCache.get(ctx);
  if (cached !== undefined) return cached;
  const length = Math.max(1, Math.floor(ctx.sampleRate));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = 0x2545f491;
  for (let i = 0; i < length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    data[i] = (seed / 0x80000000) - 1;
  }
  noiseCache.set(ctx, buffer);
  return buffer;
}

/** Gain node with an instant attack to `peak` and a linear decay to 0 over `decaySec`. */
function envelope(
  ctx: BaseAudioContext,
  startSec: number,
  peak: number,
  attackSec: number,
  decaySec: number,
): GainNode {
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, startSec);
  env.gain.linearRampToValueAtTime(peak, startSec + attackSec);
  env.gain.linearRampToValueAtTime(0, startSec + attackSec + decaySec);
  return env;
}

/** Collects sources and starts and stops them together. */
function assemble(
  p: VoiceParams,
  durationMs: number,
  sources: AudioScheduledSourceNode[],
): BuiltVoice {
  return {
    durationMs,
    sources,
    start() {
      const stopSec = p.startSec + durationMs / 1000;
      for (const s of sources) {
        s.start(p.startSec);
        s.stop(stopSec);
      }
    },
  };
}

function oscillator(
  ctx: BaseAudioContext,
  type: OscillatorType,
  freq: number,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  return osc;
}

function noise(ctx: BaseAudioContext): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  return src;
}

function filter(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  freq: number,
  q = 1,
): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** A dull wooden thud: a short sine drop plus low-passed noise. */
const knock: VoiceBuilder = (ctx, p, output) => {
  const ms = 120;
  const sec = ms / 1000;
  const osc = oscillator(ctx, "sine", 180);
  osc.frequency.setValueAtTime(180, p.startSec);
  osc.frequency.exponentialRampToValueAtTime(70, p.startSec + sec);
  const oscEnv = envelope(ctx, p.startSec, p.gain * 0.8, 0.002, sec - 0.002);
  osc.connect(oscEnv).connect(output);

  const n = noise(ctx);
  const lp = filter(ctx, "lowpass", 900);
  const nEnv = envelope(ctx, p.startSec, p.gain * 0.5, 0.001, 0.03);
  n.connect(lp).connect(nEnv).connect(output);
  return assemble(p, ms, [osc, n]);
};

/** A very short, bright noise tick. */
const click: VoiceBuilder = (ctx, p, output) => {
  const ms = 20;
  const n = noise(ctx);
  const hp = filter(ctx, "highpass", 2500);
  const env = envelope(ctx, p.startSec, p.gain, 0.0005, ms / 1000 - 0.0005);
  n.connect(hp).connect(env).connect(output);
  return assemble(p, ms, [n]);
};

/** A sine tone at the caller's frequency and duration, with short edge ramps. */
const tone: VoiceBuilder = (ctx, p, output) => {
  const osc = oscillator(ctx, "sine", p.frequency);
  const sec = p.durationMs / 1000;
  const edge = Math.min(0.005, sec / 4);
  const env = ctx.createGain();
  env.gain.setValueAtTime(0, p.startSec);
  env.gain.linearRampToValueAtTime(p.gain, p.startSec + edge);
  env.gain.setValueAtTime(p.gain, p.startSec + sec - edge);
  env.gain.linearRampToValueAtTime(0, p.startSec + sec);
  osc.connect(env).connect(output);
  return assemble(p, p.durationMs, [osc]);
};

/** A low sine with a fast downward pitch sweep. */
const kick: VoiceBuilder = (ctx, p, output) => {
  const ms = 300;
  const sec = ms / 1000;
  const osc = oscillator(ctx, "sine", 150);
  osc.frequency.setValueAtTime(150, p.startSec);
  osc.frequency.exponentialRampToValueAtTime(45, p.startSec + 0.12);
  const env = envelope(ctx, p.startSec, p.gain, 0.002, sec - 0.002);
  osc.connect(env).connect(output);
  return assemble(p, ms, [osc]);
};

/** Band-passed noise on top of a short triangle body. */
const snare: VoiceBuilder = (ctx, p, output) => {
  const ms = 200;
  const sec = ms / 1000;
  const n = noise(ctx);
  const bp = filter(ctx, "bandpass", 1800, 0.8);
  const nEnv = envelope(ctx, p.startSec, p.gain * 0.7, 0.001, sec - 0.001);
  n.connect(bp).connect(nEnv).connect(output);

  const osc = oscillator(ctx, "triangle", 200);
  const oEnv = envelope(ctx, p.startSec, p.gain * 0.5, 0.001, 0.08);
  osc.connect(oEnv).connect(output);
  return assemble(p, ms, [n, osc]);
};

/** Short high-passed noise. */
const hat: VoiceBuilder = (ctx, p, output) => {
  const ms = 80;
  const n = noise(ctx);
  const hp = filter(ctx, "highpass", 7000);
  const env = envelope(ctx, p.startSec, p.gain, 0.001, ms / 1000 - 0.001);
  n.connect(hp).connect(env).connect(output);
  return assemble(p, ms, [n]);
};

/** A low sawtooth through a low-pass filter. */
const bass: VoiceBuilder = (ctx, p, output) => {
  const ms = 350;
  const sec = ms / 1000;
  const osc = oscillator(ctx, "sawtooth", 55);
  const lp = filter(ctx, "lowpass", 300, 2);
  const env = envelope(ctx, p.startSec, p.gain, 0.01, sec - 0.01);
  osc.connect(lp).connect(env).connect(output);
  return assemble(p, ms, [osc]);
};

/** Two inharmonic sine partials with a long decay. */
const bell: VoiceBuilder = (ctx, p, output) => {
  const ms = 900;
  const sec = ms / 1000;
  const base = oscillator(ctx, "sine", 880);
  const partial = oscillator(ctx, "sine", 880 * 2.76);
  const baseEnv = envelope(ctx, p.startSec, p.gain * 0.7, 0.002, sec - 0.002);
  const partialEnv = envelope(ctx, p.startSec, p.gain * 0.3, 0.002, 0.4);
  base.connect(baseEnv).connect(output);
  partial.connect(partialEnv).connect(output);
  return assemble(p, ms, [base, partial]);
};

/** The built-in Voices, keyed by the name passed to `Synth.schedule`. */
export const builtInVoices: ReadonlyMap<string, VoiceBuilder> = new Map<
  string,
  VoiceBuilder
>([
  ["knock", knock],
  ["click", click],
  ["tone", tone],
  ["kick", kick],
  ["snare", snare],
  ["hat", hat],
  ["bass", bass],
  ["bell", bell],
]);
