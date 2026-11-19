import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

/**
 * Screen colours. Panels are opaque, so contrast does not depend on the Scene's
 * Dread_Level brightness (Req 15.2, 15.3). Ratios: TEXT 16:1, MUTED 11:1, FOCUS 13:1.
 */
export const COLORS = {
  panel: "#0b0806",
  text: "#f4ead5",
  muted: "#cdbfa6",
  button: "#1c140d",
  focus: "#ffd166",
} as const;

export const SCREEN_CSS = `
.dai-panel { position: relative; z-index: 1; box-sizing: border-box; max-width: 40rem; margin: 2rem auto; padding: 1.5rem;
  background: ${COLORS.panel}; color: ${COLORS.text}; font: 1.125rem/1.5 Georgia, serif; border: 1px solid ${COLORS.muted}; }
.dai-panel h1 { font-size: 1.5rem; margin: 0 0 1rem; }
.dai-panel button { font: inherit; color: ${COLORS.text}; background: ${COLORS.button}; border: 2px solid ${COLORS.text};
  padding: 0.5rem 1rem; margin: 0.5rem 0.5rem 0.5rem 0; cursor: pointer; }
.dai-panel button:disabled { color: ${COLORS.muted}; border-color: ${COLORS.muted}; cursor: not-allowed; }
.dai-panel button[aria-pressed="true"] { background: ${COLORS.text}; color: ${COLORS.panel}; }
.dai-panel .dai-muted { color: ${COLORS.muted}; }
.dai-panel :focus-visible { outline: 3px solid ${COLORS.focus}; outline-offset: 2px; }
`;

/** A screen. Moves focus to the heading on mount so keyboard and screen reader users start at the top. */
export function Panel({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <main className="dai-panel" data-testid={testId}>
      <style>{SCREEN_CSS}</style>
      <h1 ref={heading} tabIndex={-1}>
        {title}
      </h1>
      {children}
    </main>
  );
}
