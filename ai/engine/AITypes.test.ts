/**
 * ai/engine/AITypes.test.ts
 *
 * Type-level tests for AITypes shared types.
 *
 * Architecture reference: §4.9 — AI Framework and Agent System
 *
 * Invariants upheld:
 *   #18 — AIParams are passed by value (frozen); restricting fields to
 *          primitives makes shallow Object.freeze complete (no unfrozen
 *          nested references possible).
 *
 * Tests written first (TDD — red confirmed via `pnpm typecheck` before
 * implementation: @ts-expect-error directives below are initially unused
 * and cause a typecheck error until the type constraint is tightened).
 */

import { describe, it, expect } from 'vitest';
import type { AIParams, PlayerSnapshot } from './AITypes.js';
import type { PlayerSnapshot as CanonicalPlayerSnapshot } from '@chimera-engine/simulation/projection/StateProjector.js';

// ─── AIParams type constraints ────────────────────────────────────────────────

describe('AIParams', () => {
    it('accepts primitive number fields', () => {
        const params: AIParams = { aggressivity: 0.5 };
        expect(params).toBeDefined();
    });

    it('accepts primitive string fields', () => {
        const params: AIParams = { strategy: 'defensive' };
        expect(params).toBeDefined();
    });

    it('accepts primitive boolean fields', () => {
        const params: AIParams = { enabled: true };
        expect(params).toBeDefined();
    });

    it('accepts undefined (optional) fields', () => {
        const params: AIParams = { maybeField: undefined };
        expect(params).toBeDefined();
    });

    it('accepts null fields', () => {
        const params: AIParams = { maybeField: null };
        expect(params).toBeDefined();
    });

    it('rejects array-valued fields (Invariant #18 — shallow-freeze completeness)', () => {
        // @ts-expect-error: AIParams must not accept array-valued fields; a shallow
        // Object.freeze would leave the array contents unfrozen, violating Invariant #18.
        const _: AIParams = { preferredUnits: ['a', 'b'] };
        expect(_).toBeDefined();
    });

    it('rejects nested-object fields (Invariant #18 — shallow-freeze completeness)', () => {
        // @ts-expect-error: AIParams must not accept object-valued fields; a shallow
        // Object.freeze would leave nested objects unfrozen, violating Invariant #18.
        const _: AIParams = { nested: { value: 1 } };
        expect(_).toBeDefined();
    });
});

// ─── PlayerSnapshot unification (WARN-1) ──────────────────────────────────────

describe('PlayerSnapshot', () => {
    it('should be the canonical type from StateProjector', () => {
        // WARN-1: PlayerSnapshot must be imported from StateProjector (canonical F26 definition),
        // not defined locally as a stub. This type-level assertion ensures the AI's PlayerSnapshot
        // is structurally compatible with the canonical definition.
        const _canary: PlayerSnapshot = {} as CanonicalPlayerSnapshot;
        expect(_canary).toBeDefined();
    });
});
