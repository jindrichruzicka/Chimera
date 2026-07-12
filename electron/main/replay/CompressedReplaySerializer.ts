/**
 * electron/main/replay/CompressedReplaySerializer.ts
 *
 * Async gzip-compressed replay serializer: wraps the pure
 * simulation-layer JSON functions with non-blocking zlib compression.
 *
 * Lives in electron/main/replay/ so that Node.js imports (node:zlib,
 * node:util) stay outside simulation/, satisfying invariant #1.
 *
 * Architecture reference: §4.28
 *
 * Two storage strategies live here:
 *   - Deterministic replays (`ReplayFile`): the whole JSON is gzipped — the file
 *     is an action log, already compact.
 *   - Perspective replays (`PerspectiveReplayFile`): one projected `PlayerSnapshot`
 *     per tick is far bulkier, so the frame stream is encoded as a full keyframe
 *     every N ticks (default 256) plus structural JSON deltas in between, then
 *     gzipped. The transform round-trips the frame stream exactly at the snapshot
 *     level (`deserialize(serialize(file))` deep-equals `file`).
 *
 * Invariants upheld:
 *   #1 — simulation/ has zero Node.js imports. This file is in electron/main/.
 *   #43 — the pure serializeReplay/deserializeReplay in simulation/ are untouched;
 *         the diff/encode helpers below are pure (no Date.now / Math.random).
 *   #98 — deserializePerspectiveReplayCompressed re-validates the decoded file
 *         through parsePerspectiveReplayFile (locked viewerId, strict tick order).
 */

import { promisify } from 'node:util';
import { gzip, gunzip } from 'node:zlib';
import {
    serializeReplay,
    deserializeReplay,
    parsePerspectiveReplayFile,
    safeReviver,
} from '@chimera-engine/simulation/replay/index.js';
import type {
    ReplayFile,
    ReplaySerializer,
    PerspectiveReplayFile,
    PerspectiveReplayFrame,
    PerspectiveReplaySerializer,
} from '@chimera-engine/simulation/replay/index.js';
import type { PlayerSnapshot } from '@chimera-engine/simulation/projection/StateProjector.js';
import { ReplayParseError } from '@chimera-engine/simulation/replay/index.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/**
 * Compresses the JSON representation of a `ReplayFile` with async gzip.
 *
 * `serializeReplayCompressed` returns a `Promise<Buffer>`.
 * `deserializeReplayCompressed` expects a `Buffer`.
 * Neither method blocks the event loop.
 *
 * Use this for production replay exports. Use the plain simulation-layer
 * `serializeReplay`/`deserializeReplay` when human-readability matters.
 */
export async function serializeReplayCompressed(file: ReplayFile): Promise<Buffer> {
    const json = serializeReplay(file);
    return gzipAsync(Buffer.from(json, 'utf8'));
}

