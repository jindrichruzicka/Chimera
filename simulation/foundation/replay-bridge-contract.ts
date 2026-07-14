/**
 * shared/replay-bridge-contract.ts
 *
 * Shared structural contract for the slice of the Chimera preload replay bridge
 * (`window.__chimera.replay.perspective`) that a game's shell module reads
 * directly off `globalThis` to gate replay-related menu affordances.
 *
 * Why this lives in `shared/`: `games/*` may import only from `simulation/`,
 * `ai/`, `shared/`, and their own files (§3 Module Boundary Table) — never from
 * `electron/*` (where the canonical `PerspectiveReplayAPI` lives) nor
 * `renderer/*`. A game shell module (e.g. `games/tactics/shell/main-menu.ts`)
 * gates its "Replays" button on whether any perspective replays exist, so it
 * needs the `list` slice of that bridge but cannot reach the canonical type.
 *
 * Drift protection: `electron/preload/api-types.ts` declares
 * `PerspectiveReplayAPI extends PerspectiveReplayListBridge`, so the canonical
 * preload surface is structurally pinned to this shared slice — a change to
 * `list`'s signature that diverges from this contract is a compile error in the
 * preload layer. Both the game consumer and the canonical producer therefore
 * reference one source of truth for this method's shape.
 *
 * Module boundary (§3 Module Boundary Table): `shared/` must not import from
 * `renderer/`, `electron/`, or `games/*`. This module has zero imports — the
 * constraint is structurally enforced.
 */

/**
 * Reserved, opaque handle that stands in for the **in-progress, not-yet-saved**
 * recording of the just-finished match, instead of a real on-disk replay path.
 *
 * The post-game **Replay** action passes this to `openInPlayer` so the player
 * previews the match straight from the host's in-memory recording — the match is
 * NOT written to disk at game-over; the player's compact save icon is the sole
 * thing that persists it. Main recognises this token by exact equality **before**
 * any path-schema parse or directory-containment check and routes it to in-memory
 * playback (`openCurrent`), so it never reaches the filesystem — it is deliberately
 * NOT a valid path and can never escape the replay directory (OWASP A01 unaffected).
 *
 * Shared here (not in `electron/*`) so both the main-process IPC handlers and a
 * game screen (which may import only `simulation/`/`ai/`/`shared/`, Invariant #96)
 * reference one source of truth for the token.
 */
export const CURRENT_MATCH_REPLAY_PATH = '::chimera-current-match::';

/**
 * The read-only `list` slice of `window.__chimera.replay` (the deterministic
 * `ReplayAPI`, §4.28) that a game's shell module may read off `globalThis` to
 * decide whether a replay-related menu affordance is available. Companion to
 * {@link PerspectiveReplayListBridge}: a game whose Replays affordance should
 * reflect BOTH saved deterministic and perspective replays reads both slices.
 *
 * The item shape is intentionally opaque (`unknown`) — only the presence of
 * entries is consumed here — so this slice stays free of the electron-only
 * `ReplayListItem` type while remaining assignable from it.
 */
export interface ReplayListBridge {
    /** List stored deterministic-replay entries for `gameId`, newest-first. */
    list(gameId: string): Promise<readonly unknown[]>;
}

/**
 * The read-only `list` slice of `window.__chimera.replay.perspective`
 * (`PerspectiveReplayAPI`, §4.28) that a game's shell module may read
 * off `globalThis` to decide whether a replay-related menu affordance is
 * available.
 */
export interface PerspectiveReplayListBridge {
    /**
     * List stored perspective-replay entries for `gameId`, newest-first. The item
     * shape is intentionally opaque (`unknown`) — a game shell only consumes the
     * presence/count of entries here — so this slice stays free of the
     * `PerspectiveReplayListItem` type while remaining assignable from it. A
     * perspective replay's per-frame snapshots and `viewerId` are still read only
     * on open (invariants #3 / #98 — no gameplay state crosses here). Mirrors
     * {@link ReplayListBridge.list}.
     */
    list(gameId: string): Promise<readonly unknown[]>;
}

