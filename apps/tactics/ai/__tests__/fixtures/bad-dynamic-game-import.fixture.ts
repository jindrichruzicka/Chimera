// apps/tactics/ai/__tests__/fixtures/bad-dynamic-game-import.fixture.ts
//
// ESLint dynamic-import boundary smoke-test fixture.
//
// A game's own AI code depends on `@chimera-engine/simulation` plus its own
// sibling modules (Invariant #1) — never on ANOTHER game. This is the LAZY form
// of that ban, and no bash invariant check scans a game's AI tree for it;
// `tools/eslint-dynamic-games-import-zone.test.ts` — which lints this file —
// records why the static guard misses it.
//
// Excluded from the normal lint run via the `ignores` glob in eslint.config.mjs;
// the zone smoke test lints it explicitly with `--no-ignore`.

export const loadSiblingGame = (): Promise<unknown> =>
    import('../../../../../apps/other-game/ai/policy.js');
