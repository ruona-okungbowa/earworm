import { describe, expect, it } from "vitest";
import {
  compareEvents,
  describeMismatch,
  FIXTURE_DIR,
  fixtureTest,
  loadManifest,
  runFixture,
} from "../../helpers/fixtures";
import type { FixtureEntry } from "../../helpers/fixtures";

// Requirements 18.18, 18.19, 16.11.
// Sound starts match within 15 ms by startTime, ends within 30 ms by endTime,
// with no unmatched or extra Event. Quiet-room and fan emit no sound Event.

const fixtures = loadManifest().fixtures;
const withSounds = fixtures.filter((f) => (f.expected.sounds?.length ?? 0) > 0);

function soundEvents(entry: FixtureEntry) {
  return runFixture(entry, FIXTURE_DIR).events.filter(
    (e) => e.type === "sound-start" || e.type === "sound-end",
  );
}

describe("sound fixtures", () => {
  it("lists at least one sustained fixture", () => {
    expect(withSounds.length).toBeGreaterThan(0);
  });

  for (const entry of withSounds) {
    fixtureTest(
      entry,
      `${entry.name}: sound-start within 15 ms and sound-end within 30 ms, none extra`,
      () => {
        // Only the sound expectations are compared here; pitch has its own test.
        const soundOnly: FixtureEntry = {
          ...entry,
          expected: entry.expected.sounds
            ? { sounds: entry.expected.sounds }
            : {},
        };
        const { events } = runFixture(soundOnly, FIXTURE_DIR);
        const mismatch = compareEvents(soundOnly, events);
        expect(mismatch ? describeMismatch(mismatch) : null).toBeNull();
      },
    );
  }

  for (const name of ["quiet-room", "fan"]) {
    const entry = fixtures.find((f) => f.name === name);
    if (!entry) throw new Error(`${name} is not listed in manifest.json`);
    fixtureTest(
      entry,
      `${name}: emits no sound-start or sound-end Event`,
      () => {
        expect(soundEvents(entry)).toEqual([]);
      },
    );
  }
});
