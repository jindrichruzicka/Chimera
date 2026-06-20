// simulation/engine/__tests__/fixtures/bad-cross-boundary-import.fixture.ts
//
// ESLint import-boundary smoke-test fixture (issue #759).
//
// `@chimera/simulation` is the zero-dependency engine leaf (Invariant #1): it
// must not import any sibling workspace package. Importing `@chimera/networking`
// from simulation/ is a deliberate violation that the `no-restricted-imports`
// leaf rule must flag.
//
// This file is excluded from the normal lint run via the `ignores` glob in
// eslint.config.mjs; the eslint-import-boundary smoke test lints it explicitly
// with `--no-ignore`.

import '@chimera/networking/provider/MultiplayerProvider.js';
