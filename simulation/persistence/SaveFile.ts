/**
 * simulation/persistence/SaveFile.ts
 *
 * Save file schema: versioned envelope wrapping a GameSnapshot checkpoint,
 * a delta action log, and pending commitment state (§4.11).
 *
 * All types are pure TypeScript — zero runtime code in this file.
 *
 * Architecture reference: §4.11
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no Node.js FS or Electron imports.
 *   #44 — No float fields participate in equality or arithmetic; all arithmetic
 *          fields in BaseGameSnapshot are integers (upheld by the engine types).
 */

import type { BaseGameSnapshot, EngineAction, PlayerId } from '../engine/types.js';
import type { CommitmentEnvelope, CommitmentId } from '../projection/CommitmentScheme.js';
import type { StagedReveals } from '../projection/RevealStaging.js';

// ─── Session manifest ─────────────────────────────────────────────────────────

/**
 * One seat in the saved session composition.
 *
 * Carries the raw player id and how that seat was controlled at save time —
 * never profile data (avatar, display name, locale; Invariant #59). A later
 * restore uses `control` to decide which seats the host re-seats locally, which
 * are AI-driven, and which wait for a remote reclaim.
 */
export interface SaveSeat {
    /** Raw player id exactly as it appears in `checkpoint.players`. */
    readonly playerId: PlayerId;
    /** How the seat was controlled at save time. */
    readonly control: 'host' | 'local' | 'remote' | 'ai';
    /** Lobby slot index the seat occupied. */
    readonly slotIndex: number;
    /** AI-only: whether the agent saw the full unprojected snapshot. */
    readonly omniscient?: boolean;
}

/**
 * Host-local session composition captured alongside the checkpoint.
 *
 * Orchestration metadata, not gameplay state: it is neither header (not needed
 * to pick a migration) nor checkpoint (the simulation never reads it). It stays
 * main-side with the rest of the `SaveFile` (Invariant #1 — a save never
 * crosses IPC); clients learn the `matchId` only via their projected snapshots.
 */
export interface SaveSessionManifest {
    /** Stable match identity, mirroring `checkpoint.matchId`. */
    readonly matchId: string;
    /**
     * Lobby capacity at save time. Live manifests record the real capacity;
     * checkpoint-derived backfills (`deriveSessionManifest`) can only record a
     * floor — `max(seat count, highest slotIndex + 1)` — so restore consumers
     * must treat a migrated value as a lower bound, not exact capacity.
     */
    readonly maxPlayers: number;
    /** Session composition, one entry per seated player. */
    readonly seats: readonly SaveSeat[];
}

// ─── SaveFileHeader ───────────────────────────────────────────────────────────

/**
 * Fixed-size header read before deserialising the rest of the save file.
 * All fields are `readonly`; mutation is not permitted on save data.
 *
 * `schemaVersion` is incremented on every breaking change to `SaveFile`
 * shape. `SaveMigrator` uses this to apply upgrade migrations.
 */
export interface SaveFileHeader {
    /** Incremented on every breaking change to SaveFile shape. */
    readonly schemaVersion: number;
    /** Semver of the Chimera engine that wrote the file. */
    readonly engineVersion: string;
    /** Game identifier, e.g. `'tactics'`. */
    readonly gameId: string;
    /** Semver of the game content that wrote the file. */
    readonly gameVersion: string;
    /** Save slot name, e.g. `'autosave'`, `'quicksave'`, `'slot-2'`. */
    readonly slotId: string;
    /** Unix timestamp in milliseconds when the file was written. */
    readonly savedAt: number;
    /** Human-readable turn position displayed in the save slot UI. */
    readonly turnNumber: number;
    /** Player display names for the save slot UI. */
    readonly playerNames: readonly string[];
    /** Base64 PNG captured by the renderer at save time (optional). */
    readonly thumbnailDataUrl?: string;
    /**
     * SHA-256 hex checksum of the canonical save body
     * (`{ checkpoint, deltaActions, pendingCommitments }`).
     *
     * Optional so that saves written before this field was introduced load
     * without error (backwards-compatible). When present, the repository
     * verifies it on load and throws `SaveIntegrityError` on mismatch.
     */
    readonly checksum?: string;
}

// ─── SaveFile ─────────────────────────────────────────────────────────────────

/**
 * Full save file envelope.
 *
 * A save file is a durable Memento (§4.11): a named, versioned snapshot of
 * the authoritative `GameSnapshot` at a particular point in time, together
 * with the action log since that checkpoint and any pending commitments
 * required for anti-cheat continuity after a reload.
 *
 * All fields are `readonly`. The file is written atomically and must never
 * be mutated after creation (invariant #23 / SaveRepository.save contract).
 */
export interface SaveFile {
    /** Fixed-size header — read first, used to decide whether to migrate. */
    readonly header: SaveFileHeader;

    /**
     * Full authoritative game state at the moment of save.
     * Restoring from this checkpoint directly gives O(1) load time
     * regardless of match length.
     */
    readonly checkpoint: BaseGameSnapshot;

    /**
     * Actions recorded after the checkpoint snapshot.
     * Empty at a normal save point (save happens at END_TURN, after commit).
     * Retained for forensic replay and integrity verification.
     */
    readonly deltaActions: readonly EngineAction[];

    /**
     * All pending commitment envelopes at save time (§8).
     * Required for anti-cheat continuity: without these, the client
     * cannot verify REVEAL messages for values committed before the save.
     */
    // KNOWN-LIMITATION: Record<CommitmentId, ...> does not enforce the CommitmentId brand at
    // the type level — TypeScript allows plain string keys in computed positions. Authoritative
    // validation of all CommitmentId keys is deferred to the commitment scheme implementation,
    // which will own a dedicated validator at the deserialization boundary.
    readonly pendingCommitments: Record<CommitmentId, CommitmentEnvelope>;

    /**
     * Host-retained staged reveals for an in-progress commitment turn (§4.6/§8,
     * Invariant #26). Carries the `{ value, nonce }` matching each pending
     * commitment so a save taken mid-commit (some players committed, awaiting
     * others) can still reveal after load. Moves as a unit with
     * `pendingCommitments`: a load that restores envelopes but not staging must
     * not apply reveals. Empty `{}` outside commitment mode and for v4
     * saves (the v4→v5 migration backfills it).
     *
     * Typed non-optional because every writer (`captureSaveFile`) and the
     * migrator guarantee on-disk presence, so loaded files always carry it. The
     * one transient gap is an in-memory file between deserialize and migrate (the
     * serializer schema marks it `.optional()` so legacy v4 JSON still parses):
     * the `?? {}` guards in `SessionRuntime.applyRestoredFile` and
     * `SaveChecksum.computeBodyChecksum` cover that window before the migrator
     * backfills it.
     */
    readonly stagedReveals: StagedReveals;

    /**
     * Saved session composition: match identity, lobby capacity,
     * and per-seat control kinds so a restore can rebuild the session. Host-local
     * orchestration metadata — no profile data (Invariant #59), never projected
     * or sent over IPC (Invariant #1), and deliberately excluded from the body
     * checksum (like the header) so pre-v6 checksums still verify after the
     * v5→v6 migration backfills it.
     *
     * Typed non-optional following the `stagedReveals` precedent: every writer
     * (`captureSaveFile`) and the migrator guarantee presence; the serializer
     * schema marks it `.optional()` only so legacy v5 JSON still parses before
     * the migrator runs.
     */
    readonly session: SaveSessionManifest;
}
