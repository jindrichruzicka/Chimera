/**
 * electron/main/saves/SavesIpcAdapter.test.ts
 *
 * Verifies that the {@link createSavesIpcPort} adapter delegates to the
 * injected SaveManager and converts the simulation-side SaveSlotMeta into
 * the preload-side SaveSlotMeta shape consumed by the renderer.
 *
 * Saves the test from any FS / Electron coupling: the adapter only sees
 * `InMemorySaveRepository` (via SaveManager) and a hand-rolled capture
 * function fake.
 *
 * Architecture reference: §4.11
 * Task: F18 / issue #372
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { toSlotId } from '../../preload/api-types.js';
import type { SaveSlotMeta as PreloadSaveSlotMeta, SaveRequest } from '../../preload/api-types.js';
import { InMemorySaveRepository } from '@chimera-engine/simulation/persistence/InMemorySaveRepository.js';
import type { SaveFile } from '@chimera-engine/simulation/persistence/SaveFile.js';
import { SaveNotFoundError } from '@chimera-engine/simulation/persistence/SaveMigrator.js';
import { playerId } from '@chimera-engine/simulation/engine/index.js';
import { createNoopLogger } from '../logging/logger.js';
import { SaveManager } from './SaveManager.js';
import { createSavesIpcPort } from './SavesIpcAdapter.js';

const TACTICS = 'tactics';

function makeFile(
    slotId: string,
    savedAt: number,
    turnNumber: number,
    checkpointTick = turnNumber,
): SaveFile {
    return {
        header: {
            schemaVersion: 1,
            engineVersion: '0.0.0',
            gameId: TACTICS,
            gameVersion: '0.0.0',
            slotId,
            savedAt,
            turnNumber,
            playerNames: ['Alice', 'Bob'],
        },
        checkpoint: {
            tick: checkpointTick,
            engineMetadata: {
                gameId: TACTICS,
                version: 0,
                seed: 'seed',
                phase: 'lobby',
                turn: { current: turnNumber, total: turnNumber + 1 },
                rngState: 0,
            },
            players: [],
            // @chimera-review: minimal stub; SavesIpcAdapter only reads SaveFile.header —
            // checkpoint fields are never inspected by the code under test.
        } as unknown as SaveFile['checkpoint'],
        deltaActions: [],
        pendingCommitments: {},
        stagedReveals: {},
        session: {
            matchId: 'match-fixture',
            maxPlayers: 2,
            seats: [
                { playerId: playerId('Alice'), control: 'host', slotIndex: 0 },
                { playerId: playerId('Bob'), control: 'remote', slotIndex: 1 },
            ],
        },
    };
}

describe('createSavesIpcPort', () => {
    let repo: InMemorySaveRepository;
    let manager: SaveManager;
    let captured: SaveRequest[];
    let nextCaptured: SaveFile | null;
    let port: ReturnType<typeof createSavesIpcPort>;

    beforeEach(() => {
        repo = new InMemorySaveRepository();
        manager = new SaveManager(repo, createNoopLogger());
        captured = [];
        nextCaptured = null;
        port = createSavesIpcPort({
            saveManager: manager,
            captureSaveFile: async (req) => {
                captured.push(req);
                if (nextCaptured === null) {
                    throw new Error('test did not seed nextCaptured');
                }
                return nextCaptured;
            },
            logger: createNoopLogger(),
        });
    });

    describe('list', () => {
        it('returns an empty array when no slots exist', async () => {
            const result = await port.list(TACTICS);
            expect(result).toEqual([]);
        });

        it('maps simulation SaveSlotMeta into preload SaveSlotMeta shape', async () => {
            await repo.save(makeFile('alpha', 1_700_000_000_000, 7));
            await repo.save(makeFile('beta', 1_700_000_001_000, 11));

            const result = await port.list(TACTICS);

            // Sorted by savedAt desc (matches repository contract).
            expect(result).toHaveLength(2);
            const beta = result[0]!;
            const alpha = result[1]!;
            expect(beta).toMatchObject({
                slotId: toSlotId('tactics/beta'),
                gameId: TACTICS,
                tick: 11,
                savedAt: 1_700_000_001_000,
            } satisfies PreloadSaveSlotMeta);
            expect(alpha).toMatchObject({
                slotId: toSlotId('tactics/alpha'),
                gameId: TACTICS,
                tick: 7,
                savedAt: 1_700_000_000_000,
            } satisfies PreloadSaveSlotMeta);
            // Verify the exact keyset — no simulation-only fields
            // (turnNumber, playerNames, sizeBytes, schemaVersion) must
            // leak across the IPC boundary.
            expect(Object.keys(beta).sort()).toEqual(['gameId', 'savedAt', 'slotId', 'tick']);
        });

        it('maps tick from the saved checkpoint rather than the turn counter', async () => {
            await repo.save(makeFile('autosave', 1_700_000_004_000, 2, 7));

            const result = await port.list(TACTICS);

            expect(result[0]).toMatchObject({
                slotId: toSlotId('tactics/autosave'),
                gameId: TACTICS,
                tick: 7,
                savedAt: 1_700_000_004_000,
            } satisfies PreloadSaveSlotMeta);
        });
    });

    describe('save', () => {
        it('captures a SaveFile, persists it, and returns its preload SaveSlotMeta', async () => {
            nextCaptured = makeFile('quicksave', 1_700_000_002_000, 5);

            const request: SaveRequest = { gameId: TACTICS, label: 'Quick' };
            const meta = await port.save(request);

            expect(captured).toEqual([request]);
            expect(meta).toMatchObject({
                slotId: toSlotId('tactics/quicksave'),
                gameId: TACTICS,
                tick: 5,
                savedAt: 1_700_000_002_000,
            } satisfies PreloadSaveSlotMeta);
            // Persisted to the repository.
            const persisted = await repo.list(TACTICS);
            expect(persisted.map((m) => m.slotId)).toEqual(['tactics/quicksave']);
        });

        it('preserves the label when the request supplies one', async () => {
            nextCaptured = makeFile('slot-1', 1_700_000_003_000, 3);
            const meta = await port.save({ gameId: TACTICS, label: 'My Save' });
            expect(meta.label).toBe('My Save');
        });
    });

    describe('load', () => {
        it('delegates to the manager and resolves to undefined', async () => {
            await repo.save(makeFile('alpha', 1_700_000_000_000, 7));
            await expect(port.load(toSlotId('tactics/alpha'))).resolves.toBeUndefined();
        });

        it('propagates SaveNotFoundError when the slot does not exist', async () => {
            await expect(port.load(toSlotId('tactics/missing'))).rejects.toBeInstanceOf(
                SaveNotFoundError,
            );
        });

        it('awaits restoreSession with the loaded SaveFile when supplied', async () => {
            await repo.save(makeFile('alpha', 1_700_000_000_000, 7));
            const restored: SaveFile[] = [];
            let restoreSettled = false;
            const restorePort = createSavesIpcPort({
                saveManager: manager,
                captureSaveFile: () => Promise.reject(new Error('not used')),
                restoreSession: async (file) => {
                    restored.push(file);
                    // Force an extra microtask so a fire-and-forget call (missing
                    // await) would resolve load before this flag flips.
                    await Promise.resolve();
                    restoreSettled = true;
                },
                logger: createNoopLogger(),
            });

            await restorePort.load(toSlotId('tactics/alpha'));

            expect(restored).toHaveLength(1);
            expect(restored[0]?.header.slotId).toBe('alpha');
            expect(restored[0]?.header.gameId).toBe(TACTICS);
            expect(restoreSettled).toBe(true);
        });

        it('propagates a restoreSession rejection to the caller', async () => {
            await repo.save(makeFile('alpha', 1_700_000_000_000, 7));
            const restorePort = createSavesIpcPort({
                saveManager: manager,
                captureSaveFile: () => Promise.reject(new Error('not used')),
                restoreSession: () =>
                    Promise.reject(new Error('saves:load: this save belongs to a different match')),
                logger: createNoopLogger(),
            });

            await expect(restorePort.load(toSlotId('tactics/alpha'))).rejects.toThrow(
                /different match/,
            );
        });
    });

    describe('delete', () => {
        it('delegates to the manager and resolves to undefined', async () => {
            await repo.save(makeFile('alpha', 1_700_000_000_000, 7));
            await expect(port.delete(toSlotId('tactics/alpha'))).resolves.toBeUndefined();
            expect(await repo.has('tactics/alpha')).toBe(false);
        });

        it('propagates SaveNotFoundError when the slot does not exist', async () => {
            await expect(port.delete(toSlotId('tactics/missing'))).rejects.toBeInstanceOf(
                SaveNotFoundError,
            );
        });
    });
});
