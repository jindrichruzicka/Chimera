/**
 * electron/main/runtime/StateBroadcaster.ts
 *
 * Projection fan-out component.  Sits between the ActionPipeline broadcast
 * stage and the HostTransport.  When broadcastWave(snapshot, viewerId) is
 * called (Stage 7 of ActionPipeline.process()), StateBroadcaster projects the
 * full host snapshot and delegates only the resulting PlayerSnapshot to
 * transport.sendSnapshot(viewerId, snapshot), then fans that wave out to any
 * spectators. Point-sends to a single viewer (reconnect re-sync, host-renderer
 * seat switch) use broadcast(), which never touches spectator traffic.
 *
 * Architecture: §4.6, §4.14 — StateProjector / StateBroadcaster
 *
 * Invariants upheld:
 *   #3  — Sends only PlayerSnapshot through HostTransport.
 *   #8  — StateProjector.project() is the mandatory outbound snapshot gate;
 *          StateBroadcaster never reads GameSnapshot fields directly.
 *   #39 — Zero imports from networking/provider/local/, ws, or DOM APIs.
 *   #67 — Constructed with injected Logger child; no console.* calls.
 */

import type { HostTransport, PlayerId, Unsubscribe } from '@chimera-engine/networking';
import { crc32Json } from '@chimera-engine/simulation/foundation/crc32.js';
import type { BaseGameSnapshot } from '@chimera-engine/simulation/engine/types.js';
import type {
    PlayerSnapshot,
    StateProjector,
} from '@chimera-engine/simulation/projection/StateProjector.js';
import type { Logger } from '../logging/logger.js';
import type { E2eHooks } from './e2e-hooks.js';

export interface RendererSnapshotRecipient {
    readonly viewerId: PlayerId;
    readonly sendSnapshot: (snapshot: PlayerSnapshot) => void;
    readonly sendTick?: (tick: number) => void;
}

/**
 * Read-only view of the host's spectator ledger (Invariant #114): which
 * spectators are connected and which seat each one follows. Structural
 * seam so this module never imports the lobby-layer registry; the
 * composition root injects `SpectatorRegistry`, which satisfies it.
 */
export interface SpectatorViewSource {
    entries(): readonly (readonly [PlayerId, PlayerId])[];
    followedBy(spectatorId: PlayerId): PlayerId | undefined;
}

/**
 * Options for {@link StateBroadcaster}.
 *
 * The two E2E branches are mutually exclusive:
 * - No E2E: neither `hostViewerId` nor `e2eHooks` need be supplied.
 * - E2E: both `hostViewerId` **and** `e2eHooks` must be supplied together;
 *   supplying `e2eHooks` without `hostViewerId` is a type error (ISP).
 *
 * `spectators` is independent of the E2E pairing: when supplied, every
 * broadcast wave (and clock tick) also reaches each spectator with the
 * projection of its followed seat.
 */
export type StateBroadcasterOptions = (
    | { readonly hostViewerId?: PlayerId; readonly e2eHooks?: undefined }
    | { readonly hostViewerId: PlayerId; readonly e2eHooks: E2eHooks }
) & { readonly spectators?: SpectatorViewSource };

/**
 * Fans out projected `PlayerSnapshot` objects to connected players via
 * `HostTransport.sendSnapshot()`.
 *
 * `broadcastWave` is wired into `ActionPipeline` as the
 * `BroadcastContext.broadcast` callback at construction time in
 * `electron/main/index.ts`.
 */
export class StateBroadcaster {
    private readonly log: Logger;
    private readonly rendererRecipients = new Map<PlayerId, Set<RendererSnapshotRecipient>>();
    private disposed = false;
    /**
     * Last snapshot object fanned out to spectators. Stage 7 calls
     * `broadcast()` once per seated viewer with the SAME snapshot object and
     * guarantees a changed reference whenever state changed — so reference
     * identity marks a new wave, and spectators get exactly one perspective
     * send per wave instead of one per seated viewer.
     */
    private lastSpectatorSnapshot: Readonly<BaseGameSnapshot> | null = null;
    /** Last tick value forwarded to spectators (ticks advance monotonically). */
    private lastSpectatorTick: number | null = null;

