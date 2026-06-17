/**
 * electron/main/replay/PerspectiveReplayPlaybackManager.ts
 *
 * Main-process owner of *perspective* replay playback (§4.28, ADR F44b, F44b /
 * T6, #672) — the read side of the recording machinery in
 * `./PerspectiveReplayManager.ts`, and the privacy-preserving counterpart to the
 * deterministic `./replay-playback-manager.ts`.
 *
 * A perspective replay stores only already-projected `PlayerSnapshot` frames for
 * a single, **locked** `viewerId`. Playback is therefore *verbatim*: this manager
 * walks the stored frames in order and serves them unchanged. It NEVER re-runs the
 * simulation — no seed, no `gameConfig`, no `ActionPipeline`, no `StateProjector`
 * (invariant #98, and the perspective carve-out of invariant #70). The
 * import-boundary test asserts that none of `ActionRegistry`, `ActionPipeline`,
 * `StateProjector`, or `buildHostSessionPipeline` is imported here.
 *
 * Because frames carry a single locked viewer, `open` exposes that one `viewerId`
 * and deliberately offers no seat list and no seat switching (contrast the
 * deterministic `ReplayPlaybackManager.open`, which lists every `playerId`).
 *
 * Architecture reference: §4.28 (ADR F44b)
 * Task: F44b / T6 (issue #672)
 *
 * Invariants upheld:
 *   #67 — constructed with an injected Logger child; every public method logs at
 *           debug level.
 *   #70 — perspective playback never touches `ActionPipeline`; the deterministic
 *           "reuse the live pipeline" rule explicitly does not apply (it walks
 *           stored snapshots instead).
 *   #98 — playback steps through stored `PlayerSnapshot`s for the single locked
 *           `viewerId`; never re-runs the sim, never exposes a seat list.
 */

import type {
    PerspectiveReplayFile,
    PerspectiveReplayFrame,
} from '@chimera/simulation/replay/index.js';
// The IPC-contract types that cross the boundary, as used by the deterministic
// `replay-playback-manager.ts`. `PerspectiveReplayPlaybackInfo` is the canonical
// `open()` return shape — imported here rather than redeclared, mirroring how that
// manager imports `ReplayPlaybackInfo` (the single source of truth lives in
// `api-types.ts`, so the IPC port and this manager cannot drift). The stored
// `frame.snapshot` is the simulation-projection `PlayerSnapshot`
// (`projection/StateProjector.ts`); the two `PlayerSnapshot`s are structurally
// compatible, so serving frames verbatim under the declared type is sound. If the
// shapes ever diverge, tsc surfaces it here.
import type { PerspectiveReplayPlaybackInfo, PlayerSnapshot } from '../../preload/api-types.js';
import type { Logger } from '../logging/logger.js';

/**
 * Narrow slice of `PerspectiveReplayManager` the playback manager depends on
 * (DIP, mirroring `ReplayLoaderPort`). The injected loader owns the
 * engineVersion compatibility guard, so opening an incompatible file rejects
 * before any frame is read.
 */
export interface PerspectiveReplayLoaderPort {
    load(path: string): Promise<PerspectiveReplayFile>;
}

interface ActivePlayback {
    readonly viewerId: string;
    /** Stored frames, ordered by strictly-increasing tick (invariant #98). */
    readonly frames: readonly PerspectiveReplayFrame[];
}

/**
 * Loads a perspective replay and serves its stored, already-projected snapshots
 * verbatim. Holds at most one active playback session; opening a new replay
 * replaces it.
 */
export class PerspectiveReplayPlaybackManager {
    private readonly log: Logger;
    #active: ActivePlayback | null = null;

    constructor(
        private readonly loader: PerspectiveReplayLoaderPort,
        logger: Logger,
    ) {
        this.log = logger.child({ module: 'perspective-replay-playback-manager' });
    }

    /**
     * Load `path` via the injected loader (which applies the engineVersion guard)
     * and ready its stored frames for playback. Returns the static metadata —
     * including the single locked `viewerId` and no seat list. Replaces any
     * previously open session.
     */
    async open(path: string): Promise<PerspectiveReplayPlaybackInfo> {
        this.log.debug('open', { path });
        const file = await this.loader.load(path);
        this.#active = { viewerId: file.viewerId, frames: file.frames };
        return {
            gameId: file.gameId,
            totalTicks: file.durationTicks,
            viewerId: file.viewerId,
        };
    }

