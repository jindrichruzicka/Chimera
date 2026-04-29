/**
 * electron/main/runtime/StateBroadcaster.ts
 *
 * Projection fan-out component.  Sits between the ActionPipeline broadcast
 * stage and the HostTransport.  When broadcast(snapshot, viewerId) is called
 * (Stage 7 of ActionPipeline.process()), StateBroadcaster delegates to
 * transport.sendSnapshot(viewerId, snapshot).
 *
 * At this stage (pre-F26) no obfuscation logic is applied — the snapshot is
 * forwarded as-is.  The interface already accepts HostTransport so that
 * plugging in a real projector in F26 requires no interface change.
 *
 * Architecture: §4.14 — Pluggable Multiplayer Provider / StateBroadcaster
 * Task: F11-T02 (issue #239)
 *
 * Invariants upheld:
 *   #1  — Accepts ViewerSnapshot (the projected boundary type); no reference to
 *          GameSnapshot.  The internal cast to PlayerSnapshot is safe pre-F26
 *          because no projection is applied yet (TODO(F26)).
 *   #2  — Zero imports from networking/provider/local/, ws, or DOM APIs.
 *   #67 — Constructed with injected Logger child; no console.* calls.
 */

import type {
    HostTransport,
    PlayerSnapshot,
    PlayerId,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { ViewerSnapshot } from '@chimera/simulation/engine/types.js';
import type { Logger } from '../logging/logger.js';

/**
 * Fans out projected `PlayerSnapshot` objects to connected players via
 * `HostTransport.sendSnapshot()`.
 *
 * Wired into `ActionPipeline` as the `BroadcastContext.broadcast` callback
 * at construction time in `electron/main/index.ts`.
 */
export class StateBroadcaster {
    private readonly log: Logger;

    constructor(
        private readonly transport: HostTransport,
        logger: Logger,
    ) {
        this.log = logger.child({ module: 'state-broadcaster' });
    }

    /**
     * Forward a projected viewer snapshot to the specified player via the
     * `HostTransport`.
     *
     * Accepts the `ViewerSnapshot` brand produced by `ActionPipeline` Stage 7
     * so the `BroadcastContext.broadcast` signature is satisfied without an
     * unsafe cast at every call site.
     *
     * The cast to `PlayerSnapshot` here is safe pre-F26: no projection is
     * applied yet (Invariant #1), so `ViewerSnapshot` is structurally
     * identical to `PlayerSnapshot`.  A `StateProjector` (F26) will replace
     * this cast once obfuscation logic is wired.
     *
     * TODO(F26): apply StateProjector and remove the `as unknown as` cast.
     */
    broadcast(snapshot: ViewerSnapshot, viewerId: PlayerId): void {
        const playerSnapshot = snapshot as unknown as PlayerSnapshot;
        this.log.debug('broadcast', { viewerId, tick: playerSnapshot.tick });
        this.transport.sendSnapshot(viewerId, playerSnapshot);
    }
}
