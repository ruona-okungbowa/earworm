import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Vitest mutates `instances`, so each project needs its own copy.
const browser = (args: string[] = []) => ({
  enabled: true,
  headless: true,
  provider: playwright({ launchOptions: { args } }),
  instances: [{ browser: "chromium" as const }],
});

// 200 property-test runs in CI, 100 locally. `CI` unset, "", "0" or "false" means local.
const ci = process.env.CI;
const pbtRuns =
  ci !== undefined && ci !== "" && ci !== "0" && ci !== "false" ? 200 : 100;

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**", "apps/*/src/**"],
      reporter: ["text", "lcov", "json-summary"],
    },
    projects: [
      {
        test: {
          name: "core",
          include: ["tests/core/**/*.test.ts", "tests/helpers/**/*.test.ts"],
          provide: { pbtRuns },
          environment: "node",
          // Property tests run 200 cases under coverage in CI and exceed the 5 s default.
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "do-as-i-do-logic",
          include: ["tests/do-as-i-do/logic/**/*.test.ts"],
          provide: { pbtRuns },
          environment: "node",
          testTimeout: 60_000,
        },
      },
      {
        test: {
          name: "browser",
          include: [
            "tests/browser/**/*.test.ts",
            "tests/do-as-i-do/integration/**/*.test.ts",
          ],
          provide: { pbtRuns },
          browser: browser(),
        },
      },
      {
        plugins: [react()],
        // Pre-bundle React up front. Discovering react-dom/client mid-run makes Vite
        // reload, which leaves two React copies and breaks every hook call.
        optimizeDeps: { include: ["react", "react-dom", "react-dom/client"] },
        test: {
          name: "ui",
          include: [
            "tests/ui/**/*.test.{ts,tsx}",
            "tests/do-as-i-do/ui/**/*.test.{ts,tsx}",
          ],
          provide: { pbtRuns },
          // A fake microphone and an auto-accepted permission prompt, for the real Capture_Pipeline.
          browser: browser([
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ]),
        },
      },
    ],
  },
});
