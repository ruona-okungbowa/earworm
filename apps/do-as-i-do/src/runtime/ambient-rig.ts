import type { Ms } from "@earworm/core";
import type { AudioEngine, Synth } from "@earworm/browser";
import {
  AMBIENT_STOP_RAMP_MS,
  gainAt,
  initialAmbient,
  onDread,
  onStop,
} from "../logic/index.js";
import type { AmbientState, Ramp } from "../logic/index.js";

const CHUNK_MS = 60_000; // Synth limit for one sound
const CHUNK_EVERY_MS = 59_000; // 1,000 ms overlap
const FADE_SEC = 1;

export interface AmbientRig {
  start(): void;
  onDread(targetGain: number, rampMs: number): void;
  /** Ramps to silence over 2,000 ms and stops scheduling chunks. */
  stop(): void;
  /** Current planned gain, for tests and the UI. */
  gain(): number;
}

export interface AmbientRigOptions {
  engine: AudioEngine;
  synth: Synth;
  startGain: number;
  log?: (message: string, error: unknown) => void;
}

export function createAmbientRig(opts: AmbientRigOptions): AmbientRig {
  const { engine, synth } = opts;
  const log = opts.log ?? ((m: string, e: unknown): void => console.error(m, e));
  let plan: AmbientState = initialAmbient(opts.startGain);
  let rig: GainNode | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let nextAt: Ms = 0;
  let stopped = false;

  const apply = (r: Ramp): void => {
    const g = rig?.gain;
    if (g === undefined) return;
    g.cancelScheduledValues(r.fromMs / 1000);
    g.setValueAtTime(r.fromGain, r.fromMs / 1000);
    g.linearRampToValueAtTime(r.toGain, r.toMs / 1000);
  };

  // Drone and low-passed noise, all into the one rig node so one set of ramps controls every chunk.
  synth.registerVoice("ambient", (ctx, p) => {
    const sec = p.durationMs / 1000;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, p.startSec);
    env.gain.linearRampToValueAtTime(1, p.startSec + FADE_SEC);
    env.gain.setValueAtTime(1, p.startSec + sec - FADE_SEC);
    env.gain.linearRampToValueAtTime(0, p.startSec + sec);
    if (rig !== null) env.connect(rig);

    const drone = ctx.createOscillator();
    drone.type = "sine";
    drone.frequency.value = 55;
    const droneLevel = ctx.createGain();
    droneLevel.gain.value = 0.7;
    drone.connect(droneLevel).connect(env);

    const length = Math.max(1, Math.floor(ctx.sampleRate));
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x1badf00d; // fixed seed, no Math.random
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] = seed / 0x80000000 - 1;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = 180;
    const noiseLevel = ctx.createGain();
    noiseLevel.gain.value = 0.3;
    noise.connect(lowpass).connect(noiseLevel).connect(env);

    const sources: AudioScheduledSourceNode[] = [drone, noise];
    return {
      durationMs: p.durationMs,
      sources,
      start() {
        for (const s of sources) {
          s.start(p.startSec);
          s.stop(p.startSec + sec);
        }
      },
    };
  });

  const scheduleChunks = (): void => {
    if (stopped) return;
    const horizon = engine.now() + CHUNK_EVERY_MS; // always one chunk ahead
    while (nextAt <= horizon) {
      const at = nextAt;
      nextAt += CHUNK_EVERY_MS;
      synth
        .schedule("ambient", at, {
          durationMs: CHUNK_MS,
          gain: plan.gain,
          ungated: true,
        })
        .catch((e: unknown) => log("ambient-rig: chunk schedule failed", e));
    }
  };

  return {
    start() {
      if (rig !== null || stopped) return;
      const ctx = engine.context;
      rig = ctx.createGain();
      rig.gain.value = plan.gain;
      rig.connect(ctx.destination);
      nextAt = engine.now();
      scheduleChunks();
      timer = setInterval(scheduleChunks, CHUNK_EVERY_MS);
    },
    onDread(targetGain, rampMs) {
      if (stopped) return;
      const r = onDread(plan, engine.now(), targetGain, rampMs);
      plan = r.state;
      apply(r.ramp);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) clearInterval(timer);
      timer = null;
      const r = onStop(plan, engine.now());
      plan = r.state;
      apply(r.ramp);
      setTimeout(() => rig?.disconnect(), AMBIENT_STOP_RAMP_MS + 100);
    },
    gain: () => gainAt(plan, engine.now()),
  };
}
