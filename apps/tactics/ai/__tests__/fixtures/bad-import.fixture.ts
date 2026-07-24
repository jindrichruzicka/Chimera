// bad-import.fixture.ts
// Imports a forbidden layer to prove the module-boundary rule (Invariant #1)
// fires for per-game AI: AI code may depend only on the engine simulation/ai
// packages plus sibling-relative game modules — never networking, renderer, or
// electron. DO NOT import from production code — linted explicitly with
// `--no-ignore` by the zone guard test.
import * as forbidden from '@chimera-engine/networking';

export const value = forbidden;
