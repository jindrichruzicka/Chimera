/**
 * simulation/replay/PerspectiveReplayFile.test.ts
 *
 * TDD tests for the PerspectiveReplayFile schema and parsePerspectiveReplayFile
 * validation. Tests written first (RED before implementation).
 *
 * Architecture reference: §4.28 (ADR F44b)
 * Task: F44b / T1 (issue #667)
 *
 * Invariants upheld:
 *   #1  — simulation/ has zero runtime deps on React, DOM, or networking
 *   #42 — tick values are plain integers throughout
 *   #43 — parser is pure; no I/O
 *   #98 — perspective replays carry only projected PlayerSnapshots for a single
 *         locked viewerId; malformed if viewerId/frames missing or any frame's
 *         viewerId differs
 */

import { describe, expect, it } from 'vitest';
import { parsePerspectiveReplayFile } from './PerspectiveReplayFile.js';
import type { PerspectiveReplayFile, PerspectiveReplayFrame } from './PerspectiveReplayFile.js';
import { ReplayParseError } from './ReplayFile.js';
import type { PlayerSnapshot } from '../projection/StateProjector.js';
import { gamePhase, playerId as toPlayerId } from '../engine/types.js';
import type { PlayerId } from '../engine/types.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSnapshot(viewerId: PlayerId, tick: number): PlayerSnapshot {
    return {
        tick,
        viewerId,
        phase: gamePhase('play'),
        players: {},
        entities: {},
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
    };
}

function makeFrame(viewerId: PlayerId, tick: number): PerspectiveReplayFrame {
    return { tick, snapshot: makeSnapshot(viewerId, tick) };
}

function makePerspectiveReplayFile(
    overrides: Partial<PerspectiveReplayFile> = {},
): PerspectiveReplayFile {
    const viewerId = overrides.viewerId ?? toPlayerId('p1');
    return {
        formatVersion: 1,
        kind: 'perspective',
        engineVersion: '0.7.0',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        viewerId,
        recordedAt: '2026-06-02T10:00:00.000Z',
        durationTicks: 2,
        players: [
            { playerId: toPlayerId('p1'), displayName: 'Player One' },
            { playerId: toPlayerId('p2'), displayName: 'Player Two' },
        ],
        frames: [makeFrame(viewerId, 0), makeFrame(viewerId, 1)],
        ...overrides,
    };
}

// ─── parsePerspectiveReplayFile — valid input ───────────────────────────────────

describe('parsePerspectiveReplayFile — valid input', () => {
    it('accepts a well-formed perspective replay file and returns it', () => {
        const file = makePerspectiveReplayFile();
        const raw: unknown = file;

        const parsed = parsePerspectiveReplayFile(raw);

        expect(parsed).toEqual(file);
        expect(parsed.kind).toBe('perspective');
        expect(parsed.viewerId).toBe('p1');
        expect(parsed.frames).toHaveLength(2);
    });

    it('accepts a file with zero frames', () => {
        const raw: unknown = makePerspectiveReplayFile({ frames: [], durationTicks: 0 });

        expect(() => parsePerspectiveReplayFile(raw)).not.toThrow();
    });

    it('preserves unknown extra top-level fields (forward compatibility)', () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), futureField: 'ignored' };

        const parsed = parsePerspectiveReplayFile(raw) as unknown as Record<string, unknown>;

        expect(parsed['futureField']).toBe('ignored');
    });
});

// ─── parsePerspectiveReplayFile — non-object input ──────────────────────────────

describe('parsePerspectiveReplayFile — non-object input', () => {
    it.each([null, undefined, 42, 'str', [makePerspectiveReplayFile()]])(
        'throws ReplayParseError for non-object input %p',
        (raw) => {
            expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
        },
    );
});

// ─── parsePerspectiveReplayFile — discriminators ────────────────────────────────

describe('parsePerspectiveReplayFile — formatVersion and kind', () => {
    it('throws when formatVersion is not 1', () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), formatVersion: 2 };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it("throws when kind is not 'perspective'", () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), kind: 'deterministic' };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws when kind is absent (e.g. a deterministic ReplayFile shape)', () => {
        const { kind: _kind, ...noKind } = makePerspectiveReplayFile();
        const raw: unknown = noKind;

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parsePerspectiveReplayFile — header string fields ──────────────────────────

describe('parsePerspectiveReplayFile — header string fields', () => {
    it.each(['engineVersion', 'gameId', 'gameVersion'] as const)(
        'throws ReplayParseError when %s is not a string',
        (field) => {
            const raw: unknown = { ...makePerspectiveReplayFile(), [field]: 42 };

            expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
        },
    );

    it.each(['engineVersion', 'gameId', 'gameVersion'] as const)(
        'throws ReplayParseError when %s is absent',
        (field) => {
            const { [field]: _omit, ...rest } = makePerspectiveReplayFile();
            const raw: unknown = rest;

            expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
        },
    );
});

// ─── parsePerspectiveReplayFile — recordedAt (OWASP A08 integrity) ──────────────

