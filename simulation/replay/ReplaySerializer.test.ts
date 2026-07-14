/**
 * simulation/replay/ReplaySerializer.test.ts
 *
 * TDD tests for ReplaySerializer (JSON serialize/deserialize).
 * Tests written first (RED before implementation).
 *
 * Architecture reference: §4.28
 * Task: F44 / T1 (issue #655)
 *
 * Invariants upheld:
 *   #1  — simulation/ has zero runtime deps on React, DOM, or networking
 *   #43 — serializer functions are pure; no I/O, no Date.now, no Math.random
 *   #71 — replay files contain full EngineAction payloads
 */

import { describe, expect, it } from 'vitest';
import { serializeReplay, deserializeReplay, JsonReplaySerializer } from './ReplaySerializer.js';
import { ReplayParseError } from './ReplayFile.js';
import type { ReplayFile } from './ReplayFile.js';
import { playerId as toPlayerId } from '../engine/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReplayFile(overrides: Partial<ReplayFile> = {}): ReplayFile {
    return {
        formatVersion: 1,
        engineVersion: '0.7.0',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        gameConfig: { mapSize: 10 },
        seed: 99,
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
            {
                tick: 1,
                playerId: toPlayerId('p2'),
                action: {
                    type: 'tactics:move_unit',
                    playerId: toPlayerId('p2'),
                    tick: 1,
                    payload: { unitId: 'u1', toX: 3, toY: 4 },
                },
            },
        ],
        metadata: {
            recordedAt: '2026-06-02T10:00:00.000Z',
            durationTicks: 50,
            players: [
                { playerId: toPlayerId('p1'), displayName: 'Player One' },
                { playerId: toPlayerId('p2'), displayName: 'Player Two' },
            ],
        },
        ...overrides,
    };
}

// ─── serializeReplay ─────────────────────────────────────────────────────────

describe('serializeReplay', () => {
    it('returns a string', () => {
        const result = serializeReplay(makeReplayFile());

        expect(typeof result).toBe('string');
    });

    it('returns valid JSON', () => {
        const result = serializeReplay(makeReplayFile());

        expect(() => JSON.parse(result)).not.toThrow();
    });

    it('serialized JSON contains all top-level fields', () => {
        const file = makeReplayFile();
        const json = JSON.parse(serializeReplay(file)) as Record<string, unknown>;

        expect(json['formatVersion']).toBe(1);
        expect(json['engineVersion']).toBe('0.7.0');
        expect(json['gameId']).toBe('tactics');
        expect(json['seed']).toBe(99);
        expect(Array.isArray(json['actions'])).toBe(true);
        expect(typeof json['metadata']).toBe('object');
    });

    it('does not mutate the input file', () => {
        const file = makeReplayFile();
        const originalActionsLength = file.actions.length;

        serializeReplay(file);

        expect(file.actions).toHaveLength(originalActionsLength);
    });
});

// ─── deserializeReplay ───────────────────────────────────────────────────────

describe('deserializeReplay', () => {
    it('returns a ReplayFile when given valid JSON', () => {
        const file = makeReplayFile();
        const json = serializeReplay(file);

        const result = deserializeReplay(json);

        expect(result.formatVersion).toBe(1);
        expect(result.gameId).toBe('tactics');
    });

    it('throws ReplayParseError when given invalid JSON', () => {
        expect(() => deserializeReplay('not valid json')).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when JSON parses to non-object', () => {
        expect(() => deserializeReplay('"just a string"')).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when JSON is missing seed', () => {
        const file = makeReplayFile();
        const json = JSON.parse(serializeReplay(file)) as Record<string, unknown>;
        delete json['seed'];

        expect(() => deserializeReplay(JSON.stringify(json))).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when JSON is missing actions', () => {
        const file = makeReplayFile();
        const json = JSON.parse(serializeReplay(file)) as Record<string, unknown>;
        delete json['actions'];

        expect(() => deserializeReplay(JSON.stringify(json))).toThrowError(ReplayParseError);
    });
});

// ─── Round-trip ───────────────────────────────────────────────────────────────

