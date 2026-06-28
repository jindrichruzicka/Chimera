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
    serializePerspectiveReplayCompressed,
    deserializePerspectiveReplayCompressed,
    CompressedPerspectiveReplaySerializer,
    diffSnapshots,
    applySnapshotDelta,
    encodeFrameStream,
    decodeFrameStream,
    DEFAULT_KEYFRAME_INTERVAL,
} from './CompressedReplaySerializer.js';
import { serializeReplay } from '@chimera-engine/simulation/replay/index.js';
import { ReplayParseError } from '@chimera-engine/simulation/replay/index.js';
import type {
    ReplayFile,
    PerspectiveReplayFile,
    PerspectiveReplayFrame,
} from '@chimera-engine/simulation/replay/index.js';
import type { PlayerSnapshot } from '@chimera-engine/simulation/projection/StateProjector.js';
import { playerId as toPlayerId } from '@chimera-engine/simulation/engine/index.js';
import { gamePhase } from '@chimera-engine/simulation/engine/types.js';

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

// ─── Perspective replay helpers ─────────────────────────────────────────────────

const VIEWER = toPlayerId('p1');

function snap(tick: number, extra: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    return {
        tick,
        viewerId: VIEWER,
        phase: gamePhase('playing'),
        players: {},
        entities: {},
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: tick % 2 === 0,
        ...extra,
    };
}

function makePerspectiveFile(
    frames: PerspectiveReplayFrame[],
    overrides: Partial<PerspectiveReplayFile> = {},
): PerspectiveReplayFile {
    return {
        formatVersion: 1,
        kind: 'perspective',
        engineVersion: '0.7.0',
        gameId: 'tactics',
        gameVersion: '0.1.0',
        viewerId: VIEWER,
        recordedAt: '2026-06-02T10:00:00.000Z',
        durationTicks: frames.length === 0 ? 0 : (frames[frames.length - 1]?.tick ?? 0),
        players: [{ playerId: VIEWER, displayName: 'Player One' }],
        frames,
        ...overrides,
    };
}

/** A run of `count` frames at consecutive ticks 0..count-1. */
function consecutiveFrames(count: number): PerspectiveReplayFrame[] {
    return Array.from({ length: count }, (_, tick) => ({ tick, snapshot: snap(tick) }));
}

// ─── diffSnapshots / applySnapshotDelta (pure structural delta) ─────────────────

describe('diffSnapshots / applySnapshotDelta', () => {
    it('round-trips a primitive change', () => {
        const prev = { a: 1, b: 2 };
        const next = { a: 1, b: 3 };

        expect(applySnapshotDelta(prev, diffSnapshots(prev, next))).toStrictEqual(next);
    });

    it('round-trips a nested-object change', () => {
        const prev = { p: { x: { y: 1 }, z: 2 } };
        const next = { p: { x: { y: 9 }, z: 2 } };

        expect(applySnapshotDelta(prev, diffSnapshots(prev, next))).toStrictEqual(next);
    });

    it('round-trips an array replacement (arrays are atomic)', () => {
        const prev = { events: [1, 2, 3] };
        const next = { events: [1, 2, 3, 4] };

        expect(applySnapshotDelta(prev, diffSnapshots(prev, next))).toStrictEqual(next);
    });

    it('round-trips a null ↔ object change in both directions', () => {
        const prev = { gameResult: null as unknown };
        const next = { gameResult: { winner: 'p1' } as unknown };

        expect(applySnapshotDelta(prev, diffSnapshots(prev, next))).toStrictEqual(next);
        expect(applySnapshotDelta(next, diffSnapshots(next, prev))).toStrictEqual(prev);
    });

    it('round-trips a type change (object → primitive)', () => {
        const prev = { v: { nested: true } as unknown };
        const next = { v: 5 as unknown };

        expect(applySnapshotDelta(prev, diffSnapshots(prev, next))).toStrictEqual(next);
    });

    it('round-trips key addition and removal', () => {
        const prev = { a: 1, gone: true };
        const next = { a: 1, added: 'x' };

        expect(applySnapshotDelta(prev, diffSnapshots(prev, next))).toStrictEqual(next);
    });

    it('produces an empty delta for equal objects', () => {
        const obj = { a: 1, b: { c: 2 } };

        expect(diffSnapshots(obj, { ...obj, b: { c: 2 } })).toStrictEqual({});
    });

    it('does not mutate the previous object when applying a delta', () => {
        const prev = { p: { x: 1 } };
        const frozenPrev = JSON.parse(JSON.stringify(prev)) as typeof prev;
        const next = { p: { x: 2 } };

        applySnapshotDelta(prev, diffSnapshots(prev, next));

        expect(prev).toStrictEqual(frozenPrev);
    });
});

