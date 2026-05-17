/**
 * renderer/input/InputBindingSchema.test.ts
 *
 * Type-level and runtime unit tests for InputBindingSchema types:
 * KeyBinding, EngineBindings, GameBindingSchema<T>.
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Task: #572 (F40 — core input types)
 *
 * Invariants upheld:
 *   #65 — InputManager is renderer-only; these types must never be
 *           imported by simulation/ or ai/.
 *   #66 — Key bindings are settings, not profile data; stored under
 *           settings.controls.bindings as EngineBindings.
 *
 * Tests written first (TDD — red confirmed: module did not exist before
 * this commit; `pnpm test` reported "cannot find module").
 */

import { describe, it, expect } from 'vitest';
import type { KeyBinding, EngineBindings, GameBindingSchema } from './InputBindingSchema.js';
import type { EngineSettings } from '@chimera/simulation/settings/index.js';

// ─── KeyBinding ───────────────────────────────────────────────────────────────

describe('KeyBinding', () => {
    it('conforming object with only primary satisfies the interface', () => {
        const binding: KeyBinding = { primary: 'KeyZ' };
        expect(binding.primary).toBe('KeyZ');
        expect(binding.secondary).toBeUndefined();
        expect(binding.modifiers).toBeUndefined();
    });

    it('accepts secondary and modifiers when provided', () => {
        const binding: KeyBinding = {
            primary: 'KeyZ',
            secondary: 'KeyY',
            modifiers: ['Ctrl'],
        };
        expect(binding.primary).toBe('KeyZ');
        expect(binding.secondary).toBe('KeyY');
        expect(binding.modifiers).toEqual(['Ctrl']);
    });

    it('accepts all recognised modifier keys', () => {
        const binding: KeyBinding = {
            primary: 'KeyZ',
            modifiers: ['Ctrl', 'Shift', 'Alt', 'Meta'],
        };
        expect(binding.modifiers).toHaveLength(4);
    });

    it('rejects an unknown modifier at compile time', () => {
        // @ts-expect-error: 'Win' is not a recognised modifier
        const _: KeyBinding = { primary: 'KeyZ', modifiers: ['Win'] };
        expect(_).toBeDefined();
    });

    it('rejects a missing primary at compile time', () => {
        // @ts-expect-error: KeyBinding requires a primary field
        const _: KeyBinding = { secondary: 'KeyY' };
        expect(_).toBeDefined();
    });
});

// ─── EngineBindings ───────────────────────────────────────────────────────────

describe('EngineBindings', () => {
    it('accepts a record keyed by engine-namespaced InputActionIds', () => {
        const bindings: EngineBindings = {
            'engine:undo': { primary: 'KeyZ', modifiers: ['Ctrl'] },
            'engine:redo': { primary: 'KeyZ', modifiers: ['Ctrl', 'Shift'] },
            'engine:toggle-menu': { primary: 'Escape' },
            'engine:toggle-perf-hud': { primary: 'F3' },
        };
        expect(bindings['engine:undo']?.primary).toBe('KeyZ');
        expect(bindings['engine:toggle-menu']?.primary).toBe('Escape');
    });

    it('accepts a record keyed by game-namespaced InputActionIds', () => {
        const bindings: EngineBindings = {
            'game:end-turn': { primary: 'Enter' },
            'game:cycle-unit': { primary: 'Tab' },
        };
        expect(bindings['game:end-turn']?.primary).toBe('Enter');
    });

    it('accepts mixed engine and game keys', () => {
        const bindings: EngineBindings = {
            'engine:undo': { primary: 'KeyZ', modifiers: ['Ctrl'] },
            'game:end-turn': { primary: 'Enter' },
        };
        expect(Object.keys(bindings)).toHaveLength(2);
    });
});

// ─── GameBindingSchema ────────────────────────────────────────────────────────

describe('GameBindingSchema', () => {
    it('accepts an EngineBindings-compatible record', () => {
        interface TacticsBindings {
            readonly 'engine:undo': KeyBinding;
            readonly 'game:end-turn': KeyBinding;
        }

        const schema: GameBindingSchema<TacticsBindings> = {
            'engine:undo': { primary: 'KeyZ', modifiers: ['Ctrl'] },
            'game:end-turn': { primary: 'Enter' },
        };

        expect(schema['engine:undo'].primary).toBe('KeyZ');
        expect(schema['game:end-turn'].primary).toBe('Enter');
    });

    it('is structurally identical to T — GameBindingSchema<T> = T', () => {
        interface SimpleBindings {
            readonly 'engine:undo': KeyBinding;
        }

        const schema: GameBindingSchema<SimpleBindings> = {
            'engine:undo': { primary: 'KeyZ' },
        };

        // The value is assignable back to SimpleBindings directly
        const retyped: SimpleBindings = schema;
        expect(retyped['engine:undo'].primary).toBe('KeyZ');
    });
});

// ─── Structural compatibility guard (WARN-2 fix) ──────────────────────────────
//
// `simulation/settings/SettingsSchema.ts` cannot import KeyBinding (module boundary
// Invariant #65), so it re-declares the binding shape inline.  These type-level
// assertions catch any future drift between the two definitions at compile time.
//
// If either assertion produces a TS2322 error, the inline type in SettingsSchema.ts
// must be updated to match KeyBinding (or vice versa).

describe('EngineSettings.controls.bindings ↔ KeyBinding structural compatibility', () => {
    it('EngineSettings inline binding shape extends KeyBinding (no extra required fields)', () => {
        // `_BindingEntry` is the value type of the bindings record in EngineSettings.
        // With noUncheckedIndexedAccess, indexing a Record returns T | undefined;
        // NonNullable strips the undefined so we compare the bare struct.
        type _BindingEntry = NonNullable<EngineSettings['controls']['bindings'][string]>;

        // EngineSettings inline type must be assignable to KeyBinding.
        // A compile error here means the inline struct added a field not present in KeyBinding.
        type _InlineExtendsKeyBinding = _BindingEntry extends KeyBinding ? true : never;
        const _assertForward: _InlineExtendsKeyBinding = true;
        void _assertForward;

        // KeyBinding must be assignable to the EngineSettings inline type.
        // A compile error here means KeyBinding added a required field the inline struct lacks.
        type _KeyBindingExtendsInline = KeyBinding extends _BindingEntry ? true : never;
        const _assertReverse: _KeyBindingExtendsInline = true;
        void _assertReverse;

        // Runtime no-op: this describe block exists for the compile-time assertions above.
        expect(true).toBe(true);
    });
});
