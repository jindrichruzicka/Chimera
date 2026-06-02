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
 * Task: F44 / T3 (issue #657)
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
} from '@chimera/simulation/replay/index.js';
import type { Logger } from '../logging/logger.js';

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
     * Begin recording a new match. Must be called before `recordAction`.
     * @throws {Error} if a recording is already in progress.
     */
    startRecording(header: ReplayHeader): void {
        this.log.debug('startRecording', { gameId: header.gameId, seed: header.seed });
        if (this.recording !== null) {
            throw new Error('ReplayManager.startRecording: a recording is already in progress');
        }
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
    async finaliseRecording(): Promise<string> {
        this.log.debug('finaliseRecording');
        const state = this.recording;
        if (state === null) {
            throw new Error('ReplayManager.finaliseRecording: no recording in progress');
        }

        const file: ReplayFile = {
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
            },
        };

        try {
            const savedPath = await this.repository.save(file);
            this.log.debug('finaliseRecording: saved', { path: savedPath });
            return savedPath;
        } finally {
            this.recording = null;
        }
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

    /** Permanently delete the replay at `filePath`. */
    delete(filePath: string): Promise<void> {
        this.log.debug('delete', { filePath });
        return this.repository.delete(filePath);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

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