// ─── encodeFrameStream / decodeFrameStream ──────────────────────────────────────

describe('encodeFrameStream / decodeFrameStream', () => {
    it('emits the first frame as a keyframe', () => {
        const encoded = encodeFrameStream(consecutiveFrames(3), 256);

        expect(encoded[0]?.kind).toBe('keyframe');
    });

    it('emits a keyframe every N ticks and deltas in between', () => {
        const encoded = encodeFrameStream(consecutiveFrames(10), 4);

        const keyframeTicks = encoded.filter((f) => f.kind === 'keyframe').map((f) => f.tick);
        expect(keyframeTicks).toStrictEqual([0, 4, 8]);
        // Everything else is a delta.
        expect(encoded.filter((f) => f.kind === 'delta').map((f) => f.tick)).toStrictEqual([
            1, 2, 3, 5, 6, 7, 9,
        ]);
    });

    it('round-trips the frame stream exactly through encode → decode', () => {
        const frames = consecutiveFrames(20);

        expect(decodeFrameStream(encodeFrameStream(frames, 4))).toStrictEqual(frames);
    });

    it('round-trips an empty frame stream', () => {
        expect(decodeFrameStream(encodeFrameStream([], 256))).toStrictEqual([]);
    });
});

// ─── serializePerspectiveReplayCompressed round-trip ────────────────────────────

describe('serializePerspectiveReplayCompressed', () => {
    it('resolves to a Buffer', async () => {
        const buf = await serializePerspectiveReplayCompressed(
            makePerspectiveFile(consecutiveFrames(5)),
        );

        expect(Buffer.isBuffer(buf)).toBe(true);
    });

    it('round-trips the frame stream exactly at the snapshot level (default interval)', async () => {
        const file = makePerspectiveFile(consecutiveFrames(300));

        const result = await deserializePerspectiveReplayCompressed(
            await serializePerspectiveReplayCompressed(file),
        );

        expect(result).toStrictEqual(file);
    });

    it('round-trips exactly with a custom keyframe interval', async () => {
        const file = makePerspectiveFile(consecutiveFrames(20));

        const result = await deserializePerspectiveReplayCompressed(
            await serializePerspectiveReplayCompressed(file, { keyframeInterval: 3 }),
        );

        expect(result).toStrictEqual(file);
    });

    it('round-trips frames carrying nested, array, and null variation', async () => {
        const frames: PerspectiveReplayFrame[] = [
            { tick: 0, snapshot: snap(0, { gameResult: null }) },
            {
                tick: 1,
                snapshot: snap(1, {
                    events: [{ kind: 'noticed' } as never],
                    sceneId: 'battle' as never,
                }),
            },
            { tick: 2, snapshot: snap(2, { gameResult: { foo: 'bar' } as never }) },
        ];
        const file = makePerspectiveFile(frames, { durationTicks: 2 });

        const result = await deserializePerspectiveReplayCompressed(
            await serializePerspectiveReplayCompressed(file, { keyframeInterval: 256 }),
        );

        expect(result).toStrictEqual(file);
    });

    it('produces smaller output than raw JSON for a repetitive frame stream', async () => {
        const file = makePerspectiveFile(consecutiveFrames(300));

        const jsonSize = Buffer.from(JSON.stringify(file), 'utf8').length;
        const compressedSize = (await serializePerspectiveReplayCompressed(file)).length;

        expect(compressedSize).toBeLessThan(jsonSize);
    });
});

