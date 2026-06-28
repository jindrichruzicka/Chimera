// electron/preload/__tests__/fixtures/bad-cross-boundary-import.fixture.ts
//
// ESLint import-boundary smoke-test fixture (issue #777, F62).
//
// The preload bridge is the sole renderer-facing surface (Invariant #5) and
// depends on the @chimera-engine/simulation contract surface ONLY. It must never import
// the renderer UI library, the ai/networking runtime, a game package, or the
// electron main-process internals. Importing the renderer component barrel from a
// preload module is a deliberate violation that the preload `no-restricted-imports`
// zone in eslint.config.mjs must flag (Invariant #1/#5).
//
// This file is excluded from the normal lint run via the `ignores` glob in
// eslint.config.mjs; the eslint-import-boundary smoke test lints it explicitly
// with `--no-ignore`.

import '@chimera-engine/renderer/components/ui/index.js';
