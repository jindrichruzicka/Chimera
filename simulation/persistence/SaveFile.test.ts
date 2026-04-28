/**
 * simulation/persistence/SaveFile.test.ts
 *
 * Tests for JsonSaveSerializer (issue #120, §4.11).
 *
 * CompressedSaveSerializer has moved to electron/main/saves/ and is tested
 * in electron/main/saves/CompressedSaveSerializer.test.ts (issue #137).
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no FS or Electron imports here.
 */

import { describe, expect, it } from 'vitest';
import { JsonSaveSerializer, MAX_SAVE_SIZE_CHARS } from './JsonSaveSerializer.js';
import { SaveParseError } from './SaveMigrator.js';
import type { SaveFile } from './SaveFile.js';
import type { GamePhase } from '../engine/types.js';
import { playerId as toPlayerId } from '../engine/types.js';

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
        },
        deltaActions: [],
        pendingCommitments: {},
        ...overrides,
    };
}

// ─── JsonSaveSerializer ───────────────────────────────────────────────────────

describe('JsonSaveSerializer', () => {
    it('round-trip: serialize then deserialize returns a structurally equal SaveFile', async () => {
        const serializer = new JsonSaveSerializer();
        const file = makeSaveFile();

        const raw = await serializer.serialize(file);
        const result = await serializer.deserialize(raw);

        expect(result).toStrictEqual(file);
    });

    it('serialize returns a string', async () => {
        const serializer = new JsonSaveSerializer();
        const raw = await serializer.serialize(makeSaveFile());

        expect(typeof raw).toBe('string');
    });

    it('round-trip preserves all SaveFileHeader fields including optional thumbnailDataUrl', async () => {
        const serializer = new JsonSaveSerializer();
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

        expect(await serializer.deserialize(await serializer.serialize(file))).toStrictEqual(file);
    });

    it('round-trip preserves deltaActions', async () => {
        const serializer = new JsonSaveSerializer();
        const file = makeSaveFile({
            deltaActions: [
                {
                    type: 'engine:end_turn',
                    playerId: toPlayerId('player-1'),
                    tick: 3,
                    payload: {},
                },
            ],
        });

        expect(await serializer.deserialize(await serializer.serialize(file))).toStrictEqual(file);
    });
});

// ─── JsonSaveSerializer — security (OWASP A08 / issue #133) ──────────────────

describe('JsonSaveSerializer — security', () => {
    it('rejects with SaveParseError when raw input exceeds MAX_SAVE_SIZE_CHARS', async () => {
        const serializer = new JsonSaveSerializer();
        const oversized = 'x'.repeat(MAX_SAVE_SIZE_CHARS + 1);

        await expect(serializer.deserialize(oversized)).rejects.toBeInstanceOf(SaveParseError);
    });

    it('rejects with SaveParseError when the top-level header field is absent', async () => {
        const serializer = new JsonSaveSerializer();
        const noHeader = JSON.stringify({
            checkpoint: {
                tick: 1,
                seed: 42,
                players: {},
                entities: {},
                phase: 'playing',
                events: [],
            },
            deltaActions: [],
            pendingCommitments: {},
        });

        await expect(serializer.deserialize(noHeader)).rejects.toBeInstanceOf(SaveParseError);
    });

    it('rejects with SaveParseError when header is present but missing required fields', async () => {
        const serializer = new JsonSaveSerializer();
        const partialHeader = JSON.stringify({
            header: { schemaVersion: 1 }, // missing engineVersion, gameId, etc.
            checkpoint: {
                tick: 1,
                seed: 42,
                players: {},
                entities: {},
                phase: 'playing',
                events: [],
            },
            deltaActions: [],
            pendingCommitments: {},
        });

        await expect(serializer.deserialize(partialHeader)).rejects.toBeInstanceOf(SaveParseError);
    });

    it('rejects with SaveParseError when the top-level checkpoint field is absent', async () => {
        const serializer = new JsonSaveSerializer();
        const noCheckpoint = JSON.stringify({
            header: {
                schemaVersion: 1,
                engineVersion: '0.1.0',
                gameId: 'tactics',
                gameVersion: '0.1.0',
                slotId: 'autosave',
                savedAt: 1_700_000_000_000,
                turnNumber: 1,
                playerNames: [],
            },
            deltaActions: [],
            pendingCommitments: {},
        });

        await expect(serializer.deserialize(noCheckpoint)).rejects.toBeInstanceOf(SaveParseError);
    });

    it('rejects with SaveParseError when deltaActions is not an array', async () => {
        const serializer = new JsonSaveSerializer();
        const badDeltaActions = JSON.stringify({
            header: {
                schemaVersion: 1,
                engineVersion: '0.1.0',
                gameId: 'tactics',
                gameVersion: '0.1.0',
                slotId: 'autosave',
                savedAt: 1_700_000_000_000,
                turnNumber: 1,
                playerNames: [],
            },
            checkpoint: {
                tick: 1,
                seed: 42,
                players: {},
                entities: {},
                phase: 'playing',
                events: [],
            },
            deltaActions: 'not-an-array',
            pendingCommitments: {},
        });

        await expect(serializer.deserialize(badDeltaActions)).rejects.toBeInstanceOf(
            SaveParseError,
        );
    });

    it('rejects with SaveParseError when raw JSON is syntactically invalid', async () => {
        const serializer = new JsonSaveSerializer();

        await expect(serializer.deserialize('{ this is not json }')).rejects.toBeInstanceOf(
            SaveParseError,
        );
    });

    it('does not pollute Object.prototype when JSON contains __proto__ injection', async () => {
        const serializer = new JsonSaveSerializer();
        // A crafted payload that attempts to inject a property via __proto__.
        const pollutionAttempt = '{"__proto__": {"injected": true}, "header": null}';

        // The call must reject (validation fails) but must not have side-effected
        // Object.prototype before rejecting.
        await expect(serializer.deserialize(pollutionAttempt)).rejects.toBeInstanceOf(
            SaveParseError,
        );
        expect(Object.hasOwn(Object.prototype, 'injected')).toBe(false);
    });

    it('deserialize still resolves on a valid file after the security checks', async () => {
        const serializer = new JsonSaveSerializer();
        const file = makeSaveFile();

        await expect(
            serializer.deserialize(await serializer.serialize(file)),
        ).resolves.toStrictEqual(file);
    });
});

