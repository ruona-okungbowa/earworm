import type {
  BandEvent,
  EarwormEvent,
  EnvelopeEvent,
  EventSource,
  SpectrumEvent,
  Unsubscribe,
} from "@earworm/core";

/** Returns the last event in `events` whose type is `type`, or `null`. */
export function latestOfType<T extends EarwormEvent["type"]>(
  events: readonly EarwormEvent[],
  type: T,
): Extract<EarwormEvent, { type: T }> | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === type) return e as Extract<EarwormEvent, { type: T }>;
  }
  return null;
}

export interface LatestValues {
  /** Level of the latest Envelope event, `null` until one arrives. */
  readonly envelope: number | null;
  /** Magnitudes of the latest Spectrum event, `null` until one arrives. */
  readonly spectrum: Float32Array | null;
  /** Values of the latest Band event, `null` until one arrives. */
  readonly bands: Readonly<Record<string, number>> | null;
}

export interface LatestValueStore {
  /** Current snapshot. The reference changes only when a value changes. */
  getSnapshot(): LatestValues;
  subscribe(listener: () => void): Unsubscribe;
  /** Feeds one event. Non-matching events leave the snapshot untouched. */
  push(event: EarwormEvent): void;
  /** Feeds every event from `source` until the returned function is called. */
  attach(source: EventSource): Unsubscribe;
}

export function createLatestValueStore(): LatestValueStore {
  let snapshot: LatestValues = { envelope: null, spectrum: null, bands: null };
  const listeners = new Set<() => void>();

  const update = (next: LatestValues): void => {
    snapshot = next;
    for (const l of [...listeners]) l();
  };

  const push = (event: EarwormEvent): void => {
    switch (event.type) {
      case "envelope":
        update({ ...snapshot, envelope: (event as EnvelopeEvent).level });
        break;
      case "spectrum":
        update({ ...snapshot, spectrum: (event as SpectrumEvent).magnitudes });
        break;
      case "band":
        update({ ...snapshot, bands: (event as BandEvent).values });
        break;
      default:
        break;
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    push,
    attach: (source) => source.subscribe(push),
  };
}
