// renderer/__tests__/fixtures/good-contract-import.fixture.ts
//
// ESLint import-boundary smoke-test fixture (issue #772).
//
// The renderer's only @chimera-engine/* dependency is `@chimera-engine/simulation`, consumed
// as type-only contracts (Invariant #1). Importing it from renderer/ must NOT
// trip the boundary rule — this fixture proves the rule is not over-broad.
//
// Excluded from the normal lint run via the `ignores` glob in eslint.config.mjs;
// the eslint-import-boundary smoke test lints it explicitly with `--no-ignore`.

import type { LobbyState } from '@chimera-engine/simulation/foundation/messages-schemas.js';

export type Probe = LobbyState;
