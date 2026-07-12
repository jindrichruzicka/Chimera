/**
 * electron/main/runtime/SessionRuntime.ts
 *
 * Minimal main-process holder for the live `BaseGameSnapshot` of a single
 * hosted session.  Sits between the transport (which delivers
 * `EngineAction`s from clients) and `HostSessionPipeline.processAction`
 * (which produces the next snapshot), and exposes:
 *
 *   - `applyAction(action)`        — drive the pipeline with a freshly
 *                                    received action and update the live
 *                                    snapshot in place;
 *   - `captureSaveFile(request)`   — produce a {@link SaveFile} from the
 *                                    current snapshot;
 *   - `applyRestoredFile(file)`    — replace the live snapshot from a
 *                                    loaded save.
 *
 * `SessionRuntime` is intentionally small.  It is the only place in `main/`
 * that owns a mutable reference to a {@link BaseGameSnapshot}; everywhere
 * else in `simulation/` the snapshot stays immutable per Invariant #1.
 *
 * Architecture: §4.11 — Save / Load · §4.7 — ActionPipeline host bootstrap.
 *
 * Invariants upheld:
 *   #1  — `BaseGameSnapshot` never crosses the IPC boundary; only
 *          `SaveFile.header` / `SaveSlotMeta` ever leave the host.
 *   #25 — `captureSaveFile` is an out-of-band host call; it never
 *          re-enters the pipeline as a synthetic `engine:save` action.
 *   #44 — `header.turnNumber` mirrors the integer field on the snapshot;
 *          no float arithmetic.
 */

import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import {
    CURRENT_SCHEMA_VERSION,
    deriveSessionManifest,
    type SaveFile,
    type SaveSessionManifest,
} from '@chimera-engine/simulation/persistence/index.js';
import {
    DEFAULT_SCENE_CLIENT_TIMEOUT_POLICY,
    DEFAULT_SCENE_TRANSITION_TIMEOUT_TICKS,
} from '@chimera-engine/simulation/scene/SceneRegistry.js';
import {
    CommitmentVerificationError,
    DefaultCommitmentScheme,
    RevealStaging,
    toCommitmentId,
    type CommitmentEnvelope,
    type CommitmentId,
    type CommitmentReveal,
    type CommitmentScheme,
    type RevealStagingPort,
    type StagedReveals,
} from '@chimera-engine/simulation/projection/index.js';
import type { SaveRequest } from '../../preload/api-types.js';

/**
 * Function that applies a single `ActionEnvelope` to a snapshot and returns
 * the next snapshot.  Production wires this to
 * `HostSessionPipelineResult.processAction`; tests inject a stub.
 */
export type ApplyActionFn = (
    snapshot: Readonly<BaseGameSnapshot>,
    action: ActionEnvelope,
) => BaseGameSnapshot;

/**
 * Engine version stamped on every {@link SaveFile} written by this host.
 * Stamped here rather than imported from `package.json` so the runtime
 * remains free of build-tool-specific imports.  Bump in lock-step with
 * the engine version when the on-disk schema changes.
 */
export const HOST_ENGINE_VERSION = '0.1.0';

export type PendingCommitments = Readonly<Record<CommitmentId, CommitmentEnvelope>>;

export class SessionCommitmentRuntime {
    private readonly commitmentScheme: CommitmentScheme;
    private pendingCommitments: Record<CommitmentId, CommitmentEnvelope> = {};

    constructor(commitmentScheme: CommitmentScheme = new DefaultCommitmentScheme()) {
        this.commitmentScheme = commitmentScheme;
    }

    /**
     * Generate a new commitment for `value`, store the envelope in
     * pendingCommitments, and return the envelope for broadcast.
     *
     * Phase 1 of the commit/reveal protocol (§4.6 / §8).
     */
    commit(value: unknown): CommitmentEnvelope {
        const envelope = this.commitmentScheme.commit(value);
        this.pendingCommitments[envelope.id] = envelope;
        return envelope;
    }

