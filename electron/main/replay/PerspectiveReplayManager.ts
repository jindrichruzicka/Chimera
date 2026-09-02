/**
 * electron/main/replay/PerspectiveReplayManager.ts
 *
 * Main-process owner of *perspective* replay recording and persistence (§4.28)
 * — the privacy-preserving counterpart to the deterministic
 * `ReplayManager` (`./replay-manager.ts`). Holds the in-progress recording state
 * machine and delegates all I/O to an injected `PerspectiveReplayRepository`.
 *
 * A perspective replay stores only already-projected `PlayerSnapshot` frames for
 * a single, **locked** `viewerId`; it is never re-simulated (invariant #98). The
 * recording path therefore never touches the simulation, the seed, or the action
 * log — `recordSnapshot` simply appends frames that a single seat legitimately
 * saw, rejecting any frame projected for a different viewer.
 *
 * No concrete repository or serializer is imported here — the manager knows only
 * the `PerspectiveReplayFile`/repository contracts, keeping it I/O-agnostic
 * (mirroring `ReplayManager`).
 *
 * Architecture reference: §4.28
 *
 * Invariants upheld:
 *   #30 — the frame buffer has a fixed `maxFrames` ceiling; on overflow the
 *           OLDEST frame is dropped and the transition is reported once per
 *           recording.
 *   #67 — constructed with an injected Logger child; it reports through that
 *           Logger, never `console.*`. `recordSnapshot` reports at `trace` rather
 *           than `debug` because it runs once per recorded beat — see the file
 *           sink threshold in §4.27.
 *   #98 — `viewerId` is locked at `start`; `recordSnapshot` skips (never
 *           appends) any frame whose `snapshot.viewerId` differs from it, whose
 *           `tick` is not strictly greater than the last appended tick, or whose
 *           outer `tick` disagrees with its `snapshot.tick` — so the persisted
 *           file holds strictly-ordered frames for exactly one seat, validated at
 *           the source rather than only at the serializer boundary.
 */

import { ReplayVersionError } from '@chimera-engine/simulation/replay/index.js';
import type {
    PerspectiveReplayFile,
    PerspectiveReplayFrame,
    PerspectiveReplayHeader,
    PerspectiveReplayListItem,
    PerspectiveReplayRepository,
} from '@chimera-engine/simulation/replay/index.js';
import type { Logger } from '../logging/logger.js';

/**
 * The start-time metadata for a perspective recording: the full
 * {@link PerspectiveReplayHeader} except `durationTicks`, which the manager
 * computes at `finalise` from the recorded frames. The caller supplies
 * `recordedAt` (an ISO-8601 UTC timestamp) so the manager stays free of
 * wall-clock reads and remains deterministic under test.
 */
export type PerspectiveReplayStartHeader = Omit<PerspectiveReplayHeader, 'durationTicks'>;

/**
 * The running engine's version identity, used by `load()` to decide whether a
 * stored perspective replay is compatible. Only `engineVersion` participates:
 * unlike a deterministic replay, a perspective replay is never re-simulated, so
 * compatibility reduces to the recording engine matching the running engine.
 * (`formatVersion` is already enforced by `parsePerspectiveReplayFile` on load.)
 */
export interface PerspectiveReplayEngineIdentity {
    readonly engineVersion: string;
}

/**
 * Default ceiling on the frames one recording retains (Invariant #30).
 *
 * The number matches `MAX_ACTION_HISTORY_ENTRIES` — the engine's existing
 * order of magnitude for a per-match retained buffer — and nothing more is
 * claimed for it: the two fill at different rates, because the action history
 * appends on every depth-0 dispatch while a frame is retained only when the
 * beat changed something.
 *
 * The retained cost is a whole projected snapshot per frame, so it scales with
 * the game's entity count rather than with this number alone.
 *
 * A ceiling is a retention decision, not a correctness one: overflowing a match
 * costs the OLDEST frames of its perspective replay, never a later one, and the
 * per-game switch that turns recording off entirely is a separate concern.
 */
export const DEFAULT_MAX_PERSPECTIVE_REPLAY_FRAMES = 10_000;

