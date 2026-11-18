import { err } from "@earworm/core";
import type { KitError, KitErrorCode, Ms } from "@earworm/core";
import type { AudioEngine } from "./engine.js";
import type { Gate } from "./gate.js";
import { validateScheduleRequest } from "./schedule-validation.js";
import { builtInVoices } from "./voices.js";
import type { VoiceBuilder } from "./voices.js";
import type {
  ScheduleOptions,
  ValidatedRequest,
} from "./schedule-validation.js";

export type { BuiltVoice, VoiceBuilder, VoiceParams } from "./voices.js";

export interface Synth {
  schedule(
    voice: string,
    atMs: Ms,
    opts?: ScheduleOptions,
  ): Promise<{ startMs: Ms; endMs: Ms }>;
  registerVoice(name: string, builder: VoiceBuilder): void;
  stop(): void;
}

export interface SynthOptions {
  gate: Gate;
}

/** Time allowed for sounds to fade out on `stop()`. */
const STOP_RAMP_MS = 40;
const STOP_DEADLINE_MS = 50;

interface ActiveSound {
  startMs: Ms;
  endMs: Ms;
  out: GainNode;
  sources: AudioScheduledSourceNode[];
  windowId: number | null;
}

function reject(error: KitError): Promise<never> {
  return Promise.reject(error);
}

function failWith(
  code: KitErrorCode,
  message: string,
  extra?: { field?: string },
): Promise<never> {
  const r = err(code, message, extra);
  return reject(r.ok ? { code, message } : r.error);
}

export function createSynth(engine: AudioEngine, options: SynthOptions): Synth {
  const { gate } = options;
  const voices = new Map<string, VoiceBuilder>(builtInVoices);
  const active = new Set<ActiveSound>();
  let stopped = false;

  return {
    registerVoice(name, builder) {
      voices.set(name, builder);
    },

    schedule(voice, atMs, opts = {}) {
      const validated = validateScheduleRequest(voice, opts);
      if (!validated.ok) return reject(validated.error);
      const req: ValidatedRequest = validated.value;
      if (stopped) {
        return failWith("synth-stopped", "the Synth has been stopped");
      }
      if (typeof atMs !== "number" || !Number.isFinite(atMs)) {
        return failWith("invalid-timestamp", "atMs must be a finite number");
      }
      const builder = voices.get(voice);
      if (builder === undefined) {
        return failWith("invalid-config", `unknown voice "${voice}"`, {
          field: "voice",
        });
      }

      const ctx = engine.context;
      const startMs = Math.max(atMs, engine.now());
      const out = ctx.createGain();
      out.connect(ctx.destination);
      const built = builder(
        ctx,
        {
          frequency: req.frequency,
          durationMs: req.durationMs,
          gain: req.gain,
          startSec: startMs / 1000,
        },
        out,
      );
      const endMs = startMs + built.durationMs;

      let windowId: number | null = null;
      if (!req.ungated) {
        const w = gate.addWindow(startMs, endMs);
        if (!w.ok) {
          out.disconnect();
          return reject(w.error);
        }
        windowId = w.value.id;
      }

      const sound: ActiveSound = {
        startMs,
        endMs,
        out,
        sources: built.sources,
        windowId,
      };
      active.add(sound);
      const first = built.sources[0];
      if (first !== undefined) {
        first.addEventListener("ended", () => {
          active.delete(sound);
        });
      }
      built.start();
      return Promise.resolve({ startMs, endMs });
    },

    stop() {
      stopped = true;
      const nowMs = engine.now();
      const nowSec = nowMs / 1000;
      for (const s of active) {
        if (s.windowId !== null && s.startMs > nowMs) {
          gate.cancelWindow(s.windowId);
        }
        s.out.gain.cancelScheduledValues(nowSec);
        s.out.gain.setValueAtTime(s.out.gain.value, nowSec);
        s.out.gain.linearRampToValueAtTime(0, nowSec + STOP_RAMP_MS / 1000);
        for (const src of s.sources) {
          try {
            src.stop(nowSec + STOP_DEADLINE_MS / 1000);
          } catch {
            // Source already stopped.
          }
        }
      }
      active.clear();
    },
  };
}
