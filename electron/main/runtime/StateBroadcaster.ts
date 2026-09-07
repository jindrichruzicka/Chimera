/**
 * electron/main/runtime/StateBroadcaster.ts
 *
 * Projection fan-out component.  Sits between the ActionPipeline broadcast
 * stage and the HostTransport.  When broadcastWave(snapshot, viewerId) is
 * called (Stage 7 of ActionPipeline.process()), StateBroadcaster projects the
 * full host snapshot and delegates only the resulting PlayerSnapshot to
 * transport.sendSnapshot(viewerId, snapshot), then fans that wave out to any
 * spectators. Point-sends to a single viewer use broadcast(), which never
 * touches spectator traffic.
 *
 * Architecture: §4.6, §4.14 — StateProjector / StateBroadcaster
 *
 * Invariants upheld:
 *   #3  — Sends only PlayerSnapshot through HostTransport.
 *   #8  — StateProjector.project() is the mandatory outbound snapshot gate;
 *          StateBroadcaster never reads GameSnapshot fields directly.
 *   #47 — Zero imports from networking/provider/local/, ws, or DOM APIs.
 *   #67 — Constructed with injected Logger child; no console.* calls.
 */

import type { HostTransport, PlayerId, Unsubscribe } from '@chimera-engine/networking';
import { crc32Json } from '@chimera-engine/simulation/foundation/crc32.js';
import { diffSnapshots } from '@chimera-engine/simulation/foundation/snapshot-diff.js';
import { toSnapshotDelta } from '@chimera-engine/simulation/foundation/snapshot-delta.js';
import type {
    BaseGameSnapshot,
    BroadcastOptions,
} from '@chimera-engine/simulation/engine/types.js';
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
) & {
    readonly spectators?: SpectatorViewSource;
    /**
     * Beats between forced keyframes on the transport leg, per recipient.
     * Defaults to {@link DEFAULT_KEYFRAME_INTERVAL_BEATS}.
     */
    readonly keyframeIntervalBeats?: number;
};

/**
 * The default for `keyframeIntervalBeats`.
 *
 * Not a loss-recovery number: the wire is ordered and reliable, so a frame is
 * never simply missing — a session that breaks reconnects and asks for a full
 * snapshot. It bounds how long a recipient whose chain broke for any other
 * reason stays wrong before the host repairs it without being asked.
 */
export const DEFAULT_KEYFRAME_INTERVAL_BEATS = 60;

/** What was actually put on the wire, for the measurement this path exists to justify. */
export interface SnapshotDeltaMetrics {
    /** Whole projections sent, for every reason a keyframe is owed. */
    readonly keyframes: number;
    /** Beats that put only changed paths on the wire. */
    readonly deltas: number;
    /** Keyframes sent BECAUSE the delta would not have been smaller. */
    readonly sizeFallbacks: number;
}

/**
 * What the broadcaster remembers about one transport recipient, so the next
 * beat can be expressed as a difference from the last one.
 *
 * Bounded by construction: one entry per recipient the host has sent to, and
 * `onPlayerLeft` drops the entry. Keyed by RECIPIENT rather than by seat —
 * a spectator is diffed against what that spectator received, not against the
 * seat it follows.
 */
