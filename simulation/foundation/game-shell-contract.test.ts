/**
 * shared/game-shell-contract.test.ts
 *
 * Type-level and runtime unit tests for GameMainMenuDefinition contract types:
 * GameMenuCommandId, GameMainMenuLayout, GameMainMenuButton, GameMainMenuAction,
 * GameMainMenuDefinition.
 *
 * Also tests GameSettingsPageDefinition contract types introduced in #625:
 * EngineSettingsFieldId, SettingsControlDefinition, SettingsItemDefinition,
 * SettingsSectionDefinition, SettingsTabDefinition, GameSettingsPageDefinition.
 *
 * Architecture reference: §4.37 — Renderer Shell Pages UI Contract
 * Task: #616 (F51 — GameMainMenuDefinition contract types)
 * Task: #625 (F52 — GameSettingsPageDefinition contract types)
 *
 * Invariants upheld:
 *   #80 — shared contract types must not import from games/* or renderer/*
 *   §4.13 — EngineSettingsFieldId mirrors documented EngineSettings paths
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
    GameFontDisplay,
    GameFontFace,
    GameFontStyle,
    EngineSettingsFieldId,
    SettingsControlDefinition,
    SettingsItemDefinition,
    SettingsSectionDefinition,
    SettingsTabDefinition,
    GameSettingsPageDefinition,
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

// ─── GameFontFace ────────────────────────────────────────────────────────────

describe('GameFontFace', () => {
    it('accepts a self-hosted game font declaration', () => {
        const font: GameFontFace = {
            family: 'Cinzel',
            src: 'tactics/fonts/Cinzel-Regular.woff2',
            weight: '400',
            style: 'normal',
            display: 'swap',
        };

        expect(font.family).toBe('Cinzel');
        expect(font.src).toBe('tactics/fonts/Cinzel-Regular.woff2');
    });

    it('accepts all documented font display values', () => {
        const displays: GameFontDisplay[] = ['auto', 'block', 'swap', 'fallback', 'optional'];

        for (const display of displays) {
            const font: GameFontFace = {
                family: 'Cinzel',
                src: 'tactics/fonts/Cinzel-Regular.woff2',
                display,
            };
            expect(font.display).toBe(display);
        }
    });

    it('accepts normal and italic font styles', () => {
        const styles: GameFontStyle[] = ['normal', 'italic'];

        for (const style of styles) {
            const font: GameFontFace = {
                family: 'Cinzel',
                src: 'tactics/fonts/Cinzel-Regular.woff2',
                style,
            };
            expect(font.style).toBe(style);
        }
    });

    it('rejects invalid font display values at compile time', () => {
        const font: GameFontFace = {
            family: 'Cinzel',
            src: 'tactics/fonts/Cinzel-Regular.woff2',
            // @ts-expect-error: 'instant' is not a valid FontFace display mode
            display: 'instant',
        };
        expect(font).toBeDefined();
    });

    it('rejects invalid font style values at compile time', () => {
        const font: GameFontFace = {
            family: 'Cinzel',
            src: 'tactics/fonts/Cinzel-Regular.woff2',
            // @ts-expect-error: 'oblique' is not part of the game font contract
            style: 'oblique',
        };
        expect(font).toBeDefined();
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

// ─── EngineSettingsFieldId ────────────────────────────────────────────────────

describe('EngineSettingsFieldId', () => {
    it('accepts all audio engine field ids', () => {
        const ids: EngineSettingsFieldId[] = [
            'audio.masterVolume',
            'audio.sfxVolume',
            'audio.musicVolume',
            'audio.muted',
        ];
        expect(ids).toHaveLength(4);
    });

    it('accepts all display engine field ids', () => {
        const ids: EngineSettingsFieldId[] = ['display.targetFps'];
        expect(ids).toHaveLength(1);
    });

    it('accepts all gameplay engine field ids', () => {
        const ids: EngineSettingsFieldId[] = [
            'gameplay.language',
            'gameplay.autoSave',
            'gameplay.autoSaveIntervalTurns',
            'gameplay.showHints',
            'gameplay.showPerfHud',
        ];
        expect(ids).toHaveLength(5);
    });

    it('accepts controls bindings engine field id', () => {
        const id: EngineSettingsFieldId = 'controls.bindings';
        expect(id).toBe('controls.bindings');
    });

    it('rejects a stale/invalid id at compile time (display.resolution)', () => {
        // @ts-expect-error: 'display.resolution' is not a valid EngineSettingsFieldId
        const _: EngineSettingsFieldId = 'display.resolution';
        expect(_).toBeDefined();
    });

    it('rejects a stale/invalid id at compile time (display.fpsLimit)', () => {
        // @ts-expect-error: 'display.fpsLimit' is not a valid EngineSettingsFieldId
        const _: EngineSettingsFieldId = 'display.fpsLimit';
        expect(_).toBeDefined();
    });

    it('rejects the UI-only controls rebind panel id at compile time', () => {
        // @ts-expect-error: 'controls.rebind' is not a documented EngineSettings path
        const _: EngineSettingsFieldId = 'controls.rebind';
        expect(_).toBeDefined();
    });

    it('rejects a game-specific path at compile time', () => {
        // @ts-expect-error: game-defined paths are not valid EngineSettingsFieldIds
        const _: EngineSettingsFieldId = 'tactics.difficulty';
        expect(_).toBeDefined();
    });

    it('rejects an arbitrary string at compile time', () => {
        // @ts-expect-error: bare arbitrary strings are not assignable to EngineSettingsFieldId
        const _: EngineSettingsFieldId = 'unknown.field';
        expect(_).toBeDefined();
    });
});

// ─── SettingsControlDefinition ────────────────────────────────────────────────

describe('SettingsControlDefinition', () => {
    it('accepts a slider control definition', () => {
        const ctrl: SettingsControlDefinition = { type: 'slider', min: 0, max: 1, step: 0.01 };
        expect(ctrl.type).toBe('slider');
        if (ctrl.type === 'slider') {
            expect(ctrl.min).toBe(0);
            expect(ctrl.max).toBe(1);
            expect(ctrl.step).toBe(0.01);
        }
    });

    it('accepts a toggle control definition', () => {
        const ctrl: SettingsControlDefinition = { type: 'toggle' };
        expect(ctrl.type).toBe('toggle');
    });

    it('accepts a select control definition with options', () => {
        const ctrl: SettingsControlDefinition = {
            type: 'select',
            options: [
                { value: '30', label: '30 FPS' },
                { value: '60', label: '60 FPS' },
                { value: '0', label: 'Uncapped' },
            ],
        };
        expect(ctrl.type).toBe('select');
        if (ctrl.type === 'select') {
            expect(ctrl.options).toHaveLength(3);
        }
    });

    it('accepts an empty options array for select', () => {
        const ctrl: SettingsControlDefinition = { type: 'select', options: [] };
        expect(ctrl.type).toBe('select');
    });

    it('accepts a key-binding control definition', () => {
        const ctrl: SettingsControlDefinition = { type: 'key-binding' };
        expect(ctrl.type).toBe('key-binding');
    });

    it('exhaustive switch — TypeScript errors if a variant is unhandled', () => {
        const assertNever = (x: never): never => {
            throw new Error(
                `Unhandled SettingsControlDefinition type: ${String((x as { type: string }).type)}`,
            );
        };

        const describeControl = (ctrl: SettingsControlDefinition): string => {
            switch (ctrl.type) {
                case 'slider':
                    return `slider ${ctrl.min}–${ctrl.max} step ${ctrl.step}`;
                case 'toggle':
                    return 'toggle';
                case 'select':
                    return `select (${ctrl.options.length} options)`;
                case 'key-binding':
                    return 'key-binding';
                default:
                    return assertNever(ctrl);
            }
        };

        expect(describeControl({ type: 'slider', min: 0, max: 1, step: 0.1 })).toBe(
            'slider 0–1 step 0.1',
        );
        expect(describeControl({ type: 'toggle' })).toBe('toggle');
        expect(describeControl({ type: 'select', options: [] })).toBe('select (0 options)');
        expect(describeControl({ type: 'key-binding' })).toBe('key-binding');
    });

    it('rejects an unknown control type at compile time', () => {
        // @ts-expect-error: 'dropdown' is not a valid SettingsControlDefinition type
        const _: SettingsControlDefinition = { type: 'dropdown', options: [] };
        expect(_).toBeDefined();
    });

    it('rejects slider missing required fields at compile time', () => {
        // @ts-expect-error: slider variant requires min, max, step
        const _: SettingsControlDefinition = { type: 'slider' };
        expect(_).toBeDefined();
    });

    it('rejects select missing options at compile time', () => {
        // @ts-expect-error: select variant requires options array
        const _: SettingsControlDefinition = { type: 'select' };
        expect(_).toBeDefined();
    });
});

// ─── SettingsItemDefinition ───────────────────────────────────────────────────

describe('SettingsItemDefinition', () => {
    it('accepts an engine-field item', () => {
        const item: SettingsItemDefinition = {
            kind: 'engine-field',
            fieldId: 'audio.masterVolume',
        };
        expect(item.kind).toBe('engine-field');
        if (item.kind === 'engine-field') {
            expect(item.fieldId).toBe('audio.masterVolume');
        }
    });

    it('accepts a game-field item with a slider control', () => {
        const item: SettingsItemDefinition = {
            kind: 'game-field',
            path: 'tactics.campaignDifficulty',
            label: 'Campaign Difficulty',
            control: { type: 'select', options: [{ value: 'normal', label: 'Normal' }] },
        };
        expect(item.kind).toBe('game-field');
        if (item.kind === 'game-field') {
            expect(item.path).toBe('tactics.campaignDifficulty');
            expect(item.label).toBe('Campaign Difficulty');
            expect(item.control.type).toBe('select');
        }
    });

    it('accepts a game-field item with a toggle control', () => {
        const item: SettingsItemDefinition = {
            kind: 'game-field',
            path: 'tactics.showFogOfWar',
            label: 'Fog of War',
            control: { type: 'toggle' },
        };
        expect(item.kind).toBe('game-field');
    });

    it('discriminant narrows each variant correctly', () => {
        const items: SettingsItemDefinition[] = [
            { kind: 'engine-field', fieldId: 'display.targetFps' },
            {
                kind: 'game-field',
                path: 'tactics.animSpeed',
                label: 'Animation Speed',
                control: { type: 'slider', min: 0, max: 2, step: 0.5 },
            },
        ];

        for (const item of items) {
            switch (item.kind) {
                case 'engine-field':
                    expect(typeof item.fieldId).toBe('string');
                    break;
                case 'game-field':
                    expect(typeof item.path).toBe('string');
                    expect(typeof item.label).toBe('string');
                    break;
            }
        }
    });

    it('rejects engine-field missing fieldId at compile time', () => {
        // @ts-expect-error: engine-field requires fieldId
        const _: SettingsItemDefinition = { kind: 'engine-field' };
        expect(_).toBeDefined();
    });

    it('rejects game-field missing required fields at compile time', () => {
        // @ts-expect-error: game-field requires path, label, and control
        const _: SettingsItemDefinition = { kind: 'game-field', path: 'x' };
        expect(_).toBeDefined();
    });

    it('rejects an unknown kind at compile time', () => {
        // @ts-expect-error: 'custom-field' is not a valid SettingsItemDefinition kind
        const _: SettingsItemDefinition = { kind: 'custom-field' };
        expect(_).toBeDefined();
    });
});

// ─── SettingsSectionDefinition ────────────────────────────────────────────────

describe('SettingsSectionDefinition', () => {
    it('accepts a fully-specified section', () => {
        const section: SettingsSectionDefinition = {
            id: 'volumes',
            label: 'Volumes',
            items: [
                { kind: 'engine-field', fieldId: 'audio.masterVolume' },
                { kind: 'engine-field', fieldId: 'audio.sfxVolume' },
            ],
        };
        expect(section.id).toBe('volumes');
        expect(section.label).toBe('Volumes');
        expect(section.items).toHaveLength(2);
    });

    it('accepts a section without an optional label', () => {
        const section: SettingsSectionDefinition = {
            id: 'volumes',
            items: [],
        };
        expect(section.id).toBe('volumes');
        expect(section.label).toBeUndefined();
    });

    it('accepts an empty items array', () => {
        const section: SettingsSectionDefinition = { id: 'empty', items: [] };
        expect(section.items).toHaveLength(0);
    });

    it('rejects a section missing id at compile time', () => {
        // @ts-expect-error: SettingsSectionDefinition requires id
        const _: SettingsSectionDefinition = { items: [] };
        expect(_).toBeDefined();
    });

    it('rejects a section missing items at compile time', () => {
        // @ts-expect-error: SettingsSectionDefinition requires items
        const _: SettingsSectionDefinition = { id: 'x' };
        expect(_).toBeDefined();
    });
});

// ─── SettingsTabDefinition ────────────────────────────────────────────────────

describe('SettingsTabDefinition', () => {
    it('accepts a fully-specified tab', () => {
        const tab: SettingsTabDefinition = {
            id: 'audio',
            label: 'Audio',
            sections: [
                {
                    id: 'volumes',
                    label: 'Volumes',
                    items: [{ kind: 'engine-field', fieldId: 'audio.masterVolume' }],
                },
            ],
        };
        expect(tab.id).toBe('audio');
        expect(tab.label).toBe('Audio');
        expect(tab.sections).toHaveLength(1);
    });

    it('accepts a tab with multiple sections', () => {
        const tab: SettingsTabDefinition = {
            id: 'display',
            label: 'Display',
            sections: [
                { id: 'screen', items: [{ kind: 'engine-field', fieldId: 'display.targetFps' }] },
                { id: 'perf', items: [{ kind: 'engine-field', fieldId: 'display.targetFps' }] },
            ],
        };
        expect(tab.sections).toHaveLength(2);
    });

    it('accepts a tab with an empty sections array', () => {
        const tab: SettingsTabDefinition = { id: 'empty-tab', label: 'Empty', sections: [] };
        expect(tab.sections).toHaveLength(0);
    });

    it('rejects a tab missing id at compile time', () => {
        // @ts-expect-error: SettingsTabDefinition requires id
        const _: SettingsTabDefinition = { label: 'Audio', sections: [] };
        expect(_).toBeDefined();
    });

    it('rejects a tab missing label at compile time', () => {
        // @ts-expect-error: SettingsTabDefinition requires label
        const _: SettingsTabDefinition = { id: 'audio', sections: [] };
        expect(_).toBeDefined();
    });

    it('rejects a tab missing sections at compile time', () => {
        // @ts-expect-error: SettingsTabDefinition requires sections
        const _: SettingsTabDefinition = { id: 'audio', label: 'Audio' };
        expect(_).toBeDefined();
    });
});

// ─── GameSettingsPageDefinition ───────────────────────────────────────────────

describe('GameSettingsPageDefinition', () => {
    it('accepts a full settings page definition with multiple tabs', () => {
        const def: GameSettingsPageDefinition = {
            tabs: [
                {
                    id: 'audio',
                    label: 'Audio',
                    sections: [
                        {
                            id: 'volumes',
                            items: [
                                { kind: 'engine-field', fieldId: 'audio.masterVolume' },
                                { kind: 'engine-field', fieldId: 'audio.sfxVolume' },
                                { kind: 'engine-field', fieldId: 'audio.musicVolume' },
                                { kind: 'engine-field', fieldId: 'audio.muted' },
                            ],
                        },
                    ],
                },
                {
                    id: 'display',
                    label: 'Display',
                    sections: [
                        {
                            id: 'screen',
                            items: [{ kind: 'engine-field', fieldId: 'display.targetFps' }],
                        },
                    ],
                },
                {
                    id: 'gameplay',
                    label: 'Gameplay',
                    sections: [
                        {
                            id: 'general',
                            items: [
                                { kind: 'engine-field', fieldId: 'gameplay.language' },
                                { kind: 'engine-field', fieldId: 'gameplay.autoSave' },
                                {
                                    kind: 'engine-field',
                                    fieldId: 'gameplay.autoSaveIntervalTurns',
                                },
                                { kind: 'engine-field', fieldId: 'gameplay.showHints' },
                                { kind: 'engine-field', fieldId: 'gameplay.showPerfHud' },
                            ],
                        },
                    ],
                },
                {
                    id: 'controls',
                    label: 'Controls',
                    sections: [
                        {
                            id: 'keybindings',
                            items: [{ kind: 'engine-field', fieldId: 'controls.bindings' }],
                        },
                    ],
                },
                {
                    id: 'game',
                    label: 'Game',
                    sections: [
                        {
                            id: 'tactics',
                            label: 'Tactics',
                            items: [
                                {
                                    kind: 'game-field',
                                    path: 'tactics.campaignDifficulty',
                                    label: 'Campaign Difficulty',
                                    control: {
                                        type: 'select',
                                        options: [
                                            { value: 'easy', label: 'Easy' },
                                            { value: 'normal', label: 'Normal' },
                                            { value: 'hard', label: 'Hard' },
                                        ],
                                    },
                                },
                                {
                                    kind: 'game-field',
                                    path: 'tactics.showFogOfWar',
                                    label: 'Fog of War',
                                    control: { type: 'toggle' },
                                },
                            ],
                        },
                    ],
                },
            ],
        };
        expect(def.tabs).toHaveLength(5);
        const audioTab = def.tabs.find((t) => t.id === 'audio');
        expect(audioTab?.id).toBe('audio');
        const gameTab = def.tabs.find((t) => t.id === 'game');
        const firstSection = gameTab?.sections[0];
        expect(firstSection?.items).toHaveLength(2);
    });

    it('accepts an empty tabs array', () => {
        const def: GameSettingsPageDefinition = { tabs: [] };
        expect(def.tabs).toHaveLength(0);
    });

    it('accepts a single-tab definition', () => {
        const def: GameSettingsPageDefinition = {
            tabs: [{ id: 'all', label: 'All Settings', sections: [] }],
        };
        expect(def.tabs).toHaveLength(1);
    });

    it('rejects a definition missing tabs at compile time', () => {
        // @ts-expect-error: GameSettingsPageDefinition requires tabs
        const _: GameSettingsPageDefinition = {};
        expect(_).toBeDefined();
    });
});
