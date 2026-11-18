import { err, ok } from "@earworm/core";
import type { Result } from "@earworm/core";

export interface ScheduleOptions {
  /** Hz, 20 to 20,000. Default 440. */
  frequency?: number | undefined;
  /** Ms, 1 to 60,000. Default 200. */
  durationMs?: number | undefined;
  /** Peak level scale, 0 to 1 inclusive. Default 1. */
  gain?: number | undefined;
  /** Play without notifying the Gate. */
  ungated?: boolean | undefined;
}

export interface ValidatedRequest {
  voice: string;
  frequency: number;
  durationMs: number;
  gain: number;
  ungated: boolean;
}

export const MIN_FREQUENCY_HZ = 20;
export const MAX_FREQUENCY_HZ = 20_000;
export const MIN_DURATION_MS = 1;
export const MAX_DURATION_MS = 60_000;
export const DEFAULT_FREQUENCY_HZ = 440;
export const DEFAULT_DURATION_MS = 200;

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

/**
 * Pure check of a schedule request. Uses no Web Audio API. Checks run in order:
 * frequency, duration, gain. An omitted field takes its default.
 */
export function validateScheduleRequest(
  voice: string,
  opts: ScheduleOptions = {},
): Result<ValidatedRequest> {
  const frequency = opts.frequency ?? DEFAULT_FREQUENCY_HZ;
  if (
    !isFiniteNumber(frequency) ||
    frequency < MIN_FREQUENCY_HZ ||
    frequency > MAX_FREQUENCY_HZ
  ) {
    return err(
      "invalid-frequency",
      `frequency must be a finite number from ${MIN_FREQUENCY_HZ} to ${MAX_FREQUENCY_HZ} Hz`,
      { field: "frequency" },
    );
  }
  const durationMs = opts.durationMs ?? DEFAULT_DURATION_MS;
  if (
    !isFiniteNumber(durationMs) ||
    durationMs < MIN_DURATION_MS ||
    durationMs > MAX_DURATION_MS
  ) {
    return err(
      "invalid-duration",
      `duration must be a finite number from ${MIN_DURATION_MS} to ${MAX_DURATION_MS} ms`,
      { field: "durationMs" },
    );
  }
  const gain = opts.gain ?? 1;
  if (!isFiniteNumber(gain) || gain < 0 || gain > 1) {
    return err("invalid-gain", "gain must be a finite number from 0 to 1", {
      field: "gain",
    });
  }
  return ok({
    voice,
    frequency,
    durationMs,
    gain,
    ungated: opts.ungated === true,
  });
}
