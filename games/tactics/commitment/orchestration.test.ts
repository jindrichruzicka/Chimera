// games/tactics/commitment/orchestration.test.ts
//
// Unit tests for the tactics implementation of the host-neutral
// `CommitmentTurnOrchestration` (T9 / #729). These pure hooks let the host
// drive the commit-then-sync reveal sequence without naming tactics: stage on
// the commit action, reveal on the commitment-mode End Turn, order
// deterministically (attack-first), and expand a revealed bundle into engine
// actions.
//
// Design note: docs/security-trust/tactics-commitment-battle-mode.md §3, §5

import {
    TACTICS_ATTACK_ACTION,
    TACTICS_COMMIT_ACTION,
    TACTICS_MOVE_UNIT_ACTION,
    TACTICS_TURN_MODE_SETTING,
} from '@chimera/games/tactics/constants.js';
import type { ActionEnvelope, BaseGameSnapshot } from '@chimera/simulation/engine/types.js';
import { entityId, gamePhase, playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import { toCommitmentId, type StagedReveals } from '@chimera/simulation/projection/index.js';
import { describe, expect, it } from 'vitest';

import { tacticsGridCoordinate } from '../actions.js';
import type { BufferedTacticsAction, TacticsCommitmentEnvelopeValue } from './contract.js';
import { tacticsCommitmentOrchestration } from './orchestration.js';

const P1 = toPlayerId('player-1');
const P2 = toPlayerId('player-2');

const move: BufferedTacticsAction = {
    type: TACTICS_MOVE_UNIT_ACTION,
    payload: { unitId: entityId('u1'), x: tacticsGridCoordinate(1), y: tacticsGridCoordinate(0) },
};
const attack: BufferedTacticsAction = {
    type: TACTICS_ATTACK_ACTION,
    payload: { attackerId: entityId('u1'), defenderId: entityId('u2') },
};

function snapshot(
    turnMode = 'commitment',
    turnNumber = 4,
    committedTurns?: Record<string, number>,
): BaseGameSnapshot {
    return {
        tick: 9,
        seed: 42,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber,
        timers: {},
        gameResult: null,
        ...(committedTurns === undefined ? {} : { committedTurns }),
        setup: { matchSettings: { [TACTICS_TURN_MODE_SETTING]: turnMode }, playerAttributes: {} },
    };
}

/** Post-apply snapshot for a commit the authority accepted (marker written). */
function accepted(player = P1, turnNumber = 4): BaseGameSnapshot {
    return snapshot('commitment', turnNumber, { [player]: turnNumber });
}

function commitAction(actions: BufferedTacticsAction[], player = P1): ActionEnvelope {
    return { type: TACTICS_COMMIT_ACTION, playerId: player, tick: 9, payload: { actions } };
}

function staged(
    entries: { player: ReturnType<typeof toPlayerId>; actions: BufferedTacticsAction[] }[],
): StagedReveals {
    const out: Record<string, unknown> = {};
    entries.forEach((e, i) => {
        const id = toCommitmentId(`env-${i}`);
        const value: TacticsCommitmentEnvelopeValue = {
            playerId: e.player,
            turnNumber: 4,
            actions: e.actions,
        };
        out[id] = { envelopeId: id, playerId: e.player, nonce: `nonce-${i}`, value };
    });
    return out as StagedReveals;
}

describe('tacticsCommitmentOrchestration.stageOnCommit', () => {
    it('extracts {playerId, value} from an accepted commit action', () => {
        const result = tacticsCommitmentOrchestration.stageOnCommit(
            commitAction([move, attack]),
            accepted(P1, 4),
        );
        expect(result).not.toBeNull();
        expect(result?.playerId).toBe(P1);
        const value = result?.value as TacticsCommitmentEnvelopeValue;
        expect(value.playerId).toBe(P1);
        expect(value.turnNumber).toBe(4); // bound to the current turn
        expect(value.actions).toHaveLength(2);
    });

    it('returns null for a non-commit action', () => {
        const endTurn: ActionEnvelope = {
            type: 'engine:end_turn',
            playerId: P1,
            tick: 9,
            payload: {},
        };
        expect(tacticsCommitmentOrchestration.stageOnCommit(endTurn, accepted())).toBeNull();
    });

    it('returns null for a commit the authority rejected — no marker, no stage (BLOCK-1)', () => {
        // No `committedTurns` marker ⇒ the pipeline did not accept this commit
        // (e.g. sequential mode, or an unseated player). It must never stage.
        expect(
            tacticsCommitmentOrchestration.stageOnCommit(
                commitAction([move]),
                snapshot('commitment', 4),
            ),
        ).toBeNull();
    });

    it('returns null when the buffer payload is malformed (not staged)', () => {
        const bad: ActionEnvelope = {
            type: TACTICS_COMMIT_ACTION,
            playerId: P1,
            tick: 9,
            payload: { actions: [{ type: 'tactics:bogus', payload: {} }] },
        };
        expect(tacticsCommitmentOrchestration.stageOnCommit(bad, accepted())).toBeNull();
    });

    it('returns null when the buffer exceeds the size cap (resource bound)', () => {
        const huge = Array.from({ length: 65 }, () => move);
        expect(
            tacticsCommitmentOrchestration.stageOnCommit(commitAction(huge), accepted()),
        ).toBeNull();
    });

    it('accepts an empty buffer (a player may commit no actions)', () => {
        const result = tacticsCommitmentOrchestration.stageOnCommit(commitAction([]), accepted());
        expect(result).not.toBeNull();
        expect((result?.value as TacticsCommitmentEnvelopeValue).actions).toEqual([]);
    });
});

describe('tacticsCommitmentOrchestration.shouldReveal', () => {
    it('is true for engine:end_turn in commitment mode', () => {
        const endTurn: ActionEnvelope = {
            type: 'engine:end_turn',
            playerId: P1,
            tick: 9,
            payload: {},
        };
        expect(tacticsCommitmentOrchestration.shouldReveal(endTurn, snapshot('commitment'))).toBe(
            true,
        );
    });

    it('is false for engine:end_turn in sequential mode', () => {
        const endTurn: ActionEnvelope = {
            type: 'engine:end_turn',
            playerId: P1,
            tick: 9,
            payload: {},
        };
        expect(tacticsCommitmentOrchestration.shouldReveal(endTurn, snapshot('sequential'))).toBe(
            false,
        );
    });

    it('is false for the commit action itself', () => {
        expect(
            tacticsCommitmentOrchestration.shouldReveal(
                commitAction([move]),
                snapshot('commitment'),
            ),
        ).toBe(false);
    });
});

describe('tacticsCommitmentOrchestration.shouldAutoEndTurn', () => {
    // A post-apply snapshot where EVERY seat has committed for the current turn.
    const allCommitted = snapshot('commitment', 4, { [P1]: 4, [P2]: 4 });

    it('is true for the commit that completes the set (every seat committed)', () => {
        expect(
            tacticsCommitmentOrchestration.shouldAutoEndTurn?.(commitAction([move]), allCommitted),
        ).toBe(true);
    });

    it('is false while only some seats have committed', () => {
        const partial = snapshot('commitment', 4, { [P1]: 4 }); // P2 not yet committed
        expect(
            tacticsCommitmentOrchestration.shouldAutoEndTurn?.(commitAction([move]), partial),
        ).toBe(false);
    });

    it('is false in sequential mode even if markers are present', () => {
        const seqAllCommitted = snapshot('sequential', 4, { [P1]: 4, [P2]: 4 });
        expect(
            tacticsCommitmentOrchestration.shouldAutoEndTurn?.(
                commitAction([move]),
                seqAllCommitted,
            ),
        ).toBe(false);
    });

    it('is false for a non-commit action', () => {
        const endTurn: ActionEnvelope = {
            type: 'engine:end_turn',
            playerId: P1,
            tick: 9,
            payload: {},
        };
        expect(tacticsCommitmentOrchestration.shouldAutoEndTurn?.(endTurn, allCommitted)).toBe(
            false,
        );
    });
});

describe('tacticsCommitmentOrchestration.resolveRevealOrder', () => {
    it('orders attack-committers ahead of move-only committers', () => {
        const order = tacticsCommitmentOrchestration.resolveRevealOrder(
            staged([
                { player: P1, actions: [move] }, // move only
                { player: P2, actions: [attack] }, // has attack
            ]),
            42,
            9,
        );
        expect(order).toEqual([P2, P1]);
    });
});

describe('tacticsCommitmentOrchestration.revealedActionsFor', () => {
    it('expands a revealed bundle into ordered engine action envelopes', () => {
        const value: TacticsCommitmentEnvelopeValue = {
            playerId: P1,
            turnNumber: 4,
            actions: [move, attack],
        };
        const actions = tacticsCommitmentOrchestration.revealedActionsFor(value, P1, 12);
        expect(actions).toEqual([
            { type: TACTICS_MOVE_UNIT_ACTION, playerId: P1, tick: 12, payload: move.payload },
            { type: TACTICS_ATTACK_ACTION, playerId: P1, tick: 12, payload: attack.payload },
        ]);
    });

    it('returns no actions for a malformed value', () => {
        expect(tacticsCommitmentOrchestration.revealedActionsFor({ nope: true }, P1, 12)).toEqual(
            [],
        );
    });
});
