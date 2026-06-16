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

import { ActionRegistry } from '@chimera/simulation/engine/ActionRegistry.js';
import { registerEngineActions } from '@chimera/simulation/engine/EngineActions.js';
import type {
    ActionEnvelope,
    BaseEntityState,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import { entityId, playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import {
    CommitmentVerificationError,
    toCommitmentId,
    type CommitmentReveal,
} from '@chimera/simulation/projection/index.js';
import {
    TACTICS_ATTACK_ACTION,
    TACTICS_COMMIT_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_TURN_MODE_SETTING,
} from '@chimera/shared/tactics.js';
import type { WireCommitmentReveal } from '@chimera/shared/messages.js';
import {
    registerTacticsActions,
    tacticsGridCoordinate,
    type TacticsAttackPayload,
    type TacticsMoveUnitPayload,
} from '@chimera/games/tactics/actions.js';
import { tacticsCommitmentOrchestration } from '@chimera/games/tactics/commitment/orchestration.js';
import type { BufferedTacticsAction } from '@chimera/games/tactics/commitment/contract.js';

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
    drive(action: ActionEnvelope): void;
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

    // Mirrors index.ts `onActionReceived`: apply first, then stage the commit only
    // if the pipeline accepted it, then reveal on the commitment-mode end-turn. A
    // rejected action throws out of the pipeline and is swallowed (as in production).
    const drive = (action: ActionEnvelope): void => {
        try {
            runtime.applyAction(action);
            const staged = orchestration.stageOnCommit(action, runtime.getSnapshot());
            if (staged !== null) {
                runtime.commitTurn(staged.playerId, staged.value);
            }
            if (orchestration.shouldReveal(action, runtime.getSnapshot())) {
                runRevealSync({ orchestration, session: runtime, sendReveal });
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
        // P2 commits an attack (reveals first); P1 commits a two-move bundle.
        h.drive(commit(h.runtime, P1, [move(U1, 0, 1), move(U1, 0, 2)]));
        h.drive(commit(h.runtime, P2, [attack(U2, U1)]));
        h.drive(endTurn(h.runtime, P1));

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
            h.drive(commit(h.runtime, P2, [attack(U2, U1)]));
            h.drive(endTurn(h.runtime, P1));
            return revealedPlayers(h.sentReveals);
        };
        // Fixed seed + actions → the same concrete order on every run (P2's attack
        // group reveals before P1's move group), reproducible under replay.
        expect(runOrder()).toEqual([P2, P1]);
        expect(runOrder()).toEqual([P2, P1]);

        // A client that restored the broadcast envelopes verifies every reveal in
        // the host's order (Invariant #9 gate succeeds) — i.e. it converges.
        const h = buildHarness('commitment', 2);
        h.drive(commit(h.runtime, P1, [move(U1, 0, 1)]));
        h.drive(commit(h.runtime, P2, [attack(U2, U1)]));
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
        h.drive(commit(h.runtime, P2, [move(U2, 1, 1)]));
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
        // Commitment mode: P1 commits an attack that kills P2's last unit.
        const h = buildHarness('commitment', 1);
        h.drive(commit(h.runtime, P1, [attack(U1, U2)]));
        h.drive(commit(h.runtime, P2, [move(U2, 1, 1)]));
        h.drive(endTurn(h.runtime, P1));
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