    /**
     * Like {@link commit}, but also returns the matching {@link CommitmentReveal}
     * (carrying the nonce) so the caller can build a valid reveal later — used by
     * the tactics commitment turn mode, where the host commits a player's bundle
     * and must reveal it after every seat has committed. Stores the envelope in
     * `pendingCommitments` identically to {@link commit}, so the existing
     * `getPendingCommitments` → `PlayerSnapshot.commitments` egress is unchanged.
     */
    commitRevealable(value: unknown): { envelope: CommitmentEnvelope; reveal: CommitmentReveal } {
        const { envelope, reveal } = this.commitmentScheme.commitRevealable(value);
        this.pendingCommitments[envelope.id] = envelope;
        return { envelope, reveal };
    }

    restorePendingCommitments(pendingCommitments: PendingCommitments): void {
        this.pendingCommitments = copyPendingCommitments(pendingCommitments);
    }

    capturePendingCommitments(): Record<CommitmentId, CommitmentEnvelope> {
        return copyPendingCommitments(this.pendingCommitments);
    }

    verifyReveal(reveal: CommitmentReveal): unknown {
        const envelope = this.pendingCommitments[reveal.id];
        if (envelope === undefined) {
            throw new CommitmentVerificationError('No pending commitment found for reveal');
        }

        const verified = this.commitmentScheme.verify(reveal, envelope);
        if (!verified) {
            throw new CommitmentVerificationError();
        }

        delete this.pendingCommitments[reveal.id];
        return reveal.value;
    }
}

function copyPendingCommitments(
    pendingCommitments: PendingCommitments,
): Record<CommitmentId, CommitmentEnvelope> {
    // Object.create(null) prevents __proto__ key injection from network data
    // from polluting Object.prototype via the [[Set]] accessor (§11.2).
    const copy = Object.create(null) as Record<CommitmentId, CommitmentEnvelope>;
    for (const [id, envelope] of Object.entries(pendingCommitments)) {
        copy[toCommitmentId(id)] = envelope;
    }
    return copy;
}

/**
 * Narrow structural interface for the commitment runtime slot in
 * {@link SessionRuntimeOptions}.  Typed as an interface (not the concrete
 * class) so test doubles and future alternative implementations can be
 * injected without an `as any` cast (DIP — §coding-standards SOLID §3.5).
 */
export interface CommitmentRuntimePort {
    commit(value: unknown): CommitmentEnvelope;
    commitRevealable(value: unknown): { envelope: CommitmentEnvelope; reveal: CommitmentReveal };
    restorePendingCommitments(pendingCommitments: PendingCommitments): void;
    capturePendingCommitments(): Record<CommitmentId, CommitmentEnvelope>;
    verifyReveal(reveal: CommitmentReveal): unknown;
}

/**
 * Narrow interface that exposes {@link SessionRuntime.dispatchTick} to the
 * CHIMERA_E2E wiring site in `electron/main/index.ts`.
 *
 * `dispatchTick` is `private` on the concrete class so production code holding
 * a `SessionRuntime` reference cannot call it accidentally and inject a bare
 * `engine:tick` outside the real-time scheduler.  The E2E gate must cast
 * explicitly:
 *
 * ```ts
 * const e2e = sessionRuntime as unknown as E2eSessionRuntime;
 * hooks.dispatchTick = () => e2e.dispatchTick(metadata.hostId);
 * ```
 *
 * `as unknown as E2eSessionRuntime` is intentional (SOLID §ISP); the cast is
 * safe because the concrete class implements the method — it is only hidden
 * from the public type surface.
 *
 * Architecture: §13.9 — E2E hooks contract.
 * @chimera-review: only `electron/main/index.ts` may hold a value of this type;
 *   do not pass it to any other production module.
 */
export interface E2eSessionRuntime {
    dispatchTick(playerId: PlayerId): void;
}

