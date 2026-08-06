// electron/preload/__tests__/fixtures/bad-dynamic-game-import.fixture.ts
//
// ESLint dynamic-import boundary smoke-test fixture.
//
// The preload bridge is the sole renderer-facing surface (Invariant #5), and
// `@chimera-engine/simulation` is its only workspace dependency (Invariant #1):
// it must not pull a game into the sandboxed preload. This is the LAZY form of
// that ban, and no bash invariant check scans this directory for it;
// `tools/eslint-dynamic-games-import-zone.test.ts` — which lints this file —
// records why the static guard misses it.
//
// Excluded from the normal lint run via the `ignores` glob in eslint.config.mjs;
// the zone smoke test lints it explicitly with `--no-ignore`.

export const loadGame = (): Promise<unknown> => import('../../../../apps/tactics/actions/index.js');
