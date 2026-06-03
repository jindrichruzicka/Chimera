/**
 * simulation/replay/PerspectiveReplayFile.ts
 *
 * PerspectiveReplayFile schema, associated types, and structural validation.
 * Pure type declarations and pure functions — zero I/O, no Node.js APIs.
 *
 * A *perspective* replay is the privacy-preserving counterpart to the
 * deterministic `ReplayFile` (`./ReplayFile.ts`). Instead of replaying
 * `{ seed, gameConfig, actions }` through the live pipeline, it stores a
 * sequence of already-projected `PlayerSnapshot` frames for a single,
 * **locked** `viewerId`. It therefore carries only what one player legitimately
 * saw — no host-internal `seed`, `gameConfig`, or `actions`.
 *
 * The `kind: 'perspective'` literal discriminates this file from the
 * deterministic `ReplayFile` (which has no `kind`); both kinds coexist on disk.
 *
 * Architecture reference: §4.28 (ADR F44b)
 * Task: F44b / T1 (issue #667)
 *
 * Invariants upheld:
 *   #1  — simulation/ has zero runtime deps on React, DOM, or networking
 *   #42 — tick values are plain integers throughout
 *   #43 — parser is pure; no I/O, no Date.now()
 *   #98 — perspective replays carry only projected PlayerSnapshots for a single
 *         locked, immutable viewerId; malformed if viewerId/frames missing, if
 *         any frame's snapshot.viewerId differs from the file's viewerId, or if
 *         frame ticks are not strictly increasing
 */

import type { PlayerId } from '../engine/types.js';
import type { PlayerSnapshot } from '../projection/StateProjector.js';
import { isIso8601UtcTimestamp } from './iso8601.js';
import {
    ReplayParseError,
    validateReplayPlayerMetadata,
    type ReplayPlayerMetadata,
} from './ReplayFile.js';

// ─── PerspectiveReplayHeader ────────────────────────────────────────────────────

/**
 * The metadata-only view of a perspective replay: everything except the
 * per-tick `frames`. `viewerId` is **LOCKED** — every frame in the file must be
 * projected for this exact viewer (invariant #98).
 *
 * Deliberately carries no `seed`, `gameConfig`, or `actions`: a perspective
 * replay is not re-simulated, so it never holds host-internal state.
 */
export interface PerspectiveReplayHeader {
    readonly formatVersion: 1;
    readonly kind: 'perspective';
    readonly engineVersion: string;
    readonly gameId: string;
    readonly gameVersion: string;
    /** The single, immutable viewer whose projection this replay captures. */
    readonly viewerId: PlayerId;
    /** ISO-8601 UTC timestamp captured at recording start. */
    readonly recordedAt: string;
    readonly durationTicks: number;
    readonly players: readonly ReplayPlayerMetadata[];
}

// ─── PerspectiveReplayFrame ─────────────────────────────────────────────────────

/**
 * A single recorded frame: the projected `PlayerSnapshot` at a given tick.
 * `tick` must be a non-negative integer (invariant #42). The snapshot's
 * `viewerId` must equal the file's locked `viewerId` (invariant #98).
 */
export interface PerspectiveReplayFrame {
    readonly tick: number;
    readonly snapshot: PlayerSnapshot;
}

// ─── PerspectiveReplayFile ──────────────────────────────────────────────────────

/**
 * The complete, self-contained perspective replay file schema.
 *
 * Stored as JSON. Playback simply walks `frames` in order — no re-simulation,
 * no pipeline. Frames are therefore ordered by strictly increasing `tick`. Any
 * file missing `viewerId` or `frames`, carrying a frame whose `snapshot.viewerId`
 * differs from the file's `viewerId`, or whose frame ticks are not strictly
 * increasing, is malformed (invariant #98).
 */
export interface PerspectiveReplayFile extends PerspectiveReplayHeader {
    readonly frames: readonly PerspectiveReplayFrame[];
}

