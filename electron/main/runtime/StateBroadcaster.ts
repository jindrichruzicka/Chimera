/**
 * electron/main/runtime/StateBroadcaster.ts
 *
 * Projection fan-out component.  Sits between the ActionPipeline broadcast
 * stage and the HostTransport.  When broadcast(snapshot, viewerId) is called
 * (Stage 7 of ActionPipeline.process()), StateBroadcaster projects the full
 * host snapshot and delegates only the resulting PlayerSnapshot to
 * transport.sendSnapshot(viewerId, snapshot).
 *
 * Architecture: §4.6, §4.14 — StateProjector / StateBroadcaster
 * Task: F11-T02 (issue #239), issue #436
 *
 * Invariants upheld:
 *   #3  — Sends only PlayerSnapshot through HostTransport.
 *   #8  — StateProjector.project() is the mandatory outbound snapshot gate;
 *          StateBroadcaster never reads GameSnapshot fields directly.
 *   #39 — Zero imports from networking/provider/local/, ws, or DOM APIs.
 *   #67 — Constructed with injected Logger child; no console.* calls.
 */

import type {
    HostTransport,
    PlayerId,
    Unsubscribe,
} from '@chimera/networking/provider/MultiplayerProvider.js';
import type { BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import type {
    PlayerSnapshot,
    StateProjector,
} from '@chimera/simulation/projection/StateProjector.js';
import type { Logger } from '../logging/logger.js';

export interface RendererSnapshotRecipient {
    readonly viewerId: PlayerId;
    readonly sendSnapshot: (snapshot: PlayerSnapshot) => void;
}

/**
 * Fans out projected `PlayerSnapshot` objects to connected players via
 * `HostTransport.sendSnapshot()`.
 *
 * Wired into `ActionPipeline` as the `BroadcastContext.broadcast` callback
 * at construction time in `electron/main/index.ts`.
 */
export class StateBroadcaster {
    private readonly log: Logger;
    private readonly rendererRecipients = new Map<PlayerId, Set<RendererSnapshotRecipient>>();
    private disposed = false;

    constructor(
        private readonly transport: HostTransport,
        private readonly projector: StateProjector<BaseGameSnapshot>,
        logger: Logger,
    ) {
        this.log = logger.child({ module: 'state-broadcaster' });
    }

    registerRendererRecipient(recipient: RendererSnapshotRecipient): Unsubscribe {
        if (this.disposed) {
            return () => undefined;
        }

        const recipients = this.rendererRecipients.get(recipient.viewerId) ?? new Set();
        recipients.add(recipient);
        this.rendererRecipients.set(recipient.viewerId, recipients);

        return () => {
            const registered = this.rendererRecipients.get(recipient.viewerId);
            if (registered === undefined) {
                return;
            }
            registered.delete(recipient);
            if (registered.size === 0) {
                this.rendererRecipients.delete(recipient.viewerId);
            }
        };
    }

    /**
     * Project the full host snapshot for `viewerId` and forward only that
     * player-safe view to the transport and registered renderer boundaries.
     *
     * No-ops silently if `dispose()` has already been called.
     */
    broadcast(snapshot: Readonly<BaseGameSnapshot>, viewerId: PlayerId): void {
        if (this.disposed) return;
        const playerSnapshot = this.projector.project(snapshot, viewerId);
        this.log.debug('broadcast', { viewerId, tick: playerSnapshot.tick });
        this.transport.sendSnapshot(viewerId, playerSnapshot);
        this.sendToRendererRecipients(viewerId, playerSnapshot);
    }

    private sendToRendererRecipients(viewerId: PlayerId, snapshot: PlayerSnapshot): void {
        const recipients = this.rendererRecipients.get(viewerId);
        if (recipients === undefined) {
            return;
        }

        for (const recipient of recipients) {
            recipient.sendSnapshot(snapshot);
        }
    }

    /**
     * Release this broadcaster. After calling `dispose()`, any subsequent
     * `broadcast()` calls are silently ignored, preventing stale snapshots
     * from leaking out during rapid session cycling.
     *
     * Safe to call multiple times.
     */
    dispose(): void {
        this.disposed = true;
        this.rendererRecipients.clear();
    }
}
