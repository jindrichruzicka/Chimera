/**
 * simulation/persistence/__test-support__/saveRepositoryContractTests.ts
 *
 * Shared SaveRepository contract test suite — reusable across every
 * SaveRepository implementation (§4.11, invariant #41).
 *
 * Usage:
 *   import { runSaveRepositoryContractTests } from './__test-support__/saveRepositoryContractTests.js';
 *   runSaveRepositoryContractTests('MyRepository', () => new MyRepository());
 *
 * Tests cover the full SaveRepository contract:
 *   - list: empty for unknown game; returns metas sorted by savedAt desc; filters by gameId
 *   - save + load round-trip; overwrite behaviour
 *   - has: false before save, true after
 *   - delete: removes slot; throws SaveNotFoundError when absent
 *   - load: throws SaveNotFoundError when absent
 */

import { describe, expect, it } from 'vitest';
import type { SaveRepository } from '../SaveRepository.js';
import { CURRENT_SCHEMA_VERSION, SaveNotFoundError } from '../SaveMigrator.js';
import type { SaveFile } from '../SaveFile.js';
import type { GamePhase } from '../../engine/types.js';

// ── Shared test factory ────────────────────────────────────────────────────────

/**
 * Build a minimal valid SaveFile for test purposes.
 * `slotId` is the SHORT form (e.g. 'autosave'); the repository is
 * responsible for storing it under the qualified key `${gameId}/${slotId}`.
 */
export function makeFile(gameId: string, slotId: string, savedAt = 1_700_000_000_000): SaveFile {
    return {
        header: {
            schemaVersion: CURRENT_SCHEMA_VERSION,
            engineVersion: '0.1.0',
            gameId,
            gameVersion: '0.1.0',
            slotId,
            savedAt,
            turnNumber: 1,
            playerNames: ['Alice', 'Bob'],
        },
        checkpoint: {
            tick: 1,
            seed: 42,
            players: {},
            entities: {},
            phase: 'playing' as GamePhase,
            events: [],
            turnNumber: 0,
        },
        deltaActions: [],
        pendingCommitments: {},
    };
}

/**
 * Run the full SaveRepository contract test suite against the provided
 * factory function. Call this in any test file that wants to validate a
 * SaveRepository implementation.
 */
export function runSaveRepositoryContractTests(name: string, factory: () => SaveRepository): void {
    describe(`${name} — SaveRepository contract`, () => {
        // ── list ─────────────────────────────────────────────────────────────

        it('list returns an empty array for an unknown gameId', async () => {
            const repo = factory();

            expect(await repo.list('unknown-game')).toStrictEqual([]);
        });

        it('list returns a meta entry after save', async () => {
            const repo = factory();
            const file = makeFile('tactics', 'autosave');

            await repo.save(file);
            const slots = await repo.list('tactics');

            expect(slots).toHaveLength(1);
            expect(slots[0]?.gameId).toBe('tactics');
            expect(slots[0]?.slotId).toBe('tactics/autosave');
            expect(slots[0]?.savedAt).toBe(1_700_000_000_000);
            expect(slots[0]?.turnNumber).toBe(1);
            expect(slots[0]?.playerNames).toStrictEqual(['Alice', 'Bob']);
            expect(slots[0]?.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
        });

        it('list returns entries sorted by savedAt descending', async () => {
            const repo = factory();
            await repo.save(makeFile('tactics', 'slot-1', 1_000));
            await repo.save(makeFile('tactics', 'slot-2', 3_000));
            await repo.save(makeFile('tactics', 'slot-3', 2_000));

            const slots = await repo.list('tactics');

            expect(slots.map((s) => s.savedAt)).toStrictEqual([3_000, 2_000, 1_000]);
        });

        it('list filters by gameId and excludes other games', async () => {
            const repo = factory();
            await repo.save(makeFile('tactics', 'autosave'));
            await repo.save(makeFile('chess', 'autosave'));

            const tacticsSlots = await repo.list('tactics');
            const chessSlots = await repo.list('chess');

            expect(tacticsSlots).toHaveLength(1);
            expect(tacticsSlots[0]?.gameId).toBe('tactics');
            expect(chessSlots).toHaveLength(1);
            expect(chessSlots[0]?.gameId).toBe('chess');
        });

        // ── save + load round-trip ────────────────────────────────────────────

        it('load returns the saved file', async () => {
            const repo = factory();
            const file = makeFile('tactics', 'autosave');

            await repo.save(file);
            const loaded = await repo.load('tactics/autosave');

            // Use toMatchObject rather than toStrictEqual: implementations may
            // attach additional computed fields (e.g. header.checksum) to the
            // persisted file without violating the contract.
            expect(loaded).toMatchObject(file);
        });

        it('save overwrites an existing slot silently', async () => {
            const repo = factory();
            const file1 = makeFile('tactics', 'slot-1', 1_000);
            const file2 = makeFile('tactics', 'slot-1', 2_000);

            await repo.save(file1);
            await repo.save(file2);
            const loaded = await repo.load('tactics/slot-1');

            expect(loaded.header.savedAt).toBe(2_000);
        });

        // ── load: not found ───────────────────────────────────────────────────

        it('load throws SaveNotFoundError when slot is absent', async () => {
            const repo = factory();

            await expect(repo.load('tactics/missing')).rejects.toBeInstanceOf(SaveNotFoundError);
        });

        it('load throws SaveNotFoundError with the requested slotId', async () => {
            const repo = factory();

            try {
                await repo.load('tactics/missing-slot');
                expect.fail('Expected SaveNotFoundError');
            } catch (err) {
                expect(err).toBeInstanceOf(SaveNotFoundError);
                expect((err as SaveNotFoundError).slotId).toBe('tactics/missing-slot');
            }
        });

        // ── has ───────────────────────────────────────────────────────────────

        it('has returns false when slot is absent', async () => {
            const repo = factory();

            expect(await repo.has('tactics/absent')).toBe(false);
        });

        it('has returns true after save', async () => {
            const repo = factory();
            await repo.save(makeFile('tactics', 'autosave'));

            expect(await repo.has('tactics/autosave')).toBe(true);
        });

        it('has returns false after delete', async () => {
            const repo = factory();
            await repo.save(makeFile('tactics', 'autosave'));
            await repo.delete('tactics/autosave');

            expect(await repo.has('tactics/autosave')).toBe(false);
        });

        // ── delete ────────────────────────────────────────────────────────────

        it('delete removes the slot from list', async () => {
            const repo = factory();
            await repo.save(makeFile('tactics', 'autosave'));

            await repo.delete('tactics/autosave');
            const slots = await repo.list('tactics');

            expect(slots).toHaveLength(0);
        });

        it('delete throws SaveNotFoundError when slot is absent', async () => {
            const repo = factory();

            await expect(repo.delete('tactics/absent')).rejects.toBeInstanceOf(SaveNotFoundError);
        });
    });
}
