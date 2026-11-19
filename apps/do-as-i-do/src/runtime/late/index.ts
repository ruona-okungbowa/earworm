// Sittings 4 and 5 need no runtime code of their own. The Driver's PlayQueue already gives each answer
// knock and each of the five Sitting 5 plays to the Synth LOOKAHEAD_MS early, and `cancel-plays` clears
// the queue (D5). The silence cue is the `cue stay-silent` effect, which the Driver passes to `onEffect`.
export { lateSittings } from "../../logic/late/index.js";
