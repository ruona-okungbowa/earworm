import { useEffect, useRef, useState } from "react";
import type { DreadSettings } from "../story/types";
import { usePrefersReducedMotion } from "./reduced-motion";

// One flicker cycle is 1,400 ms: two changes per cycle, about 1.4 per second, under the 3 per second limit (Req 2.5).
const FLICKER_CYCLE_MS = 1400;
// In reduced motion a pulse is a static glow held this long, so it never changes faster than 3 per second.
const REDUCED_PULSE_HOLD_MS = 400;

const CSS = `
@keyframes dai-flicker { from { opacity: 1; } to { opacity: var(--dai-flicker-low); } }
@keyframes dai-pulse { from { opacity: 0.9; transform: scale(0.6); } to { opacity: 0; transform: scale(1.4); } }
`;

export interface SceneProps {
  /** Settings of the current Dread_Level, from the Story_Script Dread table. */
  readonly dread: DreadSettings;
  /**
   * Total pulses so far: one per Presence knock plus one per Accepted_Onset. Each increase
   * shows one pulse. Render the Scene in the same commit as the change so it appears at once.
   */
  readonly pulses: number;
}

export function Scene({ dread, pulses }: SceneProps) {
  const reduced = usePrefersReducedMotion();
  const flicker = !reduced && dread.flicker > 0;

  // Reduced motion: hold a static glow, and extend it if more pulses arrive meanwhile.
  const [glow, setGlow] = useState(false);
  const seen = useRef(pulses);
  useEffect(() => {
    if (!reduced || pulses === seen.current) {
      seen.current = pulses;
      return;
    }
    seen.current = pulses;
    setGlow(true);
    const t = setTimeout(() => setGlow(false), REDUCED_PULSE_HOLD_MS);
    return () => clearTimeout(t);
  }, [pulses, reduced]);

  return (
    <div
      data-testid="scene"
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        background: "#050403",
        overflow: "hidden",
        // Static brightness for the Dread_Level.
        filter: `brightness(${dread.brightness})`,
        ["--dai-flicker-low" as string]: String(1 - 0.5 * dread.flicker),
        ...(flicker ? { animation: `dai-flicker ${FLICKER_CYCLE_MS}ms ease-in-out infinite alternate` } : {}),
      }}
    >
      <style>{CSS}</style>
      {/* Table: a plain lit slab, no Presence. */}
      <div
        style={{
          position: "absolute",
          left: "10%",
          right: "10%",
          bottom: 0,
          height: "28%",
          background: "linear-gradient(#2a1d12, #120c07)",
          borderTop: "2px solid #3b2a1a",
        }}
      />
      {reduced ? (
        glow && <PulseDot animated={false} />
      ) : (
        pulses > 0 && <PulseDot key={pulses} animated />
      )}
    </div>
  );
}

function PulseDot({ animated }: { animated: boolean }) {
  return (
    <div
      data-testid="pulse"
      style={{
        position: "absolute",
        left: "50%",
        bottom: "26%",
        width: 120,
        height: 120,
        marginLeft: -60,
        borderRadius: "50%",
        background: "radial-gradient(#e8c98a, transparent 70%)",
        opacity: 0.6,
        ...(animated ? { animation: "dai-pulse 400ms ease-out forwards" } : {}),
      }}
    />
  );
}
