// apps/tactics/shell/settings-page.test.ts
//
// Unit tests for the Tactics settings page definition.
// Written first (TDD - red confirmed before implementation).
//
// Architecture reference: section 4.13 Settings System, section 4.37.9 Settings page definition.
// Task: #629
//
// Module boundary enforced by import statements below:
//   - apps/tactics/shell/ may import from shared/ and own Tactics files only.

import { describe, expect, it } from 'vitest';
import type {
    GameSettingsPageDefinition,
    SettingsItemDefinition,
    SettingsTabDefinition,
} from '@chimera-engine/simulation/foundation/game-shell-contract.js';
import { TACTICS_DEFAULTS, tacticsSettingsSchema } from '../settings-schema';
import { tacticsSettingsPageDefinition } from './settings-page';

const EXPECTED_ANIMATION_SPEED_OPTIONS = [
    { value: 'slow', label: 'Slow' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
    { value: 'instant', label: 'Instant' },
] as const;

function findTab(tabId: string): SettingsTabDefinition {
    const tab = tacticsSettingsPageDefinition.tabs.find((candidate) => candidate.id === tabId);
    if (tab === undefined) {
        throw new Error(`Expected settings tab '${tabId}' to be defined.`);
    }
    return tab;
}

function tabItems(tabId: string): readonly SettingsItemDefinition[] {
    return findTab(tabId).sections.flatMap((section) => section.items);
}

function engineFieldsForTab(tabId: string): string[] {
    return tabItems(tabId).flatMap((item) => (item.kind === 'engine-field' ? [item.fieldId] : []));
}

function gameFieldsForTab(tabId: string): string[] {
    return tabItems(tabId).flatMap((item) => (item.kind === 'game-field' ? [item.path] : []));
}

function allItems(): readonly SettingsItemDefinition[] {
    return tacticsSettingsPageDefinition.tabs.flatMap((tab) =>
        tab.sections.flatMap((section) => section.items),
    );
}

function findGameField(path: string): Extract<SettingsItemDefinition, { kind: 'game-field' }> {
    const item = allItems().find((candidate) =>
        candidate.kind === 'game-field' ? candidate.path === path : false,
    );
    if (item?.kind !== 'game-field') {
        throw new Error(`Expected game settings field '${path}' to be defined.`);
    }
    return item;
}

describe('tacticsSettingsPageDefinition', () => {
    it('is a GameSettingsPageDefinition', () => {
        const definition: GameSettingsPageDefinition = tacticsSettingsPageDefinition;

        expect(definition.tabs).toHaveLength(5);
    });

    it('defines the expected five tabs in order', () => {
        expect(tacticsSettingsPageDefinition.tabs.map((tab) => [tab.id, tab.label])).toEqual([
            ['audio', 'Audio'],
            ['display', 'Display'],
            ['gameplay', 'Gameplay'],
            ['ai', 'AI'],
            ['controls', 'Controls'],
        ]);
    });

    it('defines the audio engine fields requested by the Tactics settings page', () => {
        expect(engineFieldsForTab('audio')).toEqual([
            'audio.masterVolume',
            'audio.sfxVolume',
            'audio.musicVolume',
        ]);
        expect(gameFieldsForTab('audio')).toEqual([]);
    });

    it('defines display fields using the current EngineSettings field ids', () => {
        expect(engineFieldsForTab('display')).toEqual([
            'display.fullscreen',
            'display.vsync',
            'display.targetFps',
            'display.uiScale',
        ]);
        expect(gameFieldsForTab('display')).toEqual([]);
    });

    it('defines gameplay engine and Tactics-specific fields', () => {
        expect(engineFieldsForTab('gameplay')).toEqual(['gameplay.showPerfHud']);
        expect(gameFieldsForTab('gameplay')).toEqual([
            'showGrid',
            'animationSpeed',
            'showDamageNumbers',
        ]);
    });

    it('uses the TacticsSettings animationSpeed union as select options', () => {
        const item = findGameField('animationSpeed');

        expect(item.label).toBe('Animation Speed');
        expect(item.control).toEqual({
            type: 'select',
            options: EXPECTED_ANIMATION_SPEED_OPTIONS,
        });
    });

    it('uses toggle controls for boolean Tactics gameplay fields', () => {
        expect(findGameField('showGrid').control).toEqual({ type: 'toggle' });
        expect(findGameField('showDamageNumbers').control).toEqual({ type: 'toggle' });
    });

    it('uses an aiThinkingDelayMs slider range accepted by tacticsSettingsSchema', () => {
        const item = findGameField('aiThinkingDelayMs');

        expect(item.control).toEqual({ type: 'slider', min: 0, max: 5000, step: 100 });
        if (item.control.type !== 'slider') {
            throw new Error('aiThinkingDelayMs must use a slider control.');
        }

        expect(
            tacticsSettingsSchema.schema.safeParse({
                ...TACTICS_DEFAULTS,
                aiThinkingDelayMs: item.control.min,
            }).success,
        ).toBe(true);
        expect(
            tacticsSettingsSchema.schema.safeParse({
                ...TACTICS_DEFAULTS,
                aiThinkingDelayMs: item.control.max,
            }).success,
        ).toBe(true);
        expect(
            tacticsSettingsSchema.schema.safeParse({
                ...TACTICS_DEFAULTS,
                aiThinkingDelayMs: item.control.max + item.control.step,
            }).success,
        ).toBe(false);
    });

    it('defines the controls tab through the current key-binding engine field', () => {
        expect(engineFieldsForTab('controls')).toEqual(['controls.bindings']);
        expect(gameFieldsForTab('controls')).toEqual([]);
    });

    it('keeps game-specific fields out of reserved engine namespaces', () => {
        const reservedEngineNamespaces = new Set(['audio', 'display', 'gameplay', 'controls']);
        const gameFieldNamespaces = allItems().flatMap((item) => {
            if (item.kind !== 'game-field') {
                return [];
            }
            const separatorIndex = item.path.indexOf('.');
            return [separatorIndex === -1 ? item.path : item.path.slice(0, separatorIndex)];
        });

        expect(
            gameFieldNamespaces.some((namespace) => reservedEngineNamespaces.has(namespace)),
        ).toBe(false);
    });
});
