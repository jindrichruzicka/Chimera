/**
 * electron/main/__tests__/reveal-sync.integration.test.ts
 *
 * Integration test for the commitment-mode reveal-sync orchestration (T9 / #729).
 * Wires a REAL tactics host pipeline (engine + tactics actions) into a
 * `SessionRuntime`, the registered `tacticsCommitmentOrchestration`, and the
 * host `runRevealSync` driver — mirroring the `index.ts` `onActionReceived`
 * wiring — then asserts the four acceptance criteria end-to-end:
 *
 *   AC1 — after all commit, reveals apply grouped-by-player, attack-committed
 *         players' groups first;
 *   AC2 — reveal order is deterministic for a fixed seed (host + a client
 *         converge by verifying in host order; replay-safe);
 *   AC3 — a revealed action failing `verify()` is dropped, not applied (#9);
 *   AC4 — a revealed attack resolves game-end identically to sequential mode.
 *
 * Architecture: §4.6/§8 · docs/security-trust/tactics-commitment-battle-mode.md
 * Invariants verified: #3/#8 (buffer never on the snapshot), #9 (verify gate),
 * deterministic reveal order.
 */

import { describe, expect, it, vi } from 'vitest';

import { ActionRegistry } from '@chimera-engine/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera-engine/simulation/engine/EngineActions.js';
import type {
    ActionEnvelope,
    BaseEntityState,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera-engine/simulation/engine/types.js';
import { entityId, playerId as toPlayerId } from '@chimera-engine/simulation/engine/types.js';
import {
    CommitmentVerificationError,
    toCommitmentId,
    type CommitmentReveal,
} from '@chimera-engine/simulation/projection/index.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_COMMIT_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_TURN_MODE_SETTING,
} from '@chimera-engine/tactics/simulation/constants.js';
import type { WireCommitmentReveal } from '@chimera-engine/simulation/foundation/messages.js';
import {
    registerTacticsActions,
    tacticsGridCoordinate,
    type TacticsAttackPayload,
    type TacticsMoveUnitPayload,
} from '@chimera-engine/tactics/simulation/actions.js';
import { tacticsCommitmentOrchestration } from '@chimera-engine/tactics/simulation/commitment/orchestration.js';
import type { BufferedTacticsAction } from '@chimera-engine/tactics/simulation/commitment/contract.js';

import { buildHostSessionPipeline } from '../runtime/HostSessionPipeline.js';
import { runRevealSync } from '../runtime/RevealOrchestrator.js';
import { SessionCommitmentRuntime, SessionRuntime } from '../runtime/SessionRuntime.js';

const P1 = toPlayerId('player-1');
const P2 = toPlayerId('player-2');
const U1 = entityId('u1'); // P1's unit at (0,0)
const U2 = entityId('u2'); // P2's unit at (1,0), adjacent to U1

function unit(owner: PlayerId, x: number, y: number, hp: number): BaseEntityState {
    return {
        id: owner === P1 ? U1 : U2,
        kind: 'unit',
        ownerId: owner,
        x: tacticsGridCoordinate(x),
        y: tacticsGridCoordinate(y),
        hp,
        visibleTo: [P1, P2],
    } as unknown as BaseEntityState;
}

function makeSnapshot(turnMode: 'commitment' | 'sequential', hp: number): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 42,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: { [U1]: unit(P1, 0, 0, hp), [U2]: unit(P2, 1, 0, hp) },
        phase: 'playing' as BaseGameSnapshot['phase'],
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
        turnClock: { activePlayerId: P1, deadlineMs: 60_000 },
        setup: { matchSettings: { [TACTICS_TURN_MODE_SETTING]: turnMode }, playerAttributes: {} },
    };
}

const move = (unitId: typeof U1, x: number, y: number): BufferedTacticsAction => ({
    type: TACTICS_MOVE_UNIT_ACTION,
    payload: {
        unitId,
        x: tacticsGridCoordinate(x),
        y: tacticsGridCoordinate(y),
    } satisfies TacticsMoveUnitPayload,
});

const attack = (attackerId: typeof U1, defenderId: typeof U1): BufferedTacticsAction => ({
    type: TACTICS_ATTACK_ACTION,
    payload: { attackerId, defenderId } satisfies TacticsAttackPayload,
});

