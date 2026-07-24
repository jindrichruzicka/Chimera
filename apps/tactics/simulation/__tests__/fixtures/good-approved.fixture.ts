// good-approved.fixture.ts
// Should produce ZERO ESLint violations. Shows the approved per-game pattern:
// seeded `ctx.rng` for randomness, integer arithmetic — no fromFloat(), no
// Math.random(). DO NOT import this file from production code.

interface Rng {
    int(maxExclusive: number): number;
}

interface Ctx {
    rng: Rng;
}

export function decide(ctx: Ctx): number {
    return ctx.rng.int(6);
}