// ─── JsonSaveSerializer — checkpoint.turnNumber validation (B1 from eca8acb review) ──
//
// The Zod checkpoint schema must declare turnNumber as a required integer so
// that saves written before BaseGameSnapshot.turnNumber was introduced are
// rejected at parse-time rather than silently producing undefined — which would
// propagate NaN through engine:end_turn.reduce and pruneTo arithmetic.

describe('JsonSaveSerializer — checkpoint.turnNumber schema enforcement', () => {
    // Helper to build the minimal valid JSON string for a save file but with
    // a custom checkpoint object so we can probe the schema boundary.
    function makeRawWithCheckpoint(checkpoint: Record<string, unknown>): string {
        return JSON.stringify({
            header: {
                schemaVersion: 1,
                engineVersion: '0.1.0',
                gameId: 'tactics',
                gameVersion: '0.1.0',
                slotId: 'autosave',
                savedAt: 1_700_000_000_000,
                turnNumber: 1,
                playerNames: [],
            },
            checkpoint,
            deltaActions: [],
            pendingCommitments: {},
        });
    }

    it('rejects with SaveParseError when checkpoint.turnNumber is absent', async () => {
        const serializer = new JsonSaveSerializer();
        const raw = makeRawWithCheckpoint({
            tick: 1,
            seed: 42,
            phase: 'playing',
            players: {},
            entities: {},
            events: [],
            // turnNumber deliberately omitted
        });

        await expect(serializer.deserialize(raw)).rejects.toBeInstanceOf(SaveParseError);
    });

    it('rejects with SaveParseError when checkpoint.turnNumber is a float', async () => {
        const serializer = new JsonSaveSerializer();
        const raw = makeRawWithCheckpoint({
            tick: 1,
            seed: 42,
            phase: 'playing',
            players: {},
            entities: {},
            events: [],
            turnNumber: 1.5,
        });

        await expect(serializer.deserialize(raw)).rejects.toBeInstanceOf(SaveParseError);
    });

    it('rejects with SaveParseError when checkpoint.turnNumber is a string', async () => {
        const serializer = new JsonSaveSerializer();
        const raw = makeRawWithCheckpoint({
            tick: 1,
            seed: 42,
            phase: 'playing',
            players: {},
            entities: {},
            events: [],
            turnNumber: '3',
        });

        await expect(serializer.deserialize(raw)).rejects.toBeInstanceOf(SaveParseError);
    });

    it('round-trips checkpoint.turnNumber correctly through serialize/deserialize', async () => {
        const serializer = new JsonSaveSerializer();
        const file = makeSaveFile({
            checkpoint: {
                tick: 5,
                seed: 99,
                players: {},
                entities: {},
                phase: 'playing' as GamePhase,
                events: [],
                turnNumber: 7,
            },
        });

        const result = await serializer.deserialize(await serializer.serialize(file));

        expect((result.checkpoint as unknown as Record<string, unknown>)['turnNumber']).toBe(7);
    });
});
