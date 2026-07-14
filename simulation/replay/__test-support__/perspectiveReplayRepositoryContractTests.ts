/**
 * simulation/replay/__test-support__/perspectiveReplayRepositoryContractTests.ts
 *
 * Shared PerspectiveReplayRepository contract test suite — reusable across every
 * implementation (§4.28, ADR F44b, invariant #41).
 *
 * Usage:
 *   import { runPerspectiveReplayRepositoryContractTests } from './__test-support__/perspectiveReplayRepositoryContractTests.js';
 *   runPerspectiveReplayRepositoryContractTests('MyRepository', () => new MyRepository());
 *
 * As with the deterministic suite, `save()` assigns and returns the storage
 * path, so the tests capture that path and feed it back into `load()` /
 * `delete()`. Deliberately narrower than the deterministic suite: no `listItems`.
 */

import { describe, expect, it } from 'vitest';
import type { PerspectiveReplayRepository } from '../PerspectiveReplayRepository.js';
import { ReplayNotFoundError } from '../PerspectiveReplayRepository.js';
import type { PerspectiveReplayFile, PerspectiveReplayFrame } from '../PerspectiveReplayFile.js';
import type { PlayerSnapshot } from '../../projection/StateProjector.js';
import { playerId as toPlayerId, gamePhase } from '../../engine/types.js';

// ── Shared test factory ────────────────────────────────────────────────────────

/**
 * A minimal valid projected `PlayerSnapshot` for `viewerId` at `tick`. Mirrors
 * `makeStubPlayerSnapshot` but with a caller-chosen viewer so the frame passes
 * the file's locked-viewerId check (invariant #98).
 */
function makeSnapshot(viewerId: ReturnType<typeof toPlayerId>, tick: number): PlayerSnapshot {
    return {
        tick,
        viewerId,
        phase: gamePhase('playing'),
        players: {},
        entities: {},
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: tick % 2 === 0,
    };
}

/**
 * Build a minimal valid PerspectiveReplayFile with three strictly-increasing
 * frames (ticks 0,1,2). `recordedAt` controls the newest-first ordering asserted
 * by the `list` contract.
 */
export function makePerspectiveReplayFile(
    gameId: string,
    recordedAt = '2026-06-02T10:00:00.000Z',
    overrides: Partial<PerspectiveReplayFile> = {},
): PerspectiveReplayFile {
    const viewerId = toPlayerId('p1');
    const frames: PerspectiveReplayFrame[] = [0, 1, 2].map((tick) => ({
        tick,
        snapshot: makeSnapshot(viewerId, tick),
    }));
    return {
        formatVersion: 1,
        kind: 'perspective',
        engineVersion: '0.1.0',
        gameId,
        gameVersion: '0.1.0',
        viewerId,
        recordedAt,
        durationTicks: 2,
        players: [{ playerId: viewerId, displayName: 'Player One' }],
        frames,
        ...overrides,
    };
}

/**
 * Run the full PerspectiveReplayRepository contract suite against the provided
 * factory.
 */
