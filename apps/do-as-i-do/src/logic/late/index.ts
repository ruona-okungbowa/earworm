import type { LateSittings } from "../sittings.js";
import {
  startAnswering,
  stepAnswering,
  type AnsweringState,
} from "./answering.js";
import { startHold, stepHold, type HoldState } from "./hold.js";

export { planHold, type HoldPlan } from "./hold-plan.js";
export { startHold, stepHold, type HoldState } from "./hold.js";
export {
  startAnswering,
  stepAnswering,
  type AnsweringState,
} from "./answering.js";

// The Session holds these states as `unknown`; each is only ever fed back to its own step function.
export const lateSittings: LateSittings = {
  start4: () => startAnswering(),
  step4: (state, input, nowMs, story, mode, random) =>
    stepAnswering(
      state as AnsweringState,
      input,
      nowMs,
      story.config,
      mode,
      random,
    ),
  start5: (_story, _mode, _nowMs, dread) => startHold(dread),
  step5: (state, input, nowMs, story, mode) =>
    stepHold(state as HoldState, input, nowMs, story, mode),
};
