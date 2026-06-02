/**
 * simulation/replay/ReplayFile.test.ts
 *
 * TDD tests for ReplayFile schema and parseReplayFile validation.
 * Tests written first (RED before implementation).
 *
 * Architecture reference: §4.28
 * Task: F44 / T1 (issue #655)
 *
 * Invariants upheld:
 *   #1  — simulation/ has zero runtime deps on React, DOM, or networking
 *   #42 — tick values are plain integers throughout
 *   #43 — serializer functions are pure; no I/O
 *   #71 — replay files contain full EngineAction payloads; seed and actions mandatory
 */

import { describe, expect, it } from 'vitest';
import { parseReplayFile, ReplayParseError } from './ReplayFile.js';
import type { ReplayFile, RecordedAction, ReplayMetadata } from './ReplayFile.js';
import type { EngineAction } from '../engine/types.js';
import { playerId as toPlayerId } from '../engine/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeAction(tick: number): EngineAction {
    return {
        type: 'engine:end_turn',
        playerId: toPlayerId('p1'),
        tick,
        payload: {},
    };
}

function makeMetadata(overrides: Partial<ReplayMetadata> = {}): ReplayMetadata {
    return {
        recordedAt: '2026-06-02T10:00:00.000Z',
        durationTicks: 10,
        players: [
            { playerId: toPlayerId('p1'), displayName: 'Player One' },
            { playerId: toPlayerId('p2'), displayName: 'Player Two' },
        ],
        ...overrides,
    };
}

function makeReplayFile(overrides: Partial<ReplayFile> = {}): ReplayFile {
    return {
        formatVersion: 1,
        engineVersion: '0.7.0',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        gameConfig: {},
        seed: 42,
        actions: [
            { tick: 0, playerId: toPlayerId('p1'), action: makeAction(0) },
            { tick: 1, playerId: toPlayerId('p1'), action: makeAction(1) },
        ],
        metadata: makeMetadata(),
        ...overrides,
    };
}

// ─── RecordedAction shape ─────────────────────────────────────────────────────

describe('RecordedAction', () => {
    it('accepts a valid recorded action', () => {
        const action: RecordedAction = {
            tick: 3,
            playerId: toPlayerId('p1'),
            action: makeAction(3),
        };

        expect(action.tick).toBe(3);
        expect(action.playerId).toBe('p1');
    });
});

// ─── parseReplayFile — valid input ────────────────────────────────────────────

describe('parseReplayFile — valid input', () => {
    it('returns a ReplayFile when given a structurally valid object', () => {
        const raw: unknown = makeReplayFile();

        const result = parseReplayFile(raw);

        expect(result.formatVersion).toBe(1);
        expect(result.gameId).toBe('tactics');
        expect(result.seed).toBe(42);
        expect(result.actions).toHaveLength(2);
    });

    it('returns the exact same actions array contents', () => {
        const raw: unknown = makeReplayFile();

        const result = parseReplayFile(raw);

        expect(result.actions[0]?.tick).toBe(0);
        expect(result.actions[1]?.tick).toBe(1);
    });

    it('returns metadata as-is when valid', () => {
        const raw: unknown = makeReplayFile();

        const result = parseReplayFile(raw);

        expect(result.metadata.recordedAt).toBe('2026-06-02T10:00:00.000Z');
        expect(result.metadata.durationTicks).toBe(10);
        expect(result.metadata.players).toEqual([
            { playerId: 'p1', displayName: 'Player One' },
            { playerId: 'p2', displayName: 'Player Two' },
        ]);
    });

    it('accepts an empty actions array', () => {
        const raw: unknown = makeReplayFile({ actions: [] });

        const result = parseReplayFile(raw);

        expect(result.actions).toHaveLength(0);
    });

    it('preserves unknown extra fields for forward-compatibility', () => {
        const raw: unknown = {
            ...makeReplayFile(),
            futureField: 'some-future-value',
        };

        // Should not throw — forward-compat: unknown fields pass through
        const result = parseReplayFile(raw);

        expect((result as unknown as Record<string, unknown>)['futureField']).toBe(
            'some-future-value',
        );
    });

    it('preserves unknown extra fields in actions for forward-compatibility', () => {
        const rawAction = {
            tick: 0,
            playerId: toPlayerId('p1'),
            action: makeAction(0),
            extraField: 'x',
        };
        const raw: unknown = makeReplayFile({
            actions: [rawAction] as unknown as RecordedAction[],
        });

        const result = parseReplayFile(raw);

        expect((result.actions[0] as unknown as Record<string, unknown>)['extraField']).toBe('x');
    });
});

// ─── parseReplayFile — seed validation ───────────────────────────────────────

