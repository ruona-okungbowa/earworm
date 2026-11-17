import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Vitest mutates `instances`, so each project needs its own copy.
const browser = () => ({
  enabled: true,
  headless: true,
  provider: playwright(),
  instances: [{ browser: "chromium" as const }],
});

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**"],
      reporter: ["text", "lcov", "json-summary"],
    },
    projects: [
      {
        test: {
          name: "core",
          include: ["packages/core/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
          environment: "node",
        },
      },
      {
        test: {
          name: "browser",
          include: ["packages/browser/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
          browser: browser(),
        },
      },
      {
        plugins: [react()],
        test: {
          name: "ui",
          include: ["packages/ui/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
          browser: browser(),
        },
      },
    ],
  },
});
