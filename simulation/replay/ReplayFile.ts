/**
 * simulation/replay/ReplayFile.ts
 *
 * ReplayFile schema, associated types, and structural validation.
 * Pure type declarations and pure functions — zero I/O, no Node.js APIs.
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

import type { EngineAction, PlayerId } from '../engine/types.js';

const ISO_8601_UTC_TIMESTAMP_PATTERN =
    /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d{1,9})?Z$/u;

// ─── ReplayParseError ─────────────────────────────────────────────────────────

/**
 * Thrown by `parseReplayFile` when the raw input fails structural validation.
 * Distinct from runtime errors — callers can instanceof-check to distinguish
 * "malformed replay file" from unexpected exceptions.
 *
 * Covers OWASP A08 (Software and Data Integrity Failures).
 */
export class ReplayParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'ReplayParseError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── RecordedAction ───────────────────────────────────────────────────────────

/**
 * A single action recorded during a live match.
 *
 * All fields are plain integers or strings — no nested snapshots (invariant #71).
 * `tick` must be a non-negative integer (invariant #42).
 */
export interface RecordedAction {
    readonly tick: number;
    readonly playerId: PlayerId;
    readonly action: EngineAction;
}

// ─── ReplayMetadata ───────────────────────────────────────────────────────────

export interface ReplayPlayerMetadata {
    readonly playerId: PlayerId;
    readonly displayName: string;
}

/**
 * Non-gameplay metadata recorded alongside the action log.
 * `recordedAt` is an ISO-8601 date string set at recording start.
 * `durationTicks` is an integer tick count (invariant #42).
 */
export interface ReplayMetadata {
    readonly recordedAt: string;
    readonly durationTicks: number;
    readonly players: readonly ReplayPlayerMetadata[];
}

// ─── ReplayFile ───────────────────────────────────────────────────────────────

/**
 * The complete, self-contained replay file schema.
 *
 * Stored as JSON (extension `.chimera-replay`). Playback starts from `seed +
 * gameConfig` and feeds each `RecordedAction` through the live `ActionPipeline`
 * (invariant #70). Any file missing `seed` or `actions` is malformed (invariant #71).
 *
 * `gameConfig` remains game-agnostic — it is passed straight through to the
 * game's initialise function without modification.
 */
export interface ReplayFile {
    readonly formatVersion: 1;
    readonly engineVersion: string;
    readonly gameId: string;
    readonly gameVersion: string;
    readonly gameConfig: Readonly<Record<string, unknown>>;
    readonly seed: number;
    readonly actions: readonly RecordedAction[];
    readonly metadata: ReplayMetadata;
}

// ─── ReplayHeader ───────────────────────────────────────────────────────────

/**
 * The static (non-action) portion of a recording, supplied to
 * `ReplayManager.startRecording()` before any `RecordedAction` is appended.
 *
 * Contains every `ReplayFile` field except `formatVersion` (the constant `1`),
 * the `actions` log (accumulated during recording), and
 * `metadata.durationTicks` (computed at finalise from the recorded actions).
 * `recordedAt` is captured by the caller at recording start so the simulation
 * layer stays free of wall-clock reads (invariant #43).
 */
export interface ReplayHeader {
    readonly engineVersion: string;
    readonly gameId: string;
    readonly gameVersion: string;
    readonly gameConfig: Readonly<Record<string, unknown>>;
    readonly seed: number;
    /** ISO-8601 UTC timestamp captured at recording start. */
    readonly recordedAt: string;
    readonly players: readonly ReplayPlayerMetadata[];
}

// ─── parseReplayFile ──────────────────────────────────────────────────────────

/**
 * Validates that `raw` has the structural shape of a `ReplayFile` and returns
 * it cast to that type. Unknown extra fields are preserved for forward
 * compatibility — this is intentionally NOT a strict-shape parser.
 *
 * Throws `ReplayParseError` if any required field is missing or has an
 * incorrect type. Does not perform I/O; pure function (invariant #43).
 */
