/**
 * electron/main/replay/replay-manager.ts
 *
 * Main-process owner of replay recording and persistence (§4.28). Holds the
 * in-progress recording state machine, delegates all I/O to an injected
 * `ReplayRepository`, and enforces the cross-version compatibility guard via an
 * injected `ReplayMigrator` on `load()`.
 *
 * No concrete repository, serializer, or `ReplayPlayer` is imported here — the
 * manager knows only the `ReplayFile`/repository/migrator contracts, keeping it
 * free of any game-logic dependency (invariant #71).
 *
 * Architecture reference: §4.28
 *
 * Invariants upheld:
 *   #67 — constructed with an injected Logger child; every public method logs
 *           at debug level.
 *   #71 — persists the full ReplayFile (seed + actions mandatory); never
 *           projects snapshots, never imports ReplayPlayer.
 */

import type {
    RecordedAction,
    ReplayFile,
    ReplayHeader,
    ReplayMigrator,
    ReplayRepository,
} from '@chimera-engine/simulation/replay/index.js';
import type { Logger } from '../logging/logger.js';
import type { ReplayListItem } from '../../preload/api-types.js';

/** The single `formatVersion` written by this engine build. */
const FORMAT_VERSION = 1 as const;

/**
 * The running engine's version identity, used by `load()` to decide whether a
 * stored replay is compatible. `gameVersions` maps each installed `gameId` to
 * its version; a replay whose `gameId` is absent is treated as incompatible.
 */
export interface ReplayEngineIdentity {
    readonly engineVersion: string;
    readonly gameVersions: ReadonlyMap<string, string>;
}

interface RecordingState {
    readonly header: ReplayHeader;
    readonly actions: RecordedAction[];
}

/**
 * Records, persists, lists, loads, and deletes replays for the main process.
 * Constructed once and wired into the replay IPC namespace.
 */
export class ReplayManager {
    private readonly log: Logger;
    private recording: RecordingState | null = null;
    /**
     * Path of the most recently finalised replay for the current match, or
     * `null` when no match has been finalised since the last `startRecording`.
     * Lets {@link exportCurrentMatch} stay idempotent: once the player's save icon
     * has persisted the match, a repeat press (or any second call) returns the same
     * path rather than writing a duplicate file.
     */
    private lastSavedPath: string | null = null;

    constructor(
        private readonly repository: ReplayRepository,
        private readonly migrator: ReplayMigrator,
        private readonly identity: ReplayEngineIdentity,
        logger: Logger,
    ) {
        this.log = logger.child({ module: 'replay-manager' });
    }

    // ── Recording ─────────────────────────────────────────────────────────────

    /**
     * Whether a match recording is currently in progress. Lets the post-game
     * co-save export helper skip the deterministic write when nothing is recorded
     * (a joined client, or a packaged build where the deterministic recorder never
     * started), mirroring `PerspectiveReplayManager.isRecording()`.
     */
    isRecording(): boolean {
        return this.recording !== null;
    }

    /**
     * Begin recording a new match. Must be called before `recordAction`.
     * @throws {Error} if a recording is already in progress.
     */
    startRecording(header: ReplayHeader): void {
        this.log.debug('startRecording', { gameId: header.gameId, seed: header.seed });
        if (this.recording !== null) {
            throw new Error('ReplayManager.startRecording: a recording is already in progress');
        }
        // A new match supersedes any path remembered from the previous one, so a
        // later `exportCurrentMatch` can never return a stale match's replay.
        this.lastSavedPath = null;
        this.recording = { header, actions: [] };
    }

    /**
     * Append one recorded action to the in-progress recording.
     * @throws {Error} if no recording is in progress.
     */
    recordAction(entry: RecordedAction): void {
        this.log.debug('recordAction', { tick: entry.tick, playerId: entry.playerId });
        if (this.recording === null) {
            throw new Error('ReplayManager.recordAction: no recording in progress');
        }
        this.recording.actions.push(entry);
    }

    /**
     * Finalise and flush the in-progress recording: assemble the `ReplayFile`
     * and write it via the repository (atomic on the filesystem implementation).
     * Recording state is cleared whether the write resolves or rejects, so a
     * failed flush leaves no stale state behind.
     *
     * @returns the saved file path.
     * @throws {Error} if no recording is in progress.
     */
    async finaliseRecording(name?: string): Promise<string> {
        this.log.debug('finaliseRecording');
        const state = this.recording;
        if (state === null) {
            throw new Error('ReplayManager.finaliseRecording: no recording in progress');
        }

        const file = ReplayManager.assembleFile(state, name);

        try {
            const savedPath = await this.repository.save(file);
            this.lastSavedPath = savedPath;
            this.log.debug('finaliseRecording: saved', { path: savedPath });
            return savedPath;
        } finally {
            this.recording = null;
        }
    }

    /**
     * Idempotent "ensure this match's replay is on disk, and give me its path".
     *
     * Backs the replay player's save icon — the sole gate that persists a match
     * (the match is NOT finalised at game-over; the post-game summary's
     * Replay button now previews the in-memory recording via
     * {@link getCurrentMatchFile} instead of exporting). So unlike the destructive
     * {@link finaliseRecording}, this method does not require an in-progress
     * recording:
     *
     *   - recording still in progress (first save press) → finalise it and return
     *     the new path;
     *   - already saved this match (repeat press) → return the remembered path (no
     *     second file is written);
     *   - nothing recorded or saved yet → throw.
     *
     * `name` (optional) is the user-entered replay name from the player's save
     * dialog; it is stamped only on the first save (the in-progress branch). A
     * repeat "already saved" press returns the remembered path unchanged — the
     * name was captured on that first (and only) save, which is the only save
     * because the save icon disables once it lands.
     *
     * @throws {Error} when no recording is in progress and none was finalised
     *   for the current match.
     */
    async exportCurrentMatch(name?: string): Promise<string> {
        this.log.debug('exportCurrentMatch', {
            recording: this.recording !== null,
            hasSaved: this.lastSavedPath !== null,
        });
        if (this.recording !== null) {
            return this.finaliseRecording(name);
        }
        if (this.lastSavedPath !== null) {
            return this.lastSavedPath;
        }
        throw new Error(
            'ReplayManager.exportCurrentMatch: no recording in progress and no saved replay',
        );
    }