// ─── parsePerspectiveReplayFile ─────────────────────────────────────────────────

/**
 * Validates that `raw` has the structural shape of a `PerspectiveReplayFile`
 * and returns it cast to that type. Unknown extra fields are preserved for
 * forward compatibility — this is intentionally NOT a strict-shape parser, and
 * it deliberately does not deep-validate the `PlayerSnapshot` payload beyond its
 * `viewerId` (mirroring how `parseReplayFile` leaves the `EngineAction` payload
 * to the action registry).
 *
 * Throws `ReplayParseError` if any required field is missing or has an incorrect
 * type, if any frame's `snapshot.viewerId` differs from the file's locked
 * `viewerId`, or if frame ticks are not strictly increasing (invariant #98).
 * Does not perform I/O; pure function (invariant #43).
 */
export function parsePerspectiveReplayFile(raw: unknown): PerspectiveReplayFile {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ReplayParseError(
            `Perspective replay file must be a plain object, got ${raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw}`,
        );
    }

    const obj = raw as Record<string, unknown>;

    // ── formatVersion ────────────────────────────────────────────────────────
    // `!== 1` subsumes the undefined / null / non-integer cases, so the single
    // strict-equality check is sufficient (and rejects all of them).
    const formatVersion = obj['formatVersion'];
    if (formatVersion !== 1) {
        throw new ReplayParseError(
            `Perspective replay file requires 'formatVersion' to be 1, got ${JSON.stringify(formatVersion)}`,
        );
    }

    // ── kind (discriminator — distinguishes from the deterministic ReplayFile) ─
    const kind = obj['kind'];
    if (kind !== 'perspective') {
        throw new ReplayParseError(
            `Perspective replay file requires 'kind' to be 'perspective', got ${JSON.stringify(kind)}`,
        );
    }

    // ── engineVersion ────────────────────────────────────────────────────────
    const engineVersion = obj['engineVersion'];
    if (typeof engineVersion !== 'string') {
        throw new ReplayParseError(
            `Perspective replay file requires 'engineVersion' to be a string, got ${JSON.stringify(engineVersion)}`,
        );
    }

    // ── gameId ───────────────────────────────────────────────────────────────
    const gameId = obj['gameId'];
    if (typeof gameId !== 'string') {
        throw new ReplayParseError(
            `Perspective replay file requires 'gameId' to be a string, got ${JSON.stringify(gameId)}`,
        );
    }

    // ── gameVersion ──────────────────────────────────────────────────────────
    const gameVersion = obj['gameVersion'];
    if (typeof gameVersion !== 'string') {
        throw new ReplayParseError(
            `Perspective replay file requires 'gameVersion' to be a string, got ${JSON.stringify(gameVersion)}`,
        );
    }

    // ── viewerId (mandatory, non-empty, LOCKED — invariant #98) ──────────────
    const viewerId = obj['viewerId'];
    if (typeof viewerId !== 'string' || viewerId.length === 0) {
        throw new ReplayParseError(
            `Perspective replay file requires 'viewerId' to be a non-empty string, got ${JSON.stringify(viewerId)}`,
        );
    }

    // ── recordedAt ───────────────────────────────────────────────────────────
    const recordedAt = obj['recordedAt'];
    if (typeof recordedAt !== 'string') {
        throw new ReplayParseError(
            `Perspective replay file requires 'recordedAt' to be a string, got ${JSON.stringify(recordedAt)}`,
        );
    }
    if (!isIso8601UtcTimestamp(recordedAt)) {
        throw new ReplayParseError(
            `Perspective replay file requires 'recordedAt' to be an ISO-8601 UTC timestamp, got ${JSON.stringify(recordedAt)}`,
        );
    }

    // ── durationTicks ────────────────────────────────────────────────────────
    const durationTicks = obj['durationTicks'];
    if (
        durationTicks === undefined ||
        !Number.isInteger(durationTicks) ||
        (durationTicks as number) < 0
    ) {
        throw new ReplayParseError(
            `Perspective replay file requires 'durationTicks' to be a non-negative integer, got ${JSON.stringify(durationTicks)}`,
        );
    }

    // ── players ──────────────────────────────────────────────────────────────
    const players = obj['players'];
    if (!Array.isArray(players)) {
        throw new ReplayParseError(
            `Perspective replay file requires 'players' to be an array, got ${players === null ? 'null' : typeof players}`,
        );
    }
    for (let i = 0; i < players.length; i++) {
        validateReplayPlayerMetadata(players[i], i, 'players');
    }

    // ── frames (mandatory array — invariant #98) ─────────────────────────────
    const frames = obj['frames'];
    if (!Array.isArray(frames)) {
        throw new ReplayParseError(
            `Perspective replay file requires 'frames' to be an array, got ${frames === null ? 'null' : typeof frames}`,
        );
    }
    let previousTick = -1;
    for (let i = 0; i < frames.length; i++) {
        previousTick = validateFrame(frames[i], i, viewerId, previousTick);
    }

    // Cast: all required fields have been structurally validated above.
    // Unknown extra top-level fields are preserved intentionally (forward compat).
    return raw as PerspectiveReplayFile;
}