describe('JSON round-trip', () => {
    it('deserialize(serialize(file)) deep-equals the original', () => {
        const file = makeReplayFile();

        const result = deserializeReplay(serializeReplay(file));

        expect(result).toStrictEqual(file);
    });

    it('round-trip preserves all action payload fields', () => {
        const file = makeReplayFile();

        const result = deserializeReplay(serializeReplay(file));

        expect(result.actions[1]?.action.payload).toStrictEqual({ unitId: 'u1', toX: 3, toY: 4 });
    });

    it('round-trip preserves metadata.players', () => {
        const file = makeReplayFile();

        const result = deserializeReplay(serializeReplay(file));

        expect(result.metadata.players).toEqual([
            { playerId: 'p1', displayName: 'Player One' },
            { playerId: 'p2', displayName: 'Player Two' },
        ]);
    });

    it('round-trip preserves gameConfig', () => {
        const file = makeReplayFile({ gameConfig: { mapSize: 16, fog: true } });

        const result = deserializeReplay(serializeReplay(file));

        expect(result.gameConfig).toStrictEqual({ mapSize: 16, fog: true });
    });

    it('round-trip preserves the user-entered metadata.name', () => {
        const file = makeReplayFile({
            metadata: {
                recordedAt: '2026-06-02T10:00:00.000Z',
                durationTicks: 50,
                players: [{ playerId: toPlayerId('p1'), displayName: 'Player One' }],
                name: 'Grand Finale',
            },
        });

        const result = deserializeReplay(serializeReplay(file));

        expect(result.metadata.name).toBe('Grand Finale');
    });

    it('round-trip works with empty actions array', () => {
        const file = makeReplayFile({ actions: [] });

        const result = deserializeReplay(serializeReplay(file));

        expect(result.actions).toHaveLength(0);
    });

    it('round-trip preserves integer seed (invariant #42)', () => {
        const file = makeReplayFile({ seed: 1_234_567 });

        const result = deserializeReplay(serializeReplay(file));

        expect(result.seed).toBe(1_234_567);
        expect(Number.isInteger(result.seed)).toBe(true);
    });

    it('round-trip preserves integer action ticks (invariant #42)', () => {
        const file = makeReplayFile();

        const result = deserializeReplay(serializeReplay(file));

        for (const entry of result.actions) {
            expect(Number.isInteger(entry.tick)).toBe(true);
        }
    });
});

// ─── Security — prototype pollution defence ──────────────────────────────────

describe('deserializeReplay — prototype pollution defence', () => {
    it('rejects __proto__ instead of silently changing replay data', () => {
        const malicious =
            '{"__proto__": {"polluted": true}, "formatVersion": 1, "engineVersion": "0.7.0", "gameId": "g", "gameVersion": "1", "gameConfig": {}, "seed": 1, "actions": [], "metadata": {"recordedAt": "2026-01-01T00:00:00Z", "durationTicks": 0, "players": []}}';

        expect(() => deserializeReplay(malicious)).toThrowError(ReplayParseError);
        expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('preserves constructor and prototype keys in gameConfig', () => {
        const file = makeReplayFile({
            gameConfig: {
                constructor: 'custom-constructor-token',
                prototype: { mode: 'draft' },
            },
        });

        const result = deserializeReplay(serializeReplay(file));

        expect(result.gameConfig).toStrictEqual({
            constructor: 'custom-constructor-token',
            prototype: { mode: 'draft' },
        });
    });

    it('preserves constructor and prototype keys in action payloads', () => {
        const file = makeReplayFile({
            actions: [
                {
                    tick: 0,
                    playerId: toPlayerId('p1'),
                    action: {
                        type: 'tactics:configure_blueprint',
                        playerId: toPlayerId('p1'),
                        tick: 0,
                        payload: {
                            constructor: 'barracks',
                            prototype: { armor: 2 },
                        },
                    },
                },
            ],
        });

        const result = deserializeReplay(serializeReplay(file));

        expect(result.actions[0]?.action.payload).toStrictEqual({
            constructor: 'barracks',
            prototype: { armor: 2 },
        });
    });
});

// ─── JsonReplaySerializer (ReplaySerializer strategy) ──────────────────────────

describe('JsonReplaySerializer', () => {
    it('round-trips a ReplayFile through serialize → deserialize', async () => {
        const serializer = new JsonReplaySerializer();
        const file = makeReplayFile();

        const bytes = await serializer.serialize(file);
        const restored = await serializer.deserialize(bytes);

        expect(restored).toStrictEqual(file);
    });

    it('deserialize accepts a Buffer as well as a string', async () => {
        const serializer = new JsonReplaySerializer();
        const file = makeReplayFile();

        const text = await serializer.serialize(file);
        const restored = await serializer.deserialize(Buffer.from(String(text), 'utf8'));

        expect(restored).toStrictEqual(file);
    });

    it('deserialize rejects malformed JSON with ReplayParseError', async () => {
        const serializer = new JsonReplaySerializer();

        await expect(serializer.deserialize('not json')).rejects.toBeInstanceOf(ReplayParseError);
    });
});
