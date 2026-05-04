/**
 * simulation/engine/index.test.ts
 *
 * Barrel surface contract tests — verifies that every class that forms part of
 * the public ActionPipeline contract is re-exported through the engine barrel.
 *
 * WARN-1 regression guard: ForbiddenDispatchError must be accessible from the
 * barrel so that host-side error handling in electron/main can do
 * `instanceof ForbiddenDispatchError` without importing from ActionPipeline.ts
 * directly.
 *
 * Tests written first (red) before the barrel export was added.
 */

import { describe, it, expect } from 'vitest';
import {
    ForbiddenDispatchError,
    RecursiveDispatchError,
    StaleActionError,
    ActionUnauthorizedError,
} from './index.js';

describe('simulation/engine barrel — error class exports', () => {
    it('exports ForbiddenDispatchError (WARN-1)', () => {
        const err = new ForbiddenDispatchError('test:action');
        expect(err).toBeInstanceOf(ForbiddenDispatchError);
        expect(err.code).toBe('FORBIDDEN_DISPATCH');
        expect(err.actionType).toBe('test:action');
        expect(err.message).toContain('test:action');
    });

    it('ForbiddenDispatchError instanceof chain is intact across barrel re-export', () => {
        const err = new ForbiddenDispatchError('game:move');
        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(ForbiddenDispatchError);
        expect(err.name).toBe('ForbiddenDispatchError');
    });

    it('RecursiveDispatchError is still exported from the barrel', () => {
        const err = new RecursiveDispatchError(16);
        expect(err).toBeInstanceOf(RecursiveDispatchError);
        expect(err.code).toBe('RECURSIVE_DISPATCH');
    });

    it('StaleActionError is still exported from the barrel', () => {
        const err = new StaleActionError(3, 5);
        expect(err).toBeInstanceOf(StaleActionError);
        expect(err.code).toBe('STALE_ACTION');
    });

    it('ActionUnauthorizedError is still exported from the barrel', () => {
        const err = new ActionUnauthorizedError('game:test', 'not_allowed');
        expect(err).toBeInstanceOf(ActionUnauthorizedError);
        expect(err.code).toBe('ACTION_UNAUTHORIZED');
    });
});
