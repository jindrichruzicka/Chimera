import { afterEach, describe, expect, it, vi } from 'vitest';

// Mirrors the component-gallery gate test: the deterministic (debug) replay
// surface is visible in every launch EXCEPT the packaged production app, keyed
// off the build-time `NEXT_PUBLIC_CHIMERA_PACKAGED` flag that only the
// `package:tactics*` scripts set.

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('areDeterministicReplaysVisible', () => {
    it('returns true in a non-packaged (debug/dev) build', async () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_PACKAGED', '');
        vi.resetModules();
        const { areDeterministicReplaysVisible } = await import('./deterministicReplayGate.js');
        expect(areDeterministicReplaysVisible()).toBe(true);
    });

    it('returns false in the packaged production build', async () => {
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_PACKAGED', '1');
        vi.resetModules();
        const { areDeterministicReplaysVisible } = await import('./deterministicReplayGate.js');
        expect(areDeterministicReplaysVisible()).toBe(false);
    });
});
