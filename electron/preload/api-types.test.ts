/**
 * electron/preload/api-types.test.ts
 *
 * Unit tests for the SlotId branded type and its constructor helper.
 * Written first (red) per TDD mandate — toSlotId does not exist yet.
 *
 * Reference: TypeScript §1.3 (branded types).
 */

import { describe, expect, it } from 'vitest';
import { gamePhase, playerId, toSlotId } from './api-types.js';
import type { PlayerSnapshot, SlotId } from './api-types.js';

describe('toSlotId', () => {
    it('wraps a raw string as a SlotId', () => {
        const id = toSlotId('slot-abc');
        expect(id).toBe('slot-abc');
    });

    it('result is assignable to string', () => {
        const id: SlotId = toSlotId('slot-xyz');
        const s: string = id;
        expect(s).toBe('slot-xyz');
    });

    it('preserves the raw string value including empty string', () => {
        expect(toSlotId('')).toBe('');
    });

    it('preserves non-trivial slot identifier strings', () => {
        const raw = 'autosave-2026-04-30T12:34:56.789Z';
        expect(toSlotId(raw)).toBe(raw);
    });
});

describe('PlayerSnapshot', () => {
    it('carries gameResult across the preload boundary', () => {
        const viewerId = playerId('p1');
        const snapshot: PlayerSnapshot = {
            tick: 3,
            viewerId,
            players: { [viewerId]: { id: viewerId } },
            entities: {},
            phase: gamePhase('ended'),
            events: [],
            commitments: {},
            gameResult: { winnerIds: [viewerId] },
            undoMeta: { canUndo: false, canRedo: false },
            isMyTurn: true,
        };

        expect(snapshot.gameResult?.winnerIds).toEqual([viewerId]);
    });
});
