/**
 * renderer/input/InputAction.test.ts
 *
 * Type-level and runtime unit tests for InputAction core types:
 * InputActionId, InputAction, RebindResult, InputEvent.
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Task: #572 (F40 — core input types)
 *
 * Invariants upheld:
 *   #65 — InputManager is renderer-only; these types must never be
 *           imported by simulation/ or ai/.
 *
 * Tests written first (TDD — red confirmed: module did not exist before
 * this commit; `pnpm test` reported "cannot find module").
 */

import { describe, it, expect } from 'vitest';
import type { InputActionId, InputAction, RebindResult, InputEvent } from './InputAction.js';

// ─── InputActionId ────────────────────────────────────────────────────────────

describe('InputActionId', () => {
    it('accepts an engine-namespaced id', () => {
        const id: InputActionId = 'engine:undo';
        expect(id).toBe('engine:undo');
    });

    it('accepts a game-namespaced id', () => {
        const id: InputActionId = 'game:end-turn';
        expect(id).toBe('game:end-turn');
    });

    it('rejects a bare string without a namespace prefix', () => {
        // @ts-expect-error: InputActionId requires engine: or game: prefix
        const _: InputActionId = 'undo';
        expect(_).toBeDefined();
    });

    it('rejects an unknown namespace prefix', () => {
        // @ts-expect-error: InputActionId requires engine: or game: prefix; 'ui:' is invalid
        const _: InputActionId = 'ui:open-menu';
        expect(_).toBeDefined();
    });
});

// ─── InputAction ──────────────────────────────────────────────────────────────

describe('InputAction', () => {
    it('conforming object satisfies the interface', () => {
        const action: InputAction = {
            id: 'engine:undo',
            description: 'Undo the last move',
            category: 'UI',
            oneShot: true,
        };
        expect(action.id).toBe('engine:undo');
        expect(action.description).toBe('Undo the last move');
        expect(action.category).toBe('UI');
        expect(action.oneShot).toBe(true);
    });

    it('accepts a game-namespaced id', () => {
        const action: InputAction = {
            id: 'game:end-turn',
            description: 'End the current turn',
            category: 'Game',
            oneShot: false,
        };
        expect(action.id).toBe('game:end-turn');
        expect(action.oneShot).toBe(false);
    });

    it('rejects a missing id at compile time', () => {
        // @ts-expect-error: InputAction requires an id field
        const _: InputAction = {
            description: 'Missing id',
            category: 'UI',
            oneShot: true,
        };
        expect(_).toBeDefined();
    });
});

// ─── RebindResult ─────────────────────────────────────────────────────────────

describe('RebindResult', () => {
    it('ok variant has ok=true', () => {
        const result: RebindResult = { ok: true };
        expect(result.ok).toBe(true);
    });

    it('conflict variant has ok=false, reason="conflict", and conflictingAction', () => {
        const result: RebindResult = {
            ok: false,
            reason: 'conflict',
            conflictingAction: 'engine:redo',
        };
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('conflict');
            expect(result.conflictingAction).toBe('engine:redo');
        }
    });

    it('discriminant narrows ok variant to { ok: true }', () => {
        const result: RebindResult = { ok: true };
        if (result.ok) {
            // TypeScript narrows to { ok: true } — conflictingAction must not exist
            expect(result.ok).toBe(true);
        }
    });

    it('discriminant narrows conflict variant — conflictingAction accessible', () => {
        const result: RebindResult = {
            ok: false,
            reason: 'conflict',
            conflictingAction: 'game:cycle-unit',
        };
        if (!result.ok) {
            expect(result.conflictingAction).toBe('game:cycle-unit');
        }
    });

    it('supports a typed persistence-failure variant', () => {
        const result: RebindResult = {
            ok: false,
            reason: 'persist_failed',
        };

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.reason).toBe('persist_failed');
        }
    });

    it('exhaustive switch on ok compiles cleanly over both variants', () => {
        const assertNever = (x: never): never => {
            throw new Error(`Unhandled RebindResult: ${JSON.stringify(x)}`);
        };

        // Switch on the primary discriminant `ok`.
        // After handling both `true` and `false`, TypeScript narrows `r` in
        // the default branch to `never`, confirming the union is exhaustive.
        const classify = (r: RebindResult): string => {
            switch (r.ok) {
                case true:
                    return 'success';
                case false:
                    if (r.reason === 'conflict') {
                        return `conflict with ${r.conflictingAction}`;
                    }
                    if (r.reason === 'persist_failed') {
                        return 'persist failed';
                    }
                    return assertNever(r);
                default:
                    return assertNever(r);
            }
        };

        expect(classify({ ok: true })).toBe('success');
        expect(classify({ ok: false, reason: 'conflict', conflictingAction: 'engine:undo' })).toBe(
            'conflict with engine:undo',
        );
        expect(classify({ ok: false, reason: 'persist_failed' })).toBe('persist failed');
    });

    it('rejects conflict variant missing conflictingAction at compile time', () => {
        // @ts-expect-error: conflict variant requires a conflictingAction field
        const _: RebindResult = { ok: false, reason: 'conflict' };
        expect(_).toBeDefined();
    });

    it('rejects persist_failed variant containing conflictingAction at compile time', () => {
        const _: RebindResult = {
            ok: false,
            reason: 'persist_failed',
            // @ts-expect-error: persist_failed variant must not include conflictingAction
            conflictingAction: 'engine:undo',
        };
        expect(_).toBeDefined();
    });
});

// ─── InputEvent ───────────────────────────────────────────────────────────────

describe('InputEvent', () => {
    it('conforming object satisfies the interface', () => {
        const event: InputEvent = {
            actionId: 'engine:undo',
            code: 'KeyZ',
            modifiers: ['Ctrl'],
            repeat: false,
            pressed: true,
            timestamp: 1000,
        };
        expect(event.actionId).toBe('engine:undo');
        expect(event.code).toBe('KeyZ');
        expect(event.modifiers).toEqual(['Ctrl']);
        expect(event.repeat).toBe(false);
        expect(event.pressed).toBe(true);
        expect(event.timestamp).toBe(1000);
    });

    it('accepts empty modifiers array', () => {
        const event: InputEvent = {
            actionId: 'game:end-turn',
            code: 'Enter',
            modifiers: [],
            repeat: false,
            pressed: true,
            timestamp: 2000,
        };
        expect(event.modifiers).toHaveLength(0);
    });

    it('rejects a missing actionId at compile time', () => {
        // @ts-expect-error: InputEvent requires an actionId field
        const _: InputEvent = {
            code: 'KeyZ',
            modifiers: [],
            repeat: false,
            pressed: true,
            timestamp: 1000,
        };
        expect(_).toBeDefined();
    });
});
