/**
 * shared/game-shell-contract.test.ts
 *
 * Type-level and runtime unit tests for GameMainMenuDefinition contract types:
 * GameMenuCommandId, GameMainMenuLayout, GameMainMenuButton, GameMainMenuAction,
 * GameMainMenuDefinition.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 * Task: #616 (F51 — GameMainMenuDefinition contract types)
 *
 * Invariants upheld:
 *   #80 — shared contract types must not import from games/* or renderer/*
 *
 * Tests written first (TDD — red confirmed: module did not exist before
 * this commit; `pnpm test` reported "cannot find module").
 */

import { describe, it, expect } from 'vitest';
import type {
    GameMenuCommandId,
    GameMainMenuLayout,
    GameMainMenuButton,
    GameMainMenuAction,
    GameMainMenuDefinition,
} from './game-shell-contract.js';

// ─── GameMenuCommandId ────────────────────────────────────────────────────────

describe('GameMenuCommandId', () => {
    it('accepts a branded string cast', () => {
        const id = 'tactics:start-tutorial' as GameMenuCommandId;
        expect(id).toBe('tactics:start-tutorial');
    });

    it('rejects a plain string without cast at compile time', () => {
        // @ts-expect-error: GameMenuCommandId requires the branded cast; a plain string is not assignable
        const _: GameMenuCommandId = 'unbranded-id';
        expect(_).toBeDefined();
    });
});

// ─── GameMainMenuLayout ───────────────────────────────────────────────────────

describe('GameMainMenuLayout', () => {
    it('accepts a fully-specified layout', () => {
        const layout: GameMainMenuLayout = {
            orientation: 'vertical',
            align: 'center',
            anchor: 'center',
            offsetX: 0,
            offsetY: 0,
            gap: 8,
        };
        expect(layout.orientation).toBe('vertical');
        expect(layout.align).toBe('center');
        expect(layout.anchor).toBe('center');
    });

    it('accepts horizontal orientation', () => {
        const layout: GameMainMenuLayout = { orientation: 'horizontal' };
        expect(layout.orientation).toBe('horizontal');
    });

    it('accepts all anchor values', () => {
        const anchors: NonNullable<GameMainMenuLayout['anchor']>[] = [
            'center',
            'top',
            'bottom',
            'top-left',
            'top-right',
            'bottom-left',
            'bottom-right',
        ];
        for (const anchor of anchors) {
            const layout: GameMainMenuLayout = { anchor };
            expect(layout.anchor).toBe(anchor);
        }
    });

    it('accepts an empty layout (all optional, engine uses defaults)', () => {
        const layout: GameMainMenuLayout = {};
        expect(layout).toBeDefined();
    });

    it('rejects an invalid orientation at compile time', () => {
        // @ts-expect-error: 'diagonal' is not a valid orientation value
        const _: GameMainMenuLayout = { orientation: 'diagonal' };
        expect(_).toBeDefined();
    });

    it('rejects an invalid anchor at compile time', () => {
        // @ts-expect-error: 'left' is not a valid anchor value
        const _: GameMainMenuLayout = { anchor: 'left' };
        expect(_).toBeDefined();
    });
});

// ─── GameMainMenuAction ───────────────────────────────────────────────────────

describe('GameMainMenuAction', () => {
    it('navigate variant has type "navigate" and a target', () => {
        const action: GameMainMenuAction = { type: 'navigate', target: '/lobby' };
        expect(action.type).toBe('navigate');
        if (action.type === 'navigate') {
            expect(action.target).toBe('/lobby');
        }
    });

    it('quit variant has type "quit" only', () => {
        const action: GameMainMenuAction = { type: 'quit' };
        expect(action.type).toBe('quit');
    });

    it('open-lobby variant has type "open-lobby" only', () => {
        const action: GameMainMenuAction = { type: 'open-lobby' };
        expect(action.type).toBe('open-lobby');
    });

    it('command variant has type "command" and a branded commandId', () => {
        const commandId = 'tactics:start-campaign' as GameMenuCommandId;
        const action: GameMainMenuAction = { type: 'command', commandId };
        expect(action.type).toBe('command');
        if (action.type === 'command') {
            expect(action.commandId).toBe('tactics:start-campaign');
        }
    });

    it('discriminant narrows each variant correctly', () => {
        const actions: GameMainMenuAction[] = [
            { type: 'navigate', target: '/settings' },
            { type: 'quit' },
            { type: 'open-lobby' },
            { type: 'command', commandId: 'game:credits' as GameMenuCommandId },
        ];

        for (const action of actions) {
            switch (action.type) {
                case 'navigate':
                    expect(typeof action.target).toBe('string');
                    break;
                case 'quit':
                    expect(action.type).toBe('quit');
                    break;
                case 'open-lobby':
                    expect(action.type).toBe('open-lobby');
                    break;
                case 'command':
                    expect(typeof action.commandId).toBe('string');
                    break;
            }
        }
    });

    it('exhaustive switch — TypeScript errors at compile time if a variant is unhandled', () => {
        /**
         * If a new type is added to GameMainMenuAction without updating this
         * switch, TypeScript will error on `assertNever(action)` because
         * `action` will no longer be narrowed to `never`.
         * This test acts as a compile-time regression guard.
         */
        const assertNever = (x: never): never => {
            throw new Error(
                `Unhandled GameMainMenuAction type: ${String((x as { type: string }).type)}`,
            );
        };

        const describe_action = (action: GameMainMenuAction): string => {
            switch (action.type) {
                case 'navigate':
                    return `navigate to ${action.target}`;
                case 'quit':
                    return 'quit';
                case 'open-lobby':
                    return 'open-lobby';
                case 'command':
                    return `command: ${action.commandId}`;
                default:
                    return assertNever(action);
            }
        };

        expect(describe_action({ type: 'navigate', target: '/lobby' })).toBe('navigate to /lobby');
        expect(describe_action({ type: 'quit' })).toBe('quit');
        expect(describe_action({ type: 'open-lobby' })).toBe('open-lobby');
        expect(
            describe_action({
                type: 'command',
                commandId: 'tactics:credits' as GameMenuCommandId,
            }),
        ).toBe('command: tactics:credits');
    });

    it('rejects an invalid action type at compile time', () => {
        // @ts-expect-error: 'back' is not a valid GameMainMenuAction type
        const _: GameMainMenuAction = { type: 'back' };
        expect(_).toBeDefined();
    });

    it('rejects navigate action missing target at compile time', () => {
        // @ts-expect-error: navigate variant requires a target field
        const _: GameMainMenuAction = { type: 'navigate' };
        expect(_).toBeDefined();
    });

    it('rejects command action missing commandId at compile time', () => {
        // @ts-expect-error: command variant requires a commandId field
        const _: GameMainMenuAction = { type: 'command' };
        expect(_).toBeDefined();
    });
});