/** Construction-time knobs. */
export interface PerspectiveReplayManagerOptions {
    /**
     * Frames one recording retains before the oldest is evicted. Defaults to
     * {@link DEFAULT_MAX_PERSPECTIVE_REPLAY_FRAMES}. Must be a positive integer.
     */
    readonly maxFrames?: number;
}

interface RecordingState {
    readonly header: PerspectiveReplayStartHeader;
    readonly frames: PerspectiveReplayFrame[];
    /**
     * Latch for the `perspective-replay:overflow` warn, scoped to THIS
     * recording: raised on the first eviction, and gone with the state when the
     * recording ends, so a second match that overflows reports again.
     */
    overflowReported: boolean;
}

/**
 * Records, persists, lists, loads, and deletes perspective replays for the main
 * process. Constructed once and wired into the replay IPC namespace.
 */
export class PerspectiveReplayManager {
    private readonly log: Logger;
    private recording: RecordingState | null = null;
    /**
     * Path of the most recently finalised perspective replay for the current
     * match, or `null` when none has been finalised since the last `start`.
     * Lets {@link exportCurrent} stay idempotent: once the player's save icon has
     * persisted the match, a repeat press returns the same path rather than writing
     * a duplicate (mirrors `ReplayManager.exportCurrentMatch`).
     */
    private lastSavedPath: string | null = null;

    /** Frame ceiling for one recording — fixed at construction (Invariant #30). */
    private readonly maxFrames: number;

    constructor(
        private readonly repository: PerspectiveReplayRepository,
        private readonly identity: PerspectiveReplayEngineIdentity,
        logger: Logger,
        options?: PerspectiveReplayManagerOptions,
    ) {
        this.log = logger.child({ module: 'perspective-replay-manager' });
        const maxFrames = options?.maxFrames ?? DEFAULT_MAX_PERSPECTIVE_REPLAY_FRAMES;
        if (!Number.isInteger(maxFrames) || maxFrames <= 0) {
            throw new Error(
                `PerspectiveReplayManager: maxFrames must be a positive integer, got ${String(maxFrames)}`,
            );
        }
        this.maxFrames = maxFrames;
    }

    // ── Recording ─────────────────────────────────────────────────────────────

    /**
     * Whether a recording is currently in progress. Lets a single shared manager
     * assert the host/joined-client mutual-exclusion assumption at its egress
     * seam (only one recording is ever live, since a process either hosts or
     * joins, never both) instead of relying on caller-side flags alone.
     */
    isRecording(): boolean {
        return this.recording !== null;
    }

    /**
     * Begin recording a new perspective for a single locked `viewerId`. Must be
     * called before `recordSnapshot`.
     * @throws {Error} if a recording is already in progress.
     */
    start(header: PerspectiveReplayStartHeader): void {
        this.log.debug('start', { gameId: header.gameId, viewerId: header.viewerId });
        if (this.recording !== null) {
            throw new Error('PerspectiveReplayManager.start: a recording is already in progress');
        }
        // A new match supersedes any path remembered from the previous one.
        this.lastSavedPath = null;
        this.recording = { header, frames: [], overflowReported: false };
    }

