/**
 * electron/main/runtime/RevealOrchestrator.ts
 *
 * Host-side driver for the commit-then-sync reveal sequence (T9 / #729). When
 * every seat has committed and the commitment-mode End Turn lands,
 * `runRevealSync` reveals each player's staged bundle over the existing reveal
 * channel and re-applies it so every client converges.
 *
 * Game-agnostic (Invariant #2/#94): all game-specific decisions — the
 * deterministic order and how a revealed value expands into engine actions —
 * come from the registered {@link CommitmentTurnOrchestration}; this module
 * names no game. It talks to the live session through the narrow
 * {@link RevealSyncSession} seam (satisfied by `SessionRuntime`), which keeps it
 * unit-testable without Electron.
 *
 * Per player, in order:
 *   1. build the reveal from staging (skip if the player never staged);
 *   2. verify it (Invariant #9) — a failure DROPS the bundle, it is not applied;
 *   3. broadcast it so every client runs the same verify gate and converges;
 *   4. re-dispatch the revealed actions through the pipeline in buffered order
 *      (`resolveGameResult` runs per action — game-end resolves exactly as in
 *      sequential mode, and attack-committers reveal first so a match-ending
 *      attack lands before any non-attack reveal).
 * Then clear the turn's staging.
 *
 * Design note: docs/security-trust/tactics-commitment-battle-mode.md §5
 */

import type { WireCommitmentReveal } from '@chimera/simulation/foundation/messages.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import {
    CommitmentVerificationError,
    RevealStagingError,
    type CommitmentReveal,
    type CommitmentTurnOrchestration,
    type StagedReveals,
} from '@chimera/simulation/projection/index.js';

/**
 * The minimal slice of `SessionRuntime` the reveal driver needs. Declared as an
 * interface (not the concrete class) so it composes with a test double and never
 * pulls Electron into the unit under test (SOLID DIP).
 */
export interface RevealSyncSession {
    getSnapshot(): Readonly<BaseGameSnapshot>;
    captureStagedReveals(): StagedReveals;
    buildReveal(playerId: PlayerId): CommitmentReveal;
    verifyReveal(reveal: CommitmentReveal): unknown;
    applyAction(action: ActionEnvelope): void;
    clearStagedReveals(): void;
}

export interface RunRevealSyncOptions {
    readonly orchestration: CommitmentTurnOrchestration;
    readonly session: RevealSyncSession;
    /** `HostTransport.sendReveal` — broadcasts the reveal to all connected clients. */
    readonly sendReveal: (target: PlayerId | 'broadcast', reveal: WireCommitmentReveal) => void;
}

/**
 * Reveal and apply every staged player-turn in the deterministic order the game
 * defines. Safe to call only after `orchestration.shouldReveal(...)` is true.
 */
export function runRevealSync({ orchestration, session, sendReveal }: RunRevealSyncOptions): void {
    const snapshot = session.getSnapshot();
    // Order is computed once, from the (seed, tick) every client + replay agrees
    // on — never host discretion (Invariant #71).
    const order = orchestration.resolveRevealOrder(
        session.captureStagedReveals(),
        snapshot.seed,
        snapshot.tick,
    );

    for (const playerId of order) {
        // The match may end mid-reveal: a revealed attack resolves game-end exactly
        // as in sequential mode, and attack-committers reveal first, so once the
        // result is set the remaining (non-attack) reveals are moot and the pipeline
        // would reject them (design §5). Stop here.
        if (session.getSnapshot().gameResult !== null) {
            break;
        }

        let reveal: CommitmentReveal;
        try {
            reveal = session.buildReveal(playerId);
        } catch (error) {
            if (error instanceof RevealStagingError) {
                continue; // No staged reveal for this player — skip, don't abort.
            }
            throw error;
        }

        // Invariant #9: trust the bundle only after verify() succeeds. A mismatch
        // (e.g. a tampered restore) drops it — the actions are never applied.
        let value: unknown;
        try {
            value = session.verifyReveal(reveal);
        } catch (error) {
            if (error instanceof CommitmentVerificationError) {
                continue;
            }
            throw error;
        }

        // Broadcast so every client runs the same verify gate and converges on the
        // host's order. Branded `CommitmentId` widens to the wire `string`.
        sendReveal('broadcast', { id: reveal.id, value: reveal.value, nonce: reveal.nonce });

        // Re-dispatch in buffered order; the pipeline re-validates each action and
        // resolves game-end exactly as in sequential mode. Each action is stamped
        // with the LIVE tick at dispatch — a player's buffer holds several actions
        // and every apply advances the tick, so a single shared tick would trip the
        // pipeline's StaleActionError on the 2nd action.
        const actions = orchestration.revealedActionsFor(
            value,
            playerId,
            session.getSnapshot().tick,
        );
        for (const action of actions) {
            // A revealed attack can end the match part-way through a bundle; the rest
            // is then moot. Stop applying this player's remaining actions.
            if (session.getSnapshot().gameResult !== null) {
                break;
            }
            try {
                session.applyAction({ ...action, tick: session.getSnapshot().tick });
            } catch {
                // The pipeline rejected this revealed action (e.g. a cross-player
                // conflict resolved by an earlier reveal). Drop the rest of this
                // player's bundle and move on — one bad reveal never aborts the turn.
                break;
            }
        }
    }

    session.clearStagedReveals();
}
