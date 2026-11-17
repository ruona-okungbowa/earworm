/** Milliseconds on the Audio_Clock (`AudioContext.currentTime × 1000`). */
export type Ms = number;

export type KitErrorCode =
  | "permission-denied"
  | "no-device"
  | "audio-context-resume"
  | "clock-unavailable"
  | "invalid-number"
  | "invalid-timestamp"
  | "invalid-grid"
  | "invalid-ordering"
  | "invalid-duration"
  | "invalid-ratios"
  | "invalid-frequency"
  | "invalid-gain"
  | "invalid-gate-window"
  | "invalid-config"
  | "invalid-fft-size"
  | "invalid-sample-rate"
  | "invalid-window"
  | "invalid-samples"
  | "invalid-band"
  | "invalid-unit"
  | "invalid-spectrum"
  | "invalid-calibration"
  | "calibration-failed"
  | "room-too-loud"
  | "synth-stopped"
  | "malformed-json"
  | "unsupported-version"
  | "invalid-recording";

export interface KitError {
  code: KitErrorCode;
  message: string;
  setting?: string;
  field?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: KitError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(
  code: KitErrorCode,
  message: string,
  extra?: { setting?: string; field?: string },
): Result<T> {
  const error: KitError = { code, message };
  if (extra?.setting !== undefined) error.setting = extra.setting;
  if (extra?.field !== undefined) error.field = extra.field;
  return { ok: false, error };
}
