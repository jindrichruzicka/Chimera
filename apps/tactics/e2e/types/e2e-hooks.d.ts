// e2e/types/e2e-hooks.d.ts
//
// Pulls the CHIMERA_E2E-gated `__e2eHooks` main-process global contract into the
// e2e type program. The declaration lives in electron/main/runtime/e2e-hooks.ts,
// but F62 (#777) made @chimera/electron a built package whose curated `exports`
// map deliberately does not surface main-process internals, and the root
// typecheck no longer compiles electron source. The e2e suite is a whitebox
// harness that bundles electron source at runtime and drives this test-only
// global via `typeof globalThis.__e2eHooks` (helpers/specs avoid a direct
// electron/main import), so this ambient references the electron dist build to
// keep `globalThis.__e2eHooks` typed. build:packages fronts the typecheck and the
// Playwright runner, so electron/dist exists first. F63 relocates the e2e suite
// into apps/tactics, which removes this cross-tree reference.
/// <reference path="../../../../electron/dist/main/runtime/e2e-hooks.d.ts" />