    /**
     * Return the displayed {@link PlayerSnapshot} at `tick` using **floor lookup**:
     * the snapshot of the stored frame with the greatest `tick` not exceeding the
     * requested one — i.e. the snapshot still in effect at that tick when the
     * scrubber lands between recorded frames. The snapshot is returned verbatim;
     * nothing is re-projected or re-simulated.
     *
     * A perspective recording need not begin at tick 0 — a joined client starts
     * recording on its first received snapshot, so its first frame can be a later
     * tick. For ticks before that first frame, the earliest recorded frame is held
     * (rather than throwing), so the player can open at tick 0 for any recording.
     *
     * @throws when no playback session is open, or when the recording has no frames.
     */
    snapshotAt(tick: number): PlayerSnapshot {
        const active = this.#requireActive('snapshotAt');
        if (active.frames.length === 0) {
            throw new Error(
                'PerspectiveReplayPlaybackManager.snapshotAt: the recording has no frames',
            );
        }
        const index = PerspectiveReplayPlaybackManager.floorIndex(active.frames, tick);
        // floorIndex returns -1 for ticks before the first frame; hold the
        // earliest frame in that case (frame 0) rather than erroring.
        const heldIndex = index < 0 ? 0 : index;
        // Non-null: heldIndex is a valid in-range index (frames is non-empty).
        return active.frames[heldIndex]!.snapshot;
    }

    /**
     * Return the stored snapshots whose `tick` falls within the inclusive range
     * `[from, to]`, in recorded order, so the renderer can prefetch a buffer of
     * frames per IPC round-trip. Frames are returned verbatim; gaps in the range
     * simply yield fewer snapshots (an empty array when no frame falls in range).
     *
     * The result is **sparse** — exactly the recorded frames in range — and so
     * deliberately diverges from the deterministic
     * `ReplayPlaybackManager.snapshotRange`, which re-projects a *dense* snapshot
     * for every tick in `[from, to]`. Perspective playback never re-projects
     * (invariant #98), so IPC consumers must treat the returned ticks as the only
     * frames available in the window and interpolate/hold between them themselves.
     *
     * @throws when no playback session is open, or when `from > to`.
     */
    snapshotRange(from: number, to: number): PlayerSnapshot[] {
        const active = this.#requireActive('snapshotRange');
        if (from > to) {
            throw new Error(
                `PerspectiveReplayPlaybackManager.snapshotRange: from (${from.toString()}) must be <= to (${to.toString()})`,
            );
        }
        // Frames are strictly increasing by tick (invariant #98): binary-search the
        // first in-range frame, then walk forward until the tick leaves the range —
        // O(log n + k) for k frames returned, symmetric with snapshotAt's floor lookup.
        const { frames } = active;
        const snapshots: PlayerSnapshot[] = [];
        for (
            let i = PerspectiveReplayPlaybackManager.lowerBoundIndex(frames, from);
            i < frames.length && frames[i]!.tick <= to;
            i += 1
        ) {
            // Non-null: i stays within [0, length) per the loop guard.
            snapshots.push(frames[i]!.snapshot);
        }
        return snapshots;
    }

    /** End the active playback session, if any. Idempotent. */
    close(): void {
        this.log.debug('close', { active: this.#active !== null });
        this.#active = null;
    }

    #requireActive(method: string): ActivePlayback {
        if (this.#active === null) {
            throw new Error(
                `PerspectiveReplayPlaybackManager.${method}: no perspective replay playback session is open`,
            );
        }
        return this.#active;
    }

    /**
     * Index of the first frame with `tick >= target`, or `frames.length` when
     * every frame's tick is below `target`. Binary search over the
     * strictly-increasing frame ticks (invariant #98) — the lower-bound companion
     * to {@link floorIndex}, used to bound {@link snapshotRange}'s walk.
     */
    private static lowerBoundIndex(
        frames: readonly PerspectiveReplayFrame[],
        target: number,
    ): number {
        let lo = 0;
        let hi = frames.length;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            // Non-null: mid is within [lo, hi) ⊆ [0, length).
            if (frames[mid]!.tick < target) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    /**
     * Index of the frame with the greatest `tick <= target`, or `-1` when every
     * frame's tick exceeds `target`. Binary search over the strictly-increasing
     * frame ticks (invariant #98).
     */
    private static floorIndex(frames: readonly PerspectiveReplayFrame[], target: number): number {
        let lo = 0;
        let hi = frames.length - 1;
        let result = -1;
        while (lo <= hi) {
            const mid = (lo + hi) >>> 1;
            // Non-null: mid is within [lo, hi] ⊆ [0, length).
            if (frames[mid]!.tick <= target) {
                result = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return result;
    }
}