interface RecipientDeltaState {
    /** The last whole projection this recipient was sent; every delta's baseline. */
    lastProjection: Readonly<PlayerSnapshot>;
    /** Serialised length of the last keyframe, the yardstick a delta must beat. */
    keyframeBytes: number;
    /** Beats on deltas alone since that keyframe. */
    beatsSinceKeyframe: number;
}

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
    /** Per-recipient delta baselines (see {@link RecipientDeltaState}). */
    private readonly deltaState = new Map<PlayerId, RecipientDeltaState>();
    private readonly metrics = { keyframes: 0, deltas: 0, sizeFallbacks: 0 };
    private readonly keyframeIntervalBeats: number;
    /** Drops a departed recipient's baseline; released by {@link dispose}. */
    private readonly unsubscribePlayerLeft: Unsubscribe;

    constructor(
        private readonly transport: HostTransport,
        private readonly projector: StateProjector<BaseGameSnapshot>,
        logger: Logger,
        private readonly options: StateBroadcasterOptions = {},
    ) {
        this.log = logger.child({ module: 'state-broadcaster' });
        this.keyframeIntervalBeats =
            options.keyframeIntervalBeats ?? DEFAULT_KEYFRAME_INTERVAL_BEATS;
        // Subscribed here rather than wired from the composition root because the
        // root's own player-left handler returns early down several branches (a
        // spectator leaving, a lobby-phase leave), and a baseline left behind on
        // any of them is the unbounded map this whole arc exists to remove.
        this.unsubscribePlayerLeft = transport.onPlayerLeft((playerId) => {
            this.deltaState.delete(playerId);
        });
    }

    /**
     * What this broadcaster has put on the wire so far.
     *
     * A diagnostic seam. Nothing in the running app reads it today; the size
     * fallback also leaves a `trace` line, which is what an operator would ask
     * for. The counters are what the tests assert a decision on.
     */
    deltaMetrics(): SnapshotDeltaMetrics {
        return { ...this.metrics };
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
     * A point-send to ONE viewer — it never touches spectator traffic, so a
     * host-local action never fans a snapshot out to every remote spectator.
     * The Stage-7 wave uses {@link broadcastWave}.
     *
     * No-ops silently if `dispose()` has already been called.
     */
    broadcast(snapshot: Readonly<BaseGameSnapshot>, viewerId: PlayerId): void {
        if (this.disposed) return;
        const playerSnapshot = this.projector.project(snapshot, viewerId);
        this.log.trace('broadcast', { viewerId, tick: playerSnapshot.tick });
        // A point-send is always a KEYFRAME. Every caller of it is asking for
        // the whole thing by definition — a viewer whose baseline the host
        // cannot vouch for, or one whose projection was just replaced wholesale.
        this.sendKeyframe(viewerId, playerSnapshot);
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
    broadcastWave(
        snapshot: Readonly<BaseGameSnapshot>,
        viewerId: PlayerId,
        options: BroadcastOptions = { forceFull: false },
    ): void {
        if (this.disposed) return;
        const playerSnapshot = this.projector.project(snapshot, viewerId);
        this.log.trace('broadcast', { viewerId, tick: playerSnapshot.tick });
        this.sendProjection(viewerId, playerSnapshot, options.forceFull);
        this.sendToRendererRecipients(viewerId, playerSnapshot);
        this.notifyE2eHooks(viewerId, playerSnapshot);
        this.fanOutToSpectators(snapshot, options.forceFull);
    }

    /**
     * Stage-7 clock-only wave: forward the advanced tick to `viewerId` and,
     * once per tick value, to each spectator. This is only ever driven by the
     * pipeline's clock-only broadcast path (no non-wave tick point-send
     * exists), so it fans out to spectators directly.
     */
    broadcastTick(tick: number, viewerId: PlayerId): void {
        if (this.disposed) return;
        this.log.trace('broadcast tick', { viewerId, tick });
        this.transport.sendTick(viewerId, tick);
        this.sendTickToRendererRecipients(viewerId, tick);
        this.options.e2eHooks?.onClockTick(tick, viewerId);
        this.fanOutTickToSpectators(tick);
    }

    /**
     * Unicast the followed seat's projection to one spectator. Does not
     * consume the per-wave fan-out marker, so the next regular wave still
     * reaches every spectator. No-op with a warn for a spectator the view
     * source does not know.
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
        // A unicast re-sync, so a keyframe for the same reason `broadcast()` is.
        this.sendKeyframe(spectatorId, projected);
    }

    /**
     * Send each spectator the projection of its followed seat, once per
     * broadcast wave (see `lastSpectatorSnapshot`). Spectators are remote by
     * definition, so renderer recipients and E2E host hooks are not involved.
     */
    private fanOutToSpectators(snapshot: Readonly<BaseGameSnapshot>, forceFull: boolean): void {
        const spectators = this.options.spectators;
        if (spectators === undefined) return;
        if (snapshot === this.lastSpectatorSnapshot) return;
        this.lastSpectatorSnapshot = snapshot;
        for (const [spectatorId, followedId] of spectators.entries()) {
            const projected = this.projector.project(snapshot, followedId);
            this.log.trace('spectator broadcast', {
                spectatorId,
                followedId,
                tick: projected.tick,
            });
            this.sendProjection(spectatorId, projected, forceFull);
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

    /**
     * Put this beat's projection on the wire as a delta where that is both
     * possible and cheaper, and as a whole snapshot otherwise.
     *
     * Five conditions owe a keyframe, each for its own reason:
     *  - the pipeline forced the wave (`engine:sync_request`) — the viewer that
     *    asked to be re-synced is exactly the one whose baseline the host cannot
     *    vouch for, so a delta against that baseline is the one thing it must
     *    not be sent. Nothing observable identifies this case: a re-sync after a
     *    run of clock-only beats has a projection that genuinely DID change;
     *  - no baseline — this recipient has been sent nothing to difference from;
     *  - the periodic interval elapsed;
     *  - the projection did not change, so a delta would carry no entries;
     *  - the delta is not smaller than the last keyframe, so the delta path
     *    would cost bytes rather than save them.
     *
     * The size comparison is against the last keyframe's length rather than
     * against a fresh serialisation of this projection: the snapshot is stable
     * in size from beat to beat, and serialising it every beat to decide would
     * pay the exact cost the delta is here to avoid. Only the delta — small
     * whenever the answer is "send the delta" — is measured per beat.
     */
    private sendProjection(
        recipientId: PlayerId,
        projection: PlayerSnapshot,
        forceFull: boolean,
    ): void {
        const state = this.deltaState.get(recipientId);
        if (
            forceFull ||
            state === undefined ||
            state.beatsSinceKeyframe + 1 >= this.keyframeIntervalBeats
        ) {
            this.sendKeyframe(recipientId, projection);
            return;
        }

        const delta = toSnapshotDelta(diffSnapshots(state.lastProjection, projection));
        if (delta.entries.length === 0) {
            this.sendKeyframe(recipientId, projection);
            return;
        }

        const deltaBytes = JSON.stringify(delta).length;
        if (deltaBytes >= state.keyframeBytes) {
            this.log.trace('delta not smaller than keyframe — sending the snapshot', {
                recipientId,
                deltaBytes,
                keyframeBytes: state.keyframeBytes,
            });
            this.metrics.sizeFallbacks += 1;
            this.sendKeyframe(recipientId, projection);
            return;
        }

        this.metrics.deltas += 1;
        state.lastProjection = projection;
        state.beatsSinceKeyframe += 1;
        this.transport.sendSnapshotDelta(recipientId, delta);
    }

    /** Send the whole projection and make it this recipient's new baseline. */
    private sendKeyframe(recipientId: PlayerId, projection: PlayerSnapshot): void {
        this.metrics.keyframes += 1;
        this.deltaState.set(recipientId, {
            lastProjection: projection,
            keyframeBytes: JSON.stringify(projection).length,
            beatsSinceKeyframe: 0,
        });
        this.transport.sendSnapshot(recipientId, projection);
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
        this.deltaState.clear();
        this.unsubscribePlayerLeft();
    }
}
