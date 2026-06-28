// apps/tactics/shell/settings-page.ts
//
// Tactics settings page definition for the engine-owned settings shell.
//
// Architecture reference: section 4.13 Settings System, section 4.37.9 Settings page definition.
// Task: #629
//
// Module boundary: games/* may import from simulation/, ai/, shared/, and own files.
// This module imports from shared/ only; it must never import from renderer/*.

import type { GameSettingsPageDefinition } from '@chimera-engine/simulation/foundation/game-shell-contract.js';

const ANIMATION_SPEED_OPTIONS = [
    { value: 'slow', label: 'Slow' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
    { value: 'instant', label: 'Instant' },
] as const;

export const tacticsSettingsPageDefinition: GameSettingsPageDefinition = {
    tabs: [
        {
            id: 'audio',
            label: 'Audio',
            sections: [
                {
                    id: 'audio',
                    label: 'Audio',
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
            label: 'Display',
            sections: [
                {
                    id: 'display',
                    label: 'Display',
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
            label: 'Gameplay',
            sections: [
                {
                    id: 'engine-gameplay',
                    label: 'Engine',
                    items: [{ kind: 'engine-field', fieldId: 'gameplay.showPerfHud' }],
                },
                {
                    id: 'tactics-gameplay',
                    label: 'Tactics',
                    items: [
                        {
                            kind: 'game-field',
                            path: 'showGrid',
                            label: 'Show Grid',
                            control: { type: 'toggle' },
                        },
                        {
                            kind: 'game-field',
                            path: 'animationSpeed',
                            label: 'Animation Speed',
                            control: { type: 'select', options: ANIMATION_SPEED_OPTIONS },
                        },
                        {
                            kind: 'game-field',
                            path: 'showDamageNumbers',
                            label: 'Show Damage Numbers',
                            control: { type: 'toggle' },
                        },
                    ],
                },
            ],
        },
        {
            id: 'ai',
            label: 'AI',
            sections: [
                {
                    id: 'tactics-ai',
                    label: 'AI',
                    items: [
                        {
                            kind: 'game-field',
                            path: 'aiThinkingDelayMs',
                            label: 'AI Thinking Delay',
                            control: { type: 'slider', min: 0, max: 5000, step: 100 },
                        },
                    ],
                },
            ],
        },
        {
            id: 'controls',
            label: 'Controls',
            sections: [
                {
                    id: 'controls',
                    label: 'Controls',
                    items: [{ kind: 'engine-field', fieldId: 'controls.bindings' }],
                },
            ],
        },
    ],
} as const;
