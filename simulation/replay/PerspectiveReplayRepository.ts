/**
 * Repository interface for *perspective* replay-file storage (§4.28), the
 * privacy-preserving counterpart to {@link ReplayRepository}. PURE TYPE
 * DECLARATIONS + an interface — zero runtime code, zero FS or Electron imports.
 * Two implementations exist:
 *   - InMemoryPerspectiveReplayRepository (this package) — test double
 *   - FilePerspectiveReplayRepository (electron/main/replay/) — production
 *
 * As with the deterministic repository, a replay's storage path is assigned by
 * the repository on `save()` (a generated UUID file name) and returned to the
 * caller; `load()` / `delete()` take that opaque path back, and `list()` returns
 * the stored paths for a game. Deliberately narrower than `ReplayRepository`: no
 * `listItems()` — the perspective replay browser adds it when needed.
 *
 * The owned root is **disjoint** from the deterministic `userData/replays/`: the
 * file implementation stores under `userData/perspective-replays/<gameId>/`.
 *
 * Architecture reference: §4.28
 *
 * Invariants upheld:
 *   #2  — simulation/ is side-effect-free; no FS or Electron imports.
 *   #41 — InMemoryPerspectiveReplayRepository passes the identical contract test
 *           suite as FilePerspectiveReplayRepository.
 *   #98 — files hold only projected PlayerSnapshots for a single locked viewerId;
 *           enforced by the serializer/parser, not the repository.
 */

import type { PerspectiveReplayFile } from './PerspectiveReplayFile.js';

// `ReplayNotFoundError` is shared with the deterministic repository — a missing
// perspective replay is the same not-found condition, so it is reused verbatim
// rather than duplicated.
export { ReplayNotFoundError } from './ReplayRepository.js';

// ─── PerspectiveReplayRepository ──────────────────────────────────────────────

/**
 * Repository interface for reading and writing perspective replay files (§4.28).
 *
 * All methods are async to accommodate both the in-memory test double and the
 * filesystem-backed production implementation.
 */
export interface PerspectiveReplayRepository {
    /**
     * Persist a perspective replay file. The repository assigns a fresh storage
     * path (it never overwrites an existing replay) and returns it.
     * Implementations must write atomically (see `FilePerspectiveReplayRepository`).
     */
    save(file: PerspectiveReplayFile): Promise<string>;

    /**
     * Load and structurally validate the perspective replay file at `filePath`.
     * @throws {ReplayNotFoundError} if no replay exists at `filePath`.
     * @throws {ReplayParseError} if the stored bytes are malformed.
     */
    load(filePath: string): Promise<PerspectiveReplayFile>;

    /**
     * List the stored perspective replay paths for `gameId`, sorted newest-first
     * (by `recordedAt` descending, with a stable path tiebreak).
     */
    list(gameId: string): Promise<string[]>;

    /**
     * Permanently delete the perspective replay at `filePath`.
     * @throws {ReplayNotFoundError} if no replay exists at `filePath`.
     */
    delete(filePath: string): Promise<void>;
}
