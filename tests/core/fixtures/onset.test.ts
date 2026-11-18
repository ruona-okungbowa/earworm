import { describe, expect, it } from "vitest";
import {
  compareEvents,
  describeMismatch,
  FIXTURE_DIR,
  firstTimeDifference,
  fixtureTest,
  loadManifest,
  runFixture,
  TOLERANCE,
} from "../../helpers/fixtures";
import type { FixtureEntry, NoiseFloorMode } from "../../helpers/fixtures";

// Requirements 3.7, 3.10, 16.11.

const fixtures = loadManifest().fixtures;
const onsetFixtures = fixtures.filter((f) => f.kind === "onset");

function byName(name: string): FixtureEntry {
  const entry = fixtures.find((f) => f.name === name);
  if (!entry)
    throw new Error(`Fixture "${name}" is not listed in manifest.json`);
  return entry;
}

describe("recorded fixtures: Onset_Detector", () => {
  it("lists at least one knock or clap fixture", () => {
    expect(onsetFixtures.length).toBeGreaterThan(0);
  });

  const modes: NoiseFloorMode[] = ["manifest", "default"];
  for (const entry of onsetFixtures) {
    for (const noiseFloor of modes) {
      fixtureTest(
        entry,
        `${entry.name} (${noiseFloor} floor): Onsets match within ${TOLERANCE.onsetMs} ms, none unmatched or extra`,
        () => {
          const report = runFixture(entry, FIXTURE_DIR, { noiseFloor });
          const expected = (entry.expected.onsets ?? []).map((o) => o.t);
          const actual = report.events
            .filter((e) => e.type === "onset")
            .map((e) => e.timestamp);
          const diff = firstTimeDifference(
            entry.name,
            expected,
            actual,
            TOLERANCE.onsetMs,
          );
          expect(diff, `Fixture "${entry.name}": ${diff}`).toBeNull();
          expect(actual).toHaveLength(expected.length);
        },
      );
    }
  }

  for (const name of ["quiet-room", "fan"]) {
    fixtureTest(byName(name), `${name}: no Onset`, () => {
      const report = runFixture(byName(name));
      const onsets = report.events.filter((e) => e.type === "onset");
      expect(onsets.map((e) => e.timestamp)).toEqual([]);
    });
  }

  fixtureTest(byName("door"), "door: at most one Onset", () => {
    const entry = byName("door");
    const report = runFixture(entry);
    const onsets = report.events.filter((e) => e.type === "onset");
    expect(
      onsets.length,
      `Fixture "door": Onsets at ${onsets.map((e) => e.timestamp.toFixed(2)).join(", ")} ms`,
    ).toBeLessThanOrEqual(1);
    const mismatch = compareEvents(entry, report.events);
    expect(mismatch ? describeMismatch(mismatch) : null).toBeNull();
  });
});