describe('deserializePerspectiveReplayCompressed', () => {
    it('throws ReplayParseError when given non-gzip data', async () => {
        const bad = Buffer.from('this is not gzip', 'utf8');

        await expect(deserializePerspectiveReplayCompressed(bad)).rejects.toBeInstanceOf(
            ReplayParseError,
        );
    });

    it('throws ReplayParseError when decompressed bytes are invalid JSON', async () => {
        const { gzip } = await import('node:zlib');
        const { promisify } = await import('node:util');
        const gzipAsync = promisify(gzip);

        const bad = await gzipAsync(Buffer.from('not valid json', 'utf8'));

        await expect(deserializePerspectiveReplayCompressed(bad)).rejects.toBeInstanceOf(
            ReplayParseError,
        );
    });

    it('rejects a __proto__ key in the encoded envelope without polluting Object.prototype', async () => {
        const { gzip } = await import('node:zlib');
        const { promisify } = await import('node:util');
        const gzipAsync = promisify(gzip);

        // A hand-built envelope whose delta is otherwise valid (it advances the
        // snapshot tick so it would pass parsePerspectiveReplayFile) but carries
        // a __proto__ key. Parsing must reject it explicitly — parity with
        // deserializeReplay's safeReviver — rather than relying on the emergent
        // safety of structuredClone + own-key assignment, which lets the key
        // through silently today.
        //
        // The __proto__ key is spliced into the serialized JSON textually: an
        // object-literal `__proto__:` would set the prototype, so JSON.stringify
        // would drop it and the key would never reach the wire.
        const envelope = JSON.stringify({
            formatVersion: 1,
            kind: 'perspective',
            engineVersion: '0.7.0',
            gameId: 'tactics',
            gameVersion: '0.1.0',
            viewerId: String(VIEWER),
            recordedAt: '2026-06-02T10:00:00.000Z',
            durationTicks: 1,
            players: [{ playerId: String(VIEWER), displayName: 'Player One' }],
            keyframeInterval: 256,
            frames: [
                { kind: 'keyframe', tick: 0, snapshot: snap(0) },
                { kind: 'delta', tick: 1, delta: { s: { tick: 1 } } },
            ],
        });
        const maliciousEnvelope = envelope.replace(
            '"s":{"tick":1}',
            '"s":{"tick":1,"__proto__":{"polluted":true}}',
        );
        expect(maliciousEnvelope).toContain('__proto__'); // splice landed
        const buf = await gzipAsync(Buffer.from(maliciousEnvelope, 'utf8'));

        await expect(deserializePerspectiveReplayCompressed(buf)).rejects.toThrow(/__proto__/);
        expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('throws ReplayParseError when the decoded stream violates invariant #98', async () => {
        // Two frames at the same tick — strictly-increasing ticks are required by
        // parsePerspectiveReplayFile, so the round-trip must reject on read.
        const frames = [
            { tick: 0, snapshot: snap(0) },
            { tick: 0, snapshot: snap(0) },
        ] as PerspectiveReplayFrame[];
        const malformed = makePerspectiveFile(frames, { durationTicks: 0 });

        const buf = await serializePerspectiveReplayCompressed(malformed);

        await expect(deserializePerspectiveReplayCompressed(buf)).rejects.toBeInstanceOf(
            ReplayParseError,
        );
    });
});

describe('CompressedPerspectiveReplaySerializer', () => {
    it('defaults to a keyframe interval of 256', () => {
        expect(DEFAULT_KEYFRAME_INTERVAL).toBe(256);
    });

    it('serialize resolves to a Buffer and round-trips exactly', async () => {
        const serializer = new CompressedPerspectiveReplaySerializer();
        const file = makePerspectiveFile(consecutiveFrames(300));

        const raw = await serializer.serialize(file);
        expect(Buffer.isBuffer(raw)).toBe(true);

        expect(await serializer.deserialize(raw)).toStrictEqual(file);
    });

    it('honours a configurable keyframe interval', async () => {
        const serializer = new CompressedPerspectiveReplaySerializer({ keyframeInterval: 2 });
        const file = makePerspectiveFile(consecutiveFrames(10));

        expect(await serializer.deserialize(await serializer.serialize(file))).toStrictEqual(file);
    });

    it('accepts a string handed to deserialize', async () => {
        const serializer = new CompressedPerspectiveReplaySerializer();
        const file = makePerspectiveFile(consecutiveFrames(4));
        const raw = await serializer.serialize(file);

        // FilePerspectiveReplayRepository hands back a Buffer, but the interface
        // also permits a latin1 string round-trip.
        const asString = raw.toString('latin1');
        expect(await serializer.deserialize(asString)).toStrictEqual(file);
    });
});
