export type SoundSpec =
  | {
      readonly kind: "sudden";
      readonly id: string;
      readonly voice: string;
      readonly onGain: number;
      readonly offGain: number;
    }
  | {
      readonly kind: "normal";
      readonly id: string;
      readonly voice: string;
      readonly gain: number;
    };

// NaN counts as silence.
const clamp = (x: number, lo: number, hi: number): number =>
  Number.isNaN(x) ? lo : Math.min(hi, Math.max(lo, x));

/** Peak Synth gain for one non-ambient sound. Never above `quietLimit` unless a Sudden_Sound has the toggle on. */
export function peakGain(
  spec: SoundSpec,
  jumpScare: boolean,
  quietLimit: number,
): number {
  const limit = clamp(quietLimit, 0, 1);
  if (spec.kind === "sudden") {
    return jumpScare
      ? clamp(spec.onGain, 0, 1)
      : clamp(spec.offGain, 0, limit);
  }
  return clamp(spec.gain, 0, limit);
}
