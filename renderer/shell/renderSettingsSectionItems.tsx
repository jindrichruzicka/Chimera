'use client';

/**
 * renderer/shell/renderSettingsSectionItems.tsx
 *
 * Declarative field renderer for a single settings section. Accepts a
 * `SettingsSectionDefinition` and renders each `SettingsItemDefinition`
 * as the appropriate UI control (Slider, Toggle, Select, or key-binding panel).
 *
 * Architecture reference: §4.13 — Settings System, §4.37 — Renderer Shell Pages
 * UI Contract
 *
 * Invariants upheld:
 *   #36  — settings writes go through window.__chimera.settings.update
 *          (via useSettingsStore.getState().updateSettings)
 *   #91  — no hardcoded colour/spacing/radius literals; all layout values use
 *          var(--ch-*)
 *   #92  — no raw <button> or <input type="button"> elements; all interactive
 *          controls use dedicated UI library components from renderer/components/ui/
 *   #94  — no games/* imports
 */

import React, { useCallback } from 'react';
import type {
    EngineSettingsFieldId,
    SettingsControlDefinition,
    SettingsItemDefinition,
    SettingsSectionDefinition,
} from '@chimera/shared/game-shell-contract.js';
import type { ResolvedSettings } from '@chimera/electron/preload/api-types.js';
import { Caption } from '../components/ui/Caption';
import { Select } from '../components/ui/Select';
import { Slider } from '../components/ui/Slider';
import { Toggle } from '../components/ui/Toggle';
import { useSettingsStore } from '../state/settingsStore';

// ── Types ─────────────────────────────────────────────────────────────────────

type SettingPrimitive = boolean | number | string;

type EngineFieldDescriptor = Readonly<{
    readonly control: SettingsControlDefinition;
    readonly defaultValue?: unknown;
    readonly formatValue?: ((value: unknown) => string) | undefined;
    readonly label: string;
    readonly parseValue?: ((value: SettingPrimitive) => unknown) | undefined;
    readonly testId?: string | undefined;
}>;

// ── Engine field registry ─────────────────────────────────────────────────────

const TARGET_FPS_OPTIONS = [
    { value: '30', label: '30 FPS' },
    { value: '60', label: '60 FPS' },
    { value: '120', label: '120 FPS' },
    { value: '0', label: 'Uncapped' },
] as const;

const LANGUAGE_OPTIONS = [
    { value: 'en-US', label: 'English (US)' },
    { value: 'de-DE', label: 'Deutsch' },
    { value: 'es-ES', label: 'Espanol' },
    { value: 'fr-FR', label: 'Francais' },
] as const;

const ENGINE_FIELD_REGISTRY: Record<EngineSettingsFieldId, EngineFieldDescriptor> = {
    'audio.masterVolume': {
        control: { type: 'slider', min: 0, max: 1, step: 0.01 },
        defaultValue: 1,
        formatValue: formatPercent,
        label: 'Master Volume',
        testId: 'master-volume',
    },
    'audio.sfxVolume': {
        control: { type: 'slider', min: 0, max: 1, step: 0.01 },
        defaultValue: 1,
        formatValue: formatPercent,
        label: 'SFX Volume',
    },
    'audio.musicVolume': {
        control: { type: 'slider', min: 0, max: 1, step: 0.01 },
        defaultValue: 0.8,
        formatValue: formatPercent,
        label: 'Music Volume',
    },
    'audio.muted': {
        control: { type: 'toggle' },
        defaultValue: false,
        label: 'Muted',
    },
    'display.fullscreen': {
        control: { type: 'toggle' },
        defaultValue: false,
        label: 'Fullscreen',
    },
    'display.vsync': {
        control: { type: 'toggle' },
        defaultValue: true,
        label: 'VSync',
    },
    'display.targetFps': {
        control: { type: 'select', options: TARGET_FPS_OPTIONS },
        defaultValue: 60,
        label: 'Target FPS',
        parseValue: parseIntegerValue,
    },
    'display.uiScale': {
        control: { type: 'slider', min: 0.5, max: 2, step: 0.05 },
        defaultValue: 1,
        formatValue: formatScale,
        label: 'UI Scale',
    },
    'gameplay.language': {
        control: { type: 'select', options: LANGUAGE_OPTIONS },
        defaultValue: 'en-US',
        label: 'Language',
    },
    'gameplay.autoSave': {
        control: { type: 'toggle' },
        defaultValue: true,
        label: 'Auto Save',
    },
    'gameplay.autoSaveIntervalTurns': {
        control: { type: 'slider', min: 1, max: 100, step: 1 },
        defaultValue: 5,
        formatValue: formatTurns,
        label: 'Auto Save Interval',
    },
    'gameplay.showHints': {
        control: { type: 'toggle' },
        defaultValue: true,
        label: 'Show Hints',
    },
    'gameplay.showPerfHud': {
        control: { type: 'toggle' },
        defaultValue: false,
        label: 'Show Performance HUD',
    },
    'controls.bindings': {
        control: { type: 'key-binding' },
        label: 'Controls',
    },
};

