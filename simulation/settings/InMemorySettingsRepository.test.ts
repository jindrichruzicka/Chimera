import { describe, it, expect, beforeEach } from 'vitest';
import type { SettingsRepository } from './SettingsRepository';
import { InMemorySettingsRepository } from './InMemorySettingsRepository';

/**
 * Contract tests for SettingsRepository — every concrete implementation must
 * pass these tests.  The factory function is the only thing that differs
 * between suites.
 */
function runRepositoryContractTests(label: string, makeRepo: () => SettingsRepository): void {
    describe(label, () => {
        let repo: SettingsRepository;

        beforeEach(() => {
            repo = makeRepo();
        });

        it('returns an empty object for a game with no saved settings', async () => {
            const result = await repo.load('tactics');
            expect(result).toEqual({});
        });

        it('returns empty object for each new unknown gameId independently', async () => {
            const r1 = await repo.load('tactics');
            const r2 = await repo.load('chess');
            expect(r1).toEqual({});
            expect(r2).toEqual({});
        });

        it('persists overrides after save()', async () => {
            await repo.save('tactics', { audio: { masterVolume: 0.5 } });
            const result = await repo.load('tactics');
            expect(result).toEqual({ audio: { masterVolume: 0.5 } });
        });

        it('overwrites entire override object on subsequent save()', async () => {
            await repo.save('tactics', { audio: { masterVolume: 0.5 } });
            await repo.save('tactics', { display: { targetFps: 30 } });
            const result = await repo.load('tactics');
            expect(result).toEqual({ display: { targetFps: 30 } });
        });

        it('isolates different gameId namespaces', async () => {
            await repo.save('tactics', { audio: { masterVolume: 0.5 } });
            await repo.save('chess', { audio: { masterVolume: 0.9 } });
            expect(await repo.load('tactics')).toEqual({ audio: { masterVolume: 0.5 } });
            expect(await repo.load('chess')).toEqual({ audio: { masterVolume: 0.9 } });
        });

        it('reset() makes the next load() return an empty object', async () => {
            await repo.save('tactics', { audio: { muted: true } });
            await repo.reset('tactics');
            const result = await repo.load('tactics');
            expect(result).toEqual({});
        });

        it('reset() on an unknown gameId does not throw', async () => {
            await expect(repo.reset('never-saved')).resolves.toBeUndefined();
        });

        it('load() returns a new object reference on each call (no aliasing)', async () => {
            await repo.save('tactics', { audio: { masterVolume: 0.5 } });
            const a = await repo.load('tactics');
            const b = await repo.load('tactics');
            expect(a).not.toBe(b);
        });

        it('mutations to a loaded object do not affect the stored value', async () => {
            await repo.save('tactics', { audio: { masterVolume: 0.5 } });
            const loaded = (await repo.load('tactics')) as { audio: { masterVolume: number } };
            loaded.audio.masterVolume = 9.9;
            const second = (await repo.load('tactics')) as { audio: { masterVolume: number } };
            expect(second.audio.masterVolume).toBe(0.5);
        });
    });
}

// Run the contract tests against InMemorySettingsRepository
runRepositoryContractTests('InMemorySettingsRepository', () => new InMemorySettingsRepository());
