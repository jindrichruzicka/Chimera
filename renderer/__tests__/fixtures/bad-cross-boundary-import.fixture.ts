// renderer/__tests__/fixtures/bad-cross-boundary-import.fixture.ts
//
// ESLint import-boundary smoke-test fixture (issue #772).
//
// `@chimera/renderer` depends on `@chimera/simulation` contracts only
// (Invariant #1): it must not import the `@chimera/ai` or `@chimera/networking`
// runtime. Importing `@chimera/ai` from renderer/ is a deliberate violation that
// the `no-restricted-imports` boundary rule must flag.
//
// This file is excluded from the normal lint run via the `ignores` glob in
// eslint.config.mjs; the eslint-import-boundary smoke test lints it explicitly
// with `--no-ignore`.

import '@chimera/ai';