// ── Props ─────────────────────────────────────────────────────────────────────

export interface RenderSettingsSectionItemsProps {
    /** The section definition to render. */
    readonly section: SettingsSectionDefinition;
    /** The game whose settings are being edited. Use `'__engine__'` for engine settings. */
    readonly gameId: string;
    /** Pre-resolved settings for the game. If not provided, defaults are used. */
    readonly resolvedSettings?: ResolvedSettings | undefined;
    /**
     * Called to render the key-binding controls panel for `controls.bindings`.
     * The parent page owns the rebind UI (InputManager access, capture state, etc.).
     * When omitted a placeholder caption is rendered.
     */
    readonly renderControlsPanel?: (() => React.ReactElement) | undefined;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function RenderSettingsSectionItems({
    gameId,
    renderControlsPanel,
    resolvedSettings,
    section,
}: RenderSettingsSectionItemsProps): React.ReactElement {
    const storeResolvedSettings = useSettingsStore((state) => state.settings[gameId]);
    const effectiveResolvedSettings = resolvedSettings ?? storeResolvedSettings;
    const handleUpdate = useCallback(
        (patch: Record<string, unknown>): void => {
            useSettingsStore
                .getState()
                .updateSettings(gameId, patch)
                .catch((error: unknown) => {
                    console.error('[RenderSettingsSectionItems] Failed to update settings:', error);
                });
        },
        [gameId],
    );

    return (
        <>
            {section.items.map((item) =>
                renderItem({
                    item,
                    resolvedSettings: effectiveResolvedSettings,
                    onUpdate: handleUpdate,
                    renderControlsPanel,
                }),
            )}
        </>
    );
}

// ── Item rendering ────────────────────────────────────────────────────────────

function renderItem({
    item,
    onUpdate,
    renderControlsPanel,
    resolvedSettings,
}: Readonly<{
    readonly item: SettingsItemDefinition;
    readonly onUpdate: (patch: Record<string, unknown>) => void;
    readonly renderControlsPanel?: (() => React.ReactElement) | undefined;
    readonly resolvedSettings?: ResolvedSettings | undefined;
}>): React.ReactElement {
    switch (item.kind) {
        case 'engine-field': {
            const descriptor = resolveEngineFieldDescriptor(item.fieldId);
            if (descriptor.control.type === 'key-binding') {
                return (
                    <React.Fragment key={item.fieldId}>
                        {renderControlsPanel ? (
                            renderControlsPanel()
                        ) : (
                            <Caption tone="muted">
                                Key bindings are managed by the engine controls panel.
                            </Caption>
                        )}
                    </React.Fragment>
                );
            }
            return (
                <SettingsControlField
                    control={descriptor.control}
                    defaultValue={descriptor.defaultValue}
                    formatValue={descriptor.formatValue}
                    key={item.fieldId}
                    label={descriptor.label}
                    onUpdate={onUpdate}
                    parseValue={descriptor.parseValue}
                    path={item.fieldId}
                    testId={descriptor.testId}
                    value={getValueByPath(resolvedSettings, item.fieldId)}
                />
            );
        }
        case 'game-field':
            return (
                <SettingsControlField
                    control={item.control}
                    key={item.path}
                    label={item.label}
                    onUpdate={onUpdate}
                    path={item.path}
                    value={getValueByPath(resolvedSettings, item.path)}
                />
            );
    }
}

function resolveEngineFieldDescriptor(fieldId: string): EngineFieldDescriptor {
    const descriptor = (
        ENGINE_FIELD_REGISTRY as Readonly<Record<string, EngineFieldDescriptor | undefined>>
    )[fieldId];
    if (descriptor === undefined) {
        throw new Error(`[RenderSettingsSectionItems] unknown engine settings field '${fieldId}'`);
    }
    return descriptor;
}

// ── SettingsControlField ──────────────────────────────────────────────────────

function SettingsControlField({
    control,
    defaultValue,
    formatValue,
    label,
    onUpdate,
    parseValue,
    path,
    testId,
    value,
}: Readonly<{
    readonly control: SettingsControlDefinition;
    readonly defaultValue?: unknown;
    readonly formatValue?: ((value: unknown) => string) | undefined;
    readonly label: string;
    readonly onUpdate: (patch: Record<string, unknown>) => void;
    readonly parseValue?: ((value: SettingPrimitive) => unknown) | undefined;
    readonly path: string;
    readonly testId?: string | undefined;
    readonly value: unknown;
}>): React.ReactElement {
    const elementId = getSettingsElementId('setting', path);

    switch (control.type) {
        case 'slider': {
            const currentValue = coerceNumber(value, coerceNumber(defaultValue, control.min));
            return (
                <div data-setting-path={path}>
                    <Slider
                        aria-label={label}
                        data-testid={testId}
                        id={elementId}
                        label={label}
                        max={control.max}
                        min={control.min}
                        step={control.step}
                        value={currentValue}
                        onChange={(nextValue) => {
                            const parsedValue = parseValue?.(nextValue) ?? nextValue;
                            onUpdate(buildPatchFromPath(path, parsedValue));
                        }}
                    />
                    {formatValue ? <Caption>{formatValue(currentValue)}</Caption> : null}
                </div>
            );
        }
        case 'toggle': {
            const currentValue = coerceBoolean(value, coerceBoolean(defaultValue, false));
            return (
                <div data-setting-path={path}>
                    <Toggle
                        checked={currentValue}
                        id={elementId}
                        label={label}
                        onCheckedChange={(nextValue) => {
                            const parsedValue = parseValue?.(nextValue) ?? nextValue;
                            onUpdate(buildPatchFromPath(path, parsedValue));
                        }}
                    />
                </div>
            );
        }
        case 'select': {
            const currentValue = coerceSelectValue(value, defaultValue, control.options);
            return (
                <div data-setting-path={path}>
                    <Select
                        id={elementId}
                        label={label}
                        options={control.options}
                        value={currentValue}
                        onValueChange={(nextValue) => {
                            const parsedValue = parseValue?.(nextValue) ?? nextValue;
                            onUpdate(buildPatchFromPath(path, parsedValue));
                        }}
                    />
                </div>
            );
        }
        case 'key-binding':
            return (
                <div data-setting-path={path}>
                    <Caption tone="muted">
                        Key bindings are managed by the engine controls panel.
                    </Caption>
                </div>
            );
    }
}

// ── Pure utility functions ────────────────────────────────────────────────────

function formatPercent(value: unknown): string {
    return `${(coerceNumber(value, 1) * 100).toFixed(0)}%`;
}

function formatScale(value: unknown): string {
    return `${coerceNumber(value, 1).toFixed(2)}x`;
}

function formatTurns(value: unknown): string {
    return `${coerceNumber(value, 5).toFixed(0)} turns`;
}

function parseIntegerValue(value: SettingPrimitive): number {
    return parseInt(String(value), 10);
}

function coerceNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function coerceSelectValue(
    value: unknown,
    defaultValue: unknown,
    options: readonly { readonly value: string }[],
): string {
    const fallbackValue = options[0]?.value ?? '';
    const optionValues = new Set(options.map((option) => option.value));

    for (const candidate of [value, defaultValue, fallbackValue]) {
        if (!isSettingPrimitive(candidate)) continue;
        const normalizedValue = String(candidate);
        if (optionValues.has(normalizedValue)) {
            return normalizedValue;
        }
    }

    return fallbackValue;
}

function isSettingPrimitive(value: unknown): value is SettingPrimitive {
    return ['boolean', 'number', 'string'].includes(typeof value);
}

function getValueByPath(settings: ResolvedSettings | undefined, path: string): unknown {
    if (!settings) return undefined;
    let current: unknown = settings;
    for (const part of path.split('.')) {
        if (!isRecord(current) || !(part in current)) {
            return undefined;
        }
        current = current[part];
    }
    return current;
}

function buildPatchFromPath(path: string, value: unknown): Record<string, unknown> {
    const parts = path.split('.').filter(Boolean);
    if (parts.length === 0) return {};

    let patch: unknown = value;
    for (let index = parts.length - 1; index >= 0; index -= 1) {
        patch = { [parts[index]!]: patch };
    }
    return patch as Record<string, unknown>;
}

function getSettingsElementId(...parts: readonly string[]): string {
    return parts
        .join('-')
        .replace(/[^A-Za-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
