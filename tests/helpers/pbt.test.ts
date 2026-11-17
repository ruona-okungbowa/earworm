import { describe, expect, it } from "vitest";
import { pbtParams, runsFor } from "./pbt";

describe("pbt helper", () => {
  it("runsFor gives 100 locally and 200 in CI", () => {
    expect(runsFor(false)).toBe(100);
    expect(runsFor(true)).toBe(200);
  });

  it("pbtParams never returns fewer than 100 runs", () => {
    expect(pbtParams().numRuns).toBeGreaterThanOrEqual(100);
  });
});
