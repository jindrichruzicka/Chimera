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
 *   #1  — Only PlayerSnapshot handled; no reference to GameSnapshot.
 *   #2  — Zero imports from networking/provider/local/, ws, or DOM APIs.
 *   #67 — Constructed with injected Logger child; no console.* calls.
 */

import type {
    HostTransport,
    PlayerSnapshot,
    PlayerId,
} from '@chimera/networking/provider/MultiplayerProvider.js';
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
     * Forward a projected `PlayerSnapshot` to the specified viewer.
     *
     * Called by `ActionPipeline` Stage 7 for each connected player with their
     * individual projected snapshot.  LocalWebSocketProvider serialises and
     * writes the payload to the ws socket internally — this module is fully
     * transport-agnostic.
     *
     * TODO(F26): apply StateProjector obfuscation before forwarding.
     */
    broadcast(snapshot: PlayerSnapshot, viewerId: PlayerId): void {
        this.log.debug('broadcast', { viewerId, tick: snapshot.tick });
        this.transport.sendSnapshot(viewerId, snapshot);
    }
}
