/**
 * apps/tactics/commitment/orchestration.ts
 *
 * The tactics implementation of the host-neutral {@link CommitmentTurnOrchestration}
 * (T9 / #729). Registered through the main-side game registry so the host can
 * drive the commit-then-sync reveal sequence without naming tactics
 * (Invariant #2/#94). Every hook is pure; the host passes generic engine values
 * and these hooks narrow the opaque buffer/value to tactics' own shapes.
 *
 * Flow these hooks serve (host `RevealOrchestrator`):
 *   - `stageOnCommit` reads the buffer riding the `tactics:commit` envelope and
 *     returns the value to stage (the commit reducer keeps the buffer off the
 *     snapshot — Invariants #3/#8).
 *   - `shouldReveal` fires only on the commitment-mode End Turn.
 *   - `resolveRevealOrder` derives the deterministic attack-first order.
 *   - `revealedActionsFor` expands a revealed bundle into engine actions the host
 *     re-dispatches through the pipeline (so game-end resolves exactly as in
 *     sequential mode).
 *
 * Design note: docs/security-trust/tactics-commitment-battle-mode.md §3, §5
 *
 * Module boundary: imports only `shared/`, `simulation/`, and own files.
 */

import { TACTICS_COMMIT_ACTION, readTacticsTurnMode } from '@chimera/tactics/constants.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import type {
    CommitmentTurnOrchestration,
    StagedReveals,
} from '@chimera/simulation/projection/index.js';

import { TacticsCommitmentEnvelopeValueSchema, LocalActionBufferSchema } from './bufferSchema.js';
import {
    bufferHasAttack,
    type CommittedTurn,
    type TacticsCommitmentEnvelopeValue,
} from './contract.js';
import { resolveRevealOrder } from './revealOrder.js';
import { allSeatsCommitted, isTacticsCommitmentMode } from './turnGate.js';

/** The engine action type that advances a turn — the commitment-mode reveal trigger. */
const ENGINE_END_TURN = 'engine:end_turn';

/** Narrow an opaque staged value back to the tactics committed bundle, or null. */
function narrowEnvelopeValue(value: unknown): TacticsCommitmentEnvelopeValue | null {
    const parsed = TacticsCommitmentEnvelopeValueSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}

export const tacticsCommitmentOrchestration: CommitmentTurnOrchestration = {
    stageOnCommit(
        action: ActionEnvelope,
        snapshot: Readonly<BaseGameSnapshot>,
    ): { readonly playerId: PlayerId; readonly value: unknown } | null {
        if (action.type !== TACTICS_COMMIT_ACTION) {
            return null;
        }
        // Stage ONLY a commit the authority accepted. `snapshot` is the post-apply
        // snapshot, and the commit reducer writes `committedTurns[playerId] =
        // turnNumber` exactly when its `validate()` passed (commitment mode + seated
        // for the current turn). A rejected or out-of-mode commit leaves no marker,
        // so it never stages a reveal nor projects a phantom envelope (Invariants
        // #3/#8; the buffer never reaches the snapshot, and `pendingCommitments`
        // reflects only real commits).
        if (snapshot.committedTurns?.[action.playerId] !== snapshot.turnNumber) {
            return null;
        }
        const parsed = LocalActionBufferSchema.safeParse(action.payload['actions']);
        if (!parsed.success) {
            return null;
        }
        const value: TacticsCommitmentEnvelopeValue = {
            playerId: action.playerId,
            turnNumber: snapshot.turnNumber,
            actions: parsed.data,
        };
        return { playerId: action.playerId, value };
    },

    shouldReveal(action: ActionEnvelope, snapshot: Readonly<BaseGameSnapshot>): boolean {
        return (
            action.type === ENGINE_END_TURN &&
            readTacticsTurnMode(snapshot.setup?.matchSettings) === 'commitment'
        );
    },

    shouldAutoEndTurn(action: ActionEnvelope, snapshot: Readonly<BaseGameSnapshot>): boolean {
        // The `tactics:commit` that completes the set (every seat committed for the
        // current turn) makes the player's single "End Turn" = commit the only
        // confirmation a turn needs: the host then synthesises the `engine:end_turn`
        // automatically. Reads the authoritative `committedTurns` marker on the
        // post-apply snapshot, so a rejected/out-of-mode commit (no marker) returns
        // false and never auto-advances.
        return (
            action.type === TACTICS_COMMIT_ACTION &&
            isTacticsCommitmentMode(snapshot) &&
            allSeatsCommitted(snapshot)
        );
    },

    resolveRevealOrder(staged: StagedReveals, seed: number, tick: number): readonly PlayerId[] {
        const committed: CommittedTurn[] = [];
        for (const entry of Object.values(staged)) {
            const value = narrowEnvelopeValue(entry.value);
            if (value === null) {
                continue;
            }
            committed.push({ playerId: value.playerId, hasAttack: bufferHasAttack(value.actions) });
        }
        return resolveRevealOrder(committed, seed, tick);
    },

    revealedActionsFor(
        value: unknown,
        playerId: PlayerId,
        tick: number,
    ): readonly ActionEnvelope[] {
        const narrowed = narrowEnvelopeValue(value);
        if (narrowed === null) {
            return [];
        }
        return narrowed.actions.map((action) => ({
            type: action.type,
            playerId,
            tick,
            // The buffered payload is structurally a plain object; the brand types
            // just lack an index signature. The host treats it opaquely and the
            // pipeline re-parses + re-validates it on apply (defence in depth).
            payload: action.payload as unknown as Record<string, unknown>,
        }));
    },
};
