/**
 * simulation/engine/RecursiveDispatchError.test.ts
 *
 * TDD tests for the dedicated RecursiveDispatchError module.
 *
 * Architecture reference: §4.7, §4.20
 * Task: F21 (issue #405)
 *
 * Tests written FIRST (red) before RecursiveDispatchError.ts exists.
 * Acceptance criteria from issue #405:
 *   1. MAX_NESTED_DISPATCH is exported as 16 from RecursiveDispatchError.ts.
 *   2. RecursiveDispatchError is an Error subclass.
 *   3. RecursiveDispatchError.code is 'RECURSIVE_DISPATCH'.
 *   4. RecursiveDispatchError.depth carries the depth value from the constructor.
 *   5. Error message includes the depth and MAX_NESTED_DISPATCH hint.
 */

import { describe, it, expect } from 'vitest';
import { RecursiveDispatchError, MAX_NESTED_DISPATCH } from './RecursiveDispatchError.js';

// ─── MAX_NESTED_DISPATCH constant ────────────────────────────────────────────

describe('MAX_NESTED_DISPATCH', () => {
    it('equals 16', () => {
        expect(MAX_NESTED_DISPATCH).toBe(16);
    });
});

// ─── RecursiveDispatchError shape ────────────────────────────────────────────

describe('RecursiveDispatchError', () => {
    it('is an Error subclass', () => {
        expect(new RecursiveDispatchError(16)).toBeInstanceOf(Error);
    });

    it('has code RECURSIVE_DISPATCH', () => {
        expect(new RecursiveDispatchError(16).code).toBe('RECURSIVE_DISPATCH');
    });

    it('exposes the depth passed to the constructor', () => {
        expect(new RecursiveDispatchError(5).depth).toBe(5);
        expect(new RecursiveDispatchError(16).depth).toBe(16);
    });

    it('name is RecursiveDispatchError', () => {
        expect(new RecursiveDispatchError(16).name).toBe('RecursiveDispatchError');
    });

    it('message references the depth and MAX_NESTED_DISPATCH', () => {
        const err = new RecursiveDispatchError(7);
        expect(err.message).toContain('7');
        expect(err.message).toContain('16');
    });

    it('instanceof check works across prototype chains (Object.setPrototypeOf)', () => {
        const err = new RecursiveDispatchError(16);
        expect(err).toBeInstanceOf(RecursiveDispatchError);
        expect(err).toBeInstanceOf(Error);
    });
});
