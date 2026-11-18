/**
 * Environment probe for microphone capture. Nothing here touches a browser
 * global at import time; the default environment is read lazily from
 * `globalThis` when `canUseMic()` is called without an argument.
 */

export interface CanUseMicEnv {
  readonly navigator?: unknown;
  readonly AudioContext?: unknown;
  readonly AudioWorklet?: unknown;
  readonly isSecureContext?: unknown;
}

function defaultEnv(): CanUseMicEnv {
  const g = globalThis as Record<string, unknown>;
  return {
    navigator: g["navigator"],
    AudioContext: g["AudioContext"],
    AudioWorklet: g["AudioWorklet"],
    isSecureContext: g["isSecureContext"],
  };
}

/**
 * True only when `navigator.mediaDevices.getUserMedia`, `AudioContext`,
 * `AudioWorklet` and a secure context are all present. Never throws.
 */
export function canUseMic(env?: CanUseMicEnv): boolean {
  try {
    const e = env ?? defaultEnv();
    if (e.isSecureContext !== true) return false;
    if (typeof e.AudioContext !== "function") return false;
    if (e.AudioWorklet === undefined || e.AudioWorklet === null) return false;
    const nav = e.navigator as
      | { mediaDevices?: { getUserMedia?: unknown } | null }
      | null
      | undefined;
    const media = nav?.mediaDevices;
    return typeof media?.getUserMedia === "function";
  } catch {
    return false;
  }
}