export async function deserializeReplayCompressed(buf: Buffer): Promise<ReplayFile> {
    let decompressed: Buffer;
    try {
        decompressed = await gunzipAsync(buf);
    } catch (cause) {
        throw new ReplayParseError(
            `Compressed replay data could not be decompressed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
    }
    return deserializeReplay(decompressed.toString('utf8'));
}

/**
 * `ReplaySerializer` strategy backed by the async gzip functions above.
 *
 * Inject this into `FileReplayRepository` for space-efficient production
 * storage; inject `JsonReplaySerializer` (simulation/replay) when
 * human-readable output is preferred.
 */
export class CompressedReplaySerializer implements ReplaySerializer {
    serialize(file: ReplayFile): Promise<Buffer> {
        return serializeReplayCompressed(file);
    }

    deserialize(raw: string | Buffer): Promise<ReplayFile> {
        const buf = typeof raw === 'string' ? Buffer.from(raw, 'utf8') : raw;
        return deserializeReplayCompressed(buf);
    }
}

// ─── Perspective replay: keyframe + structural-delta snapshot stream ─────────────

/** Default number of ticks between full keyframes in a perspective frame stream. */
export const DEFAULT_KEYFRAME_INTERVAL = 256;

type JsonObject = Record<string, unknown>;

/**
 * A structural delta between two plain objects, applied on top of the previous
 * object to reconstruct the next one:
 *   - `s` — keys whose value is replaced wholesale (added keys, primitives,
 *     arrays, and type changes; arrays are treated atomically).
 *   - `p` — keys whose value is itself a (nested) object delta — recurse.
 *   - `d` — keys present in the previous object but absent from the next.
 * Omitted parts mean "no change of that kind". An all-omitted `{}` delta means
 * the two objects are structurally equal.
 */
export interface SnapshotDelta {
    s?: JsonObject;
    p?: Record<string, SnapshotDelta>;
    d?: string[];
}

/** One entry in an encoded perspective frame stream. */
export type EncodedFrame =
    | { readonly kind: 'keyframe'; readonly tick: number; readonly snapshot: PlayerSnapshot }
    | { readonly kind: 'delta'; readonly tick: number; readonly delta: SnapshotDelta };

/** The gzipped envelope written to disk for a perspective replay. */
interface EncodedPerspectiveReplay {
    readonly formatVersion: 1;
    readonly kind: 'perspective';
    readonly engineVersion: string;
    readonly gameId: string;
    readonly gameVersion: string;
    readonly viewerId: string;
    readonly recordedAt: string;
    readonly durationTicks: number;
    readonly players: PerspectiveReplayFile['players'];
    readonly keyframeInterval: number;
    readonly frames: readonly EncodedFrame[];
}

/** A plain (non-null, non-array) object — eligible for recursive diffing. */
function isPlainObject(value: unknown): value is JsonObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Structural equality over JSON values (arrays compared atomically by content). */
function deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
        return a.every((item, i) => deepEqual(item, b[i]));
    }
    if (isPlainObject(a) && isPlainObject(b)) {
        const ak = Object.keys(a);
        const bk = Object.keys(b);
        if (ak.length !== bk.length) return false;
        return ak.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
    }
    return false;
}

/**
 * Compute the structural delta turning `prev` into `next`. Pure: neither input is
 * mutated. Nested plain objects recurse; arrays, primitives, and type changes are
 * stored wholesale so reconstruction is exact (invariant #43).
 */
export function diffSnapshots(prev: JsonObject, next: JsonObject): SnapshotDelta {
    const delta: SnapshotDelta = {};
    const set: JsonObject = {};
    const patch: Record<string, SnapshotDelta> = {};
    const del: string[] = [];

    for (const key of Object.keys(next)) {
        if (!Object.prototype.hasOwnProperty.call(prev, key)) {
            set[key] = next[key];
            continue;
        }
        const prevValue = prev[key];
        const nextValue = next[key];
        if (isPlainObject(prevValue) && isPlainObject(nextValue)) {
            const child = diffSnapshots(prevValue, nextValue);
            if (Object.keys(child).length > 0) {
                patch[key] = child;
            }
        } else if (!deepEqual(prevValue, nextValue)) {
            set[key] = nextValue;
        }
    }

    for (const key of Object.keys(prev)) {
        if (!Object.prototype.hasOwnProperty.call(next, key)) {
            del.push(key);
        }
    }

    if (Object.keys(set).length > 0) delta.s = set;
    if (Object.keys(patch).length > 0) delta.p = patch;
    if (del.length > 0) delta.d = del;
    return delta;
}

/**
 * Reconstruct the next object by applying `delta` to a deep clone of `prev`. Pure:
 * `prev` is never mutated. Inverse of {@link diffSnapshots}.
 */
export function applySnapshotDelta(prev: JsonObject, delta: SnapshotDelta): JsonObject {
    const result = structuredClone(prev);

    for (const key of delta.d ?? []) {
        delete result[key];
    }
    if (delta.s) {
        for (const key of Object.keys(delta.s)) {
            result[key] = structuredClone(delta.s[key]);
        }
    }
    if (delta.p) {
        for (const key of Object.keys(delta.p)) {
            const childDelta = delta.p[key];
            if (childDelta === undefined) continue;
            const base = result[key];
            result[key] = applySnapshotDelta(isPlainObject(base) ? base : {}, childDelta);
        }
    }
    return result;
}

/**
 * Encode a perspective frame stream: a full keyframe for the first frame and
 * whenever `tick - lastKeyframeTick >= keyframeInterval`, otherwise a structural
 * delta against the immediately-preceding frame's snapshot.
 */
export function encodeFrameStream(
    frames: readonly PerspectiveReplayFrame[],
    keyframeInterval: number,
): EncodedFrame[] {
    const encoded: EncodedFrame[] = [];
    let prevSnapshot: JsonObject | null = null;
    let lastKeyframeTick = 0;

    for (const frame of frames) {
        const snapshot = frame.snapshot as unknown as JsonObject;
        // Delta only when there is a prior frame within the keyframe window; the
        // `prevSnapshot !== null` guard also narrows it to JsonObject for the diff.
        if (prevSnapshot !== null && frame.tick - lastKeyframeTick < keyframeInterval) {
            encoded.push({
                kind: 'delta',
                tick: frame.tick,
                delta: diffSnapshots(prevSnapshot, snapshot),
            });
        } else {
            encoded.push({ kind: 'keyframe', tick: frame.tick, snapshot: frame.snapshot });
            lastKeyframeTick = frame.tick;
        }
        prevSnapshot = snapshot;
    }

    return encoded;
}

/**
 * Decode an encoded frame stream back to `PerspectiveReplayFrame[]`, applying each
 * delta to the running snapshot. Exact inverse of {@link encodeFrameStream}.
 */
export function decodeFrameStream(encoded: readonly EncodedFrame[]): PerspectiveReplayFrame[] {
    const frames: PerspectiveReplayFrame[] = [];
    let prevSnapshot: JsonObject | null = null;

    for (const entry of encoded) {
        let snapshot: JsonObject;
        if (entry.kind === 'keyframe') {
            snapshot = entry.snapshot as unknown as JsonObject;
        } else {
            if (prevSnapshot === null) {
                throw new ReplayParseError(
                    'Perspective replay frame stream starts with a delta frame (expected a keyframe)',
                );
            }
            snapshot = applySnapshotDelta(prevSnapshot, entry.delta);
        }
        frames.push({ tick: entry.tick, snapshot: snapshot as unknown as PlayerSnapshot });
        prevSnapshot = snapshot;
    }

    return frames;
}

/**
 * Serialise a `PerspectiveReplayFile` to gzipped keyframe/delta bytes. The header
 * is stored verbatim; only the frame stream is keyframe/delta encoded. Returns a
 * `Promise<Buffer>` and never blocks the event loop.
 */
export async function serializePerspectiveReplayCompressed(
    file: PerspectiveReplayFile,
    opts: { keyframeInterval?: number } = {},
): Promise<Buffer> {
    const keyframeInterval = opts.keyframeInterval ?? DEFAULT_KEYFRAME_INTERVAL;
    const envelope: EncodedPerspectiveReplay = {
        formatVersion: file.formatVersion,
        kind: file.kind,
        engineVersion: file.engineVersion,
        gameId: file.gameId,
        gameVersion: file.gameVersion,
        viewerId: file.viewerId,
        recordedAt: file.recordedAt,
        durationTicks: file.durationTicks,
        players: file.players,
        keyframeInterval,
        frames: encodeFrameStream(file.frames, keyframeInterval),
    };
    return gzipAsync(Buffer.from(JSON.stringify(envelope), 'utf8'));
}

/**
 * Inverse of {@link serializePerspectiveReplayCompressed}. Decompresses, decodes
 * the keyframe/delta frame stream, then re-validates the assembled file through
 * `parsePerspectiveReplayFile` so a malformed stream (e.g. a broken viewerId lock
 * or non-increasing ticks) is rejected on read (invariant #98).
 */
export async function deserializePerspectiveReplayCompressed(
    buf: Buffer,
): Promise<PerspectiveReplayFile> {
    let decompressed: Buffer;
    try {
        decompressed = await gunzipAsync(buf);
    } catch (cause) {
        throw new ReplayParseError(
            `Compressed perspective replay data could not be decompressed: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
    }

    let envelope: EncodedPerspectiveReplay;
    try {
        // Parse with the same __proto__-rejecting reviver as deserializeReplay so
        // a __proto__ key anywhere in the envelope (including inside a delta) is
        // rejected explicitly, rather than depending on the emergent safety of
        // structuredClone + own-key assignment in applySnapshotDelta (OWASP A08).
        envelope = JSON.parse(
            decompressed.toString('utf8'),
            safeReviver,
        ) as EncodedPerspectiveReplay;
    } catch (cause) {
        if (cause instanceof ReplayParseError) {
            throw cause;
        }
        throw new ReplayParseError(
            `Perspective replay JSON is not valid: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
    }
    if (!isPlainObject(envelope) || !Array.isArray(envelope.frames)) {
        throw new ReplayParseError(
            'Perspective replay envelope is malformed: missing encoded frame stream',
        );
    }

    const assembled = {
        formatVersion: envelope.formatVersion,
        kind: envelope.kind,
        engineVersion: envelope.engineVersion,
        gameId: envelope.gameId,
        gameVersion: envelope.gameVersion,
        viewerId: envelope.viewerId,
        recordedAt: envelope.recordedAt,
        durationTicks: envelope.durationTicks,
        players: envelope.players,
        frames: decodeFrameStream(envelope.frames),
    };

    return parsePerspectiveReplayFile(assembled);
}

/**
 * `PerspectiveReplaySerializer` strategy backed by the keyframe/delta + gzip
 * functions above. Inject this into `FilePerspectiveReplayRepository`. The
 * keyframe interval is configurable (default {@link DEFAULT_KEYFRAME_INTERVAL}).
 */
export class CompressedPerspectiveReplaySerializer implements PerspectiveReplaySerializer {
    private readonly keyframeInterval: number;

    constructor(opts: { keyframeInterval?: number } = {}) {
        this.keyframeInterval = opts.keyframeInterval ?? DEFAULT_KEYFRAME_INTERVAL;
    }

    serialize(file: PerspectiveReplayFile): Promise<Buffer> {
        return serializePerspectiveReplayCompressed(file, {
            keyframeInterval: this.keyframeInterval,
        });
    }

    deserialize(raw: string | Buffer): Promise<PerspectiveReplayFile> {
        // gzip output is binary; a string handle must be decoded with a
        // byte-preserving encoding (latin1), never utf8.
        const buf = typeof raw === 'string' ? Buffer.from(raw, 'latin1') : raw;
        return deserializePerspectiveReplayCompressed(buf);
    }
}