describe('parseReplayFile — missing or invalid seed', () => {
    it('throws ReplayParseError when seed is missing', () => {
        const { seed: _seed, ...noSeed } = makeReplayFile();
        const raw: unknown = noSeed;

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when seed is null', () => {
        const raw: unknown = { ...makeReplayFile(), seed: null };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when seed is a string', () => {
        const raw: unknown = { ...makeReplayFile(), seed: 'not-a-number' };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when seed is a float', () => {
        const raw: unknown = { ...makeReplayFile(), seed: 3.14 };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parseReplayFile — actions validation ────────────────────────────────────

describe('parseReplayFile — missing or invalid actions', () => {
    it('throws ReplayParseError when actions is missing', () => {
        const { actions: _actions, ...noActions } = makeReplayFile();
        const raw: unknown = noActions;

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when actions is null', () => {
        const raw: unknown = { ...makeReplayFile(), actions: null };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when actions is not an array', () => {
        const raw: unknown = { ...makeReplayFile(), actions: {} };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when an action entry is missing tick', () => {
        const raw: unknown = {
            ...makeReplayFile(),
            actions: [{ playerId: 'p1', action: makeAction(0) }],
        };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when an action tick is a float (invariant #42)', () => {
        const raw: unknown = {
            ...makeReplayFile(),
            actions: [{ tick: 1.5, playerId: 'p1', action: makeAction(1) }],
        };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when an action tick is negative', () => {
        const raw: unknown = {
            ...makeReplayFile(),
            actions: [{ tick: -1, playerId: 'p1', action: makeAction(0) }],
        };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when an action entry is missing playerId', () => {
        const raw: unknown = {
            ...makeReplayFile(),
            actions: [{ tick: 0, action: makeAction(0) }],
        };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when an action entry is missing action envelope', () => {
        const raw: unknown = {
            ...makeReplayFile(),
            actions: [{ tick: 0, playerId: 'p1' }],
        };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parseReplayFile — formatVersion validation ───────────────────────────────

describe('parseReplayFile — missing or invalid formatVersion', () => {
    it('throws ReplayParseError when formatVersion is missing', () => {
        const { formatVersion: _fv, ...noFv } = makeReplayFile();
        const raw: unknown = noFv;

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when formatVersion is 0', () => {
        const raw: unknown = { ...makeReplayFile(), formatVersion: 0 };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when formatVersion is not the current version', () => {
        const raw: unknown = { ...makeReplayFile(), formatVersion: 2 };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when formatVersion is a float', () => {
        const raw: unknown = { ...makeReplayFile(), formatVersion: 1.5 };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when formatVersion is a string', () => {
        const raw: unknown = { ...makeReplayFile(), formatVersion: '1' };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parseReplayFile — required string fields ─────────────────────────────────

describe('parseReplayFile — required string fields', () => {
    it('throws ReplayParseError when engineVersion is missing', () => {
        const { engineVersion: _ev, ...noEv } = makeReplayFile();
        const raw: unknown = noEv;

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when gameId is missing', () => {
        const { gameId: _gi, ...noGi } = makeReplayFile();
        const raw: unknown = noGi;

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when gameVersion is missing', () => {
        const { gameVersion: _gv, ...noGv } = makeReplayFile();
        const raw: unknown = noGv;

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parseReplayFile — gameConfig validation ─────────────────────────────────

describe('parseReplayFile — gameConfig validation', () => {
    it('throws ReplayParseError when gameConfig is missing', () => {
        const { gameConfig: _gameConfig, ...noGameConfig } = makeReplayFile();
        const raw: unknown = noGameConfig;

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when gameConfig is null', () => {
        const raw: unknown = { ...makeReplayFile(), gameConfig: null };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when gameConfig is an array', () => {
        const raw: unknown = { ...makeReplayFile(), gameConfig: [] };

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parseReplayFile — metadata validation ────────────────────────────────────

describe('parseReplayFile — metadata validation', () => {
    it('throws ReplayParseError when metadata is missing', () => {
        const { metadata: _meta, ...noMeta } = makeReplayFile();
        const raw: unknown = noMeta;

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when metadata.recordedAt is missing', () => {
        const raw: unknown = makeReplayFile({
            metadata: makeMetadata({ recordedAt: undefined as unknown as string }),
        });

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when metadata.recordedAt is not ISO-8601', () => {
        const raw: unknown = makeReplayFile({
            metadata: makeMetadata({ recordedAt: 'June 2, 2026 10:00' }),
        });

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when metadata.durationTicks is a float', () => {
        const raw: unknown = makeReplayFile({
            metadata: makeMetadata({ durationTicks: 5.5 }),
        });

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when metadata.durationTicks is negative', () => {
        const raw: unknown = makeReplayFile({
            metadata: makeMetadata({ durationTicks: -1 }),
        });

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when metadata.players is missing', () => {
        const raw: unknown = makeReplayFile({
            metadata: makeMetadata({ players: undefined as unknown as ReplayMetadata['players'] }),
        });

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when metadata.players is not an array', () => {
        const raw: unknown = makeReplayFile({
            metadata: makeMetadata({ players: 'p1' as unknown as ReplayMetadata['players'] }),
        });

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when a metadata player is missing playerId', () => {
        const raw: unknown = makeReplayFile({
            metadata: makeMetadata({
                players: [{ displayName: 'Player One' }] as unknown as ReplayMetadata['players'],
            }),
        });

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when a metadata player is missing displayName', () => {
        const raw: unknown = makeReplayFile({
            metadata: makeMetadata({
                players: [{ playerId: toPlayerId('p1') }] as unknown as ReplayMetadata['players'],
            }),
        });

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when a metadata player entry is not an object', () => {
        const raw: unknown = makeReplayFile({
            metadata: makeMetadata({ players: ['p1'] as unknown as ReplayMetadata['players'] }),
        });

        expect(() => parseReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parseReplayFile — non-object input ──────────────────────────────────────

describe('parseReplayFile — non-object input', () => {
    it('throws ReplayParseError when raw is null', () => {
        expect(() => parseReplayFile(null)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when raw is a string', () => {
        expect(() => parseReplayFile('not-an-object')).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when raw is an array', () => {
        expect(() => parseReplayFile([])).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when raw is a number', () => {
        expect(() => parseReplayFile(42)).toThrowError(ReplayParseError);
    });
});

// ─── ReplayParseError ─────────────────────────────────────────────────────────

describe('ReplayParseError', () => {
    it('is an instance of Error', () => {
        const err = new ReplayParseError('test error');

        expect(err).toBeInstanceOf(Error);
    });

    it('has name ReplayParseError', () => {
        const err = new ReplayParseError('bad replay');

        expect(err.name).toBe('ReplayParseError');
    });

    it('carries the supplied message', () => {
        const err = new ReplayParseError('seed missing');

        expect(err.message).toBe('seed missing');
    });
});
