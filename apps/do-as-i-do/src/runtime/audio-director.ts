import type { Ms } from "@earworm/core";
import type { Synth } from "@earworm/browser";
import { peakGain } from "../logic/index.js";

export interface AudioDirectorOptions {
  synth: Synth;
  now: () => Ms;
  /** Read when each sound starts, so a change applies to later sounds only (Requirement 3.10). */
  getJumpScare: () => boolean;
  quietPeakGainLimit: number;
  /** Text equivalent of a sound, called within 200 ms of its start (Requirement 15.4). */
  onCaption: (text: string, atMs: Ms) => void;
  log?: (message: string, error: unknown) => void;
}

export interface AudioDirector {
  /** Schedules one knock. Resolves false when the Synth rejected it (already logged). */
  playKnock(atMs: Ms): Promise<boolean>;
  /** `success` uses the bell, `refusal` the bass (Requirement 13.5). */
  playSound(sound: "success" | "refusal", atMs: Ms): Promise<boolean>;
}

const SOUNDS = {
  knock: { voice: "knock", caption: "A knock." },
  success: { voice: "bell", caption: "A bell rings." },
  refusal: { voice: "bass", caption: "A low, heavy tone." },
} as const;

export function createAudioDirector(opts: AudioDirectorOptions): AudioDirector {
  const log =
    opts.log ?? ((m: string, e: unknown): void => console.error(m, e));

  const run = async (
    kind: keyof typeof SOUNDS,
    atMs: Ms,
  ): Promise<boolean> => {
    const { voice, caption } = SOUNDS[kind];
    const gain = peakGain(
      { kind: "normal", id: kind, voice, gain: 1 },
      opts.getJumpScare(),
      opts.quietPeakGainLimit,
    );
    try {
      const { startMs } = await opts.synth.schedule(voice, atMs, { gain });
      let delay = 0;
      try {
        delay = Math.max(0, startMs - opts.now());
      } catch {
        // clock gone: caption now
      }
      setTimeout(() => opts.onCaption(caption, startMs), delay);
      return true;
    } catch (e) {
      log(`audio-director: schedule "${voice}" failed`, e);
      return false;
    }
  };

  return {
    playKnock: (atMs) => run("knock", atMs),
    playSound: (sound, atMs) => run(sound, atMs),
  };
}