// ─── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Validates a single frame and returns its (validated) `tick`. `previousTick` is
 * the tick of the preceding frame (or `-1` for the first frame): ticks must be
 * strictly increasing so that playback — which walks `frames` in order — never
 * sees a duplicate or out-of-order snapshot (invariant #98).
 */
function validateFrame(
    entry: unknown,
    index: number,
    viewerId: string,
    previousTick: number,
): number {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new ReplayParseError(`frames[${index.toString()}] must be an object`);
    }

    const frame = entry as Record<string, unknown>;

    // tick — must be a non-negative integer (invariant #42)
    const tick = frame['tick'];
    if (tick === undefined || !Number.isInteger(tick) || (tick as number) < 0) {
        throw new ReplayParseError(
            `frames[${index.toString()}].tick must be a non-negative integer, got ${JSON.stringify(tick)}`,
        );
    }

    // tick ordering — frames must be strictly increasing in tick (invariant #98)
    if ((tick as number) <= previousTick) {
        throw new ReplayParseError(
            `frames[${index.toString()}].tick (${JSON.stringify(tick)}) must be strictly greater than the previous frame's tick (${previousTick.toString()})`,
        );
    }

    // snapshot — must be a plain object (the projected PlayerSnapshot)
    const snapshot = frame['snapshot'];
    if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new ReplayParseError(
            `frames[${index.toString()}].snapshot must be a PlayerSnapshot object, got ${snapshot === null ? 'null' : typeof snapshot}`,
        );
    }

    // snapshot.viewerId — must be a string matching the file's locked viewerId
    const snapshotViewerId = (snapshot as Record<string, unknown>)['viewerId'];
    if (typeof snapshotViewerId !== 'string') {
        throw new ReplayParseError(
            `frames[${index.toString()}].snapshot.viewerId must be a string, got ${JSON.stringify(snapshotViewerId)}`,
        );
    }
    if (snapshotViewerId !== viewerId) {
        throw new ReplayParseError(
            `frames[${index.toString()}].snapshot.viewerId (${JSON.stringify(snapshotViewerId)}) must equal the file's locked viewerId (${JSON.stringify(viewerId)})`,
        );
    }

    // snapshot.tick — the frame's outer tick and the embedded snapshot's own tick
    // are redundant copies of the same value; they must agree, or playback (which
    // orders by the outer tick) would diverge from the snapshot state it renders.
    const snapshotTick = (snapshot as Record<string, unknown>)['tick'];
    if (snapshotTick !== tick) {
        throw new ReplayParseError(
            `frames[${index.toString()}].snapshot.tick (${JSON.stringify(snapshotTick)}) must equal frames[${index.toString()}].tick (${JSON.stringify(tick)})`,
        );
    }

    return tick as number;
}
