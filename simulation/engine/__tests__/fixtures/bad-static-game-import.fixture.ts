// simulation/engine/__tests__/fixtures/bad-static-game-import.fixture.ts
//
// ESLint dynamic-import boundary smoke-test fixture — the STATIC twin.
//
// Character for character the same forbidden dependency as
// `bad-dynamic-game-import.fixture.ts`, in the static specifier position. The
// pair is what lets one check assert that neither guard subsumes the other:
// with the same specifier on both sides, each rule's silence on the other's
// fixture turns on POSITION and nothing else. A static fixture naming some
// other forbidden module would make the dynamic rule's silence a fact about the
// specifier instead, and the assertion would hold for the wrong reason.
//
// Excluded from the normal lint run via the `ignores` glob in eslint.config.mjs;
// the zone smoke test lints it explicitly with `--no-ignore`.

import { constants } from '../../../../apps/tactics/simulation/constants.js';

export const gameConstants = constants;
