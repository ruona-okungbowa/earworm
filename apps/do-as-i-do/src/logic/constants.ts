export const KNOCK_DURATION_MS = 120; // length of the Synth "knock" Voice
export const LOOKAHEAD_MS = 250; // Synth.schedule is called this long before a knock plays
export const TICK_MS = 20; // Driver tick period (<= 25 ms keeps the 50 ms limits)
export const LISTEN_QUIET_MS = 2_000; // Listening_Window ends this long after the last Accepted_Onset
export const LISTEN_IDLE_MS = 12_000; // ... or this long after it opened with none
export const REOPEN_DELAY_MS = 400; // "again" / "slower": new window within 500 ms
export const REFUSAL_HOLD_MS = 2_000; // Refusal line shown this long (limit 3,000 ms)
export const REVEAL_CPS = 30; // characters per second (20 to 40)
export const AMBIENT_MAX_GAIN = 0.15;
export const AMBIENT_MIN_RAMP_MS = 1_000;
export const AMBIENT_STOP_RAMP_MS = 2_000; // ambient silent before the 3,000 ms limit
export const MIN_HITS_TO_REPLY = 2; // Min_Reply_Hits is fixed at 2
