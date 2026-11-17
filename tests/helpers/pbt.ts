import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    pbtRuns: number;
  }
}

const MIN_RUNS = 100;
const CI_RUNS = 200;

/** Property-test run count: 200 in CI, 100 locally. */
export function runsFor(ci: boolean): number {
  return ci ? CI_RUNS : MIN_RUNS;
}

/** fast-check parameters using the run count provided by vitest.config.mts. Never fewer than 100. */
export function pbtParams(): { numRuns: number } {
  const provided = inject("pbtRuns");
  const numRuns = Number.isFinite(provided) ? provided : MIN_RUNS;
  return { numRuns: Math.max(MIN_RUNS, numRuns) };
}