/**
 * The export / open-in-player slice of `window.__chimera.replay`
 * (`ReplayAPI`, §4.28) that a game's *screen* module reads off `globalThis` to
 * finalise the in-progress recording and hand it to the replay player from the
 * post-game summary.
 *
 * Why this lives in `shared/`: a game screen (`games/<name>/screens/*.tsx`) may
 * import only from `simulation/`, `ai/`, `shared/`, and its own files (§3 Module
 * Boundary Table; Invariant #96) — never the canonical `ReplayAPI` in
 * `electron/*` nor the `useReplayApi` hook in `renderer/*`. It therefore reads
 * the bridge off `globalThis`, typed against this shared slice.
 *
 * Drift protection: `electron/preload/api-types.ts` declares
 * `ReplayAPI extends ReplayExportBridge`, so the canonical preload surface is
 * structurally pinned to this slice — a divergent signature is a compile error
 * in the preload layer, not a silent drift.
 */
/**
 * Why the recording is being finalised:
 *
 * - `'save'` — the user pressed the replay player's **save icon**. Main raises the
 *   "Replay saved" toast (§4.30) once the export resolves.
 * - `'view'` — the user pressed the post-game **Replay** button. The recording is
 *   exported only to obtain a stable on-disk path for `openInPlayer`; raising a
 *   "Replay saved" toast then would be misleading, so main suppresses the
 *   `chimera:replay:exported` push for this intent.
 *
 * Defaults to `'save'` everywhere it is optional, so the historical
 * "export ⇒ toast" behaviour is preserved for any caller that omits it
 * (fail-safe — an absent or unknown intent shows the toast rather than hides it).
 */
export type ReplayExportIntent = 'save' | 'view';

export interface ReplayExportBridge {
    /**
     * Finalise the in-progress host recording to disk and resolve with the saved
     * file path (§4.28). Rejects when no match is being hosted — surfaced as an
     * inline error by the post-game summary actions.
     *
     * `intent` (default `'save'`) decides whether main raises the "Replay saved"
     * toast: `'save'` does, `'view'` (export-for-path-only) does not. See
     * {@link ReplayExportIntent}.
     */
    exportCurrentMatch(intent?: ReplayExportIntent): Promise<string>;
    /**
     * Ask main to open `path` in the replay player. Main validates the path is
     * inside the replay directory, then pushes `chimera:replay:navigate` — unless
     * `path` is {@link CURRENT_MATCH_REPLAY_PATH}, which bypasses containment and
     * opens the in-memory recording of the just-finished match (nothing is written
     * to disk until the player's save icon is pressed).
     *
     * `saveable` (default `false`) marks the opened replay as the just-finished
     * match, so the player surfaces its compact save affordance; it travels on
     * the navigate push as a query flag. Library-opened replays pass `false` (the
     * current-match export is session-gated and would not apply to them).
     */
    openInPlayer(path: string, saveable?: boolean): Promise<void>;
}

/**
 * The export / open-in-player slice of `window.__chimera.replay.perspective`
 * (`PerspectiveReplayAPI`, §4.28) that a game's *screen* module reads
 * off `globalThis` to finalise the CLIENT's own perspective recording and hand it
 * to the replay player from the post-game summary.
 *
 * Why a joined client uses this instead of {@link ReplayExportBridge}: the
 * deterministic replay re-runs the full simulation from `seed` + `actions` and
 * would reveal every player's hidden information (Invariant #71), so it stays
 * host-only. A perspective replay carries only one locked viewer's already
 * fog-filtered frames (Invariant #98), so the client may export its own.
 *
 * Unlike {@link ReplayExportBridge}, `exportCurrent` takes no `intent`: there is
 * no "Replay saved" toast push on the perspective channel, so the post-game
 * summary reflects a successful save with its own inline confirmation.
 *
 * Drift protection: `electron/preload/api-types.ts` declares
 * `PerspectiveReplayAPI extends PerspectiveReplayExportBridge`, pinning the
 * canonical preload surface to this slice — a divergent signature is a compile
 * error in the preload layer, not a silent drift.
 */
export interface PerspectiveReplayExportBridge {
    /**
     * Finalise the in-progress perspective recording to disk and resolve with the
     * saved file path. Rejects when no perspective recording is active (neither a
     * hosted nor a joined-client session).
     */
    exportCurrent(): Promise<string>;
    /**
     * Ask main to open `path` in the replay player. Main validates the path is
     * inside the perspective-replay directory, then pushes the shared
     * `chimera:replay:navigate` with `kind: 'perspective'` — unless `path` is
     * {@link CURRENT_MATCH_REPLAY_PATH}, which bypasses containment and opens the
     * in-memory perspective recording of the just-finished match.
     *
     * `saveable` (default `false`) marks the opened replay as the just-finished
     * match so the player surfaces its compact save affordance — see
     * {@link ReplayExportBridge.openInPlayer}.
     */
    openInPlayer(path: string, saveable?: boolean): Promise<void>;
}
