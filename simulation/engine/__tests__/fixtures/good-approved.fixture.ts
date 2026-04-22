// good-approved.fixture.ts
// This file should produce ZERO ESLint violations.
// It shows the approved pattern: ctx.rng.float() for randomness.
// DO NOT import this file from production code.

interface Rng {
    float(): number;
}

interface Ctx {
    rng: Rng;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function reduce(ctx: Ctx): number {
    return ctx.rng.float();
}
