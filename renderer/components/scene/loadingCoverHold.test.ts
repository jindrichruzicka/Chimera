import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
    GameScreenProps,
    GameScreenRegistry,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { DEFAULT_LOADING_BEAT_FLOOR_MS, resolveLoadingBeatFloorMs } from './loadingCoverHold.js';

const Playfield = (_props: GameScreenProps): null => null;

function makeRegistry(overrides: Partial<GameScreenRegistry> = {}): GameScreenRegistry {
    return { playfield: Playfield, ...overrides };
}

function stubReducedMotionPreference(matches: boolean): void {
    vi.stubGlobal('window', {
        matchMedia: (query: string) => ({
            matches: query === '(prefers-reduced-motion: reduce)' && matches,
        }),
    });
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
});

describe('resolveLoadingBeatFloorMs', () => {
    it('returns a declared positive minimum outside e2e', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 700 });
        expect(resolveLoadingBeatFloorMs(registry)).toBe(700);
    });

    it('falls back to the engine default when the registry declares no minimum', () => {
        // An undeclared minimum is a beat of the DEFAULT length, never a beat
        // of no length: a cover whose only bound is its own two fades flashes
        // under reduced motion, where those fades are cuts.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        expect(resolveLoadingBeatFloorMs(makeRegistry())).toBe(DEFAULT_LOADING_BEAT_FLOOR_MS);
    });

    it('returns 0 for a declared 0 — the explicit opt-down to gate-settle-only', () => {
        // `0` is the one value that must NOT reach the default: it is how a
        // game says "show the cover, but only for as long as the load runs".
        // Folding it in with the invalid values is the mutant.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 0 });
        expect(resolveLoadingBeatFloorMs(registry)).toBe(0);
    });

    it.each([
        ['a negative minimum', -250],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
    ])('falls back to the engine default for %s', (_label, declared) => {
        // Registration already warns on each of these; the resolver's job is
        // to keep the beat readable rather than to punish the declaration.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: declared });
        expect(resolveLoadingBeatFloorMs(registry)).toBe(DEFAULT_LOADING_BEAT_FLOOR_MS);
    });

    it('collapses to 0 under the e2e flag, read at call time — stubbed after import, it still collapses', () => {
        // Read at CALL time, not at import: this module was
        // imported before the stub, so a module-level capture returns 700.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 700 });
        expect(resolveLoadingBeatFloorMs(registry)).toBe(0);
    });

    it('collapses the DEFAULT under the e2e flag too, not only a declared minimum', () => {
        // The undeclared path is the one a game reaches without opting in, so
        // a collapse that only covers the declared branch leaves every
        // scaffolded game waiting out the default in the e2e suite.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        expect(resolveLoadingBeatFloorMs(makeRegistry())).toBe(0);
    });

    it("does not collapse for an e2e flag value other than exactly '1'", () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '0');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 700 });
        expect(resolveLoadingBeatFloorMs(registry)).toBe(700);
    });

    it('deliberately does NOT collapse under prefers-reduced-motion', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        stubReducedMotionPreference(true);
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 700 });
        expect(resolveLoadingBeatFloorMs(registry)).toBe(700);
    });

    it('defaults to a floor long enough to read, and finite', () => {
        // The constant is the feature's product claim in one number: a beat
        // shorter than this reads as a flicker rather than as an explanation.
        expect(Number.isFinite(DEFAULT_LOADING_BEAT_FLOOR_MS)).toBe(true);
        expect(DEFAULT_LOADING_BEAT_FLOOR_MS).toBeGreaterThanOrEqual(400);
    });
});
