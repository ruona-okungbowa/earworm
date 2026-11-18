import type { EarwormEvent, Recording } from "./events.js";
import { err, ok } from "./types.js";
import type { Result } from "./types.js";

const SUPPORTED_VERSION = 1;

type Plain = Record<string, unknown>;

/** `-0` becomes `0`; every other number is unchanged. */
function num(n: number): number {
  return n === 0 ? 0 : n;
}

function setOwn(target: Plain, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function bandValues(values: Record<string, number>): Plain {
  const out: Plain = {};
  for (const key of Object.keys(values)) {
    setOwn(out, key, num(values[key] as number));
  }
  return out;
}

/** Replacer for Custom_Event data: writes `-0` as `0`. */
function dataReplacer(_key: string, value: unknown): unknown {
  return typeof value === "number" && value === 0 ? 0 : value;
}

/**
 * Writes an Event as a plain object with a fixed key order per type.
 * Spectrum magnitudes become a plain array of numbers.
 */
function toPlain(e: EarwormEvent): Plain {
  switch (e.type) {
    case "onset":
      return {
        type: e.type,
        timestamp: num(e.timestamp),
        source: e.source,
        strength: num(e.strength),
      };
    case "pitch":
      return {
        type: e.type,
        timestamp: num(e.timestamp),
        source: e.source,
        frequency: num(e.frequency),
        midi: num(e.midi),
        cents: num(e.cents),
        confidence: num(e.confidence),
      };
    case "level":
    case "envelope":
      return {
        type: e.type,
        timestamp: num(e.timestamp),
        source: e.source,
        level: num(e.level),
      };
    case "release":
      return { type: e.type, timestamp: num(e.timestamp), source: e.source };
    case "sound-start":
      return {
        type: e.type,
        timestamp: num(e.timestamp),
        source: e.source,
        startTime: num(e.startTime),
        level: num(e.level),
      };
    case "sound-end":
      return {
        type: e.type,
        timestamp: num(e.timestamp),
        source: e.source,
        endTime: num(e.endTime),
        duration: num(e.duration),
      };
    case "spectrum":
      return {
        type: e.type,
        timestamp: num(e.timestamp),
        source: e.source,
        sampleRate: num(e.sampleRate),
        fftSize: num(e.fftSize),
        magnitudes: Array.from(e.magnitudes, num),
      };
    case "band":
      return {
        type: e.type,
        timestamp: num(e.timestamp),
        source: e.source,
        unit: e.unit,
        values: bandValues(e.values),
      };
    default:
      return {
        type: e.type,
        timestamp: num(e.timestamp),
        source: e.source,
        data: e.data,
      };
  }
}

/** Converts a Recording to JSON text. Key order is fixed per Event type. */
export function serialiseRecording(r: Recording): string {
  return JSON.stringify(
    { version: r.version, events: r.events.map(toPlain) },
    dataReplacer,
  );
}

function isObject(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function invalid(field: string, why: string): Result<never> {
  return err("invalid-recording", `Invalid recording: ${field} ${why}`, {
    field,
  });
}

function parseEvent(raw: unknown, path: string): Result<EarwormEvent> {
  if (!isObject(raw)) return invalid(path, "must be an object");
  const f = (name: string): string => `${path}.${name}`;
  const type = raw["type"];
  if (typeof type !== "string") return invalid(f("type"), "must be a string");
  const timestamp = raw["timestamp"];
  if (!finite(timestamp)) {
    return invalid(f("timestamp"), "must be a finite number");
  }
  const source = raw["source"];
  if (typeof source !== "string") {
    return invalid(f("source"), "must be a string");
  }
  const need = (name: string): Result<never> | number => {
    const v = raw[name];
    return finite(v) ? num(v) : invalid(f(name), "must be a finite number");
  };
  const base = { timestamp: num(timestamp), source };

  switch (type) {
    case "onset": {
      const strength = need("strength");
      if (typeof strength !== "number") return strength;
      return ok({ type, timestamp: base.timestamp, source, strength });
    }
    case "pitch": {
      const frequency = need("frequency");
      if (typeof frequency !== "number") return frequency;
      const midi = need("midi");
      if (typeof midi !== "number") return midi;
      const cents = need("cents");
      if (typeof cents !== "number") return cents;
      const confidence = need("confidence");
      if (typeof confidence !== "number") return confidence;
      return ok({
        type,
        timestamp: base.timestamp,
        source,
        frequency,
        midi,
        cents,
        confidence,
      });
    }
    case "level":
    case "envelope": {
      const level = need("level");
      if (typeof level !== "number") return level;
      return ok({ type, timestamp: base.timestamp, source, level });
    }
    case "release":
      return ok({ type, timestamp: base.timestamp, source });
    case "sound-start": {
      const startTime = need("startTime");
      if (typeof startTime !== "number") return startTime;
      if (startTime > base.timestamp) {
        return invalid(f("startTime"), "must not be later than timestamp");
      }
      const level = need("level");
      if (typeof level !== "number") return level;
      return ok({
        type,
        timestamp: base.timestamp,
        source,
        startTime,
        level,
      });
    }
    case "sound-end": {
      const endTime = need("endTime");
      if (typeof endTime !== "number") return endTime;
      if (endTime > base.timestamp) {
        return invalid(f("endTime"), "must not be later than timestamp");
      }
      const duration = need("duration");
      if (typeof duration !== "number") return duration;
      if (duration < 0) return invalid(f("duration"), "must not be negative");
      return ok({
        type,
        timestamp: base.timestamp,
        source,
        endTime,
        duration,
      });
    }
    case "spectrum": {
      const sampleRate = need("sampleRate");
      if (typeof sampleRate !== "number") return sampleRate;
      const fftSize = need("fftSize");
      if (typeof fftSize !== "number") return fftSize;
      const mags = raw["magnitudes"];
      if (!Array.isArray(mags)) {
        return invalid(f("magnitudes"), "must be an array");
      }
      if (mags.length !== fftSize / 2) {
        return invalid(f("magnitudes"), "length must be fftSize / 2");
      }
      const magnitudes = new Float32Array(mags.length);
      for (let i = 0; i < mags.length; i++) {
        const m: unknown = mags[i];
        if (!finite(m)) {
          return invalid(`${f("magnitudes")}[${i}]`, "must be a finite number");
        }
        magnitudes[i] = m;
      }
      return ok({
        type,
        timestamp: base.timestamp,
        source,
        sampleRate,
        fftSize,
        magnitudes,
      });
    }
    case "band": {
      const unit = raw["unit"];
      if (unit !== "dbfs" && unit !== "normalised") {
        return invalid(f("unit"), "must be dbfs or normalised");
      }
      const rawValues = raw["values"];
      if (!isObject(rawValues)) {
        return invalid(f("values"), "must be an object");
      }
      const values: Record<string, number> = {};
      for (const key of Object.keys(rawValues)) {
        const v = rawValues[key];
        if (!finite(v)) {
          return invalid(`${f("values")}.${key}`, "must be a finite number");
        }
        setOwn(values, key, num(v));
      }
      return ok({ type, timestamp: base.timestamp, source, unit, values });
    }
    default: {
      if (!type.startsWith("x-")) {
        return invalid(f("type"), `unknown event type "${type}"`);
      }
      const data = raw["data"];
      if (!isObject(data)) return invalid(f("data"), "must be an object");
      return ok({
        type: type as `x-${string}`,
        timestamp: base.timestamp,
        source,
        data,
      });
    }
  }
}

/** Converts JSON text to a Recording. Never throws. */
export function parseRecording(text: string): Result<Recording> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    const why = e instanceof Error ? e.message : "parse error";
    return err("malformed-json", `Recording is not valid JSON: ${why}`);
  }
  if (!isObject(json)) {
    return invalid("recording", "must be an object");
  }
  const version = json["version"];
  if (version !== SUPPORTED_VERSION) {
    const named =
      version === undefined ? "missing" : (JSON.stringify(version) ?? "?");
    return err(
      "unsupported-version",
      `Unsupported recording version: ${named}`,
      { field: "version" },
    );
  }
  const rawEvents = json["events"];
  if (!Array.isArray(rawEvents)) {
    return invalid("events", "must be an array");
  }
  const events: EarwormEvent[] = [];
  for (let i = 0; i < rawEvents.length; i++) {
    const parsed = parseEvent(rawEvents[i], `events[${i}]`);
    if (!parsed.ok) return parsed;
    events.push(parsed.value);
  }
  return ok({ version: SUPPORTED_VERSION, events });
}
