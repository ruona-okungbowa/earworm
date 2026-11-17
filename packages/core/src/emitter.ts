import type { EarwormEvent, EventSource, Unsubscribe } from "./events.js";

export interface EmitterOptions {
  onError?: (error: unknown, event: EarwormEvent) => void;
}

export interface Emitter extends EventSource {
  emit(e: EarwormEvent): void;
}

interface Entry {
  readonly listener: (e: EarwormEvent) => void;
  active: boolean;
}

function defaultOnError(error: unknown): void {
  // Core has no console types, so look it up through a narrowed globalThis.
  (globalThis as { console?: { error?: (...a: unknown[]) => void } }).console?.error?.(error);
}

export function createEmitter(opts?: EmitterOptions): Emitter {
  const onError = opts?.onError ?? defaultOnError;
  let entries: Entry[] = [];

  return {
    subscribe(listener: (e: EarwormEvent) => void): Unsubscribe {
      const entry: Entry = { listener, active: true };
      entries = [...entries, entry];
      return () => {
        if (!entry.active) return;
        entry.active = false;
        entries = entries.filter((x) => x !== entry);
      };
    },
    emit(e: EarwormEvent): void {
      const snapshot = entries;
      for (const entry of snapshot) {
        if (!entry.active) continue;
        try {
          entry.listener(e);
        } catch (error) {
          try {
            onError(error, e);
          } catch {
            // An onError that throws is ignored so emit never throws.
          }
        }
      }
    },
  };
}