    constructor(
        private readonly transport: HostTransport,
        private readonly projector: StateProjector<BaseGameSnapshot>,
        logger: Logger,
        private readonly options: StateBroadcasterOptions = {},
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
     * A point-send to ONE viewer — it never touches spectator traffic. The
     * reconnect re-sync and the host-renderer seat switch use this so a
     * host-local action never fans a snapshot out to every remote spectator;
     * the Stage-7 wave uses {@link broadcastWave}.
     *
     * No-ops silently if `dispose()` has already been called.
     */
    broadcast(snapshot: Readonly<BaseGameSnapshot>, viewerId: PlayerId): void {
        if (this.disposed) return;
        const playerSnapshot = this.projector.project(snapshot, viewerId);
        this.log.debug('broadcast', { viewerId, tick: playerSnapshot.tick });
        this.transport.sendSnapshot(viewerId, playerSnapshot);
        this.sendToRendererRecipients(viewerId, playerSnapshot);
        this.notifyE2eHooks(viewerId, playerSnapshot);
    }

    /**
     * Stage-7 wave broadcast: the per-viewer send plus a single spectator
     * fan-out per wave. `ActionPipeline` calls this once per seated viewer
     * with the same snapshot reference; the spectator fan-out is deduped on
     * that reference (see `lastSpectatorSnapshot`) so each spectator receives
     * exactly one perspective snapshot per wave (Invariant #114). Only this
     * Stage-7 path drives spectator snapshot traffic — a point-send
     * `broadcast()` never does.
     *
     * No-ops silently if `dispose()` has already been called.
     */
    broadcastWave(snapshot: Readonly<BaseGameSnapshot>, viewerId: PlayerId): void {
        if (this.disposed) return;
        this.broadcast(snapshot, viewerId);
        this.fanOutToSpectators(snapshot);
    }

    /**
     * Stage-7 clock-only wave: forward the advanced tick to `viewerId` and,
     * once per tick value, to each spectator. This is only ever driven by the
     * pipeline's clock-only broadcast path (no non-wave tick point-send
     * exists), so it fans out to spectators directly.
     */
    broadcastTick(tick: number, viewerId: PlayerId): void {
        if (this.disposed) return;
        this.log.debug('broadcast tick', { viewerId, tick });
        this.transport.sendTick(viewerId, tick);
        this.sendTickToRendererRecipients(viewerId, tick);
        this.options.e2eHooks?.onClockTick(tick, viewerId);
        this.fanOutTickToSpectators(tick);
    }

    /**
     * Unicast the followed seat's projection to one spectator — the
     * join-time initial push. Does not consume the per-wave fan-out marker,
     * so the next regular wave still reaches every spectator. No-op with a
     * warn for a spectator the view source does not know.
     */
    broadcastSpectator(snapshot: Readonly<BaseGameSnapshot>, spectatorId: PlayerId): void {
        if (this.disposed) return;
        const followedId = this.options.spectators?.followedBy(spectatorId);
        if (followedId === undefined) {
            this.log.warn('spectator snapshot requested for unregistered spectator', {
                spectatorId,
            });
            return;
        }
        const projected = this.projector.project(snapshot, followedId);
        this.log.debug('spectator unicast', { spectatorId, followedId, tick: projected.tick });
        this.transport.sendSnapshot(spectatorId, projected);
    }

    /**
     * Send each spectator the projection of its followed seat, once per
     * broadcast wave (see `lastSpectatorSnapshot`). Spectators are remote by
     * definition, so renderer recipients and E2E host hooks are not involved.
     */
    private fanOutToSpectators(snapshot: Readonly<BaseGameSnapshot>): void {
        const spectators = this.options.spectators;
        if (spectators === undefined) return;
        if (snapshot === this.lastSpectatorSnapshot) return;
        this.lastSpectatorSnapshot = snapshot;
        for (const [spectatorId, followedId] of spectators.entries()) {
            const projected = this.projector.project(snapshot, followedId);
            this.log.debug('spectator broadcast', {
                spectatorId,
                followedId,
                tick: projected.tick,
            });
            this.transport.sendSnapshot(spectatorId, projected);
        }
    }

    private fanOutTickToSpectators(tick: number): void {
        const spectators = this.options.spectators;
        if (spectators === undefined) return;
        if (tick === this.lastSpectatorTick) return;
        this.lastSpectatorTick = tick;
        for (const [spectatorId] of spectators.entries()) {
            this.transport.sendTick(spectatorId, tick);
        }
    }

    private notifyE2eHooks(viewerId: PlayerId, snapshot: PlayerSnapshot): void {
        if (this.options.e2eHooks === undefined) return;
        const checksum = crc32Json(snapshot);
        this.options.e2eHooks.onBroadcastChecksum(snapshot.tick, viewerId, checksum);
        if (viewerId !== this.options.hostViewerId) return;
        this.options.e2eHooks.onTick(snapshot.tick, checksum, snapshot);
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

    private sendTickToRendererRecipients(viewerId: PlayerId, tick: number): void {
        const recipients = this.rendererRecipients.get(viewerId);
        if (recipients === undefined) {
            return;
        }

        for (const recipient of recipients) {
            recipient.sendTick?.(tick);
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
