// PLACEHOLDER CONTENT: the user will write the final story. Replace the text
// below freely; the validator and tests guard the structure, not the words.
import { validateStoryScript } from "./validate.js";
import type { ValidationResult } from "./types.js";

export const storyScriptData: unknown = {
  config: {
    passThreshold: 0.8,
    attemptsPerRound: 3,
    onsetDebounceMs: 100,
    minReplyHits: 2,
    maxReplyHits: 7,
    copyDelayMs: 1500,
    minGapMs: 150,
    answeringPeriodMs: 45000,
    answerDelayMinMs: 400,
    answerDelayMaxMs: 1200,
    maxPendingAnswers: 4,
    holdPatternCount: 5,
    patternGapMs: 1500,
    silenceDurationMs: 20000,
    quietPeakGainLimit: 0.4,
  },
  sittings: [
    {
      number: 1,
      type: "copy",
      title: "It copies you",
      intro: "PLACEHOLDER. Something is listening. Show it you are here.",
      answer:
        "PLACEHOLDER. It was a house in Hydesville, 1848. It began with a sound in the wall.",
    },
    {
      number: 2,
      type: "lead",
      title: "It leads",
      intro: "PLACEHOLDER. Now it has something to show you. Listen.",
      answer:
        "PLACEHOLDER. Two sisters answered the sound. They snapped their fingers and it snapped back.",
      patterns: [{ intervals: [500, 500, 250, 750] }],
    },
    {
      number: 3,
      type: "spot",
      title: "One of those wasn't yours",
      intro: "PLACEHOLDER. Answer it. Pay attention to what comes back.",
      answer:
        "PLACEHOLDER. They taught it a code. One knock for no, two for yes. It learned the alphabet.",
    },
    {
      number: 4,
      type: "answer",
      title: "It answers",
      intro: "PLACEHOLDER. Ask it anything. It will answer.",
      answer:
        "PLACEHOLDER. Soon the whole country was listening for the spiritual telegraph. It answered everyone.",
    },
    {
      number: 5,
      type: "hold",
      title: "Don't answer",
      intro: "PLACEHOLDER. Whatever it shows you now, do not reply.",
      endings: {
        broke:
          "PLACEHOLDER. Something in the room answered. It was waiting for that.",
        held: "PLACEHOLDER. You kept silent. It had never been refused before.",
      },
      patterns: [
        { intervals: [400, 400, 800] },
        { intervals: [300, 300, 300, 900] },
        { intervals: [600, 300, 300, 600, 300] },
        { intervals: [250, 250, 250, 250, 750, 750] },
        { intervals: [900, 450, 450] },
      ],
    },
  ],
  lines: {
    again: ["PLACEHOLDER. Again.", "PLACEHOLDER. Once more."],
    slower: ["PLACEHOLDER. Slower.", "PLACEHOLDER. Take your time."],
    silence: ["PLACEHOLDER. Nothing?", "PLACEHOLDER. It heard nothing."],
    tooMany: ["PLACEHOLDER. Too many.", "PLACEHOLDER. Fewer this time."],
    tooFew: ["PLACEHOLDER. Too few.", "PLACEHOLDER. There was more."],
    timing: ["PLACEHOLDER. Not like that.", "PLACEHOLDER. The rhythm was wrong."],
    refusal: {
      2: ["PLACEHOLDER. You will not follow?", "PLACEHOLDER. It waits."],
      3: ["PLACEHOLDER. You will not answer?", "PLACEHOLDER. It waits."],
    },
    wasntYours: "One of those wasn't yours.",
  },
  sounds: {
    knockGain: 0.35,
    knockReplayGainDread3: 0.25,
    successGain: 0.3,
    refusalGain: 0.3,
    sudden: [
      {
        id: "slam",
        voice: "kick",
        onGain: 0.9,
        offGain: 0.3,
        caption: "A heavy thud under the table.",
        trigger: { sitting: 3, at: "answer-reveal" },
      },
    ],
  },
  dread: [
    { ambientGain: 0.02, brightness: 1, flicker: 0 },
    { ambientGain: 0.04, brightness: 0.85, flicker: 0.1 },
    { ambientGain: 0.06, brightness: 0.7, flicker: 0.25 },
    { ambientGain: 0.09, brightness: 0.55, flicker: 0.4 },
    { ambientGain: 0.12, brightness: 0.4, flicker: 0.6 },
    { ambientGain: 0.15, brightness: 0.25, flicker: 0.8 },
  ],
  ambient: { rampMs: 2000 },
};

export function loadStoryScript(): ValidationResult {
  return validateStoryScript(storyScriptData);
}
