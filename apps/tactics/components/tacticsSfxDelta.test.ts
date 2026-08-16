/**
 * tacticsSfxDelta.test.ts
 *
 * The board's positioned SFX are derived from what the viewer's projection
 * actually delivered, so every claim here is about two projected unit lists and
 * nothing else — no intent, no action payload, no actor identity.
 */
import { describe, expect, it } from 'vitest';
import { entityId, playerId } from '@chimera-engine/simulation/engine/types.js';
import { gridToWorldPoint, type TacticsSceneUnit } from './tacticsSceneModel.js';
import { resolveTacticsSfxCues } from './tacticsSfxDelta.js';

const OWNER = playerId('p1');
const OPPONENT = playerId('p2');

function unit(
    id: string,
    grid: { readonly x: number; readonly y: number },
    options: { readonly hp?: number; readonly owner?: string } = {},
): TacticsSceneUnit {
    const hp = options.hp ?? 1;
    return {
        id: entityId(id),
        ownerId: playerId(options.owner ?? OPPONENT),
        ownership: (options.owner ?? OPPONENT) === OWNER ? 'own' : 'opponent',
        grid,
        world: gridToWorldPoint(grid),
        hp,
        isAlive: hp > 0,
    };
}

describe('resolveTacticsSfxCues', () => {
    it('reports nothing when no projected unit changed', () => {
        // Positive control: without it, a resolver that emitted on every call
        // would satisfy every assertion below.
        const units = [unit('a', { x: 0, y: 0 }), unit('b', { x: 2, y: 0 })];

        expect(resolveTacticsSfxCues(units, units)).toEqual([]);
    });

    it('reports a move for a unit whose tile changed, at the tile it arrived on', () => {
        // The position is the DESTINATION, not the origin: the sound belongs where
        // the unit now stands, which is also the only tile the viewer can still
        // see it on.
        const before = [unit('a', { x: 0, y: 0 })];
        const after = [unit('a', { x: 1, y: -1 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([
            { kind: 'move', unitId: entityId('a'), world: { x: 1, y: 0, z: -1 } },
        ]);
    });

    it('reports a move that changed the grid X alone', () => {
        // The two grid axes are compared as a disjunction, so a fixture moving
        // both at once kills neither drop-one mutant. This one and its Y sibling
        // vary a single axis each.
        const before = [unit('a', { x: 0, y: 0 })];
        const after = [unit('a', { x: 1, y: 0 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([
            { kind: 'move', unitId: entityId('a'), world: { x: 1, y: 0, z: 0 } },
        ]);
    });

    it('reports a move that changed the grid Y alone', () => {
        const before = [unit('a', { x: 0, y: 0 })];
        const after = [unit('a', { x: 0, y: 1 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([
            { kind: 'move', unitId: entityId('a'), world: { x: 0, y: 0, z: 1 } },
        ]);
    });

    it('reports a hit for a unit whose hp dropped, at the unit that took it', () => {
        // A projected delta names the DEFENDER, never the attacker — the acting
        // unit is exactly what a `{ type }`-only event and a hp diff both fail to
        // carry, so the impact is positioned where it landed.
        const before = [unit('a', { x: 0, y: 0 }, { hp: 2 })];
        const after = [unit('a', { x: 0, y: 0 }, { hp: 1 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([
            { kind: 'hit', unitId: entityId('a'), world: { x: 0, y: 0, z: 0 } },
        ]);
    });

    it('reports a hit when the blow was fatal', () => {
        // hp reaching 0 keeps the entity (the reducer clamps rather than deletes),
        // so the killing blow is a hp drop like any other and must not be lost to
        // an `isAlive` filter.
        const before = [unit('a', { x: 0, y: 0 }, { hp: 1 })];
        const after = [unit('a', { x: 0, y: 0 }, { hp: 0 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([
            { kind: 'hit', unitId: entityId('a'), world: { x: 0, y: 0, z: 0 } },
        ]);
    });

    it('reports nothing for hp that rose', () => {
        // Only damage is a hit. A heal or a re-projection that restores a value
        // is not, so the comparison is directional rather than an inequality.
        const before = [unit('a', { x: 0, y: 0 }, { hp: 1 })];
        const after = [unit('a', { x: 0, y: 0 }, { hp: 2 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([]);
    });

    it('reports both cues for a unit that moved and took damage in one delta', () => {
        // A revealed commitment turn applies several actions before the viewer
        // sees anything, so one delta can carry both. Neither may swallow the
        // other, and the order is fixed for determinism.
        const before = [unit('a', { x: 0, y: 0 }, { hp: 2 })];
        const after = [unit('a', { x: 1, y: 0 }, { hp: 1 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([
            { kind: 'move', unitId: entityId('a'), world: { x: 1, y: 0, z: 0 } },
            { kind: 'hit', unitId: entityId('a'), world: { x: 1, y: 0, z: 0 } },
        ]);
    });

    it('reports one cue per changed unit when a reveal moves several at once', () => {
        // Multiplicity is the reason this reads the delta rather than the event
        // list: two move events of the same `{ type }` are indistinguishable, two
        // moved units are not.
        const before = [unit('a', { x: 0, y: 0 }), unit('b', { x: 2, y: 0 })];
        const after = [unit('a', { x: 0, y: 1 }), unit('b', { x: 2, y: 1 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([
            { kind: 'move', unitId: entityId('a'), world: { x: 0, y: 0, z: 1 } },
            { kind: 'move', unitId: entityId('b'), world: { x: 2, y: 0, z: 1 } },
        ]);
    });

    it('reports nothing for a unit that only just became visible', () => {
        // Tactics units start `visibleTo` their owner alone, so an opponent
        // ENTERS the projection when it steps into reveal range. A delta can say
        // a unit is here; with no previous tile it cannot say the unit came from
        // anywhere, so there is no move to voice.
        const before = [unit('a', { x: 0, y: 0 })];
        const after = [unit('a', { x: 0, y: 0 }), unit('b', { x: 1, y: 0 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([]);
    });

    it('reports nothing for a unit that left the projection', () => {
        // The mirror: a unit dropping out of view has no tile to be heard on.
        const before = [unit('a', { x: 0, y: 0 }), unit('b', { x: 1, y: 0 })];
        const after = [unit('a', { x: 0, y: 0 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([]);
    });

    it('reads the delta by unit id rather than by list position', () => {
        // `parseTacticsSceneUnits` walks `Object.values(entities)`, whose order is
        // insertion order and not promised to hold across a projection. Pairing by
        // index would read this as two moves.
        const before = [unit('a', { x: 0, y: 0 }), unit('b', { x: 2, y: 0 })];
        const after = [unit('b', { x: 2, y: 0 }), unit('a', { x: 0, y: 0 })];

        expect(resolveTacticsSfxCues(before, after)).toEqual([]);
    });

    it('distinguishes the world axes of a move off both axes', () => {
        // `gridToWorldPoint` maps grid.y onto world Z. An on-axis fixture carries
        // zeros that hide a y/z swap in the emitted tuple.
        const before = [unit('a', { x: 0, y: 0 })];
        const after = [unit('a', { x: 3, y: -2 })];

        expect(resolveTacticsSfxCues(before, after)?.[0]?.world).toEqual({ x: 3, y: 0, z: -2 });
    });

    it('mutates neither list it was handed', () => {
        const before = [unit('a', { x: 0, y: 0 }, { hp: 2 })];
        const after = [unit('a', { x: 1, y: 0 }, { hp: 1 })];
        const beforeSnapshot = structuredClone(before);
        const afterSnapshot = structuredClone(after);

        resolveTacticsSfxCues(before, after);

        expect(before).toEqual(beforeSnapshot);
        expect(after).toEqual(afterSnapshot);
    });
});