function buildRegistry(): ActionRegistry {
    const registry = new ActionRegistry();
    registerEngineActions(registry);
    registerTacticsActions(registry);
    return registry;
}

interface Harness {
    runtime: SessionRuntime;
    /** Reveals broadcast during the reveal sequence, in send order. */
    sentReveals: WireCommitmentReveal[];
    drive(action: ActionEnvelope, options?: { readonly skipAutoEndTurn?: boolean }): void;
}

function buildHarness(turnMode: 'commitment' | 'sequential', hp: number): Harness {
    const { processAction } = buildHostSessionPipeline(buildRegistry(), vi.fn(), {
        gameId: 'tactics',
        savePort: { autoSave: vi.fn().mockResolvedValue(undefined) },
    });
    const runtime = new SessionRuntime({
        gameId: 'tactics',
        gameVersion: '0.1.0',
        initialSnapshot: makeSnapshot(turnMode, hp),
        applyAction: processAction,
    });
    const sentReveals: WireCommitmentReveal[] = [];
    const sendReveal = vi.fn((_target: PlayerId | 'broadcast', reveal: WireCommitmentReveal) => {
        sentReveals.push(reveal);
    });
    const orchestration = tacticsCommitmentOrchestration;

    // Mirrors index.ts `onActionReceived`: apply, stage an accepted commit, reveal
    // on a commitment-mode end-turn, and — when a commit completes the set —
    // AUTO-advance the turn + reveal (mirrors `autoEndTurnIfReady`, #730 UX). A
    // rejected action throws out of the pipeline and is swallowed (as in production).
    // `skipAutoEndTurn` stops before the auto step so a test can inspect the staged
    // commitments after both commits but before the reveal consumes them (AC2).
    const drive = (
        action: ActionEnvelope,
        options: { readonly skipAutoEndTurn?: boolean } = {},
    ): void => {
        try {
            runtime.applyAction(action);
            const staged = orchestration.stageOnCommit(action, runtime.getSnapshot());
            if (staged !== null) {
                runtime.commitTurn(staged.playerId, staged.value);
            }
            if (orchestration.shouldReveal(action, runtime.getSnapshot())) {
                runRevealSync({ orchestration, session: runtime, sendReveal });
            }
            if (
                !options.skipAutoEndTurn &&
                orchestration.shouldAutoEndTurn?.(action, runtime.getSnapshot()) === true
            ) {
                const snap = runtime.getSnapshot();
                const activePlayerId = snap.turnClock?.activePlayerId;
                if (activePlayerId !== undefined) {
                    const endTurnAction: ActionEnvelope = {
                        type: 'engine:end_turn',
                        playerId: activePlayerId,
                        tick: snap.tick,
                        payload: {},
                    };
                    runtime.applyAction(endTurnAction);
                    if (orchestration.shouldReveal(endTurnAction, runtime.getSnapshot())) {
                        runRevealSync({ orchestration, session: runtime, sendReveal });
                    }
                }
            }
        } catch {
            // index.ts logs and continues; a single rejected action never crashes.
        }
    };

    return { runtime, sentReveals, drive };
}

function commit(
    runtime: SessionRuntime,
    player: PlayerId,
    actions: BufferedTacticsAction[],
): ActionEnvelope {
    return {
        type: TACTICS_COMMIT_ACTION,
        playerId: player,
        tick: runtime.getSnapshot().tick,
        payload: { actions },
    };
}

const endTurn = (runtime: SessionRuntime, player: PlayerId): ActionEnvelope => ({
    type: 'engine:end_turn',
    playerId: player,
    tick: runtime.getSnapshot().tick,
    payload: {},
});

/** The committer of each broadcast reveal, in send order. */
function revealedPlayers(sent: readonly WireCommitmentReveal[]): PlayerId[] {
    return sent.map((r) => (r.value as { playerId: PlayerId }).playerId);
}

