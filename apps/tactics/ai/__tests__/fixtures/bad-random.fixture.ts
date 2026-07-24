// bad-random.fixture.ts
// Exists only to trigger the `no-restricted-syntax` determinism rule for a
// per-game AI path (Invariant #43). DO NOT import from production code — linted
// explicitly with `--no-ignore` by the zone guard test.

export function decide(): number {
    return Math.random();
}
