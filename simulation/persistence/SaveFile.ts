/**
 * simulation/persistence/SaveFile.ts
 *
 * Save file schema: versioned envelope wrapping a GameSnapshot checkpoint,
 * a delta action log, and pending commitment state (§4.11).
 *
 * All types are pure TypeScript — zero runtime code in this file.
 *
 * Architecture reference: §4.11
 * Task: F06 / T1 (issue #120)
 *
 * Invariants upheld:
 *   #2 — simulation/ is side-effect-free; no Node.js FS or Electron imports.
 *   #44 — No float fields participate in equality or arithmetic; all arithmetic
 *          fields in BaseGameSnapshot are integers (upheld by the engine types).
 */

import type { BaseGameSnapshot, EngineAction } from '../engine/types.js';

// ─── F27 stubs (Cryptographic Commitment Scheme) ─────────────────────────────

/**
 * Opaque commitment identifier. Branded to prevent mix-up with other
 * string-shaped identifiers.
 *
 * Full definition arrives in F27 (§4.6 / §8). This is a stub so that
 * `SaveFile.pendingCommitments` can be correctly typed at M1.
 */
export type CommitmentId = string & { readonly __brand: 'CommitmentId' };

/**
 * Opaque commitment envelope stub. Holds the SHA-256 hash of a value
 * that will be revealed later (anti-cheat commitment scheme, §8).
 *
 * Full definition arrives in F27. For M1, only `commitmentId` and `hash`
 * are required so that pending commitments can be round-tripped through
 * a save file.
 */
export interface CommitmentEnvelope {
    readonly commitmentId: CommitmentId;
    readonly hash: string;
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
     * All pending commitment envelopes at save time (F27 / §8).
     * Required for anti-cheat continuity: without these, the client
     * cannot verify REVEAL messages for values committed before the save.
     *
     * Empty until F27 is implemented. Typed now so save files written
     * at M1 are forward-compatible with F27 persistence.
     */
    readonly pendingCommitments: Record<CommitmentId, CommitmentEnvelope>;
}
