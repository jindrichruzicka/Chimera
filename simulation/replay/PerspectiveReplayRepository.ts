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

// ─── PerspectiveReplayListItem ────────────────────────────────────────────────

/**
 * One stored perspective replay projected for `list()`: the opaque storage
 * `path` plus the optional user-entered `name`. Deliberately narrow — a
 * perspective replay's per-frame `PlayerSnapshot`s and its `viewerId` are read
 * only when it is opened (invariant #98), so the browser listing never carries
 * them. The `name` is user metadata (set at export), not sensitive projected
 * state, so surfacing it at list time is compatible with invariant #98.
 *
 * Reading it at list time is zero extra I/O: the file repository already
 * deserializes each file to read `recordedAt` for the newest-first sort.
 *
 * Re-exported from `@chimera-engine/simulation/bridge/api-types` so the renderer
 * and preload consume it through the bridge surface alongside {@link ReplayListItem}.
 */
export interface PerspectiveReplayListItem {
    /** Opaque storage path (the same handle returned by `save()` / accepted by `load()`). */
    readonly path: string;
    /** Optional user-entered replay name; absent for unnamed/legacy files. */
    readonly name?: string;
}

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
     * List the stored perspective replays for `gameId` as {@link PerspectiveReplayListItem}s
     * (`{ path, name? }`), sorted newest-first (by `recordedAt` descending, with a
     * stable path tiebreak). The `name` is projected in the same single-pass read
     * that computes the sort key — zero extra I/O.
     */
    list(gameId: string): Promise<PerspectiveReplayListItem[]>;

    /**
     * Permanently delete the perspective replay at `filePath`.
     * @throws {ReplayNotFoundError} if no replay exists at `filePath`.
     */
    delete(filePath: string): Promise<void>;
}
