// electron/main/runtime/RevealOrchestrator.test.ts
//
// Unit tests for the host-side reveal-sync driver (T9 / #729). `runRevealSync`
// is game-agnostic: it reads the deterministic order from a registered
// `CommitmentTurnOrchestration`, broadcasts each staged reveal via
// `HostTransport.sendReveal`, verifies before applying (Invariant #9), and
// re-dispatches the revealed actions through the session pipeline.
//
// Design note: docs/security-trust/tactics-commitment-battle-mode.md §5

import type { WireCommitmentReveal } from '@chimera/simulation/foundation/messages.js';
import type {
    ActionEnvelope,
    BaseGameSnapshot,
    PlayerId,
} from '@chimera/simulation/engine/types.js';
import { gamePhase, playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import {
    CommitmentVerificationError,
    RevealStagingError,
    toCommitmentId,
    type CommitmentReveal,
    type CommitmentTurnOrchestration,
} from '@chimera/simulation/projection/index.js';
import { describe, expect, it, vi } from 'vitest';

import { runRevealSync, type RevealSyncSession } from './RevealOrchestrator.js';

const P1 = toPlayerId('player-1');
const P2 = toPlayerId('player-2');

function snapshot(): BaseGameSnapshot {
    return {
        tick: 12,
        seed: 42,
        players: { [P1]: { id: P1 }, [P2]: { id: P2 } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 4,
        timers: {},
        gameResult: null,
    };
}

/** A reveal whose value is the player id, so we can assert what was applied. */
function revealFor(player: PlayerId): CommitmentReveal {
    return { id: toCommitmentId(`env-${player}`), value: { owner: player }, nonce: `n-${player}` };
}

interface Harness {
    session: RevealSyncSession;
    sendReveal: ReturnType<typeof vi.fn>;
    applied: ActionEnvelope[];
    cleared: () => boolean;
}

function harness(overrides: Partial<RevealSyncSession> = {}): Harness {
    const applied: ActionEnvelope[] = [];
    let cleared = false;
    const sendReveal =
        vi.fn<(target: PlayerId | 'broadcast', reveal: WireCommitmentReveal) => void>();
    const session: RevealSyncSession = {
        getSnapshot: () => snapshot(),
        captureStagedReveals: () => ({}),
        buildReveal: (player) => revealFor(player),
        verifyReveal: (reveal) => reveal.value,
        applyAction: (action) => {
            applied.push(action);
        },
        clearStagedReveals: () => {
            cleared = true;
        },
        ...overrides,
    };
    return { session, sendReveal, applied, cleared: () => cleared };
}

/** Orchestration stub: fixed order, one action expanded per player. */
function orchestration(order: PlayerId[]): CommitmentTurnOrchestration {
    return {
        stageOnCommit: () => null,
        shouldReveal: () => true,
        resolveRevealOrder: () => order,
        revealedActionsFor: (value, player, tick) => [
            { type: 'demo:act', playerId: player, tick, payload: { value } },
        ],
    };
}

describe('runRevealSync (T9 / #729)', () => {
    it('broadcasts reveals and applies revealed actions in resolveRevealOrder order', () => {
        const h = harness();
        runRevealSync({
            orchestration: orchestration([P2, P1]),
            session: h.session,
            sendReveal: h.sendReveal,
        });

        expect(h.sendReveal.mock.calls.map((c) => c[1].id)).toEqual([`env-${P2}`, `env-${P1}`]);
        expect(h.sendReveal.mock.calls.every((c) => c[0] === 'broadcast')).toBe(true);
        expect(h.applied.map((a) => a.playerId)).toEqual([P2, P1]);
    });

    it('clears the staged turn after revealing', () => {
        const h = harness();
        runRevealSync({
            orchestration: orchestration([P1]),
            session: h.session,
            sendReveal: h.sendReveal,
        });
        expect(h.cleared()).toBe(true);
    });

    it('only applies a reveal AFTER verify() succeeds (Invariant #9)', () => {
        const calls: string[] = [];
        const h = harness({
            verifyReveal: (reveal) => {
                calls.push('verify');
                return reveal.value;
            },
            applyAction: (action) => {
                calls.push(`apply:${action.playerId}`);
            },
        });
        runRevealSync({
            orchestration: orchestration([P1]),
            session: h.session,
            sendReveal: h.sendReveal,
        });
        expect(calls).toEqual(['verify', `apply:${P1}`]);
    });

    it('drops a reveal that fails verify() — it is not applied (Invariant #9)', () => {
        const h = harness({
            verifyReveal: (reveal) => {
                if (reveal.id === `env-${P1}`) {
                    throw new CommitmentVerificationError();
                }
                return reveal.value;
            },
        });
        runRevealSync({
            orchestration: orchestration([P1, P2]),
            session: h.session,
            sendReveal: h.sendReveal,
        });

        // P1's bundle is dropped; P2's still applies. The whole turn still clears.
        expect(h.applied.map((a) => a.playerId)).toEqual([P2]);
        expect(h.cleared()).toBe(true);
    });

    it('skips a player with no staged reveal without aborting the rest', () => {
        const h = harness({
            buildReveal: (player) => {
                if (player === P1) {
                    throw new RevealStagingError();
                }
                return revealFor(player);
            },
        });
        runRevealSync({
            orchestration: orchestration([P1, P2]),
            session: h.session,
            sendReveal: h.sendReveal,
        });
        expect(h.applied.map((a) => a.playerId)).toEqual([P2]);
    });

    it('stops revealing once a revealed action resolves the match (design §5)', () => {
        // The first applied action ends the match (a revealed attack); the next
        // player's reveal must not be sent or applied.
        let resolved = false;
        const base = snapshot();
        const sendReveal =
            vi.fn<(target: PlayerId | 'broadcast', reveal: WireCommitmentReveal) => void>();
        const applied: ActionEnvelope[] = [];
        const session: RevealSyncSession = {
            getSnapshot: () => (resolved ? { ...base, gameResult: { winnerIds: [P1] } } : base),
            captureStagedReveals: () => ({}),
            buildReveal: (player) => revealFor(player),
            verifyReveal: (reveal) => reveal.value,
            applyAction: (action) => {
                applied.push(action);
                resolved = true;
            },
            clearStagedReveals: () => undefined,
        };
        runRevealSync({ orchestration: orchestration([P1, P2]), session, sendReveal });

        expect(sendReveal.mock.calls.map((c) => c[1].id)).toEqual([`env-${P1}`]);
        expect(applied.map((a) => a.playerId)).toEqual([P1]);
    });

    it('drops a revealed action the pipeline rejects without aborting the turn', () => {
        const applied: ActionEnvelope[] = [];
        const session: RevealSyncSession = {
            getSnapshot: () => snapshot(),
            captureStagedReveals: () => ({}),
            buildReveal: (player) => revealFor(player),
            verifyReveal: (reveal) => reveal.value,
            applyAction: (action) => {
                if (action.playerId === P1) {
                    throw new Error('rejected by validate()');
                }
                applied.push(action);
            },
            clearStagedReveals: () => undefined,
        };
        const sendReveal =
            vi.fn<(target: PlayerId | 'broadcast', reveal: WireCommitmentReveal) => void>();
        runRevealSync({ orchestration: orchestration([P1, P2]), session, sendReveal });

        // P1's action was dropped (threw); P2's still applied.
        expect(applied.map((a) => a.playerId)).toEqual([P2]);
        expect(sendReveal.mock.calls.map((c) => c[1].id)).toEqual([`env-${P1}`, `env-${P2}`]);
    });
});
