// apps/tactics/shell/settings-page.ts
//
// Tactics settings page definition for the engine-owned settings shell.
//
// Architecture reference: section 4.13 Settings System, section 4.37.9 Settings page definition.
//
// Module boundary: games/* may import from simulation/, ai/, shared/, and own files.
// This module imports from shared/ only; it must never import from renderer/*.

import type { GameSettingsPageDefinition } from '@chimera-engine/simulation/foundation/game-shell-contract.js';

// Tab/section/field/option labels are `game.tactics.settings.*` translation
// tokens. They are stored as plain strings here — this data module is
// boundary-restricted (no renderer/i18n import) — and the engine settings shell
// resolves each label through `t()` at render (an identity for non-token text).
const ANIMATION_SPEED_OPTIONS = [
    { value: 'slow', label: 'game.tactics.settings.animSpeedSlow' },
    { value: 'normal', label: 'game.tactics.settings.animSpeedNormal' },
    { value: 'fast', label: 'game.tactics.settings.animSpeedFast' },
    { value: 'instant', label: 'game.tactics.settings.animSpeedInstant' },
] as const;

export const tacticsSettingsPageDefinition: GameSettingsPageDefinition = {
    tabs: [
        {
            id: 'audio',
            label: 'game.tactics.settings.tabAudio',
            sections: [
                {
                    id: 'audio',
                    label: 'game.tactics.settings.tabAudio',
                    items: [
                        { kind: 'engine-field', fieldId: 'audio.masterVolume' },
                        { kind: 'engine-field', fieldId: 'audio.sfxVolume' },
                        { kind: 'engine-field', fieldId: 'audio.musicVolume' },
                    ],
                },
            ],
        },
        {
            id: 'display',
            label: 'game.tactics.settings.tabDisplay',
            sections: [
                {
                    id: 'display',
                    label: 'game.tactics.settings.tabDisplay',
                    items: [
                        { kind: 'engine-field', fieldId: 'display.fullscreen' },
                        { kind: 'engine-field', fieldId: 'display.vsync' },
                        { kind: 'engine-field', fieldId: 'display.targetFps' },
                        { kind: 'engine-field', fieldId: 'display.uiScale' },
                    ],
                },
            ],
        },
        {
            id: 'gameplay',
            label: 'game.tactics.settings.tabGameplay',
            // A single section whose label matches the tab so no redundant caption
            // renders. Engine gameplay fields (e.g. gameplay.showPerfHud) are not
            // surfaced here — they are edited only via the settings file. The one
            // exception is the language selector, surfaced first so players can pick
            // the UI language from the settings page.
            sections: [
                {
                    id: 'gameplay',
                    label: 'game.tactics.settings.tabGameplay',
                    items: [
                        { kind: 'engine-field', fieldId: 'gameplay.language' },
                        {
                            kind: 'game-field',
                            path: 'showGrid',
                            label: 'game.tactics.settings.showGrid',
                            control: { type: 'toggle' },
                        },
                        {
                            kind: 'game-field',
                            path: 'animationSpeed',
                            label: 'game.tactics.settings.animationSpeed',
                            control: { type: 'select', options: ANIMATION_SPEED_OPTIONS },
                        },
                        {
                            kind: 'game-field',
                            path: 'showDamageNumbers',
                            label: 'game.tactics.settings.showDamageNumbers',
                            control: { type: 'toggle' },
                        },
                    ],
                },
            ],
        },
        {
            id: 'ai',
            label: 'game.tactics.settings.tabAi',
            sections: [
                {
                    id: 'tactics-ai',
                    label: 'game.tactics.settings.tabAi',
                    items: [
                        {
                            kind: 'game-field',
                            path: 'aiThinkingDelayMs',
                            label: 'game.tactics.settings.aiThinkingDelay',
                            control: { type: 'slider', min: 0, max: 5000, step: 100 },
                        },
                    ],
                },
            ],
        },
        {
            id: 'controls',
            label: 'game.tactics.settings.tabControls',
            sections: [
                {
                    id: 'controls',
                    label: 'game.tactics.settings.tabControls',
                    items: [{ kind: 'engine-field', fieldId: 'controls.bindings' }],
                },
            ],
        },
    ],
} as const;
