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
import type { GamePhase, BaseGameSnapshot } from '../engine/types.js';
import { playerId as toPlayerId } from '../engine/types.js';
import type { GameTimer, TimerId } from '../engine/GameTimer.js';
import type { CommitmentEnvelope } from '../projection/CommitmentScheme.js';
import { toCommitmentId } from '../projection/CommitmentScheme.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSaveFile(overrides: Partial<SaveFile> = {}): SaveFile {
    const defaultCheckpoint: Partial<BaseGameSnapshot> = {
        tick: 5,
        seed: 99,
        players: {},
        entities: {},
        phase: 'playing' as GamePhase,
        events: [],
        turnNumber: 0,
        timers: {},
        matchResult: null,
    };

    const { checkpoint: checkpointOverride, ...restOverrides } = overrides;
    const mergedCheckpoint = {
        ...defaultCheckpoint,
        ...checkpointOverride,
        timers: checkpointOverride?.timers ?? {},
    } as BaseGameSnapshot;

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
        checkpoint: mergedCheckpoint,
        deltaActions: [],
        pendingCommitments: {},
        ...restOverrides,
    };
}

function assertSaveEnvelopeCompatibility(
    envelope: CommitmentEnvelope,
): SaveFile['pendingCommitments'] {
    const pendingCommitments = Object.create(null) as SaveFile['pendingCommitments'];
    pendingCommitments[envelope.id] = envelope;

    return pendingCommitments;
}

function readPendingCommitment(
    pendingCommitments: SaveFile['pendingCommitments'],
    commitmentId: ReturnType<typeof toCommitmentId>,
): CommitmentEnvelope {
    const envelope = pendingCommitments[commitmentId];
    if (envelope === undefined) {
        throw new Error(`Expected pending commitment '${commitmentId}' to exist`);
    }

    return envelope;
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

    it('round-trip preserves pendingCommitments using canonical F27 envelope fields', async () => {
        const serializer = new JsonSaveSerializer();
        const commitmentId = toCommitmentId('commitment-1');
        const pendingCommitments = Object.create(null) as SaveFile['pendingCommitments'];
        pendingCommitments[commitmentId] = {
            id: commitmentId,
            commitment: 'a'.repeat(64),
        };
        const file = makeSaveFile({
            pendingCommitments,
        });

        const result = await serializer.deserialize(await serializer.serialize(file));

        expect(result.pendingCommitments[commitmentId]).toStrictEqual({
            id: commitmentId,
            commitment: 'a'.repeat(64),
        });
    });

    it('matches the projection CommitmentEnvelope shape for invariant #26 load wiring', () => {
        const commitmentId = toCommitmentId('commitment-compat');
        const pendingCommitments = assertSaveEnvelopeCompatibility({
            id: commitmentId,
            commitment: 'b'.repeat(64),
        });

        const compatibilityProbe = readPendingCommitment(pendingCommitments, commitmentId);

        expect(compatibilityProbe).toStrictEqual({
            id: toCommitmentId('commitment-compat'),
            commitment: 'b'.repeat(64),
        });
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

// ─── CommitmentEnvelope F27 shape — revealedAt field (issue #440) ────────────

describe('CommitmentEnvelope F27 shape — revealedAt (issue #440)', () => {
    it('round-trip preserves CommitmentEnvelope with revealedAt tick', async () => {
        const serializer = new JsonSaveSerializer();
        const commitmentId = toCommitmentId('c-reveal-1');
        const pendingCommitments = Object.create(null) as SaveFile['pendingCommitments'];
        // revealedAt is the new F27 field; type must accept it (pnpm typecheck red before fix)
        pendingCommitments[commitmentId] = {
            id: commitmentId,
            commitment: 'a'.repeat(64),
            revealedAt: 7,
        };
        const file = makeSaveFile({ pendingCommitments });

        const result = await serializer.deserialize(await serializer.serialize(file));

        expect(result.pendingCommitments[commitmentId]).toStrictEqual({
            id: commitmentId,
            commitment: 'a'.repeat(64),
            revealedAt: 7,
        });
    });

    it('round-trip preserves CommitmentEnvelope without revealedAt when omitted', async () => {
        const serializer = new JsonSaveSerializer();
        const commitmentId = toCommitmentId('c-reveal-2');
        const pendingCommitments = Object.create(null) as SaveFile['pendingCommitments'];
        pendingCommitments[commitmentId] = { id: commitmentId, commitment: 'b'.repeat(64) };
        const file = makeSaveFile({ pendingCommitments });

        const result = await serializer.deserialize(await serializer.serialize(file));

        expect(result.pendingCommitments[commitmentId]).toStrictEqual({
            id: commitmentId,
            commitment: 'b'.repeat(64),
        });
    });

    it('rejects with SaveParseError when CommitmentEnvelope.revealedAt is a float (invariant #44)', async () => {
        const serializer = new JsonSaveSerializer();
        const raw = JSON.stringify({
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
                turnNumber: 0,
            },
            deltaActions: [],
            pendingCommitments: {
                'c-float': {
                    id: 'c-float',
                    commitment: 'a'.repeat(64),
                    revealedAt: 1.5,
                },
            },
        });

        await expect(serializer.deserialize(raw)).rejects.toBeInstanceOf(SaveParseError);
    });

    it('accepts CommitmentEnvelope with valid integer revealedAt in raw JSON', async () => {
        const serializer = new JsonSaveSerializer();
        const raw = JSON.stringify({
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
                turnNumber: 0,
            },
            deltaActions: [],
            pendingCommitments: {
                'c-int': {
                    id: 'c-int',
                    commitment: 'a'.repeat(64),
                    revealedAt: 42,
                },
            },
        });

        const result = await serializer.deserialize(raw);
        const commitmentId = toCommitmentId('c-int');
        const commitment = readPendingCommitment(result.pendingCommitments, commitmentId);

        expect(commitment).toStrictEqual({
            id: 'c-int',
            commitment: 'a'.repeat(64),
            revealedAt: 42,
        });
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
                timers: {},
                matchResult: null,
            },
        });

        const result = await serializer.deserialize(await serializer.serialize(file));

        expect((result.checkpoint as unknown as Record<string, unknown>)['turnNumber']).toBe(7);
    });
});

