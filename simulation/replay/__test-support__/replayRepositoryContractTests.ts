/**
 * simulation/replay/__test-support__/replayRepositoryContractTests.ts
 *
 * Shared ReplayRepository contract test suite — reusable across every
 * ReplayRepository implementation (§4.28, invariant #41).
 *
 * Usage:
 *   import { runReplayRepositoryContractTests } from './__test-support__/replayRepositoryContractTests.js';
 *   runReplayRepositoryContractTests('MyRepository', () => new MyRepository());
 *
 * Unlike saves, `save()` assigns and returns the storage path, so the tests
 * capture that path and feed it back into `load()` / `delete()`.
 */

import { describe, expect, it } from 'vitest';
import type { ReplayRepository } from '../ReplayRepository.js';
import { ReplayNotFoundError } from '../ReplayRepository.js';
import type { ReplayFile } from '../ReplayFile.js';
import { playerId as toPlayerId } from '../../engine/types.js';

// ── Shared test factory ────────────────────────────────────────────────────────

/**
 * Build a minimal valid ReplayFile. `recordedAt` controls the newest-first
 * ordering asserted by the `list` contract.
 */
export function makeReplayFile(
    gameId: string,
    recordedAt = '2026-06-02T10:00:00.000Z',
    overrides: Partial<ReplayFile> = {},
): ReplayFile {
    return {
        formatVersion: 1,
        engineVersion: '0.1.0',
        gameId,
        gameVersion: '0.1.0',
        gameConfig: { mapSize: 10 },
        seed: 42,
        actions: [
            {
                tick: 0,
                playerId: toPlayerId('p1'),
                action: {
                    type: 'engine:end_turn',
                    playerId: toPlayerId('p1'),
                    tick: 0,
                    payload: {},
                },
            },
        ],
        metadata: {
            recordedAt,
            durationTicks: 1,
            players: [{ playerId: toPlayerId('p1'), displayName: 'Player One' }],
        },
        ...overrides,
    };
}

/**
 * Run the full ReplayRepository contract suite against the provided factory.
 */
export function runReplayRepositoryContractTests(
    name: string,
    factory: () => ReplayRepository,
): void {
    describe(`${name} — ReplayRepository contract`, () => {
        // ── list ─────────────────────────────────────────────────────────────

        it('list returns an empty array for an unknown gameId', async () => {
            const repo = factory();

            expect(await repo.list('unknown-game')).toStrictEqual([]);
        });

        // ── save + load round-trip ────────────────────────────────────────────

        it('save returns a non-empty path and load round-trips the file', async () => {
            const repo = factory();
            const file = makeReplayFile('tactics');

            const path = await repo.save(file);
            expect(typeof path).toBe('string');
            expect(path.length).toBeGreaterThan(0);

            const loaded = await repo.load(path);
            // toMatchObject: implementations may attach computed fields.
            expect(loaded).toMatchObject({
                formatVersion: 1,
                gameId: 'tactics',
                seed: 42,
            });
            expect(loaded.actions).toHaveLength(1);
        });

        it('save never overwrites — two saves yield two distinct paths', async () => {
            const repo = factory();

            const pathA = await repo.save(makeReplayFile('tactics'));
            const pathB = await repo.save(makeReplayFile('tactics'));

            expect(pathA).not.toBe(pathB);
            expect(await repo.list('tactics')).toHaveLength(2);
        });

        // ── list ordering & filtering ──────────────────────────────────────────

        it('list returns saved paths newest-first by recordedAt', async () => {
            const repo = factory();
            const oldPath = await repo.save(makeReplayFile('tactics', '2026-01-01T00:00:00.000Z'));
            const newPath = await repo.save(makeReplayFile('tactics', '2026-06-01T00:00:00.000Z'));
            const midPath = await repo.save(makeReplayFile('tactics', '2026-03-01T00:00:00.000Z'));

            const paths = await repo.list('tactics');

            expect(paths).toStrictEqual([newPath, midPath, oldPath]);
        });

        it('list filters by gameId and excludes other games', async () => {
            const repo = factory();
            await repo.save(makeReplayFile('tactics'));
            await repo.save(makeReplayFile('chess'));

            expect(await repo.list('tactics')).toHaveLength(1);
            expect(await repo.list('chess')).toHaveLength(1);
        });

        // ── listItems (enriched, single-read projection) ────────────────────────

        it('listItems returns an empty array for an unknown gameId', async () => {
            const repo = factory();

            expect(await repo.listItems('unknown-game')).toStrictEqual([]);
        });

        it('listItems returns enriched entries newest-first with projected fields', async () => {
            const repo = factory();
            const oldPath = await repo.save(makeReplayFile('tactics', '2026-01-01T00:00:00.000Z'));
            const newPath = await repo.save(makeReplayFile('tactics', '2026-06-01T00:00:00.000Z'));

            const items = await repo.listItems('tactics');

            expect(items.map((i) => i.path)).toStrictEqual([newPath, oldPath]);
            expect(items[0]).toStrictEqual({
                path: newPath,
                engineVersion: '0.1.0',
                gameId: 'tactics',
                gameVersion: '0.1.0',
                recordedAt: '2026-06-01T00:00:00.000Z',
                durationTicks: 1,
                playerIds: [toPlayerId('p1')],
            });
        });

        it('listItems filters by gameId and excludes other games', async () => {
            const repo = factory();
            await repo.save(makeReplayFile('tactics'));
            await repo.save(makeReplayFile('chess'));

            const tacticsItems = await repo.listItems('tactics');
            expect(tacticsItems).toHaveLength(1);
            expect(tacticsItems[0]?.gameId).toBe('tactics');
        });

        it('listItems projects the user-entered metadata.name when present', async () => {
            const repo = factory();
            await repo.save(
                makeReplayFile('tactics', '2026-06-01T00:00:00.000Z', {
                    metadata: {
                        recordedAt: '2026-06-01T00:00:00.000Z',
                        durationTicks: 1,
                        players: [{ playerId: toPlayerId('p1'), displayName: 'Player One' }],
                        name: 'Grand Finale',
                    },
                }),
            );

            const items = await repo.listItems('tactics');

            expect(items[0]?.name).toBe('Grand Finale');
        });

        // ── delete ────────────────────────────────────────────────────────────

        it('delete removes the replay from list', async () => {
            const repo = factory();
            const path = await repo.save(makeReplayFile('tactics'));

            await repo.delete(path);

            expect(await repo.list('tactics')).toHaveLength(0);
        });

        // ── not-found behaviour ─────────────────────────────────────────────────

        it('load throws ReplayNotFoundError when the path is absent', async () => {
            const repo = factory();
            const path = await repo.save(makeReplayFile('tactics'));
            await repo.delete(path);

            await expect(repo.load(path)).rejects.toBeInstanceOf(ReplayNotFoundError);
        });

        it('delete throws ReplayNotFoundError when the path is absent', async () => {
            const repo = factory();
            const path = await repo.save(makeReplayFile('tactics'));
            await repo.delete(path);

            await expect(repo.delete(path)).rejects.toBeInstanceOf(ReplayNotFoundError);
        });
    });
}
