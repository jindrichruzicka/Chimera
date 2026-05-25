// @vitest-environment jsdom
// renderer/shell/renderSettingsSectionItems.test.tsx
//
// Unit tests for RenderSettingsSectionItems — the declarative engine field renderer.
//
// Architecture reference: §4.13 — Settings System, §4.37 — Renderer Shell Pages UI Contract
// Task: #628 — Implement renderSettingsSectionItems.tsx
// Task: #630 — Unit coverage for settings field controls and update dispatch
//
// Invariants upheld:
//   #36 — settings writes go through window.__chimera.settings.update
//   #91 — no hardcoded colour/spacing/radius literals; layout values use var(--ch-*)
//   #94 — no games/* import from shell page components
//
// Tests written first (TDD — red confirmed before implementation existed).

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SettingsSectionDefinition } from '@chimera/shared/game-shell-contract.js';
import { RenderSettingsSectionItems } from './renderSettingsSectionItems';
import { useSettingsStore } from '../state/settingsStore';

// ── System bridge mock ────────────────────────────────────────────────────────

const mockSettingsUpdate = vi.fn().mockResolvedValue({});

function makeResolvedSettings(
    overrides: Partial<Record<'audio' | 'display' | 'gameplay' | 'controls', unknown>> = {},
): Record<string, unknown> {
    return {
        audio: { masterVolume: 0.8, sfxVolume: 1, musicVolume: 0.7, muted: false },
        display: { fullscreen: false, vsync: true, targetFps: 60, uiScale: 1 },
        gameplay: {
            language: 'en-US',
            autoSave: true,
            autoSaveIntervalTurns: 5,
            showHints: true,
            showPerfHud: false,
        },
        controls: { bindings: {} },
        ...overrides,
    };
}

beforeEach(() => {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            settings: {
                update: mockSettingsUpdate,
                reset: vi.fn().mockResolvedValue({}),
                get: vi.fn().mockResolvedValue({}),
                onChange: vi.fn().mockReturnValue(() => {}),
            },
        },
    });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
    mockSettingsUpdate.mockReset();
    mockSettingsUpdate.mockResolvedValue({});
    // Reset store state
    useSettingsStore.setState({ settings: {}, activeGameId: null });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderSection(
    section: SettingsSectionDefinition,
    options?: {
        gameId?: string;
        resolvedSettings?: Record<string, unknown>;
        renderControlsPanel?: () => React.ReactElement;
    },
): void {
    const gameId = options?.gameId ?? '__engine__';
    render(
        <RenderSettingsSectionItems
            gameId={gameId}
            renderControlsPanel={options?.renderControlsPanel}
            resolvedSettings={options?.resolvedSettings}
            section={section}
        />,
    );
}

// ─── Slider (engine-field: audio.masterVolume) ────────────────────────────────

describe('engine-field with slider control', () => {
    const section: SettingsSectionDefinition = {
        id: 'audio',
        label: 'Audio',
        items: [{ kind: 'engine-field', fieldId: 'audio.masterVolume' }],
    };

    it('renders a slider input', () => {
        renderSection(section);
        expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('renders Slider with min, max, step, and value from settingsStore', () => {
        useSettingsStore.setState({
            settings: { __engine__: makeResolvedSettings({ audio: { masterVolume: 0.42 } }) },
            activeGameId: null,
        });

        renderSection(section);

        const slider = screen.getByRole('slider');
        expect(slider).toHaveAttribute('min', '0');
        expect(slider).toHaveAttribute('max', '1');
        expect(slider).toHaveAttribute('step', '0.01');
        expect(slider).toHaveValue('0.42');
    });

    it('uses explicitly resolved settings ahead of store state', () => {
        useSettingsStore.setState({
            settings: { __engine__: makeResolvedSettings({ audio: { masterVolume: 0.2 } }) },
            activeGameId: null,
        });

        renderSection(section, {
            resolvedSettings: { audio: { masterVolume: 0.64 } },
        });

        expect(screen.getByRole('slider')).toHaveValue('0.64');
    });

    it('calls updateSettings with a patch when slider changes', async () => {
        renderSection(section);
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '0.75' } });

        await vi.waitFor(() => {
            expect(mockSettingsUpdate).toHaveBeenCalledOnce();
            expect(mockSettingsUpdate).toHaveBeenCalledWith(
                '__engine__',
                expect.objectContaining({ audio: expect.objectContaining({ masterVolume: 0.75 }) }),
            );
        });
    });

    it('logs an error when updateSettings rejects', async () => {
        const ipcError = new Error('IPC failure');
        mockSettingsUpdate.mockRejectedValueOnce(ipcError);
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        renderSection(section);
        const slider = screen.getByRole('slider');
        fireEvent.change(slider, { target: { value: '0.5' } });

        await vi.waitFor(() => {
            expect(consoleSpy).toHaveBeenCalledWith(
                '[RenderSettingsSectionItems] Failed to update settings:',
                ipcError,
            );
        });
    });
});

