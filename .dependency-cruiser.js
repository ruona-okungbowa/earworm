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
      name: "do-as-i-do-logic-stays-pure",
      comment:
        "Do As I Do logic and story run without the browser package, the ui package or React.",
      severity: "error",
      from: { path: "^apps/do-as-i-do/src/(logic|story)/" },
      to: {
        path: [
          "^packages/(browser|ui)/",
          "node_modules/(@types/)?(react|react-dom)/",
        ],
      },
    },
    {
      name: "do-as-i-do-runtime-has-no-ui",
      comment:
        "Do As I Do runtime, logic and story never import its ui folder.",
      severity: "error",
      from: { path: "^apps/do-as-i-do/src/(runtime|logic|story)/" },
      to: { path: "^apps/do-as-i-do/src/ui/" },
    },
    {
      name: "apps-use-package-names",
      comment: "Apps import @earworm/* by name, never a path into packages/.",
      severity: "error",
      from: { path: "^(apps)/" },
      // "undetermined": an app lists @earworm/* in its own package.json, so the bare import
      // resolves through the workspace symlink. Relative paths into packages/ stay "local".
      to: {
        path: "^packages/",
        dependencyTypesNot: ["aliased-workspace", "undetermined"],
      },
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
