import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
    GameScreenProps,
    GameScreenRegistry,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import {
    DEFAULT_LOADING_BEAT_FLOOR_MS,
    resolveLoadingBeatFloorMs,
    resolveLoadingCoverHoldMs,
} from './loadingCoverHold.js';

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

describe('resolveLoadingCoverHoldMs', () => {
    it('returns a declared positive minimum outside e2e', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 400 });
        expect(resolveLoadingCoverHoldMs(registry)).toBe(400);
    });

    it('returns 0 when the registry declares no minimum', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        expect(resolveLoadingCoverHoldMs(makeRegistry())).toBe(0);
    });

    it("returns 0 for a declared 0 — today's behaviour, explicitly", () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 0 });
        expect(resolveLoadingCoverHoldMs(registry)).toBe(0);
    });

    it('returns 0 for a negative minimum', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: -250 });
        expect(resolveLoadingCoverHoldMs(registry)).toBe(0);
    });

    it('returns 0 for NaN', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: Number.NaN });
        expect(resolveLoadingCoverHoldMs(registry)).toBe(0);
    });

    it('returns 0 for Infinity', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        const registry = makeRegistry({
            loadingScreenMinVisibleMs: Number.POSITIVE_INFINITY,
        });
        expect(resolveLoadingCoverHoldMs(registry)).toBe(0);
    });

    it('collapses to 0 under the e2e flag, read at call time — stubbed after import, it still collapses', () => {
        // The module was imported at the top of this file, BEFORE this stub: a
        // module-level env capture (the mutant) would return 400 here.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 400 });
        expect(resolveLoadingCoverHoldMs(registry)).toBe(0);
    });

    it("does not collapse for an e2e flag value other than exactly '1'", () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '0');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 400 });
        expect(resolveLoadingCoverHoldMs(registry)).toBe(400);
    });

    it('deliberately does NOT collapse under prefers-reduced-motion', () => {
        // Zeroed fades make the flash strictly WORSE under reduced motion, so
        // unlike screenFadeMs() the minimum stands; collapsing here is the mutant.
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        stubReducedMotionPreference(true);
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 400 });
        expect(resolveLoadingCoverHoldMs(registry)).toBe(400);
    });
});

describe('resolveLoadingBeatFloorMs', () => {
    it('returns a declared positive minimum outside e2e', () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');
        const registry = makeRegistry({ loadingScreenMinVisibleMs: 700 });
        expect(resolveLoadingBeatFloorMs(registry)).toBe(700);
    });

    it('falls back to the engine default when the registry declares no minimum', () => {
        // The difference from resolveLoadingCoverHoldMs that this function
        // exists for: an undeclared minimum is a beat of the default length,
        // never a beat of no length. A cover whose only bound is its own two
        // fades flashes under reduced motion, where those fades are cuts.
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
        // Same call-time read as resolveLoadingCoverHoldMs: this module was
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
