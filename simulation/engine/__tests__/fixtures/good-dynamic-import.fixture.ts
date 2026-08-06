// simulation/engine/__tests__/fixtures/good-dynamic-import.fixture.ts
//
// ESLint dynamic-import boundary smoke-test fixture — the NEGATIVE control.
//
// `chimera/no-dynamic-games-import` bans a lazy load that names a GAME, not
// lazy loading as such. A rule that reported here would be unusable in this
// zone; without this fixture, a rule switched off entirely would look the same
// as one that fires precisely.
//
// This file is excluded from the normal lint run via the `ignores` glob in
// eslint.config.mjs; the zone smoke test lints it explicitly with `--no-ignore`.

export const loadPipeline = (): Promise<unknown> => import('../../ActionPipeline.js');
