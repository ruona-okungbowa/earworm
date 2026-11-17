# Tech

## Rules

- Do not add a dependency without asking first.
- Use TypeScript in strict mode (root `tsconfig.json`), ESM only, npm workspaces.
- Keep TypeScript on 6.x. dependency-cruiser does not support 7.0.
- All times are milliseconds on the audio context clock.
- Pure functions take time as a parameter. They never read `Date.now`, `performance.now` or `AudioContext.currentTime`.
- Respect package boundaries. dependency-cruiser enforces them.
- `@earworm/core` must stay pure: no DOM, no React. It runs in Node and in the AudioWorklet.
- React is a peer dependency of `@earworm/ui`, not a regular dependency.
- Tests live in `tests/` at the root and run with Vitest.
- Tests import packages by name (`@earworm/core`), never via `../packages/...`.
- Property tests use fast-check with at least 100 runs locally and 200 in CI.
- Detector changes must pass the recorded fixtures in `fixtures/recorded`.

## Packages

- `@earworm/core`: pure logic, runs in Node and the AudioWorklet.
- `@earworm/browser`: Web Audio, mic, worklet, tap, synth, gate.
- `@earworm/ui`: React 19 components and hooks.
- Apps: Vite + React.

## Commands

- `npm test`: run Vitest.
- `npm run typecheck`: type-check the workspace.
- `npm run lint:deps`: check package boundaries with dependency-cruiser.