export interface SessionRuntimeOptions {
    /**
     * Game identifier for the active session, e.g. `'tactics'`.  Stamped on
     * every captured {@link SaveFile.header} and used as the qualified slot
     * prefix.
     */
    readonly gameId: string;
    /** Game content semver stamped on every captured `SaveFile.header`. */
    readonly gameVersion: string;
    /**
     * Initial authoritative snapshot for the session.  Owned by this
     * runtime from construction onward; callers must not retain a
     * reference to mutate it externally.
     */
    readonly initialSnapshot: BaseGameSnapshot;
    /**
     * Pipeline-driven `processAction` callback.  See
     * `HostSessionPipelineResult.processAction` for the production wiring.
     */
    readonly applyAction: ApplyActionFn;
    /**
     * Wall-clock provider injected for testability.  Defaults to
     * `Date.now`.  Used solely for `SaveFileHeader.savedAt` — never
     * read inside the pipeline (Invariant #43 forbids `Date.now()` from
     * `reduce`).
     */
    readonly now?: () => number;
    /**
     * Commitment runtime injected for testability.  Defaults to
     * `new SessionCommitmentRuntime()` if not provided.  Allows tests to
     * verify commitment capture/restore without using real SHA-256 hashing.
     */
    readonly commitmentRuntime?: CommitmentRuntimePort;
    /**
     * Host-side reveal-staging store for the commitment turn mode.  Defaults
     * to `new RevealStaging()`.  Retains each committed player-turn's
     * `{ value, nonce }` between Commit and Reveal and persists alongside
     * `pendingCommitments` (Invariant #26).  Injectable for tests.
     */
    readonly revealStaging?: RevealStagingPort;
    /**
     * Live session-composition provider for `SaveFile.session`.
     * Wired in `index.ts` from the lobby roster + agent slots so captured
     * saves record who controlled each seat.  May return `null` (and defaults
     * to absent) when no live composition exists — `captureSaveFile` then
     * falls back to a checkpoint-derived manifest via
     * `deriveSessionManifest`, the same heuristic the v5→v6 migration uses.
     */
    readonly getSessionManifest?: () => SaveSessionManifest | null;
}

/**
 * In-memory holder for the live snapshot of a single hosted session.
 * Created once per session in `electron/main/index.ts`'s onSessionHosted
 * callback and discarded on session close.
 */
export class SessionRuntime {
    private snapshot: BaseGameSnapshot;
    private readonly _gameId: string;
    private readonly gameVersion: string;
    private readonly applyActionFn: ApplyActionFn;
    private readonly now: () => number;
    private readonly commitments: CommitmentRuntimePort;
    private readonly staging: RevealStagingPort;
    private readonly getSessionManifest: () => SaveSessionManifest | null;

    constructor(options: SessionRuntimeOptions) {
        this.snapshot = options.initialSnapshot;
        this._gameId = options.gameId;
        this.gameVersion = options.gameVersion;
        this.applyActionFn = options.applyAction;
        this.now = options.now ?? Date.now;
        this.commitments = options.commitmentRuntime ?? new SessionCommitmentRuntime();
        this.staging = options.revealStaging ?? new RevealStaging();
        this.getSessionManifest = options.getSessionManifest ?? ((): null => null);
    }

    /** The game identifier for this session (e.g. `'tactics'`). */
    get gameId(): string {
        return this._gameId;
    }

    /**
     * Read-only access to the current authoritative snapshot.  The
     * returned reference must not be mutated; the runtime treats it as
     * immutable and replaces it wholesale on every `applyAction`.
     */
    getSnapshot(): Readonly<BaseGameSnapshot> {
        return this.snapshot;
    }

    /**
     * Drive the pipeline with `action` and store the resulting next
     * snapshot.  Does NOT broadcast — broadcast happens inside the
     * pipeline's Stage 7 callback wired in `index.ts`.
     */
    applyAction(action: ActionEnvelope): void {
        this.snapshot = this.applyActionFn(this.snapshot, action);
        this.resolveTimedOutOrReadySceneTransition();
    }

