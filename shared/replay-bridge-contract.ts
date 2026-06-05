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
 * The read-only `list` slice of `window.__chimera.replay.perspective`
 * (`PerspectiveReplayAPI`, §4.28 ADR F44b) that a game's shell module may read
 * off `globalThis` to decide whether a replay-related menu affordance is
 * available.
 */
export interface PerspectiveReplayListBridge {
    /**
     * List stored perspective-replay file paths for `gameId`, newest-first.
     * Returns opaque path handles — a perspective replay's metadata is read only
     * when it is opened (invariants #3 / #98 — no gameplay state crosses here).
     */
    list(gameId: string): Promise<readonly string[]>;
}

/**
 * The export / open-in-player slice of `window.__chimera.replay`
 * (`ReplayAPI`, §4.28) that a game's *screen* module reads off `globalThis` to
 * finalise the in-progress recording and hand it to the replay player from the
 * post-game summary (F44 / T8).
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
export interface ReplayExportBridge {
    /**
     * Finalise the in-progress host recording to disk and resolve with the saved
     * file path (§4.28). Rejects when no match is being hosted — surfaced as an
     * inline error by the post-game summary actions (F44 / T8).
     */
    exportCurrentMatch(): Promise<string>;
    /**
     * Ask main to open `path` in the replay player. Main validates the path is
     * inside the replay directory, then pushes `chimera:replay:navigate`.
     */
    openInPlayer(path: string): Promise<void>;
}
