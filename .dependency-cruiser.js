/** Boundary rules between the Earworm packages. */
module.exports = {
  forbidden: [
    {
      name: "core-stays-pure",
      comment:
        "@earworm/core runs anywhere: no browser, ui or testing packages, and no React.",
      severity: "error",
      from: { path: "^packages/core/" },
      to: {
        path: [
          "^packages/(browser|ui|testing)/",
          "node_modules/(@types/)?(react|react-dom)/",
        ],
      },
    },
    {
      name: "browser-has-no-ui",
      comment: "@earworm/browser may use core, but not ui or React.",
      severity: "error",
      from: { path: "^packages/browser/" },
      to: {
        path: [
          "^packages/(ui|testing)/",
          "node_modules/(@types/)?(react|react-dom)/",
        ],
      },
    },
    {
      name: "worklet-imports-only-core-framing",
      comment:
        "The Worklet runs in AudioWorkletGlobalScope and may import only @earworm/core/framing.",
      severity: "error",
      from: { path: "^packages/browser/src/worklet\\.ts$" },
      to: {
        pathNot: "^packages/core/src/framing\\.ts$",
      },
    },
    {
      name: "apps-use-package-names",
      comment: "Apps import @earworm/* by name, never a path into packages/.",
      severity: "error",
      from: { path: "^(apps)/" },
      to: { path: "^packages/", dependencyTypesNot: ["aliased-workspace"] },
    },
    {
      name: "tests-use-package-names",
      comment: "Tests import @earworm/* by name, never a path into packages/.",
      severity: "error",
      from: { path: "^tests/" },
      to: { path: "^packages/", dependencyTypesNot: ["aliased-workspace"] },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    // The boundary fixture violates the rules on purpose. Its test cruises it directly.
    exclude: { path: "^tests/helpers/boundary-fixture/" },
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "default"],
    },
  },
};
