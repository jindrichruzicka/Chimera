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
 *
 * Invariants upheld:
 *   #2  — simulation/ is side-effect-free; no FS or Electron imports.
 *   #41 — InMemoryReplayRepository passes the identical contract test suite
 *           as FileReplayRepository.
 */

import type { ReplayFile } from './ReplayFile.js';
import type { PlayerId } from '../engine/types.js';

// ─── ReplayListingEntry ───────────────────────────────────────────────────────

/**
 * One stored replay projected to its header + metadata scalars, as returned by
 * {@link ReplayRepository.listItems}. Carries no gameplay state — never the
 * recorded `EngineAction` log (invariant #71) — so the renderer's replay
 * browser can be populated without the full file ever leaving the host.
 *
 * Read in a single pass per file by the repository: `list()` and `listItems()`
 * share the same enumeration so a browser listing pays one deserialization, not
 * two.
 */
export interface ReplayListingEntry {
    /** Opaque storage path (the same handle returned by `save()` / accepted by `load()`). */
    readonly path: string;
    readonly engineVersion: string;
    readonly gameId: string;
    readonly gameVersion: string;
    /** ISO-8601 UTC timestamp captured at recording start. */
    readonly recordedAt: string;
    /** Highest recorded tick — the replay's length. */
    readonly durationTicks: number;
    /** Participating player ids, in recording order. */
    readonly playerIds: readonly PlayerId[];
}

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
     * List the stored replays for `gameId` as enriched {@link ReplayListingEntry}
     * projections, sorted newest-first (same ordering as {@link list}).
     *
     * Reads each file exactly once (no compatibility guard is applied — a
     * replay the running engine can no longer play must still be browsable),
     * so the renderer's replay browser does not pay the double deserialization
     * of `list()` + a per-path `load()`.
     */
    listItems(gameId: string): Promise<ReplayListingEntry[]>;

    /**
     * Permanently delete the replay at `filePath`.
     * @throws {ReplayNotFoundError} if no replay exists at `filePath`.
     */
    delete(filePath: string): Promise<void>;
}
