import { describe, expect, it } from 'vitest';
import { DEFAULT_UNDO_POLICY } from './UndoPolicy.js';
import type { UndoPolicy } from './UndoPolicy.js';

describe('UndoPolicy', () => {
    describe('DEFAULT_UNDO_POLICY', () => {
        it('allows undo by default', () => {
            expect(DEFAULT_UNDO_POLICY.allowUndo).toBe(true);
        });

        it('has unlimited undo steps within a turn (maxUndoSteps = 0)', () => {
            expect(DEFAULT_UNDO_POLICY.maxUndoSteps).toBe(0);
        });

        it('does not allow cross-turn undo by default', () => {
            expect(DEFAULT_UNDO_POLICY.crossTurnUndo).toBe(false);
        });

        it('satisfies the UndoPolicy interface', () => {
            const policy: UndoPolicy = DEFAULT_UNDO_POLICY;
            expect(policy).toBeDefined();
        });
    });
});
