import { describe, expect, it } from "vitest";
import {
  describeMismatch,
  fixtureTest,
  loadManifest,
  runFixture,
  TOLERANCE,
} from "../../helpers/fixtures";
import type { FixtureEntry, FixtureExpected } from "../../helpers/fixtures";

// Requirements 21.11, 21.12, 16.11.

type Key = "envelope" | "bands" | "spectrum";

const fixtures = loadManifest().fixtures;

function casesFor(key: Key): FixtureEntry[] {
  return fixtures.filter((f) => (f.expected[key]?.length ?? 0) > 0);
}

/** An entry that checks only one expectation kind, so a failure names that Detector. */
function only(entry: FixtureEntry, key: Key): FixtureEntry {
  const expected: FixtureExpected = { [key]: entry.expected[key] };
  return { ...entry, expected };
}

function check(entry: FixtureEntry, key: Key): void {
  const report = runFixture(only(entry, key));
  expect(report.mismatch ? describeMismatch(report.mismatch) : null).toBeNull();
}

describe("envelope fixtures", () => {
  it("has at least one fixture with an expected envelope level", () => {
    expect(casesFor("envelope").length).toBeGreaterThan(0);
  });

  for (const entry of casesFor("envelope")) {
    fixtureTest(
      entry,
      `${entry.name}: level within ${TOLERANCE.envelopeDb} dB`,
      () => {
        check(entry, "envelope");
      },
    );
  }
});

describe("band fixtures", () => {
  it("has at least one fixture with expected band levels", () => {
    expect(casesFor("bands").length).toBeGreaterThan(0);
  });

  for (const entry of casesFor("bands")) {
    fixtureTest(
      entry,
      `${entry.name}: every band level within ${TOLERANCE.bandDb} dB`,
      () => {
        check(entry, "bands");
      },
    );
  }
});

describe("spectrum fixtures", () => {
  it("has at least one fixture with an expected spectrum peak", () => {
    expect(casesFor("spectrum").length).toBeGreaterThan(0);
  });

  for (const entry of casesFor("spectrum")) {
    fixtureTest(
      entry,
      `${entry.name}: highest bin within ${TOLERANCE.spectrumBins} bin of expected`,
      () => {
        check(entry, "spectrum");
      },
    );
  }
});