// ─── Toggle (engine-field: display.fullscreen) ───────────────────────────────

describe('engine-field with toggle control', () => {
    const section: SettingsSectionDefinition = {
        id: 'display',
        items: [{ kind: 'engine-field', fieldId: 'display.fullscreen' }],
    };

    it('renders a switch (toggle)', () => {
        renderSection(section);
        expect(screen.getByRole('switch', { name: 'Fullscreen' })).toBeInTheDocument();
    });

    it('calls updateSettings through window.__chimera.settings.update when toggle changes', async () => {
        renderSection(section, { resolvedSettings: { display: { fullscreen: false } } });
        const toggle = screen.getByRole('switch', { name: 'Fullscreen' });
        fireEvent.click(toggle);

        await vi.waitFor(() => {
            expect(mockSettingsUpdate).toHaveBeenCalledOnce();
            expect(mockSettingsUpdate).toHaveBeenCalledWith(
                '__engine__',
                expect.objectContaining({ display: expect.objectContaining({ fullscreen: true }) }),
            );
        });
    });
});

// ─── Select (engine-field: display.targetFps) ────────────────────────────────

describe('engine-field with select control', () => {
    const section: SettingsSectionDefinition = {
        id: 'display',
        items: [{ kind: 'engine-field', fieldId: 'display.targetFps' }],
    };

    it('renders Select with documented display options', () => {
        renderSection(section);

        const select = screen.getByRole('combobox', { name: 'Target FPS' });
        expect(select).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '30 FPS' })).toHaveValue('30');
        expect(screen.getByRole('option', { name: '60 FPS' })).toHaveValue('60');
        expect(screen.getByRole('option', { name: '120 FPS' })).toHaveValue('120');
        expect(screen.getByRole('option', { name: 'Uncapped' })).toHaveValue('0');
    });

    it('calls updateSettings when selection changes', async () => {
        renderSection(section, { resolvedSettings: { display: { targetFps: 60 } } });
        const select = screen.getByRole('combobox');
        fireEvent.change(select, { target: { value: '30' } });

        await vi.waitFor(() => {
            expect(mockSettingsUpdate).toHaveBeenCalledOnce();
            expect(mockSettingsUpdate).toHaveBeenCalledWith(
                '__engine__',
                expect.objectContaining({ display: expect.objectContaining({ targetFps: 30 }) }),
            );
        });
    });
});

// ─── Unknown engine field ────────────────────────────────────────────────────

describe('engine-field with unknown field id', () => {
    it('throws a descriptive error before rendering any control', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const section = {
            id: 'invalid',
            items: [{ kind: 'engine-field', fieldId: 'display.resolution' }],
        } as unknown as SettingsSectionDefinition;

        expect(() => renderSection(section)).toThrow(
            "[RenderSettingsSectionItems] unknown engine settings field 'display.resolution'",
        );
        expect(screen.queryByRole('slider')).toBeNull();
        expect(screen.queryByRole('switch')).toBeNull();
        expect(screen.queryByRole('combobox')).toBeNull();
        consoleError.mockRestore();
    });
});

// ─── Key-binding engine field delegates to renderControlsPanel ────────────────

describe('engine-field with key-binding control', () => {
    const section: SettingsSectionDefinition = {
        id: 'controls',
        items: [{ kind: 'engine-field', fieldId: 'controls.bindings' }],
    };

    it('renders the controls panel via renderControlsPanel prop', () => {
        const controlsPanel = (): React.ReactElement => (
            <div data-testid="controls-panel">Controls Panel</div>
        );
        renderSection(section, { renderControlsPanel: controlsPanel });
        expect(screen.getByTestId('controls-panel')).toBeInTheDocument();
    });

    it('renders a fallback caption when renderControlsPanel is not provided', () => {
        renderSection(section);
        expect(screen.getByText(/key binding/i)).toBeInTheDocument();
    });
});