// ─── JsonSaveSerializer — GameTimer serialization (issue #407) ──────────────

describe('JsonSaveSerializer — GameTimer serialization', () => {
    it('round-trips checkpoint.timers with populated GameTimer entries', async () => {
        const serializer = new JsonSaveSerializer();
        const timer1: GameTimer = {
            id: 'tmr-entity-1-action-fire' as TimerId,
            remainingTicks: 5,
            intervalTicks: 0,
            actionType: 'entity:fire',
            payload: { targetId: 'e2' },
            active: true,
        };
        const timer2: GameTimer = {
            id: 'tmr-entity-2-action-move' as TimerId,
            remainingTicks: 10,
            intervalTicks: 3,
            actionType: 'entity:move',
            payload: { dx: 1, dy: 0 },
            active: false,
        };
        const file = makeSaveFile({
            checkpoint: {
                tick: 5,
                seed: 99,
                players: {},
                entities: {},
                phase: 'playing' as GamePhase,
                events: [],
                turnNumber: 0,
                timers: {
                    [timer1.id]: timer1,
                    [timer2.id]: timer2,
                },
                matchResult: null,
            },
        });

        const result = await serializer.deserialize(await serializer.serialize(file));

        expect(result.checkpoint.timers).toStrictEqual({
            [timer1.id]: timer1,
            [timer2.id]: timer2,
        });
    });

    it('round-trips checkpoint.timers as empty registry', async () => {
        const serializer = new JsonSaveSerializer();
        const file = makeSaveFile({
            checkpoint: {
                tick: 5,
                seed: 99,
                players: {},
                entities: {},
                phase: 'playing' as GamePhase,
                events: [],
                turnNumber: 0,
                timers: {},
                matchResult: null,
            },
        });

        const result = await serializer.deserialize(await serializer.serialize(file));

        expect(result.checkpoint.timers).toStrictEqual({});
    });

    it('deserialize accepts a save file with missing timers field (backward compatibility)', async () => {
        const serializer = new JsonSaveSerializer();
        // Construct a save file JSON that explicitly has no timers field
        const jsonWithoutTimers = JSON.stringify({
            header: {
                schemaVersion: 1,
                engineVersion: '0.1.0',
                gameId: 'tactics',
                gameVersion: '0.1.0',
                slotId: 'autosave',
                savedAt: 1_700_000_000_000,
                turnNumber: 1,
                playerNames: ['Alice'],
            },
            checkpoint: {
                tick: 5,
                seed: 99,
                phase: 'playing',
                players: {},
                entities: {},
                events: [],
                turnNumber: 0,
                // timers deliberately omitted
            },
            deltaActions: [],
            pendingCommitments: {},
        });

        // JsonSaveSerializer should accept the file without timers field
        // Migration will add timers: {} later in the SaveRepository flow
        const result = await serializer.deserialize(jsonWithoutTimers);

        expect(result.header.schemaVersion).toBe(1);
        expect(result.checkpoint).toBeDefined();
    });
});
