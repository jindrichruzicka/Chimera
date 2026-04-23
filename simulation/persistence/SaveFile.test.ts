/**
 * simulation/persistence/SaveFile.test.ts
 *
 * Tests for JsonSaveSerializer and CompressedSaveSerializer (issue #120, §4.11).
 *
 * TDD cycle: these tests are written first — the source files do not yet
 * exist. All tests must be RED before implementation starts.
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no FS or Electron imports here.
 */

import { describe, expect, it } from 'vitest';
import { CompressedSaveSerializer } from './CompressedSaveSerializer.js';
import { JsonSaveSerializer, MAX_SAVE_SIZE_CHARS } from './JsonSaveSerializer.js';
import { SaveParseError } from './SaveMigrator.js';
import type { SaveFile } from './SaveFile.js';
import type { GamePhase, PlayerId } from '../engine/types.js';

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
        },
        deltaActions: [],
        pendingCommitments: {},
        ...overrides,
    };
}

// ─── JsonSaveSerializer ───────────────────────────────────────────────────────

describe('JsonSaveSerializer', () => {
    it('round-trip: serialize then deserialize returns a structurally equal SaveFile', () => {
        const serializer = new JsonSaveSerializer();
        const file = makeSaveFile();

        const raw = serializer.serialize(file);
        const result = serializer.deserialize(raw);

        expect(result).toStrictEqual(file);
    });

    it('serialize returns a string', () => {
        const serializer = new JsonSaveSerializer();
        const raw = serializer.serialize(makeSaveFile());

        expect(typeof raw).toBe('string');
    });

    it('round-trip preserves all SaveFileHeader fields including optional thumbnailDataUrl', () => {
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

        expect(serializer.deserialize(serializer.serialize(file))).toStrictEqual(file);
    });

    it('round-trip preserves deltaActions', () => {
        const serializer = new JsonSaveSerializer();
        const file = makeSaveFile({
            deltaActions: [
                {
                    type: 'engine:end_turn',
                    playerId: 'player-1' as PlayerId,
                    tick: 3,
                    payload: {},
                },
            ],
        });

        expect(serializer.deserialize(serializer.serialize(file))).toStrictEqual(file);
    });
});

// ─── CompressedSaveSerializer ─────────────────────────────────────────────────

describe('CompressedSaveSerializer', () => {
    it('round-trip: serialize then deserialize returns a structurally equal SaveFile', () => {
        const serializer = new CompressedSaveSerializer();
        const file = makeSaveFile();

        const raw = serializer.serialize(file);
        const result = serializer.deserialize(raw);

        expect(result).toStrictEqual(file);
    });

    it('produces smaller output than JsonSaveSerializer for a non-trivial payload', () => {
        const json = new JsonSaveSerializer();
        const compressed = new CompressedSaveSerializer();

        // Build a large payload with repeated data to ensure compression is effective.
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
                playerId: 'player-1' as PlayerId,
                tick: i,
                payload: {},
            })),
        });

        const jsonSize = Buffer.from(json.serialize(file), 'utf8').length;
        const compressedSize = compressed.serialize(file).length;

        expect(compressedSize).toBeLessThan(jsonSize);
    });
});

// ─── JsonSaveSerializer — security (OWASP A08 / issue #133) ──────────────────

describe('JsonSaveSerializer — security', () => {
    it('throws SaveParseError when raw input exceeds MAX_SAVE_SIZE_CHARS', () => {
        const serializer = new JsonSaveSerializer();
        const oversized = 'x'.repeat(MAX_SAVE_SIZE_CHARS + 1);

        expect(() => serializer.deserialize(oversized)).toThrow(SaveParseError);
    });

    it('throws SaveParseError when the top-level header field is absent', () => {
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

        expect(() => serializer.deserialize(noHeader)).toThrow(SaveParseError);
    });

    it('throws SaveParseError when header is present but missing required fields', () => {
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

        expect(() => serializer.deserialize(partialHeader)).toThrow(SaveParseError);
    });

    it('throws SaveParseError when the top-level checkpoint field is absent', () => {
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

        expect(() => serializer.deserialize(noCheckpoint)).toThrow(SaveParseError);
    });

    it('throws SaveParseError when deltaActions is not an array', () => {
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

        expect(() => serializer.deserialize(badDeltaActions)).toThrow(SaveParseError);
    });

    it('throws SaveParseError when raw JSON is syntactically invalid', () => {
        const serializer = new JsonSaveSerializer();

        expect(() => serializer.deserialize('{ this is not json }')).toThrow(SaveParseError);
    });

    it('does not pollute Object.prototype when JSON contains __proto__ injection', () => {
        const serializer = new JsonSaveSerializer();
        // A crafted payload that attempts to inject a property via __proto__.
        const pollutionAttempt = '{"__proto__": {"injected": true}, "header": null}';

        // The call must throw (validation fails) but must not have side-effected
        // Object.prototype before throwing.
        expect(() => serializer.deserialize(pollutionAttempt)).toThrow(SaveParseError);
        expect(Object.hasOwn(Object.prototype, 'injected')).toBe(false);
    });

    it('deserialize still succeeds on a valid file after the security checks', () => {
        const serializer = new JsonSaveSerializer();
        const file = makeSaveFile();

        expect(serializer.deserialize(serializer.serialize(file))).toStrictEqual(file);
    });
});
