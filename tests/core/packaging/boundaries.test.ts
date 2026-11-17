import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const fixture = resolve(root, "tests/helpers/boundary-fixture");
const config = resolve(root, ".dependency-cruiser.js");

const run = (args: string, cwd: string) =>
  spawnSync(`npm exec --prefix "${root}" -- ${args}`, {
    cwd,
    shell: true,
    encoding: "utf8",
  });

describe("package boundaries", () => {
  it("the repo passes lint:deps", () => {
    const result = spawnSync("npm run lint:deps", {
      cwd: root,
      shell: true,
      encoding: "utf8",
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  }, 120_000);

  it("depcruise reports each violation in the fixture tree", () => {
    const result = run(`depcruise --config "${config}" packages`, fixture);
    const output = (result.stdout + result.stderr).replaceAll("\\", "/");

    expect(result.status).not.toBe(0);
    expect(output).toContain("packages/core/src/bad.ts");
    expect(output).toContain("packages/browser/src/index.ts");
    expect(output).toContain("core-stays-pure");
    expect(output).toContain("packages/browser/src/bad.ts");
    expect(output).toMatch(/node_modules\/(@types\/)?react\//);
    expect(output).toContain("browser-has-no-ui");
  }, 120_000);
});