    /**
     * Append one projected frame to the in-progress recording. Enforces the
     * recording-side half of invariant #98 — each rejected frame is **skipped**
     * (logged at warn, not appended, never thrown) so a single bad frame cannot
     * abort recording, and the persisted file is valid at the source rather than
     * only at the serializer boundary. A frame is skipped when:
     *   - its `snapshot.viewerId` differs from the locked `viewerId`
     *     (lock-to-initial-seat: the file holds frames for exactly the seat fixed
     *     at `start`);
     *   - its `tick` is not strictly greater than the last appended frame's tick
     *     (frames must be strictly increasing so playback never sees a duplicate
     *     or out-of-order snapshot);
     *   - its outer `tick` disagrees with the embedded `snapshot.tick` (the two
     *     are redundant copies that must match, or playback would order by a tick
     *     that diverges from the state it renders).
     * These mirror the checks `parsePerspectiveReplayFile` runs on load, surfacing
     * a violation at the offending call instead of deferring it to `finalise`.
     * @throws {Error} if no recording is in progress.
     */
    recordSnapshot(frame: PerspectiveReplayFrame): void {
        this.log.trace('recordSnapshot', { tick: frame.tick });
        if (this.recording === null) {
            throw new Error('PerspectiveReplayManager.recordSnapshot: no recording in progress');
        }
        const lockedViewerId = this.recording.header.viewerId;
        if (frame.snapshot.viewerId !== lockedViewerId) {
            this.log.warn('recordSnapshot: skipped foreign-viewerId frame', {
                tick: frame.tick,
                lockedViewerId,
                frameViewerId: frame.snapshot.viewerId,
            });
            return;
        }
        if (frame.snapshot.tick !== frame.tick) {
            this.log.warn('recordSnapshot: skipped frame with mismatched snapshot.tick', {
                tick: frame.tick,
                snapshotTick: frame.snapshot.tick,
            });
            return;
        }
        const lastTick = this.recording.frames.at(-1)?.tick ?? -1;
        if (frame.tick <= lastTick) {
            this.log.warn('recordSnapshot: skipped non-increasing-tick frame', {
                tick: frame.tick,
                lastTick,
            });
            return;
        }
        this.#appendWithinCeiling(this.recording, frame);
    }