// ─── Game-field ───────────────────────────────────────────────────────────────

describe('game-field items', () => {
    it('renders a Slider with the game-field slider definition', () => {
        const section: SettingsSectionDefinition = {
            id: 'difficulty',
            items: [
                {
                    kind: 'game-field',
                    path: 'difficulty.scale',
                    label: 'Difficulty Scale',
                    control: { type: 'slider', min: 0, max: 1, step: 0.1 },
                },
            ],
        };
        renderSection(section, { gameId: 'tactics' });
        const slider = screen.getByRole('slider', { name: 'Difficulty Scale' });
        expect(slider).toHaveAttribute('min', '0');
        expect(slider).toHaveAttribute('max', '1');
        expect(slider).toHaveAttribute('step', '0.1');
    });

    it('falls back to the slider minimum when a nested game value is absent', () => {
        const section: SettingsSectionDefinition = {
            id: 'difficulty',
            items: [
                {
                    kind: 'game-field',
                    path: 'difficulty.scale',
                    label: 'Difficulty Scale',
                    control: { type: 'slider', min: 0.25, max: 1, step: 0.25 },
                },
            ],
        };

        renderSection(section, { gameId: 'tactics', resolvedSettings: { difficulty: {} } });

        expect(screen.getByRole('slider', { name: 'Difficulty Scale' })).toHaveValue('0.25');
    });

    it('renders a Toggle for game-field with toggle control', async () => {
        const section: SettingsSectionDefinition = {
            id: 'fog',
            items: [
                {
                    kind: 'game-field',
                    path: 'fog.enabled',
                    label: 'Fog of War',
                    control: { type: 'toggle' },
                },
            ],
        };
        renderSection(section, {
            gameId: 'tactics',
            resolvedSettings: { fog: { enabled: false } },
        });
        const toggle = screen.getByRole('switch', { name: 'Fog of War' });
        expect(toggle).toBeInTheDocument();

        fireEvent.click(toggle);

        await vi.waitFor(() => {
            expect(mockSettingsUpdate).toHaveBeenCalledOnce();
            expect(mockSettingsUpdate).toHaveBeenCalledWith(
                'tactics',
                expect.objectContaining({ fog: expect.objectContaining({ enabled: true }) }),
            );
        });
    });

    it('renders a Select with the game-field select options', () => {
        const section: SettingsSectionDefinition = {
            id: 'animation',
            items: [
                {
                    kind: 'game-field',
                    path: 'animation.speed',
                    label: 'Animation Speed',
                    control: {
                        type: 'select',
                        options: [
                            { value: 'slow', label: 'Slow' },
                            { value: 'normal', label: 'Normal' },
                            { value: 'fast', label: 'Fast' },
                        ],
                    },
                },
            ],
        };

        renderSection(section, {
            gameId: 'tactics',
            resolvedSettings: { animation: { speed: 'normal' } },
        });

        const select = screen.getByRole('combobox', { name: 'Animation Speed' });
        expect(select).toHaveValue('normal');
        expect(screen.getByRole('option', { name: 'Slow' })).toHaveValue('slow');
        expect(screen.getByRole('option', { name: 'Normal' })).toHaveValue('normal');
        expect(screen.getByRole('option', { name: 'Fast' })).toHaveValue('fast');
    });

    it('falls back to the first select option when the resolved value is not primitive', () => {
        const section: SettingsSectionDefinition = {
            id: 'animation',
            items: [
                {
                    kind: 'game-field',
                    path: 'animation.speed',
                    label: 'Animation Speed',
                    control: {
                        type: 'select',
                        options: [
                            { value: 'slow', label: 'Slow' },
                            { value: 'fast', label: 'Fast' },
                        ],
                    },
                },
            ],
        };

        renderSection(section, {
            gameId: 'tactics',
            resolvedSettings: { animation: { speed: { value: 'fast' } } },
        });

        expect(screen.getByRole('combobox', { name: 'Animation Speed' })).toHaveValue('slow');
    });

    it('renders an empty select value when a select definition has no options', () => {
        const section: SettingsSectionDefinition = {
            id: 'empty-select',
            items: [
                {
                    kind: 'game-field',
                    path: 'display.mode',
                    label: 'Display Mode',
                    control: { type: 'select', options: [] },
                },
            ],
        };

        renderSection(section, { gameId: 'tactics', resolvedSettings: { display: {} } });

        const select = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Display Mode' });
        expect(select.value).toBe('');
    });
});
