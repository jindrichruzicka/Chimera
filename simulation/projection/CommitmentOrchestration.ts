/**
 * simulation/projection/CommitmentOrchestration.ts
 *
 * Game-neutral contract for the host-side commit-then-sync reveal orchestration.
 * The host (`electron/main`) drives the reveal sequence
 * without naming any game (Invariant #2/#94): a game registers a
 * {@link CommitmentTurnOrchestration} via its main-side contribution, and the
 * host's `RevealOrchestrator` calls these pure hooks to decide when to stage a
 * commit, when to reveal, in what order, and which engine actions a revealed
 * bundle expands to.
 *
 * All hooks are pure and game-owned: the host passes them generic engine values
 * (`ActionEnvelope`, `BaseGameSnapshot`, `StagedReveals`) and the game narrows
 * the opaque `value` to its own shape. Keeping this interface in `simulation/`
 * (importable by both `games/*` and `electron/main`) avoids a `games → electron`
 * import while letting the host stay game-agnostic.
 *
 * Architecture: §4.6/§8 — State Projection · docs/security-trust/tactics-commitment-battle-mode.md
 *
 * Invariants upheld:
 *   #2  — host names no game; tactics logic reaches it only through this hook.
 *   #3 / #8 — the buffer never lands on the snapshot; only the envelope hash
 *          (pre-reveal) and the verified reveal (post-commit) cross the boundary.
 */

import type { ActionEnvelope, BaseGameSnapshot, PlayerId } from '../engine/types.js';
import type { StagedReveals } from './RevealStaging.js';

/**
 * Per-game hooks the host invokes to orchestrate a commit-then-sync turn. A game
 * with no commitment turn mode simply registers no orchestration.
 */
export interface CommitmentTurnOrchestration {
    /**
     * Inspect a just-APPLIED action and, if it is this game's commit action that
     * the authority ACCEPTED, return the `{ playerId, value }` to stage for later
     * reveal (the host calls `SessionRuntime.commitTurn`). Returns `null` for any
     * other action, or for a commit the pipeline rejected.
     *
     * The host calls this with the POST-apply snapshot so the game can confirm the
     * commit landed (e.g. tactics checks its `committedTurns` marker) before
     * staging — a rejected/out-of-mode commit must never stage a reveal nor
     * project a phantom envelope (Invariants #3/#8).
     *
     * `value` is the opaque committed bundle (e.g. tactics' buffered turn). The
     * host never inspects it; the game re-narrows it on reveal.
     */
    stageOnCommit(
        action: ActionEnvelope,
        snapshot: Readonly<BaseGameSnapshot>,
    ): { readonly playerId: PlayerId; readonly value: unknown } | null;

    /**
     * Whether this just-applied action should trigger the reveal sequence — i.e.
     * the commitment-mode End Turn after every seat has committed. The host runs
     * the reveal only when this returns `true`, so sequential turns and
     * non-commitment games are unaffected.
     */
    shouldReveal(action: ActionEnvelope, snapshot: Readonly<BaseGameSnapshot>): boolean;

    /**
     * Whether this just-applied action COMPLETED the commitment set so the host
     * should advance the turn and reveal **automatically**, without a separate
     * manual End Turn. The host synthesises an `engine:end_turn` for the active
     * seat when this returns `true` (which then satisfies {@link shouldReveal}).
     *
     * Tactics returns `true` on the `tactics:commit` that makes every seated
     * player committed for the current turn, so a player's single "End Turn" (=
     * commit) is the only confirmation a turn needs. Optional — a game with no
     * auto-advance simply omits it, keeping the manual {@link shouldReveal} path.
     */
    shouldAutoEndTurn?(action: ActionEnvelope, snapshot: Readonly<BaseGameSnapshot>): boolean;

    /**
     * Derive the deterministic reveal order from the staged reveals. Pure: a
     * function of `(seed, tick)` only (Invariant #71). The game narrows each
     * staged `value` to read its grouping discriminant (e.g. attack-committers
     * first) and shuffles with the seeded RNG.
     */
    resolveRevealOrder(staged: StagedReveals, seed: number, tick: number): readonly PlayerId[];

    /**
     * Expand a revealed bundle into the ordered engine actions the host
     * re-dispatches through the `ActionPipeline` (buffered order). Each returned
     * `ActionEnvelope` is applied exactly as in sequential mode, so game-end
     * resolution is unchanged.
     */
    revealedActionsFor(value: unknown, playerId: PlayerId, tick: number): readonly ActionEnvelope[];
}
