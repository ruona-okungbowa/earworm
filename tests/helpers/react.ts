/**
 * Minimal React test helper built on `react-dom/client` and `act`.
 * No React testing library is used.
 */
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

/** Renders `element` into a fresh container attached to `document.body`. Any previous render is unmounted first. */
export async function render(element: ReactNode): Promise<HTMLElement> {
  await unmount();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const newRoot = createRoot(host);
  container = host;
  root = newRoot;
  await act(async () => {
    newRoot.render(element);
  });
  return host;
}

/** Unmounts the current render and removes its container. Safe to call when nothing is rendered. */
export async function unmount(): Promise<void> {
  const currentRoot = root;
  const currentContainer = container;
  root = null;
  container = null;
  if (currentRoot !== null) {
    await act(async () => {
      currentRoot.unmount();
    });
  }
  currentContainer?.remove();
}