    /**
     * Append `frame`, dropping the oldest first when the recording is at its
     * ceiling. Called only after every validation has passed, so eviction can
     * never be spent on a frame that is about to be skipped.
     *
     * Eviction moves the FRONT of the buffer. `recordSnapshot`'s tick-order check
     * reads the back (`frames.at(-1)`), so a dropped frame cannot make a later
     * one look out of order.
     *
     * The warn is raised on the first eviction and latched for the rest of the
     * recording: at a realtime tick rate every subsequent frame evicts, so an
     * unlatched warn would be one line per beat for the rest of the match.
     */
    #appendWithinCeiling(state: RecordingState, frame: PerspectiveReplayFrame): void {
        if (state.frames.length >= this.maxFrames) {
            state.frames.shift();
            if (!state.overflowReported) {
                state.overflowReported = true;
                this.log.warn('perspective-replay:overflow', { maxFrames: this.maxFrames });
            }
        }
        state.frames.push(frame);
    }

    /**
     * Finalise and flush the in-progress recording: assemble the
     * `PerspectiveReplayFile` (stamping `durationTicks` from the highest recorded
     * frame tick) and write it via the repository. Recording state is cleared
     * whether the write resolves or rejects, so a failed flush leaves no stale
     * state behind.
     *
     * @returns the saved file path.
     * @throws {Error} if no recording is in progress.
     */
    async finalise(name?: string): Promise<string> {
        this.log.debug('finalise');
        const state = this.recording;
        if (state === null) {
            throw new Error('PerspectiveReplayManager.finalise: no recording in progress');
        }

        const file = PerspectiveReplayManager.assembleFile(state, name);

        try {
            const savedPath = await this.repository.save(file);
            this.lastSavedPath = savedPath;
            this.log.debug('finalise: saved', { path: savedPath });
            return savedPath;
        } finally {
            this.recording = null;
        }
    }

    /**
     * Idempotent "ensure this match's perspective replay is on disk, and give me
     * its path" — the perspective counterpart to
     * {@link ReplayManager.exportCurrentMatch}. Unlike the destructive
     * {@link finalise}, it does not require an in-progress recording:
     *
     *   - recording still in progress → finalise it and return the new path;
     *   - already finalised this match → return the remembered path (no second
     *     file is written);
     *   - nothing recorded or saved yet → throw.
     *
     * `name` (optional) is the user-entered replay name from the player's save
     * dialog, stamped only on the first save (the in-progress branch); a repeat
     * "already saved" press returns the remembered path unchanged.
     *
     * @throws {Error} when no recording is in progress and none was finalised
     *   for the current match.
     */
    async exportCurrent(name?: string): Promise<string> {
        this.log.debug('exportCurrent', {
            recording: this.recording !== null,
            hasSaved: this.lastSavedPath !== null,
        });
        if (this.recording !== null) {
            return this.finalise(name);
        }
        if (this.lastSavedPath !== null) {
            return this.lastSavedPath;
        }
        throw new Error(
            'PerspectiveReplayManager.exportCurrent: no recording in progress and no saved replay',
        );
    }

    /**
     * Assemble (but do NOT persist) the current in-progress recording as a
     * {@link PerspectiveReplayFile}, so the replay player can preview the
     * just-finished match straight from memory. The perspective counterpart to
     * {@link ReplayManager.getCurrentMatchFile}: the match is written to disk only
     * when the user presses the player's save icon (which routes to
     * {@link exportCurrent}); an unsaved match is discarded by {@link abort} at
     * teardown. The frames array is defensively shallow-copied so playback cannot
     * mutate the frames still held for a later save. Non-destructive.
     *
     * @throws {Error} if no recording is in progress.
     */
    getCurrentFile(): PerspectiveReplayFile {
        this.log.debug('getCurrentFile', { recording: this.recording !== null });
        const state = this.recording;
        if (state === null) {
            throw new Error('PerspectiveReplayManager.getCurrentFile: no recording in progress');
        }
        return { ...PerspectiveReplayManager.assembleFile(state), frames: [...state.frames] };
    }

    /**
     * Discard the in-progress recording without persisting it.
     *
     * Called when a joined/hosted session closes without the match being saved —
     * either abandoned mid-match, or finished but left unsaved (the match is no
     * longer finalised at game-over; the player's save icon is the sole persistence
     * gate). Idempotent: a no-op when no recording is in progress, so it is safe to
     * call unconditionally at session teardown.
     */
    abort(): void {
        this.log.debug('abort', { active: this.recording !== null });
        this.recording = null;
    }

    // ── Persistence ─────────────────────────────────────────────────────────────

    /**
     * Load and validate a stored perspective replay. The repository's serializer
     * already re-runs `parsePerspectiveReplayFile` (so an incompatible
     * `formatVersion` or any invariant-#98 violation throws there); this method
     * adds the engine-version compatibility guard.
     * @throws {ReplayVersionError} when the file's `engineVersion` differs from
     *   the running engine.
     */
    async load(filePath: string): Promise<PerspectiveReplayFile> {
        this.log.debug('load', { filePath });
        const file = await this.repository.load(filePath);
        if (file.engineVersion !== this.identity.engineVersion) {
            throw new ReplayVersionError(
                {
                    formatVersion: file.formatVersion,
                    engineVersion: file.engineVersion,
                    gameId: file.gameId,
                    gameVersion: file.gameVersion,
                },
                {
                    engineVersion: this.identity.engineVersion,
                    gameId: file.gameId,
                    gameVersion: file.gameVersion,
                },
            );
        }
        return file;
    }

    /**
     * List stored perspective replays for `gameId`, newest-first, as
     * {@link PerspectiveReplayListItem}s (`{ path, name? }`). Delegates to the
     * repository, which reads the `name` in the same single pass that computes the
     * newest-first sort key (invariant #98 intact — no frames/viewerId cross here).
     */
    list(gameId: string): Promise<PerspectiveReplayListItem[]> {
        this.log.debug('list', { gameId });
        return this.repository.list(gameId);
    }

    /** Permanently delete the perspective replay at `filePath`. */
    delete(filePath: string): Promise<void> {
        this.log.debug('delete', { filePath });
        return this.repository.delete(filePath);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Build the `PerspectiveReplayFile` for a recording state (shared by
     * {@link finalise} and {@link getCurrentFile}). Pure — reads the state, writes
     * nothing. `name` (the user-entered replay name from the save dialog) is
     * stamped onto the file only when non-empty; the preview path
     * ({@link getCurrentFile}) always omits it.
     */
    private static assembleFile(state: RecordingState, name?: string): PerspectiveReplayFile {
        return {
            ...state.header,
            durationTicks: PerspectiveReplayManager.computeDurationTicks(state.frames),
            frames: state.frames,
            ...(name !== undefined && name.length > 0 ? { name } : {}),
        };
    }

    private static computeDurationTicks(frames: readonly PerspectiveReplayFrame[]): number {
        let max = 0;
        for (const frame of frames) {
            if (frame.tick > max) {
                max = frame.tick;
            }
        }
        return max;
    }
}
