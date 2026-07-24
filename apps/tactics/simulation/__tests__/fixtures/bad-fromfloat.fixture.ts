// bad-fromfloat.fixture.ts
// Exists only to trigger `chimera/no-fromfloat-in-simulation` for a per-game
// simulation hot path (Invariant #76). DO NOT import this file from production
// code — it is linted explicitly with `--no-ignore` by the zone guard test and
// is otherwise in the config's global ignores.
import { fromFloat } from '@chimera-engine/simulation/engine/FixedPoint';

export const value = fromFloat(1.5);
