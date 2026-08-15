import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
    GameScreenProps,
    GameScreenRegistry,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { resolveLoadingCoverHoldMs } from './loadingCoverHold.js';

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
