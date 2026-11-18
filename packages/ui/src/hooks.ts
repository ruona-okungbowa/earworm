import { useCallback, useState, useSyncExternalStore } from "react";
import type { EarwormEvent, EventSource, Unsubscribe } from "@earworm/core";
import type { CalibrationStore } from "@earworm/browser";
import { createLatestValueStore } from "./latest.js";
import type { LatestValueStore, LatestValues } from "./latest.js";

/**
 * The Calibration store holds a whole Calibration or `null`, so it can only
 * tell "uncalibrated" from "calibrated". "calibrating" and "failed" are
 * transient and are tracked by the caller (for example MicCheck).
 */
export type CalibrationState =
  | "uncalibrated"
  | "calibrating"
  | "calibrated"
  | "failed";

export interface UseEventsOptions {
  /** Most recent events to keep. Defaults to 100. */
  limit?: number;
}

const DEFAULT_EVENT_LIMIT = 100;
const EMPTY_EVENTS: readonly EarwormEvent[] = Object.freeze([]);

interface Store<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): Unsubscribe;
}

/** Subscribes to `source` only while at least one React listener exists. */
function createSourceStore<T>(
  source: EventSource,
  initial: T,
  reduce: (current: T, event: EarwormEvent) => T,
): Store<T> {
  let snapshot = initial;
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      const off = source.subscribe((event) => {
        const next = reduce(snapshot, event);
        if (next === snapshot) return;
        snapshot = next;
        listener();
      });
      return off;
    },
  };
}

function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/** The most recent `limit` events from `source`, oldest first. */
export function useEvents(
  source: EventSource,
  options: UseEventsOptions = {},
): readonly EarwormEvent[] {
  const raw = options.limit ?? DEFAULT_EVENT_LIMIT;
  const limit = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : DEFAULT_EVENT_LIMIT;
  const [store, setStore] = useState(() => makeEventsStore(source, limit));
  const [key, setKey] = useState({ source, limit });
  let current = store;
  if (key.source !== source || key.limit !== limit) {
    current = makeEventsStore(source, limit);
    setStore(current);
    setKey({ source, limit });
  }
  return useStore(current);
}

function makeEventsStore(source: EventSource, limit: number): Store<readonly EarwormEvent[]> {
  return createSourceStore<readonly EarwormEvent[]>(source, EMPTY_EVENTS, (events, e) => {
    if (limit === 0) return events;
    const next = events.length >= limit ? events.slice(events.length - limit + 1) : events.slice();
    next.push(e);
    return next;
  });
}

/** Level of the latest Level event as 0 to 1, `(clamp(dBFS, -60, 0) + 60) / 60`. */
export function useInputLevel(source: EventSource): number {
  const [state, setState] = useState(() => ({ source, store: makeLevelStore(source) }));
  let current = state.store;
  if (state.source !== source) {
    current = makeLevelStore(source);
    setState({ source, store: current });
  }
  return useStore(current);
}

function makeLevelStore(source: EventSource): Store<number> {
  return createSourceStore<number>(source, 0, (value, e) => {
    if (e.type !== "level" || !Number.isFinite(e.level)) return value;
    const clamped = Math.min(0, Math.max(-60, e.level));
    return (clamped + 60) / 60;
  });
}

/** Reads the Calibration store, not the Event_Source, which carries no Calibration. */
export function useCalibrationState(store: CalibrationStore): CalibrationState {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(() => listener()),
    [store],
  );
  const getSnapshot = useCallback(
    (): CalibrationState => (store.get() === null ? "uncalibrated" : "calibrated"),
    [store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The latest-value store lives as long as the component, so the last value
 * stays when `source` changes (for example to the Tap_Source).
 */
function useLatest<T>(source: EventSource, select: (v: LatestValues) => T): T {
  const [latest] = useState<LatestValueStore>(createLatestValueStore);
  const subscribe = useCallback(
    (listener: () => void) => {
      const offStore = latest.subscribe(listener);
      const offSource = latest.attach(source);
      return () => {
        offSource();
        offStore();
      };
    },
    [latest, source],
  );
  const getSnapshot = useCallback(() => select(latest.getSnapshot()), [latest, select]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

const selectEnvelope = (v: LatestValues): number | null => v.envelope;
const selectSpectrum = (v: LatestValues): Float32Array | null => v.spectrum;
const selectBands = (v: LatestValues): Readonly<Record<string, number>> | null => v.bands;

export function useEnvelopeLevel(source: EventSource): number | null {
  return useLatest(source, selectEnvelope);
}

export function useSpectrum(source: EventSource): Float32Array | null {
  return useLatest(source, selectSpectrum);
}

export function useBands(source: EventSource): Readonly<Record<string, number>> | null {
  return useLatest(source, selectBands);
}
