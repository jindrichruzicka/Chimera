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