export function parseReplayFile(raw: unknown): ReplayFile {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new ReplayParseError(
            `Replay file must be a plain object, got ${raw === null ? 'null' : Array.isArray(raw) ? 'array' : typeof raw}`,
        );
    }

    const obj = raw as Record<string, unknown>;

    // ── formatVersion ────────────────────────────────────────────────────────
    const formatVersion = obj['formatVersion'];
    if (
        formatVersion === undefined ||
        formatVersion === null ||
        !Number.isInteger(formatVersion) ||
        formatVersion !== 1
    ) {
        throw new ReplayParseError(
            `Replay file requires 'formatVersion' to be 1, got ${JSON.stringify(formatVersion)}`,
        );
    }

    // ── engineVersion ────────────────────────────────────────────────────────
    const engineVersion = obj['engineVersion'];
    if (typeof engineVersion !== 'string') {
        throw new ReplayParseError(
            `Replay file requires 'engineVersion' to be a string, got ${JSON.stringify(engineVersion)}`,
        );
    }

    // ── gameId ───────────────────────────────────────────────────────────────
    const gameId = obj['gameId'];
    if (typeof gameId !== 'string') {
        throw new ReplayParseError(
            `Replay file requires 'gameId' to be a string, got ${JSON.stringify(gameId)}`,
        );
    }

    // ── gameVersion ──────────────────────────────────────────────────────────
    const gameVersion = obj['gameVersion'];
    if (typeof gameVersion !== 'string') {
        throw new ReplayParseError(
            `Replay file requires 'gameVersion' to be a string, got ${JSON.stringify(gameVersion)}`,
        );
    }

    // ── gameConfig ──────────────────────────────────────────────────────────
    const gameConfig = obj['gameConfig'];
    if (gameConfig === null || typeof gameConfig !== 'object' || Array.isArray(gameConfig)) {
        throw new ReplayParseError(
            `Replay file requires 'gameConfig' to be an object, got ${gameConfig === null ? 'null' : Array.isArray(gameConfig) ? 'array' : typeof gameConfig}`,
        );
    }

    // ── seed (mandatory, integer — invariants #42, #71) ──────────────────────
    const seed = obj['seed'];
    if (seed === undefined || seed === null || !Number.isInteger(seed)) {
        throw new ReplayParseError(
            `Replay file requires 'seed' to be an integer, got ${JSON.stringify(seed)}`,
        );
    }

    // ── actions (mandatory array — invariant #71) ─────────────────────────────
    const actions = obj['actions'];
    if (!Array.isArray(actions)) {
        throw new ReplayParseError(
            `Replay file requires 'actions' to be an array, got ${actions === null ? 'null' : typeof actions}`,
        );
    }

    for (let i = 0; i < actions.length; i++) {
        validateRecordedAction(actions[i], i);
    }

    // ── metadata ─────────────────────────────────────────────────────────────
    const metadata = obj['metadata'];
    if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
        throw new ReplayParseError(
            `Replay file requires 'metadata' to be an object, got ${metadata === null ? 'null' : typeof metadata}`,
        );
    }
    validateMetadata(metadata as Record<string, unknown>);

    // Cast: all required fields have been structurally validated above.
    // Unknown extra top-level fields are preserved intentionally (forward compat).
    return raw as ReplayFile;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function validateRecordedAction(entry: unknown, index: number): void {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new ReplayParseError(`actions[${index.toString()}] must be an object`);
    }

    const act = entry as Record<string, unknown>;

    // tick — must be a non-negative integer (invariant #42)
    const tick = act['tick'];
    if (tick === undefined || !Number.isInteger(tick) || (tick as number) < 0) {
        throw new ReplayParseError(
            `actions[${index.toString()}].tick must be a non-negative integer, got ${JSON.stringify(tick)}`,
        );
    }

    // playerId — must be a string
    const pid = act['playerId'];
    if (typeof pid !== 'string') {
        throw new ReplayParseError(
            `actions[${index.toString()}].playerId must be a string, got ${JSON.stringify(pid)}`,
        );
    }

    // action — must be an object (the EngineAction envelope)
    const action = act['action'];
    if (action === null || typeof action !== 'object' || Array.isArray(action)) {
        throw new ReplayParseError(
            `actions[${index.toString()}].action must be an EngineAction object, got ${action === null ? 'null' : typeof action}`,
        );
    }
}

function validateMetadata(meta: Record<string, unknown>): void {
    const recordedAt = meta['recordedAt'];
    if (typeof recordedAt !== 'string') {
        throw new ReplayParseError(
            `metadata.recordedAt must be a string, got ${JSON.stringify(recordedAt)}`,
        );
    }
    if (!isIso8601UtcTimestamp(recordedAt)) {
        throw new ReplayParseError(
            `metadata.recordedAt must be an ISO-8601 UTC timestamp, got ${JSON.stringify(recordedAt)}`,
        );
    }

    const durationTicks = meta['durationTicks'];
    if (
        durationTicks === undefined ||
        !Number.isInteger(durationTicks) ||
        (durationTicks as number) < 0
    ) {
        throw new ReplayParseError(
            `metadata.durationTicks must be a non-negative integer, got ${JSON.stringify(durationTicks)}`,
        );
    }

    const players = meta['players'];
    if (!Array.isArray(players)) {
        throw new ReplayParseError(
            `metadata.players must be an array, got ${players === null ? 'null' : typeof players}`,
        );
    }

    for (let i = 0; i < players.length; i++) {
        validateReplayPlayerMetadata(players[i], i);
    }
}

function isIso8601UtcTimestamp(value: string): boolean {
    const match = ISO_8601_UTC_TIMESTAMP_PATTERN.exec(value);
    if (match === null) {
        return false;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return day >= 1 && day <= getDaysInMonth(year, month);
}

function getDaysInMonth(year: number, month: number): number {
    if (month === 2) {
        return isLeapYear(year) ? 29 : 28;
    }
    return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isLeapYear(year: number): boolean {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function validateReplayPlayerMetadata(entry: unknown, index: number): void {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new ReplayParseError(`metadata.players[${index.toString()}] must be an object`);
    }

    const player = entry as Record<string, unknown>;
    const playerId = player['playerId'];
    if (typeof playerId !== 'string') {
        throw new ReplayParseError(
            `metadata.players[${index.toString()}].playerId must be a string, got ${JSON.stringify(playerId)}`,
        );
    }

    const displayName = player['displayName'];
    if (typeof displayName !== 'string') {
        throw new ReplayParseError(
            `metadata.players[${index.toString()}].displayName must be a string, got ${JSON.stringify(displayName)}`,
        );
    }
}
