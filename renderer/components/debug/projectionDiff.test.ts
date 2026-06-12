// renderer/components/debug/projectionDiff.test.ts
//
// Unit tests for the renderer-local projection diff walk (§4.12, F47 T9,
// #698). Pure function — node environment, no jsdom pragma.

import { describe, expect, it } from 'vitest';

import { computeProjectionDiff } from './projectionDiff';

describe('computeProjectionDiff', () => {
    it('returns empty highlight maps for identical trees', () => {
        const value = { tick: 5, players: { 'player-a': { gold: 10 } } };

        const diff = computeProjectionDiff(value, { ...value });

        expect(diff.fullHighlights.size).toBe(0);
        expect(diff.projectionHighlights.size).toBe(0);
    });

    it('marks a key present only in the full snapshot as hidden', () => {
        const diff = computeProjectionDiff({ tick: 5, seed: 42 }, { tick: 5 });

        expect(diff.fullHighlights.get('seed')).toBe('hidden');
        expect(diff.projectionHighlights.size).toBe(0);
    });

    it('marks a key present only in the projection as extra', () => {
        const diff = computeProjectionDiff({ tick: 5 }, { tick: 5, viewerId: 'player-a' });

        expect(diff.projectionHighlights.get('viewerId')).toBe('extra');
        expect(diff.fullHighlights.size).toBe(0);
    });

    it('marks unequal leaves as masked in both maps', () => {
        const diff = computeProjectionDiff(
            { players: { 'player-a': { gold: 10 } } },
            { players: { 'player-a': { gold: 0 } } },
        );

        expect(diff.fullHighlights.get('players.player-a.gold')).toBe('masked');
        expect(diff.projectionHighlights.get('players.player-a.gold')).toBe('masked');
    });

    it('marks only the subtree root when a nested composite is hidden', () => {
        const diff = computeProjectionDiff(
            { entities: { 'e-1': { hp: 5, pos: { x: 1 } } } },
            { entities: {} },
        );

        expect(diff.fullHighlights.get('entities.e-1')).toBe('hidden');
        expect(diff.fullHighlights.has('entities.e-1.hp')).toBe(false);
        expect(diff.fullHighlights.has('entities.e-1.pos')).toBe(false);
    });

    it('marks trailing array items as hidden when the projection array is shorter', () => {
        const diff = computeProjectionDiff({ events: [1, 2, 3] }, { events: [1] });

        expect(diff.fullHighlights.get('events.1')).toBe('hidden');
        expect(diff.fullHighlights.get('events.2')).toBe('hidden');
        expect(diff.fullHighlights.has('events.0')).toBe(false);
    });

    it('marks a composite-vs-leaf mismatch as masked at that path', () => {
        const diff = computeProjectionDiff({ resources: { wood: 3 } }, { resources: 0 });

        expect(diff.fullHighlights.get('resources')).toBe('masked');
        expect(diff.projectionHighlights.get('resources')).toBe('masked');
    });

    it('marks an array-vs-record mismatch as masked at that path', () => {
        const diff = computeProjectionDiff({ items: [1] }, { items: { 0: 1 } });

        expect(diff.fullHighlights.get('items')).toBe('masked');
        expect(diff.projectionHighlights.get('items')).toBe('masked');
    });

    it('marks unequal root leaves as masked at the root path', () => {
        const diff = computeProjectionDiff(1, 2);

        expect(diff.fullHighlights.get('')).toBe('masked');
        expect(diff.projectionHighlights.get('')).toBe('masked');
    });
});
