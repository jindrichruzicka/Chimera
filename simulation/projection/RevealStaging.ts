/**
 * simulation/projection/RevealStaging.ts
 *
 * Host-side reveal-staging store — the companion to {@link CommitmentScheme} for
 * commit-then-reveal turn modes (§4.6/§8). Retains each committed
 * player-turn's `{ value, nonce }` between Commit and Reveal so the host can
 * build a valid {@link CommitmentReveal} after every seat has committed —
 * necessary because `DefaultCommitmentScheme.commit()` discards the nonce.
 *
 * Game-agnostic: the staged `value` is opaque (`unknown`); the store never
 * inspects it. Game-specific reveal ordering (e.g. tactics' attack-first
 * grouping) is layered on top by the game by reading `capture()` and narrowing
 * the value. This keeps the host (main process) ignorant of which games exist
 * (Invariant #2).
 *
 * `capture`/`restore` mirror `SessionCommitmentRuntime`'s
 * `capturePendingCommitments`/`restorePendingCommitments` so staging rides the
 * existing SaveFile save/load path (Invariant #26): a save taken mid-commit can
 * still reveal after load, and envelopes + staging move as a unit.
 *
 * Invariants upheld:
 *   #1 — simulation/ has zero runtime dependencies on React, DOM, or networking.
 *   #2 — pure store; the host stays game-agnostic (no games/* dependency).
 */

import type { PlayerId } from '../engine/types.js';
import type { CommitmentId, CommitmentReveal } from './CommitmentScheme.js';
import { toCommitmentId } from './CommitmentScheme.js';

/**
 * A single host-retained staged reveal. `value` is opaque at this layer — the
 * game owns its shape and re-narrows it when revealing.
 */
export interface StagedReveal {
    readonly envelopeId: CommitmentId;
    readonly playerId: PlayerId;
    readonly nonce: string;
    readonly value: unknown;
}

/** Read-only staged-reveal map, keyed by envelope id (save/restore + capture). */
export type StagedReveals = Readonly<Record<CommitmentId, StagedReveal>>;

/** Thrown when a reveal is requested for a player that has no staged commitment. */
export class RevealStagingError extends Error {
    constructor(message = 'No staged reveal for player') {
        super(message);
        this.name = 'RevealStagingError';
    }
}

/**
 * Host-side store retaining staged reveals for the current commit-then-sync turn.
 * Game-agnostic; lives next to {@link CommitmentScheme}.
 */
export interface RevealStagingPort {
    /** Record a freshly committed player-turn so it can be revealed later. */
    stage(entry: StagedReveal): void;
    /** Whether the given player has a staged commitment for the current turn. */
    hasCommitted(playerId: PlayerId): boolean;
    /** The players staged so far (order is the End-Turn-gate / game ordering input). */
    committedPlayerIds(): readonly PlayerId[];
    /** Build the reveal payload for a staged player (id + value + retained nonce). */
    buildReveal(playerId: PlayerId): CommitmentReveal;
    /** Discard all staged reveals once the turn has fully revealed/applied. */
    clearTurn(): void;
    /** Null-prototype copy for `SaveFile` capture (mirrors `capturePendingCommitments`). */
    capture(): StagedReveals;
    /** Restore staged reveals from a loaded `SaveFile` (mirrors `restorePendingCommitments`). */
    restore(staged: StagedReveals): void;
}

export class RevealStaging implements RevealStagingPort {
    /** Source of truth, keyed by envelope id — matches {@link StagedReveals}/{@link capture}. */
    private entries: Record<CommitmentId, StagedReveal> = Object.create(null) as Record<
        CommitmentId,
        StagedReveal
    >;
    /** playerId → envelopeId index for O(1) per-player lookup; never crosses the save boundary. */
    private readonly byPlayer = new Map<PlayerId, CommitmentId>();

    stage(entry: StagedReveal): void {
        // One envelope per player-turn: a re-commit supersedes the previous one.
        const previous = this.byPlayer.get(entry.playerId);
        if (previous !== undefined) {
            delete this.entries[previous];
        }
        this.entries[entry.envelopeId] = entry;
        this.byPlayer.set(entry.playerId, entry.envelopeId);
    }

    hasCommitted(playerId: PlayerId): boolean {
        return this.byPlayer.has(playerId);
    }

    committedPlayerIds(): readonly PlayerId[] {
        return [...this.byPlayer.keys()];
    }

    buildReveal(playerId: PlayerId): CommitmentReveal {
        const envelopeId = this.byPlayer.get(playerId);
        const entry = envelopeId === undefined ? undefined : this.entries[envelopeId];
        if (entry === undefined) {
            throw new RevealStagingError();
        }
        return { id: entry.envelopeId, value: entry.value, nonce: entry.nonce };
    }

    clearTurn(): void {
        this.entries = Object.create(null) as Record<CommitmentId, StagedReveal>;
        this.byPlayer.clear();
    }

    capture(): StagedReveals {
        return copyStagedReveals(this.entries);
    }

    restore(staged: StagedReveals): void {
        this.entries = copyStagedReveals(staged);
        this.byPlayer.clear();
        for (const entry of Object.values(this.entries)) {
            this.byPlayer.set(entry.playerId, entry.envelopeId);
        }
    }
}

function copyStagedReveals(staged: StagedReveals): Record<CommitmentId, StagedReveal> {
    // Object.create(null) prevents a __proto__ own-key from network/disk data
    // polluting Object.prototype via the [[Set]] accessor (§11.2), mirroring
    // copyPendingCommitments in SessionRuntime.
    const copy = Object.create(null) as Record<CommitmentId, StagedReveal>;
    for (const [id, entry] of Object.entries(staged)) {
        copy[toCommitmentId(id)] = entry;
    }
    return copy;
}
