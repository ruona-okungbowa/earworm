import { useSyncExternalStore } from "react";

/** The minimal shape the UI needs from the Driver. getSnapshot must return a stable reference until state changes. */
export interface SessionStore<S> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): S;
}

export function useSessionStore<S>(store: SessionStore<S>): S {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
