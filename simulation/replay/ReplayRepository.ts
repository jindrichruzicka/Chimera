/**
 * simulation/replay/ReplayRepository.ts
 *
 * Repository interface for replay-file storage (§4.28), mirroring
 * `SaveRepository` (§4.11). PURE TYPE DECLARATIONS + an interface — zero
 * runtime code, zero FS or Electron imports. Two implementations exist:
 *   - InMemoryReplayRepository (this package) — test double
 *   - FileReplayRepository (electron/main/replay/) — production
 *
 * Unlike saves (keyed by a caller-chosen slot ID), a replay's storage path is
 * assigned by the repository on `save()` (a generated UUID file name) and
 * returned to the caller. `load()`, `delete()` therefore take that opaque path
 * back, and `list()` returns the stored paths for a game.
 *
 * Architecture reference: §4.28
 * Task: F44 / T3 (issue #657)
 *
 * Invariants upheld:
 *   #2  — simulation/ is side-effect-free; no FS or Electron imports.
 *   #41 — InMemoryReplayRepository passes the identical contract test suite
 *           as FileReplayRepository.
 */

import type { ReplayFile } from './ReplayFile.js';

// ─── ReplayNotFoundError ──────────────────────────────────────────────────────

/**
 * Thrown by `ReplayRepository.load()` and `delete()` when no replay exists at
 * the given path.
 */
export class ReplayNotFoundError extends Error {
    public readonly filePath: string;

    constructor(filePath: string) {
        super(`Replay file '${filePath}' not found`);
        this.name = 'ReplayNotFoundError';
        this.filePath = filePath;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

// ─── ReplayRepository ─────────────────────────────────────────────────────────

/**
 * Repository interface for reading and writing replay files (§4.28).
 *
 * All methods are async to accommodate both the in-memory test double and the
 * filesystem-backed production implementation.
 */
export interface ReplayRepository {
    /**
     * Persist a replay file. The repository assigns a fresh storage path
     * (it never overwrites an existing replay) and returns it.
     * Implementations must write atomically (see `FileReplayRepository`).
     */
    save(file: ReplayFile): Promise<string>;

    /**
     * Load and structurally validate the replay file at `filePath`.
     * @throws {ReplayNotFoundError} if no replay exists at `filePath`.
     * @throws {ReplayParseError} if the stored bytes are malformed.
     */
    load(filePath: string): Promise<ReplayFile>;

    /**
     * List the stored replay paths for `gameId`, sorted newest-first
     * (by `metadata.recordedAt` descending).
     */
    list(gameId: string): Promise<string[]>;

    /**
     * Permanently delete the replay at `filePath`.
     * @throws {ReplayNotFoundError} if no replay exists at `filePath`.
     */
    delete(filePath: string): Promise<void>;
}
