// renderer/__tests__/fixtures/bad-dynamic-game-import.fixture.ts
//
// ESLint dynamic-import boundary smoke-test fixture.
//
// `renderer/**` is wholly game-agnostic (Invariants #1, #94): a game's renderer
// contribution enters at the consumer-app composition root through the runtime
// registration seam, never by a renderer source import. This is the LAZY form of
// that ban; `tools/eslint-dynamic-games-import-zone.test.ts` — which lints this
// file — records why the static guard misses it.
//
// MEASURED on this path: no `chimera/no-shell-games-import` zone glob matches
// it and no bash Check scans it for a game specifier. What DOES report here is
// asserted by that suite, not claimed here.
//
// Excluded from the normal lint run via the `ignores` glob in eslint.config.mjs;
// the zone smoke test lints it explicitly with `--no-ignore`.

export const loadGame = (): Promise<unknown> =>
    import('../../../apps/tactics/screens/TacticsGameHud.js');