    /**
     * Advance the simulation clock by one tick.
     *
     * Intentionally `private` — production callers must never reach this
     * directly.  The only permitted access path is via {@link E2eSessionRuntime}
     * cast at the CHIMERA_E2E wiring site in `electron/main/index.ts`.
     *
     * All tick dispatches still traverse the full `ActionPipeline`
     * (Invariant #6); no state is injected.
     *
     * @see E2eSessionRuntime
     */
    private dispatchTick(playerId: PlayerId): void {
        this.applyAction({
            type: 'engine:tick',
            playerId,
            tick: this.snapshot.tick,
            payload: { seed: this.snapshot.seed },
        });
    }

    private resolveTimedOutOrReadySceneTransition(): void {
        const transition = this.snapshot.sceneTransition;
        const hostPlayerId = this.snapshot.hostPlayerId;
        if (transition === undefined || transition === null || transition.phase === 'committing') {
            return;
        }
        if (hostPlayerId === undefined) {
            return;
        }

        if (transition.phase === 'ready') {
            this.dispatchHostSceneAction('engine:scene_commit', hostPlayerId);
            return;
        }

        const timeoutTicks = Math.max(
            0,
            transition.timeoutTicks ?? DEFAULT_SCENE_TRANSITION_TIMEOUT_TICKS,
        );
        const timedOut = this.snapshot.tick - transition.startedAtTick >= timeoutTicks;
        if (!timedOut) {
            return;
        }

        const timeoutPolicy = transition.onClientTimeout ?? DEFAULT_SCENE_CLIENT_TIMEOUT_POLICY;
        if (timeoutPolicy === 'drop') {
            this.dispatchHostSceneAction('engine:scene_drop', hostPlayerId);
            return;
        }

        this.dispatchHostSceneAction('engine:scene_commit', hostPlayerId);
    }

    private dispatchHostSceneAction(
        type: 'engine:scene_commit' | 'engine:scene_drop',
        hostPlayerId: PlayerId,
    ): void {
        this.snapshot = this.applyActionFn(this.snapshot, {
            type,
            playerId: hostPlayerId,
            tick: this.snapshot.tick,
            payload: {},
        });
    }

    /**
     * Replace the live snapshot from a previously persisted save.
     * Called by `SaveManager.restoreFromSave(...)` consumers (the load flow)
     * so the running session reflects the loaded state without going through
     * the pipeline (Invariant #24).
     */
    applyRestoredFile(file: SaveFile): void {
        this.snapshot = file.checkpoint;
        this.commitments.restorePendingCommitments(file.pendingCommitments);
        // Restore reveal staging together with the envelopes (Invariant #26): a
        // mid-commit save reveals after load only because both move as a unit.
        // `?? {}` guards an in-memory file that predates the field; the migrator
        // guarantees on-disk presence.
        this.staging.restore(file.stagedReveals ?? {});
    }

    verifyReveal(reveal: CommitmentReveal): unknown {
        return this.commitments.verifyReveal(reveal);
    }

    /**
     * Generate a commitment for `value`, store the envelope in the host's
     * pending-commitments map, and return the envelope.
     *
     * The envelope will be included in the next `PlayerSnapshot.commitments`
     * broadcast once `StateProjector.project()` is configured with
     * `getPendingCommitments: () => sessionRuntime.capturePendingCommitments()`
     * (§4.6 / §8).
     *
     * Phase 1 of the commit/reveal protocol.
     */
    commit(value: unknown): CommitmentEnvelope {
        return this.commitments.commit(value);
    }

