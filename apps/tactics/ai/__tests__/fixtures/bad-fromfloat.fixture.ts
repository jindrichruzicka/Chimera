// bad-fromfloat.fixture.ts
// Exists only to trigger `chimera/no-fromfloat-in-simulation` for a per-game AI
// path (Invariant #76). This is the fixture that proves the rule's internal
// path guard fires on `apps/<game>/ai/` — widening only the config `files` glob
// without the guard would leave this GREEN (dead config). DO NOT import from
// production code — linted explicitly with `--no-ignore` by the zone guard test.
import { fromFloat } from '@chimera-engine/simulation/engine/FixedPoint';

export const value = fromFloat(2.5);
