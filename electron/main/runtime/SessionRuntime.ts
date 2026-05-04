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
 *                                    current snapshot (BLOCK-3 fix);
 *   - `applyRestoredFile(file)`    — replace the live snapshot from a
 *                                    loaded save (WARN-2 fix).
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

import type { ActionEnvelope, BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import { CURRENT_SCHEMA_VERSION, type SaveFile } from '@chimera/simulation/persistence/index.js';
import {
    CommitmentVerificationError,
    DefaultCommitmentScheme,
    toCommitmentId,
    type CommitmentEnvelope,
    type CommitmentId,
    type CommitmentReveal,
    type CommitmentScheme,
} from '@chimera/simulation/projection/index.js';
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
    restorePendingCommitments(pendingCommitments: PendingCommitments): void;
    capturePendingCommitments(): Record<CommitmentId, CommitmentEnvelope>;
    verifyReveal(reveal: CommitmentReveal): unknown;
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

    constructor(options: SessionRuntimeOptions) {
        this.snapshot = options.initialSnapshot;
        this._gameId = options.gameId;
        this.gameVersion = options.gameVersion;
        this.applyActionFn = options.applyAction;
        this.now = options.now ?? Date.now;
        this.commitments = options.commitmentRuntime ?? new SessionCommitmentRuntime();
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
    }

    /**
     * Replace the live snapshot from a previously persisted save.
     * Called by `SaveManager.restoreFromSave(...)` consumers (load and
     * "Resume last session") so the running session reflects the loaded
     * state without going through the pipeline (Invariant #24).
     */
    applyRestoredFile(file: SaveFile): void {
        this.snapshot = file.checkpoint;
        this.commitments.restorePendingCommitments(file.pendingCommitments);
    }

    verifyReveal(reveal: CommitmentReveal): unknown {
        return this.commitments.verifyReveal(reveal);
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
    captureSaveFile(request: SaveRequest): SaveFile {
        const slotId = request.slotId ?? 'autosave';
        const playerNames = Object.keys(this.snapshot.players);
        return {
            header: {
                schemaVersion: CURRENT_SCHEMA_VERSION,
                engineVersion: HOST_ENGINE_VERSION,
                gameId: this._gameId,
                gameVersion: this.gameVersion,
                slotId,
                savedAt: this.now(),
                turnNumber: this.snapshot.turnNumber,
                playerNames,
            },
            checkpoint: this.snapshot,
            deltaActions: [],
            pendingCommitments: this.commitments.capturePendingCommitments(),
        };
    }
}
