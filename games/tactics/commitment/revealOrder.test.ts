// games/tactics/commitment/revealOrder.test.ts
//
// Unit tests for the deterministic reveal order (T9 / #729). The order is a pure
// function of `(seed, tick)`: attack-committers' groups come first, each
// partition shuffled with the seeded RNG (no Math.random). This is the property
// that lets host + clients (and replays) converge on the same reveal sequence.
//
// Design note: docs/security-trust/tactics-commitment-battle-mode.md §5

import { playerId as toPlayerId } from '@chimera/simulation/engine/types.js';
import { describe, expect, it } from 'vitest';

import type { CommittedTurn } from './contract.js';
import { resolveRevealOrder } from './revealOrder.js';

function attacker(id: string): CommittedTurn {
    return { playerId: toPlayerId(id), hasAttack: true };
}

function mover(id: string): CommittedTurn {
    return { playerId: toPlayerId(id), hasAttack: false };
}

const SEED = 42;
const TICK = 7;

describe('resolveRevealOrder (T9 / #729 — deterministic, attack-first, grouped)', () => {
    it('returns an empty order for no committed turns', () => {
        expect(resolveRevealOrder([], SEED, TICK)).toEqual([]);
    });

    it('returns every committed player exactly once (permutation of the input)', () => {
        const committed = [attacker('a'), mover('b'), attacker('c'), mover('d')];
        const order = resolveRevealOrder(committed, SEED, TICK);
        expect([...order].sort()).toEqual(committed.map((c) => c.playerId).sort());
    });

    it('places every attack-committer before every non-attack-committer', () => {
        const committed = [mover('m1'), attacker('a1'), mover('m2'), attacker('a2'), mover('m3')];
        const order = resolveRevealOrder(committed, SEED, TICK);
        const attackerIds = new Set(committed.filter((c) => c.hasAttack).map((c) => c.playerId));
        const lastAttackerIndex = Math.max(...order.map((id, i) => (attackerIds.has(id) ? i : -1)));
        const firstMoverIndex = order.findIndex((id) => !attackerIds.has(id));
        expect(lastAttackerIndex).toBeLessThan(firstMoverIndex);
    });

    it('is deterministic: identical (seed, tick) yields an identical order', () => {
        const committed = [attacker('a'), attacker('b'), mover('c'), mover('d')];
        const first = resolveRevealOrder(committed, SEED, TICK);
        const second = resolveRevealOrder(committed, SEED, TICK);
        expect(second).toEqual(first);
    });

    it('is independent of commit-arrival (input array) order — a function of the set + (seed, tick)', () => {
        const a = [attacker('a'), attacker('b'), mover('c'), mover('d')];
        const reordered = [mover('d'), attacker('b'), mover('c'), attacker('a')];
        expect(resolveRevealOrder(reordered, SEED, TICK)).toEqual(
            resolveRevealOrder(a, SEED, TICK),
        );
    });

    it('actually shuffles within a partition: different seeds produce different orders', () => {
        const committed = [attacker('a'), attacker('b'), attacker('c'), attacker('d')];
        const distinct = new Set<string>();
        for (let seed = 1; seed <= 20; seed += 1) {
            distinct.add(resolveRevealOrder(committed, seed, TICK).join(','));
        }
        // A seeded shuffle over 20 seeds must yield more than one ordering;
        // an identity (no-shuffle) implementation would collapse to a single one.
        expect(distinct.size).toBeGreaterThan(1);
    });

    it('handles a single partition (all attackers) as a deterministic permutation', () => {
        const committed = [attacker('a'), attacker('b'), attacker('c')];
        const order = resolveRevealOrder(committed, SEED, TICK);
        expect([...order].sort()).toEqual(['a', 'b', 'c'].map(toPlayerId).sort());
        expect(resolveRevealOrder(committed, SEED, TICK)).toEqual(order);
    });
});
