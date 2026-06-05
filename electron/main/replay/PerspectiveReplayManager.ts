/**
 * electron/main/replay/PerspectiveReplayManager.ts
 *
 * Main-process owner of *perspective* replay recording and persistence (§4.28,
 * ADR F44b) — the privacy-preserving counterpart to the deterministic
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
 * Architecture reference: §4.28 (ADR F44b)
 * Task: F44b / T4 (issue #670)
 *
 * Invariants upheld:
 *   #67 — constructed with an injected Logger child; every public method logs
 *           at debug level.
 *   #98 — `viewerId` is locked at `start`; `recordSnapshot` skips (never
 *           appends) any frame whose `snapshot.viewerId` differs from it, whose
 *           `tick` is not strictly greater than the last appended tick, or whose
 *           outer `tick` disagrees with its `snapshot.tick` — so the persisted
 *           file holds strictly-ordered frames for exactly one seat, validated at
 *           the source rather than only at the serializer boundary.
 */

import { ReplayVersionError } from '@chimera/simulation/replay/index.js';
import type {
    PerspectiveReplayFile,
    PerspectiveReplayFrame,
    PerspectiveReplayHeader,
    PerspectiveReplayRepository,
} from '@chimera/simulation/replay/index.js';
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

interface RecordingState {
    readonly header: PerspectiveReplayStartHeader;
    readonly frames: PerspectiveReplayFrame[];
}

/**
 * Records, persists, lists, loads, and deletes perspective replays for the main
 * process. Constructed once and wired into the replay IPC namespace (T5).
 */
export class PerspectiveReplayManager {
    private readonly log: Logger;
    private recording: RecordingState | null = null;
    /**
     * Path of the most recently finalised perspective replay for the current
     * match, or `null` when none has been finalised since the last `start`.
     * Lets {@link exportCurrent} stay idempotent after the egress path has
     * already auto-finalised the recording at game-over (mirrors
     * `ReplayManager.exportCurrentMatch`).
     */
    private lastSavedPath: string | null = null;

    constructor(
        private readonly repository: PerspectiveReplayRepository,
        private readonly identity: PerspectiveReplayEngineIdentity,
        logger: Logger,
    ) {
        this.log = logger.child({ module: 'perspective-replay-manager' });
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
        this.recording = { header, frames: [] };
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
        this.log.debug('recordSnapshot', { tick: frame.tick });
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
        this.recording.frames.push(frame);
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
    async finalise(): Promise<string> {
        this.log.debug('finalise');
        const state = this.recording;
        if (state === null) {
            throw new Error('PerspectiveReplayManager.finalise: no recording in progress');
        }

        const file: PerspectiveReplayFile = {
            ...state.header,
            durationTicks: PerspectiveReplayManager.computeDurationTicks(state.frames),
            frames: state.frames,
        };

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
     * @throws {Error} when no recording is in progress and none was finalised
     *   for the current match.
     */
    async exportCurrent(): Promise<string> {
        this.log.debug('exportCurrent', {
            recording: this.recording !== null,
            hasSaved: this.lastSavedPath !== null,
        });
        if (this.recording !== null) {
            return this.finalise();
        }
        if (this.lastSavedPath !== null) {
            return this.lastSavedPath;
        }
        throw new Error(
            'PerspectiveReplayManager.exportCurrent: no recording in progress and no saved replay',
        );
    }

    /**
     * Discard the in-progress recording without persisting it.
     *
     * Called when a host session closes mid-match (an abandoned game produces no
     * perspective file). Idempotent: a no-op when no recording is in progress, so
     * it is safe to call unconditionally at session teardown.
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

    /** List all stored perspective replay paths for `gameId`, newest-first. */
    list(gameId: string): Promise<string[]> {
        this.log.debug('list', { gameId });
        return this.repository.list(gameId);
    }

    /** Permanently delete the perspective replay at `filePath`. */
    delete(filePath: string): Promise<void> {
        this.log.debug('delete', { filePath });
        return this.repository.delete(filePath);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