export function runPerspectiveReplayRepositoryContractTests(
    name: string,
    factory: () => PerspectiveReplayRepository,
): void {
    describe(`${name} — PerspectiveReplayRepository contract`, () => {
        // ── list ─────────────────────────────────────────────────────────────

        it('list returns an empty array for an unknown gameId', async () => {
            const repo = factory();

            expect(await repo.list('unknown-game')).toStrictEqual([]);
        });

        // ── save + load round-trip ────────────────────────────────────────────

        it('save returns a non-empty path and load round-trips the file', async () => {
            const repo = factory();
            const file = makePerspectiveReplayFile('tactics');

            const path = await repo.save(file);
            expect(typeof path).toBe('string');
            expect(path.length).toBeGreaterThan(0);

            const loaded = await repo.load(path);
            // toMatchObject: implementations may attach computed fields.
            expect(loaded).toMatchObject({
                formatVersion: 1,
                kind: 'perspective',
                gameId: 'tactics',
                viewerId: file.viewerId,
            });
            expect(loaded.frames).toHaveLength(3);
            expect(loaded.frames.map((f) => f.tick)).toStrictEqual([0, 1, 2]);
            // Every frame stays locked to the file's viewer (invariant #98).
            for (const frame of loaded.frames) {
                expect(frame.snapshot.viewerId).toBe(file.viewerId);
                expect(frame.snapshot.tick).toBe(frame.tick);
            }
        });

        it('load returns an isolated copy, not a shared reference', async () => {
            const repo = factory();
            const path = await repo.save(makePerspectiveReplayFile('tactics'));

            const first = await repo.load(path);
            const second = await repo.load(path);

            // Each load must hand back a distinct object so a caller mutating one
            // result cannot corrupt the stored replay or another caller's copy.
            // The file repository parses fresh bytes each time; the in-memory
            // double must clone to match that copy semantics (invariant #41).
            expect(first).not.toBe(second);
            expect(first.frames).not.toBe(second.frames);
            expect(first).toStrictEqual(second);
        });

        it('save never overwrites — two saves yield two distinct paths', async () => {
            const repo = factory();

            const pathA = await repo.save(makePerspectiveReplayFile('tactics'));
            const pathB = await repo.save(makePerspectiveReplayFile('tactics'));

            expect(pathA).not.toBe(pathB);
            expect(await repo.list('tactics')).toHaveLength(2);
        });

        // ── list ordering & filtering ──────────────────────────────────────────

        it('list returns saved items newest-first by recordedAt', async () => {
            const repo = factory();
            const oldPath = await repo.save(
                makePerspectiveReplayFile('tactics', '2026-01-01T00:00:00.000Z'),
            );
            const newPath = await repo.save(
                makePerspectiveReplayFile('tactics', '2026-06-01T00:00:00.000Z'),
            );
            const midPath = await repo.save(
                makePerspectiveReplayFile('tactics', '2026-03-01T00:00:00.000Z'),
            );

            const items = await repo.list('tactics');

            expect(items.map((item) => item.path)).toStrictEqual([newPath, midPath, oldPath]);
        });

        it('list projects the stored name — present verbatim, absent as undefined', async () => {
            const repo = factory();
            const namedPath = await repo.save(
                makePerspectiveReplayFile('tactics', '2026-06-01T00:00:00.000Z', {
                    name: 'My Point of View',
                }),
            );
            const unnamedPath = await repo.save(
                makePerspectiveReplayFile('tactics', '2026-01-01T00:00:00.000Z'),
            );

            const items = await repo.list('tactics');

            const named = items.find((item) => item.path === namedPath);
            const unnamed = items.find((item) => item.path === unnamedPath);
            expect(named?.name).toBe('My Point of View');
            expect(unnamed?.name).toBeUndefined();
        });

        it('list filters by gameId and excludes other games', async () => {
            const repo = factory();
            await repo.save(makePerspectiveReplayFile('tactics'));
            await repo.save(makePerspectiveReplayFile('chess'));

            expect(await repo.list('tactics')).toHaveLength(1);
            expect(await repo.list('chess')).toHaveLength(1);
        });

        // ── delete ────────────────────────────────────────────────────────────

        it('delete removes the replay from list', async () => {
            const repo = factory();
            const path = await repo.save(makePerspectiveReplayFile('tactics'));

            await repo.delete(path);

            expect(await repo.list('tactics')).toHaveLength(0);
        });

        // ── not-found behaviour ─────────────────────────────────────────────────

        it('load throws ReplayNotFoundError when the path is absent', async () => {
            const repo = factory();
            const path = await repo.save(makePerspectiveReplayFile('tactics'));
            await repo.delete(path);

            await expect(repo.load(path)).rejects.toBeInstanceOf(ReplayNotFoundError);
        });

        it('delete throws ReplayNotFoundError when the path is absent', async () => {
            const repo = factory();
            const path = await repo.save(makePerspectiveReplayFile('tactics'));
            await repo.delete(path);

            await expect(repo.delete(path)).rejects.toBeInstanceOf(ReplayNotFoundError);
        });
    });
}