// ─── GameMainMenuButton ───────────────────────────────────────────────────────

describe('GameMainMenuButton', () => {
    it('accepts a fully-specified button', () => {
        const button: GameMainMenuButton = {
            label: 'Play',
            action: { type: 'navigate', target: '/lobby' },
            variant: 'primary',
        };
        expect(button.label).toBe('Play');
        expect(button.variant).toBe('primary');
    });

    it('accepts all variant values', () => {
        const variants: NonNullable<GameMainMenuButton['variant']>[] = [
            'primary',
            'secondary',
            'ghost',
            'danger',
        ];
        for (const variant of variants) {
            const button: GameMainMenuButton = {
                label: 'Test',
                action: { type: 'quit' },
                variant,
            };
            expect(button.variant).toBe(variant);
        }
    });

    it('accepts a button without optional variant (defaults to engine choice)', () => {
        const button: GameMainMenuButton = {
            label: 'Quit',
            action: { type: 'quit' },
        };
        expect(button.label).toBe('Quit');
        expect(button.variant).toBeUndefined();
    });

    it('rejects a button missing label at compile time', () => {
        // @ts-expect-error: GameMainMenuButton requires a label field
        const _: GameMainMenuButton = { action: { type: 'quit' } };
        expect(_).toBeDefined();
    });

    it('rejects a button missing action at compile time', () => {
        // @ts-expect-error: GameMainMenuButton requires an action field
        const _: GameMainMenuButton = { label: 'Play' };
        expect(_).toBeDefined();
    });

    it('rejects an invalid variant at compile time', () => {
        const _: GameMainMenuButton = {
            label: 'X',
            action: { type: 'quit' },
            // @ts-expect-error: 'info' is not a valid variant value
            variant: 'info',
        };
        expect(_).toBeDefined();
    });
});

// ─── GameMainMenuDefinition ───────────────────────────────────────────────────

describe('GameMainMenuDefinition', () => {
    it('accepts a full definition', () => {
        const def: GameMainMenuDefinition = {
            layout: {
                orientation: 'vertical',
                align: 'center',
                anchor: 'bottom',
                offsetY: -40,
                gap: 12,
            },
            buttons: [
                { label: 'Play', action: { type: 'open-lobby' } },
                { label: 'Settings', action: { type: 'navigate', target: '/settings' } },
                { label: 'Quit', action: { type: 'quit' }, variant: 'danger' },
            ],
        };
        expect(def.buttons).toHaveLength(3);
        expect(def.layout?.orientation).toBe('vertical');
    });

    it('accepts a definition with only buttons (layout optional)', () => {
        const def: GameMainMenuDefinition = {
            buttons: [{ label: 'Play', action: { type: 'open-lobby' } }],
        };
        expect(def.buttons).toHaveLength(1);
        expect(def.layout).toBeUndefined();
    });

    it('accepts an empty buttons array', () => {
        const def: GameMainMenuDefinition = { buttons: [] };
        expect(def.buttons).toHaveLength(0);
    });

    it('rejects a definition missing buttons at compile time', () => {
        // @ts-expect-error: GameMainMenuDefinition requires a buttons array
        const _: GameMainMenuDefinition = { layout: { orientation: 'vertical' } };
        expect(_).toBeDefined();
    });
});
