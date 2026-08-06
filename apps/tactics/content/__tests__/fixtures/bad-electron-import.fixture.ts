// apps/tactics/content/__tests__/fixtures/bad-electron-import.fixture.ts
//
// ESLint import-boundary smoke-test fixture.
//
// A game's content descriptors' workspace imports are simulation/, ai/ and
// their own siblings only (coding-standards §3). The file headers in `apps/<game>/content/` and
// `apps/<game>/settings-schema.ts` state that boundary; the renderer half of it
// is held by `chimera/no-game-renderer-internals` on the `apps/**` zone, and
// this fixture exercises the electron arm on a content path — the arm those
// headers described before anything enforced it.
//
// Excluded from the normal lint run via the `ignores` glob in eslint.config.mjs;
// the apps-zone smoke test lints it explicitly with `--no-ignore`.

import '@chimera-engine/electron/main';

export const contentLeak = 1;