    /**
     * Assemble (but do NOT persist) the current in-progress match as a
     * {@link ReplayFile}, so the replay player can preview the just-finished match
     * straight from memory. The match is written to disk only when the user presses
     * the player's save icon (which routes to {@link exportCurrentMatch}); a match
     * left unsaved is discarded by {@link abortRecording} at session teardown.
     *
     * The action log is defensively shallow-copied so replay playback cannot mutate
     * the array still held for a later save. Non-destructive — the recording is left
     * intact.
     *
     * @throws {Error} if no recording is in progress.
     */
    getCurrentMatchFile(): ReplayFile {
        this.log.debug('getCurrentMatchFile', { recording: this.recording !== null });
        const state = this.recording;
        if (state === null) {
            throw new Error('ReplayManager.getCurrentMatchFile: no recording in progress');
        }
        return { ...ReplayManager.assembleFile(state), actions: [...state.actions] };
    }

    /**
     * Discard the in-progress recording without persisting it.
     *
     * Called when a host session closes without the match being saved — either
     * abandoned mid-match, or finished but left unsaved (the match is no longer
     * finalised at game-over; the player's save icon is the sole persistence gate).
     * Idempotent: a no-op when no recording is in progress, so it is safe to call
     * unconditionally at session teardown — and it guarantees the next session's
     * `startRecording` starts from a clean state.
     */
    abortRecording(): void {
        this.log.debug('abortRecording', { active: this.recording !== null });
        this.recording = null;
    }

    // ── Persistence ─────────────────────────────────────────────────────────────

    /**
     * Load and validate a stored replay, enforcing the compatibility guard.
     * @throws {ReplayVersionError} when the file's identity is incompatible with
     *   the running engine and no migrator covers it.
     */
    async load(filePath: string): Promise<ReplayFile> {
        this.log.debug('load', { filePath });
        const file = await this.repository.load(filePath);
        return this.migrator.ensureCompatible(file, {
            engineVersion: this.identity.engineVersion,
            gameVersion: this.identity.gameVersions.get(file.gameId),
        });
    }

    /** List all stored replay paths for `gameId`, newest-first. */
    list(gameId: string): Promise<string[]> {
        this.log.debug('list', { gameId });
        return this.repository.list(gameId);
    }

    /**
     * List stored replays for `gameId`, newest-first, projected to
     * {@link ReplayListItem}s for the renderer's replay browser.
     *
     * Delegates to {@link ReplayRepository.listItems}, which reads each file in
     * a single pass (no double deserialization, descriptor-bounded) and applies
     * no compatibility guard: a replay the running engine can no longer play
     * must still appear so the user can see and delete it. Only non-gameplay
     * scalars are projected; the recorded action log never leaves the main
     * process here (invariant #3 / #71).
     */
    async listItems(gameId: string): Promise<ReplayListItem[]> {
        this.log.debug('listItems', { gameId });
        const entries = await this.repository.listItems(gameId);
        return entries.map((entry) => ({
            path: entry.path,
            gameId: entry.gameId,
            gameVersion: entry.gameVersion,
            engineVersion: entry.engineVersion,
            recordedAt: entry.recordedAt,
            durationTicks: entry.durationTicks,
            playerIds: [...entry.playerIds],
            // Carry the user-entered name only when present, so an unnamed replay
            // yields no `name` key (the renderer shows an "Untitled replay" fallback).
            ...(entry.name !== undefined ? { name: entry.name } : {}),
        }));
    }

    /** Permanently delete the replay at `filePath`. */
    delete(filePath: string): Promise<void> {
        this.log.debug('delete', { filePath });
        return this.repository.delete(filePath);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    /**
     * Build the `ReplayFile` for a recording state (shared by
     * {@link finaliseRecording} and {@link getCurrentMatchFile}). Pure — reads the
     * state, writes nothing. `name` (the user-entered replay name from the save
     * dialog) is stamped into metadata only when non-empty; the preview path
     * ({@link getCurrentMatchFile}) always omits it.
     */
    private static assembleFile(state: RecordingState, name?: string): ReplayFile {
        return {
            formatVersion: FORMAT_VERSION,
            engineVersion: state.header.engineVersion,
            gameId: state.header.gameId,
            gameVersion: state.header.gameVersion,
            gameConfig: state.header.gameConfig,
            seed: state.header.seed,
            actions: state.actions,
            metadata: {
                recordedAt: state.header.recordedAt,
                durationTicks: ReplayManager.computeDurationTicks(state.actions),
                players: state.header.players,
                ...(name !== undefined && name.length > 0 ? { name } : {}),
            },
        };
    }

    private static computeDurationTicks(actions: readonly RecordedAction[]): number {
        let max = 0;
        for (const action of actions) {
            if (action.tick > max) {
                max = action.tick;
            }
        }
        return max;
    }
}
