/**
 * electron/main/saves/CompressedSaveSerializer.test.ts
 *
 * Tests for the async CompressedSaveSerializer (issue #137, §4.11).
 *
 * TDD cycle: written first — RED before the source file exists.
 *
 * Invariants upheld:
 *   #2 — CompressedSaveSerializer lives in electron/main/saves/ so that
 *          Node.js (node:zlib, node:util) imports stay outside simulation/.
 */

import { describe, expect, it } from 'vitest';
import { SaveParseError } from '@chimera/simulation/persistence/index.js';
import type { SaveFile } from '@chimera/simulation/persistence/index.js';
import type { GamePhase } from '@chimera/simulation/engine/types.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/index.js';
import { CompressedSaveSerializer } from './CompressedSaveSerializer.js';
import { JsonSaveSerializer } from '@chimera/simulation/persistence/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSaveFile(overrides: Partial<SaveFile> = {}): SaveFile {
    return {
        header: {
            schemaVersion: 1,
            engineVersion: '0.1.0',
            gameId: 'tactics',
            gameVersion: '0.1.0',
            slotId: 'slot-1',
            savedAt: 1_700_000_000_000,
            turnNumber: 3,
            playerNames: ['Alice', 'Bob'],
        },
        checkpoint: {
            tick: 5,
            seed: 99,
            players: {},
            entities: {},
            phase: 'playing' as GamePhase,
            events: [],
            turnNumber: 0,
            timers: {},
        },
        deltaActions: [],
        pendingCommitments: {},
        ...overrides,
    };
}

// ─── CompressedSaveSerializer ─────────────────────────────────────────────────

describe('CompressedSaveSerializer', () => {
    it('round-trip: serialize then deserialize returns a structurally equal SaveFile', async () => {
        const serializer = new CompressedSaveSerializer();
        const file = makeSaveFile();

        const raw = await serializer.serialize(file);
        const result = await serializer.deserialize(raw);

        expect(result).toStrictEqual(file);
    });

    it('serialize returns a Buffer', async () => {
        const serializer = new CompressedSaveSerializer();

        const raw = await serializer.serialize(makeSaveFile());

        expect(Buffer.isBuffer(raw)).toBe(true);
    });

    it('produces smaller output than JsonSaveSerializer for a non-trivial payload', async () => {
        const json = new JsonSaveSerializer();
        const compressed = new CompressedSaveSerializer();

        const file = makeSaveFile({
            header: {
                schemaVersion: 1,
                engineVersion: '0.1.0',
                gameId: 'tactics',
                gameVersion: '0.1.0',
                slotId: 'slot-1',
                savedAt: 1_700_000_000_000,
                turnNumber: 50,
                playerNames: Array.from(
                    { length: 100 },
                    (_, i) => `Player_${i.toString().padStart(3, '0')}_LongRepeatingName`,
                ),
            },
            deltaActions: Array.from({ length: 60 }, (_, i) => ({
                type: 'engine:end_turn',
                playerId: toPlayerId('player-1'),
                tick: i,
                payload: {},
            })),
        });

        const jsonRaw = await json.serialize(file);
        const jsonSize = Buffer.from(jsonRaw, 'utf8').length;
        const compressedSize = (await compressed.serialize(file)).length;

        expect(compressedSize).toBeLessThan(jsonSize);
    });

    it('deserialize accepts a Buffer', async () => {
        const serializer = new CompressedSaveSerializer();
        const file = makeSaveFile();

        const buf = await serializer.serialize(file);
        const result = await serializer.deserialize(buf);

        expect(result).toStrictEqual(file);
    });

    it('serialize is non-blocking — returns a Promise', () => {
        const serializer = new CompressedSaveSerializer();

        const result = serializer.serialize(makeSaveFile());

        expect(result).toBeInstanceOf(Promise);
    });

    it('deserialize is non-blocking — returns a Promise', async () => {
        const serializer = new CompressedSaveSerializer();
        const raw = await serializer.serialize(makeSaveFile());

        const result = serializer.deserialize(raw);

        expect(result).toBeInstanceOf(Promise);
    });

    it('deserialize rejects with an error when given non-gzip data', async () => {
        const serializer = new CompressedSaveSerializer();

        await expect(
            serializer.deserialize(Buffer.from('this is not gzip data', 'utf8')),
        ).rejects.toThrow();
    });

    it('round-trip preserves SaveFileHeader fields including optional thumbnailDataUrl', async () => {
        const serializer = new CompressedSaveSerializer();
        const file = makeSaveFile({
            header: {
                schemaVersion: 1,
                engineVersion: '0.1.0',
                gameId: 'tactics',
                gameVersion: '0.1.0',
                slotId: 'slot-1',
                savedAt: 1_700_000_000_000,
                turnNumber: 3,
                playerNames: ['Alice'],
                thumbnailDataUrl: 'data:image/png;base64,ABC==',
            },
        });

        const raw = await serializer.serialize(file);
        const result = await serializer.deserialize(raw);

        expect(result).toStrictEqual(file);
    });

    it('deserialize rejects with SaveParseError when decompressed bytes are invalid JSON', async () => {
        const { gzip } = await import('node:zlib');
        const { promisify } = await import('node:util');
        const gzipAsync = promisify(gzip);

        const serializer = new CompressedSaveSerializer();
        const corruptGzip = await gzipAsync(Buffer.from('not valid json', 'utf8'));

        await expect(serializer.deserialize(corruptGzip)).rejects.toBeInstanceOf(SaveParseError);
    });
});
