/**
 * simulation/persistence/SessionManifest.test.ts
 *
 * Tests for deriveSessionManifest (F68, #820) — the shared checkpoint-derived
 * session-manifest backfill used by the v5→v6 migration and by
 * `captureSaveFile`'s fallback.
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no FS or Electron imports here.
 */

import { describe, expect, it } from 'vitest';
import { deriveSessionManifest } from './SessionManifest.js';
import type { BaseGameSnapshot } from '../engine/types.js';
import { gamePhase, playerId } from '../engine/types.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** UUID v4 shape produced by `crypto.randomUUID()`. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Build a branded players map from raw ids, preserving insertion order. */
function makePlayers(...ids: readonly string[]): BaseGameSnapshot['players'] {
    return Object.fromEntries(ids.map((id) => [playerId(id), { id: playerId(id) }]));
}

function makeCheckpoint(overrides: Partial<BaseGameSnapshot> = {}): BaseGameSnapshot {
    return {
        tick: 1,
        seed: 42,
        players: {},
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
        ...overrides,
    };
}

// ─── deriveSessionManifest ────────────────────────────────────────────────────

describe('deriveSessionManifest', () => {
    it('classifies a mixed roster: host, -local- id, ai suffix, and remote', () => {
        const manifest = deriveSessionManifest(
            makeCheckpoint({
                hostPlayerId: playerId('host-1'),
                players: makePlayers('host-1', 'p-local-2', 'ai-5', 'stranger'),
            }),
        );

        expect(manifest.seats).toEqual([
            { playerId: 'host-1', control: 'host', slotIndex: 0 },
            { playerId: 'p-local-2', control: 'local', slotIndex: 1 },
            { playerId: 'ai-5', control: 'ai', slotIndex: 5 },
            { playerId: 'stranger', control: 'remote', slotIndex: 2 },
        ]);
    });

    it('never emits colliding slotIndexes: AI suffixes claim their slot first, others fill around them', () => {
        // Regression for review WARN-1: `p1` (key-order index 0) must NOT share
        // slotIndex 0 with `ai-0` (authoritative suffix 0) — the AI id suffix IS
        // the real seat (`createSyntheticAIPlayerId` mints `ai-<slotIndex>`), so
        // the non-AI seat shifts to the next free index.
        const manifest = deriveSessionManifest(
            makeCheckpoint({ players: makePlayers('p1', 'ai-0') }),
        );

        expect(manifest.seats).toEqual([
            { playerId: 'p1', control: 'remote', slotIndex: 1 },
            { playerId: 'ai-0', control: 'ai', slotIndex: 0 },
        ]);
        const indexes = manifest.seats.map((seat) => seat.slotIndex);
        expect(new Set(indexes).size).toBe(indexes.length);
    });

    it('sets maxPlayers to at least the highest slotIndex + 1 so no seat is out of range', () => {
        // Regression for review WARN-1/WARN-2: an AI at slot 5 among 2 seats
        // implies the lobby had capacity ≥ 6 — a 2-seat capacity with a seat at
        // index 5 would be self-contradictory for the restore consumer.
        const manifest = deriveSessionManifest(
            makeCheckpoint({
                hostPlayerId: playerId('h'),
                players: makePlayers('h', 'ai-5'),
            }),
        );

        expect(manifest.maxPlayers).toBe(6);
        for (const seat of manifest.seats) {
            expect(seat.slotIndex).toBeLessThan(manifest.maxPlayers);
        }
    });

    it('uses the seat count as maxPlayers when slot indexes are contiguous', () => {
        const manifest = deriveSessionManifest(
            makeCheckpoint({
                hostPlayerId: playerId('h'),
                players: makePlayers('h', 'guest'),
            }),
        );

        expect(manifest.maxPlayers).toBe(2);
    });

    it('treats an id with a zero-padded ai suffix as remote, not ai (no duplicate AI slots)', () => {
        // `createSyntheticAIPlayerId` never zero-pads, so `ai-01` cannot be an
        // engine-minted AI seat; classifying it as ai would collide with `ai-1`.
        const manifest = deriveSessionManifest(
            makeCheckpoint({ players: makePlayers('ai-1', 'ai-01') }),
        );

        expect(manifest.seats).toEqual([
            { playerId: 'ai-1', control: 'ai', slotIndex: 1 },
            { playerId: 'ai-01', control: 'remote', slotIndex: 0 },
        ]);
    });

    it('classifies the host as host even when its id contains -local-', () => {
        const manifest = deriveSessionManifest(
            makeCheckpoint({
                hostPlayerId: playerId('p-local-1'),
                players: makePlayers('p-local-1'),
            }),
        );

        expect(manifest.seats).toEqual([{ playerId: 'p-local-1', control: 'host', slotIndex: 0 }]);
    });

    it('adopts checkpoint.matchId when present', () => {
        const manifest = deriveSessionManifest(
            makeCheckpoint({ matchId: 'match-live', players: makePlayers('p1') }),
        );

        expect(manifest.matchId).toBe('match-live');
    });

    it('mints a fresh UUID matchId when the checkpoint has none', () => {
        const manifest = deriveSessionManifest(makeCheckpoint({ players: makePlayers('p1') }));

        expect(manifest.matchId).toMatch(UUID_RE);
    });

    it('never emits omniscient (unknowable from a checkpoint)', () => {
        const manifest = deriveSessionManifest(makeCheckpoint({ players: makePlayers('ai-0') }));

        expect(manifest.seats[0]).not.toHaveProperty('omniscient');
    });

    it('produces an empty manifest for a checkpoint with no players', () => {
        const manifest = deriveSessionManifest(makeCheckpoint());

        expect(manifest.seats).toEqual([]);
        expect(manifest.maxPlayers).toBe(0);
        expect(manifest.matchId).toMatch(UUID_RE);
    });

    it('does not mutate the input checkpoint', () => {
        const checkpoint = makeCheckpoint({
            hostPlayerId: playerId('h'),
            players: makePlayers('h', 'ai-2'),
        });
        const frozen = Object.freeze({ ...checkpoint, players: Object.freeze(checkpoint.players) });

        expect(() => deriveSessionManifest(frozen)).not.toThrow();
    });
});