    /**
     * Commit a player's buffered turn in commit-then-sync turn mode:
     * produce + broadcast the commitment envelope and stage the matching
     * `{ value, nonce }` so the host can reveal it after every seat has
     * committed.  The same nonce flows into the envelope (via
     * `pendingCommitments`) and the staged reveal because both come from one
     * `commitRevealable` call.  `value` is opaque here — the host stays
     * game-agnostic (Invariant #2); the committing game owns its shape and
     * re-narrows it on reveal.  Returns the envelope for broadcast.
     */
    commitTurn(playerId: PlayerId, value: unknown): CommitmentEnvelope {
        const { envelope, reveal } = this.commitments.commitRevealable(value);
        this.staging.stage({
            envelopeId: envelope.id,
            playerId,
            nonce: reveal.nonce,
            value,
        });
        return envelope;
    }

    /** Whether `playerId` has a staged commitment for the current turn. */
    hasCommitted(playerId: PlayerId): boolean {
        return this.staging.hasCommitted(playerId);
    }

    /**
     * The players staged so far, for the End-Turn gate and the deterministic
     * reveal order. Game-specific grouping (e.g. tactics' attack-first
     * ordering) is derived by the game from `staging.capture()`.
     */
    committedPlayerIds(): readonly PlayerId[] {
        return this.staging.committedPlayerIds();
    }

    /**
     * Snapshot of every staged reveal, keyed by envelope id. The host's
     * `RevealOrchestrator` reads this to derive the deterministic reveal order
     * from the (game-opaque) staged values without touching their shape.
     */
    captureStagedReveals(): StagedReveals {
        return this.staging.capture();
    }

    /**
     * Build the reveal payload for a staged player so the host can broadcast it
     * via `HostTransport.sendReveal`. The matching envelope in
     * `pendingCommitments` verifies it (Invariant #9). Throws
     * `RevealStagingError` if `playerId` has no staged commitment.
     */
    buildReveal(playerId: PlayerId): CommitmentReveal {
        return this.staging.buildReveal(playerId);
    }

    /**
     * Discard the turn's staged reveals once every one has been revealed and
     * applied, so the next commitment turn starts clean.
     */
    clearStagedReveals(): void {
        this.staging.clearTurn();
    }

    /**
     * Return a null-prototype copy of the current pending commitments.
     * Used by `DefaultStateProjector` via the `getPendingCommitments` option
     * to populate `PlayerSnapshot.commitments` on every broadcast.
     */
    capturePendingCommitments(): Readonly<Record<CommitmentId, CommitmentEnvelope>> {
        return this.commitments.capturePendingCommitments();
    }

    /**
     * Produce a {@link SaveFile} from the current snapshot suitable for
     * persistence by `SaveManager.save()` / `SaveManager.autoSave()`.
     *
     * The header's `slotId` honours `request.slotId` (defaulting to
     * `'autosave'` when absent so autosave round-trips through this
     * function before reaching `SaveManager.autoSave`).  `playerNames`
     * is derived from `snapshot.players` keys; once a real
     * `PlayerDirectory` is wired into the session the host can swap in
     * actual display names.
     */
    captureSaveFile(request: SaveRequest, snapshotOverride?: BaseGameSnapshot): SaveFile {
        const snapshot = snapshotOverride ?? this.snapshot;
        const slotId = request.slotId ?? 'autosave';
        const playerNames = Object.keys(snapshot.players);
        return {
            header: {
                schemaVersion: CURRENT_SCHEMA_VERSION,
                engineVersion: HOST_ENGINE_VERSION,
                gameId: this._gameId,
                gameVersion: this.gameVersion,
                slotId,
                savedAt: this.now(),
                turnNumber: snapshot.turnNumber,
                playerNames,
            },
            checkpoint: snapshot,
            deltaActions: [],
            pendingCommitments: this.commitments.capturePendingCommitments(),
            stagedReveals: this.staging.capture(),
            // Live composition when the host wired a provider; otherwise a
            // best-effort checkpoint-derived manifest (same heuristic as the
            // v5→v6 migration) so every captured file carries `session`.
            session: this.getSessionManifest() ?? deriveSessionManifest(snapshot),
        };
    }
}
