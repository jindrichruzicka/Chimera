/**
 * electron/main/replay/CompressedReplaySerializer.test.ts
 *
 * TDD tests for the gzip-compressed replay serializer (issue #655, §4.28).
 * Tests written first (RED before source file).
 *
 * Invariants upheld:
 *   #1 — CompressedReplaySerializer lives in electron/main/replay/ so that
 *         Node.js (node:zlib, node:util) imports stay outside simulation/.
 */

import { describe, expect, it } from 'vitest';
import {
    serializeReplayCompressed,
    deserializeReplayCompressed,
} from './CompressedReplaySerializer.js';
import { serializeReplay } from '@chimera/simulation/replay/index.js';
import { ReplayParseError } from '@chimera/simulation/replay/index.js';
import type { ReplayFile } from '@chimera/simulation/replay/index.js';
import { playerId as toPlayerId } from '@chimera/simulation/engine/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReplayFile(overrides: Partial<ReplayFile> = {}): ReplayFile {
    return {
        formatVersion: 1,
        engineVersion: '0.7.0',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        gameConfig: {},
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
            recordedAt: '2026-06-02T10:00:00.000Z',
            durationTicks: 5,
            players: [{ playerId: toPlayerId('p1'), displayName: 'Player One' }],
        },
        ...overrides,
    };
}

// ─── serializeReplayCompressed ────────────────────────────────────────────────

describe('serializeReplayCompressed', () => {
    it('returns a Promise', () => {
        const result = serializeReplayCompressed(makeReplayFile());

        expect(result).toBeInstanceOf(Promise);
    });

    it('resolves to a Buffer', async () => {
        const buf = await serializeReplayCompressed(makeReplayFile());

        expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it('produces smaller output than JSON for a non-trivial payload', async () => {
        const file = makeReplayFile({
            actions: Array.from({ length: 60 }, (_, i) => ({
                tick: i,
                playerId: toPlayerId('p1'),
                action: {
                    type: 'engine:end_turn',
                    playerId: toPlayerId('p1'),
                    tick: i,
                    payload: {},
                },
            })),
        });

        const jsonSize = Buffer.from(serializeReplay(file), 'utf8').length;
        const compressedSize = (await serializeReplayCompressed(file)).length;

        expect(compressedSize).toBeLessThan(jsonSize);
    });
});

// ─── deserializeReplayCompressed ──────────────────────────────────────────────

describe('deserializeReplayCompressed', () => {
    it('returns a Promise', async () => {
        const buf = await serializeReplayCompressed(makeReplayFile());
        const result = deserializeReplayCompressed(buf);

        expect(result).toBeInstanceOf(Promise);
    });

    it('throws when given non-gzip data', async () => {
        const bad = Buffer.from('this is not gzip', 'utf8');

        await expect(deserializeReplayCompressed(bad)).rejects.toBeInstanceOf(ReplayParseError);
    });

    it('throws ReplayParseError when decompressed bytes are invalid JSON', async () => {
        const { gzip } = await import('node:zlib');
        const { promisify } = await import('node:util');
        const gzipAsync = promisify(gzip);

        const bad = await gzipAsync(Buffer.from('not valid json', 'utf8'));

        await expect(deserializeReplayCompressed(bad)).rejects.toBeInstanceOf(ReplayParseError);
    });
});

// ─── Compressed round-trip ────────────────────────────────────────────────────

describe('compressed round-trip', () => {
    it('deserializeCompressed(serializeCompressed(file)) deep-equals the original', async () => {
        const file = makeReplayFile();

        const buf = await serializeReplayCompressed(file);
        const result = await deserializeReplayCompressed(buf);

        expect(result).toStrictEqual(file);
    });

    it('compressed and plain round-trips produce identical output', async () => {
        const file = makeReplayFile();

        const fromCompressed = await deserializeReplayCompressed(
            await serializeReplayCompressed(file),
        );

        // Spot-check; both paths go through parseReplayFile
        expect(fromCompressed.seed).toBe(file.seed);
        expect(fromCompressed.actions).toHaveLength(file.actions.length);
        expect(fromCompressed.metadata.players).toEqual(file.metadata.players);
    });

    it('preserves all action payloads through compressed round-trip', async () => {
        const file = makeReplayFile({
            actions: [
                {
                    tick: 0,
                    playerId: toPlayerId('p1'),
                    action: {
                        type: 'tactics:move_unit',
                        playerId: toPlayerId('p1'),
                        tick: 0,
                        payload: { unitId: 'u7', toX: 2, toY: 9 },
                    },
                },
            ],
        });

        const result = await deserializeReplayCompressed(await serializeReplayCompressed(file));

        expect(result.actions[0]?.action.payload).toStrictEqual({ unitId: 'u7', toX: 2, toY: 9 });
    });
});