describe('parsePerspectiveReplayFile — recordedAt', () => {
    it('throws ReplayParseError when recordedAt is not a string', () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), recordedAt: 1717322400000 };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when recordedAt is not an ISO-8601 UTC timestamp', () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), recordedAt: '2026-06-02 10:00' };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parsePerspectiveReplayFile — durationTicks ─────────────────────────────────

describe('parsePerspectiveReplayFile — durationTicks', () => {
    it('throws ReplayParseError when durationTicks is absent', () => {
        const { durationTicks: _omit, ...rest } = makePerspectiveReplayFile();
        const raw: unknown = rest;

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when durationTicks is not an integer', () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), durationTicks: 2.5 };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when durationTicks is negative', () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), durationTicks: -1 };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parsePerspectiveReplayFile — players ───────────────────────────────────────

describe('parsePerspectiveReplayFile — players', () => {
    it('throws ReplayParseError when players is not an array', () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), players: {} };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when a players entry is malformed', () => {
        const raw: unknown = {
            ...makePerspectiveReplayFile(),
            players: [{ playerId: 'p1' }],
        };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parsePerspectiveReplayFile — missing viewerId (Inv #98) ─────────────────────

describe('parsePerspectiveReplayFile — viewerId', () => {
    it('throws ReplayParseError when viewerId is absent', () => {
        const { viewerId: _viewerId, ...noViewer } = makePerspectiveReplayFile();
        const raw: unknown = noViewer;

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when viewerId is empty', () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), viewerId: '' };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when viewerId is not a string', () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), viewerId: 42 };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parsePerspectiveReplayFile — missing frames (Inv #98) ───────────────────────

describe('parsePerspectiveReplayFile — frames', () => {
    it('throws ReplayParseError when frames is absent', () => {
        const { frames: _frames, ...noFrames } = makePerspectiveReplayFile();
        const raw: unknown = noFrames;

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when frames is not an array', () => {
        const raw: unknown = { ...makePerspectiveReplayFile(), frames: {} };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when a frame.tick is negative', () => {
        const viewerId = toPlayerId('p1');
        const raw: unknown = {
            ...makePerspectiveReplayFile({ viewerId }),
            frames: [{ tick: -1, snapshot: makeSnapshot(viewerId, 0) }],
        };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when a frame.snapshot is missing', () => {
        const raw: unknown = {
            ...makePerspectiveReplayFile(),
            frames: [{ tick: 0 }],
        };

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when a frame.tick disagrees with snapshot.tick', () => {
        const viewerId = toPlayerId('p1');
        const raw: unknown = makePerspectiveReplayFile({
            viewerId,
            frames: [{ tick: 5, snapshot: makeSnapshot(viewerId, 4) }],
        });

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parsePerspectiveReplayFile — frame tick ordering (Inv #98) ──────────────────

describe('parsePerspectiveReplayFile — frame tick ordering', () => {
    it('accepts frames with strictly increasing, non-contiguous ticks', () => {
        const viewerId = toPlayerId('p1');
        const raw: unknown = makePerspectiveReplayFile({
            viewerId,
            frames: [makeFrame(viewerId, 0), makeFrame(viewerId, 5), makeFrame(viewerId, 9)],
            durationTicks: 9,
        });

        expect(() => parsePerspectiveReplayFile(raw)).not.toThrow();
    });

    it('throws ReplayParseError when frame ticks are out of order', () => {
        const viewerId = toPlayerId('p1');
        const raw: unknown = makePerspectiveReplayFile({
            viewerId,
            frames: [makeFrame(viewerId, 1), makeFrame(viewerId, 0)],
        });

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when consecutive frame ticks are duplicated', () => {
        const viewerId = toPlayerId('p1');
        const raw: unknown = makePerspectiveReplayFile({
            viewerId,
            frames: [makeFrame(viewerId, 0), makeFrame(viewerId, 0)],
        });

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── parsePerspectiveReplayFile — frame viewerId lock (Inv #98) ──────────────────

describe('parsePerspectiveReplayFile — frame viewerId lock', () => {
    it('throws ReplayParseError when any frame snapshot.viewerId differs from file viewerId', () => {
        const viewerId = toPlayerId('p1');
        const raw: unknown = makePerspectiveReplayFile({
            viewerId,
            frames: [makeFrame(viewerId, 0), makeFrame(toPlayerId('p2'), 1)],
        });

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });

    it('throws ReplayParseError when a frame snapshot.viewerId is not a string', () => {
        const viewerId = toPlayerId('p1');
        const snapshot = { ...makeSnapshot(viewerId, 0), viewerId: 7 };
        const raw: unknown = makePerspectiveReplayFile({
            viewerId,
            frames: [{ tick: 0, snapshot } as unknown as PerspectiveReplayFrame],
        });

        expect(() => parsePerspectiveReplayFile(raw)).toThrowError(ReplayParseError);
    });
});

// ─── ReplayParseError reuse ─────────────────────────────────────────────────────

describe('parsePerspectiveReplayFile — error type', () => {
    it('throws an error named ReplayParseError', () => {
        let caught: unknown;
        try {
            parsePerspectiveReplayFile(null);
        } catch (err) {
            caught = err;
        }

        expect(caught).toBeInstanceOf(ReplayParseError);
        expect((caught as Error).name).toBe('ReplayParseError');
    });
});
