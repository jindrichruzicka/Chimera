// ai/engine/__tests__/fixtures/bad-dynamic-game-import.fixture.ts
//
// ESLint dynamic-import boundary smoke-test fixture.
//
// `@chimera-engine/simulation` is `@chimera-engine/ai`'s only workspace
// dependency (Invariant #1), and it must not name a game. This is the LAZY form
// of that ban;
// `tools/eslint-dynamic-games-import-zone.test.ts` — which lints this file —
// records why the static guard misses it.
//
// Excluded from the normal lint run via the `ignores` glob in eslint.config.mjs;
// the zone smoke test lints it explicitly with `--no-ignore`.

export const loadGame = (): Promise<unknown> => import('../../../../apps/tactics/ai/heuristics.js');