describe('reveal-sync orchestration (T9 / #729) — integration', () => {
    it('AC1: reveals are grouped-by-player with attack-committed groups first', () => {
        // hp 2 so the attack does not end the match — both groups reveal.
        const h = buildHarness('commitment', 2);
        // P2 commits an attack (reveals first); P1 commits a two-move bundle. P2's
        // commit completes the set, so the host auto-advances + reveals — no manual
        // End Turn (#730 UX).
        h.drive(commit(h.runtime, P1, [move(U1, 0, 1), move(U1, 0, 2)]));
        h.drive(commit(h.runtime, P2, [attack(U2, U1)]));

        // Attack-committer P2 reveals before move-only P1 (one envelope per player).
        expect(revealedPlayers(h.sentReveals)).toEqual([P2, P1]);
        // P1's whole bundle applied contiguously: both moves landed (final at 0,2).
        const u1 = h.runtime.getSnapshot().entities[U1] as unknown as { x: number; y: number };
        expect([u1.x, u1.y]).toEqual([0, 2]);
    });

    it('AC2: reveal order is deterministic for a fixed seed (host + client converge)', () => {
        const runOrder = (): PlayerId[] => {
            const h = buildHarness('commitment', 2);
            h.drive(commit(h.runtime, P1, [move(U1, 0, 1)]));
            h.drive(commit(h.runtime, P2, [attack(U2, U1)])); // completing commit auto-reveals
            return revealedPlayers(h.sentReveals);
        };
        // Fixed seed + actions → the same concrete order on every run (P2's attack
        // group reveals before P1's move group), reproducible under replay.
        expect(runOrder()).toEqual([P2, P1]);
        expect(runOrder()).toEqual([P2, P1]);

        // A client that restored the broadcast envelopes verifies every reveal in
        // the host's order (Invariant #9 gate succeeds) — i.e. it converges.
        // `skipAutoEndTurn` lets us snapshot the staged commitments after both
        // commits but before the reveal consumes them, then trigger the reveal.
        const h = buildHarness('commitment', 2);
        h.drive(commit(h.runtime, P1, [move(U1, 0, 1)]));
        h.drive(commit(h.runtime, P2, [attack(U2, U1)]), { skipAutoEndTurn: true });
        const envelopes = h.runtime.capturePendingCommitments(); // before reveal consumes them
        h.drive(endTurn(h.runtime, P1));

        const client = new SessionCommitmentRuntime();
        client.restorePendingCommitments(envelopes);
        expect(h.sentReveals).toHaveLength(2); // not a vacuous loop
        for (const wire of h.sentReveals) {
            const reveal: CommitmentReveal = {
                id: toCommitmentId(wire.id),
                value: wire.value,
                nonce: wire.nonce,
            };
            expect(() => client.verifyReveal(reveal)).not.toThrow();
        }
    });

    it('AC3: a tampered revealed action fails verify() and is dropped (Invariant #9)', () => {
        const h = buildHarness('commitment', 2);
        h.drive(commit(h.runtime, P1, [attack(U1, U2)]));
        h.drive(commit(h.runtime, P2, [move(U2, 1, 1)]), { skipAutoEndTurn: true });
        const envelopes = h.runtime.capturePendingCommitments();
        h.drive(endTurn(h.runtime, P1));

        const client = new SessionCommitmentRuntime();
        client.restorePendingCommitments(envelopes);

        const genuine = h.sentReveals[0];
        if (genuine === undefined) throw new Error('expected a broadcast reveal');
        // Genuine reveal verifies; a value-tampered reveal does NOT.
        expect(() =>
            client.verifyReveal({
                id: toCommitmentId(genuine.id),
                value: genuine.value,
                nonce: genuine.nonce,
            }),
        ).not.toThrow();
        const tampered: CommitmentReveal = {
            id: toCommitmentId(genuine.id),
            value: { playerId: P2, turnNumber: 0, actions: [] }, // not what was committed
            nonce: genuine.nonce,
        };
        expect(() => client.verifyReveal(tampered)).toThrow(CommitmentVerificationError);
    });

    it('AC4: a revealed attack resolves game-end identically to sequential mode', () => {
        // Commitment mode: P1 commits an attack that kills P2's last unit. P2's
        // commit completes the set → auto-reveal (no manual End Turn).
        const h = buildHarness('commitment', 1);
        h.drive(commit(h.runtime, P1, [attack(U1, U2)]));
        h.drive(commit(h.runtime, P2, [move(U2, 1, 1)]));
        const commitmentResult = h.runtime.getSnapshot().gameResult;

        // Sequential mode: dispatch the very same attack directly.
        const seq = buildHarness('sequential', 1);
        seq.runtime.applyAction({
            type: TACTICS_ATTACK_ACTION,
            playerId: P1,
            tick: seq.runtime.getSnapshot().tick,
            payload: { attackerId: U1, defenderId: U2 },
        });
        const sequentialResult = seq.runtime.getSnapshot().gameResult;

        expect(commitmentResult).toEqual({ winnerIds: [P1] });
        expect(commitmentResult).toEqual(sequentialResult);
    });

    it('#730: the completing commit auto-advances the turn AND reveals — no explicit End Turn', () => {
        // The player's single "End Turn" = commit is the only confirmation a turn
        // needs: the second commit completes the set, so the host auto-end-turns and
        // reveals. (The engine `mayEndTurn` any-seat authority is unit-tested in
        // turnGate.test.ts.)
        const h = buildHarness('commitment', 2);
        const c1 = commit(h.runtime, P1, [move(U1, 0, 1)]);
        h.drive(c1);
        // shouldAutoEndTurn is false on the first (partial) commit.
        expect(
            tacticsCommitmentOrchestration.shouldAutoEndTurn?.(c1, h.runtime.getSnapshot()),
        ).toBe(false);
        const turnBefore = h.runtime.getSnapshot().turnNumber;
        h.drive(commit(h.runtime, P2, [attack(U2, U1)]));

        // No explicit endTurn() was driven, yet the reveal fired (attack-first) and
        // the turn advanced exactly once.
        expect(revealedPlayers(h.sentReveals)).toEqual([P2, P1]);
        expect(h.runtime.getSnapshot().turnNumber).toBe(turnBefore + 1);
    });

    it('#730: two commitment turns in a row — markers expire and stamina refreshes for all', () => {
        const h = buildHarness('commitment', 6);
        // Turn 1: P1 spends ALL THREE stamina (three moves), ending at (2,2); P2
        // commits one move so the turn can complete.
        h.drive(commit(h.runtime, P1, [move(U1, 0, 1), move(U1, 1, 1), move(U1, 2, 2)]));
        h.drive(commit(h.runtime, P2, [move(U2, 1, 1)])); // completing commit auto-reveals
        expect(h.sentReveals).toHaveLength(2);
        const u1AfterTurn1 = h.runtime.getSnapshot().entities[U1] as unknown as {
            x: number;
            y: number;
        };
        expect([u1AfterTurn1.x, u1AfterTurn1.y]).toEqual([2, 2]); // all three moves applied

        // Turn 2: P1 (who hit 0 stamina last turn) commits another move. It only
        // applies if stamina refreshed on the turn advance — proving the
        // commitment-mode refresh covers every seat, not just the active one.
        const turnNumberAfterTurn1 = h.runtime.getSnapshot().turnNumber;
        h.drive(commit(h.runtime, P1, [move(U1, 3, 3)]));
        h.drive(commit(h.runtime, P2, [move(U2, 2, 2)])); // completing commit auto-reveals

        expect(h.sentReveals.length).toBeGreaterThan(2); // a second reveal fired
        expect(h.runtime.getSnapshot().turnNumber).toBe(turnNumberAfterTurn1 + 1);
        const u1AfterTurn2 = h.runtime.getSnapshot().entities[U1] as unknown as {
            x: number;
            y: number;
        };
        expect([u1AfterTurn2.x, u1AfterTurn2.y]).toEqual([3, 3]); // refreshed → move applied
    });

    it('BLOCK-1: a rejected out-of-mode commit never stages or projects an envelope', () => {
        // A sequential-mode `tactics:commit` is rejected by the pipeline
        // (not_commitment_mode). Because staging runs only AFTER the commit is
        // accepted, no phantom envelope reaches `pendingCommitments` (which would
        // otherwise be projected to peers as PlayerSnapshot.commitments).
        const h = buildHarness('sequential', 1);
        h.drive(commit(h.runtime, P1, [move(U1, 0, 1)]));

        expect(h.runtime.capturePendingCommitments()).toEqual({});
        expect(h.runtime.committedPlayerIds()).toEqual([]);
        expect(h.sentReveals).toHaveLength(0);
    });
});
