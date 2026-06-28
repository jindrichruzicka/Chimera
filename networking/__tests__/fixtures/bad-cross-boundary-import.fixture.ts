// networking/__tests__/fixtures/bad-cross-boundary-import.fixture.ts
//
// ESLint import-boundary smoke-test fixture (issue #768).
//
// `@chimera-engine/networking` depends on `@chimera-engine/simulation` ONLY (Invariant #1): it
// must not import the AI/UI/host/game layers. Importing `@chimera-engine/renderer` from
// networking/ is a deliberate violation that the `no-restricted-imports`
// boundary rule must flag.
//
// This file is excluded from the normal lint run via the `ignores` glob in
// eslint.config.mjs; the eslint-import-boundary smoke test lints it explicitly
// with `--no-ignore`.

import '@chimera-engine/renderer/components/ui/index.js';
