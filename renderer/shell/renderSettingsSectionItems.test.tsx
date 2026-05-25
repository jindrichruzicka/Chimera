// @vitest-environment jsdom
// renderer/shell/renderSettingsSectionItems.test.tsx
//
// Unit tests for RenderSettingsSectionItems — the declarative engine field renderer.
//
// Architecture reference: §4.13 — Settings System, §4.37 — Renderer Shell Pages UI Contract
// Task: #628 — Implement renderSettingsSectionItems.tsx
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

    it('reflects the current engine field value from resolvedSettings', () => {
        renderSection(section, {
            resolvedSettings: { audio: { masterVolume: 0.42 } },
        });
        const slider = screen.getByRole('slider');
        expect(slider).toHaveValue('0.42');
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

// ─── Toggle (engine-field: audio.muted) ──────────────────────────────────────

describe('engine-field with toggle control', () => {
    const section: SettingsSectionDefinition = {
        id: 'audio',
        items: [{ kind: 'engine-field', fieldId: 'audio.muted' }],
    };

    it('renders a switch (toggle)', () => {
        renderSection(section);
        expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('calls updateSettings when toggle changes', async () => {
        renderSection(section, { resolvedSettings: { audio: { muted: false } } });
        const toggle = screen.getByRole('switch');
        fireEvent.click(toggle);

        await vi.waitFor(() => {
            expect(mockSettingsUpdate).toHaveBeenCalledOnce();
            expect(mockSettingsUpdate).toHaveBeenCalledWith(
                '__engine__',
                expect.objectContaining({ audio: expect.objectContaining({ muted: true }) }),
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

    it('renders a combobox (select)', () => {
        renderSection(section);
        expect(screen.getByRole('combobox')).toBeInTheDocument();
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
    it('renders a slider for game-field with slider control', () => {
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
        expect(screen.getByRole('slider')).toBeInTheDocument();
    });

    it('calls updateSettings with game field path patch when value changes', async () => {
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
        const toggle = screen.getByRole('switch');
        fireEvent.click(toggle);

        await vi.waitFor(() => {
            expect(mockSettingsUpdate).toHaveBeenCalledOnce();
            expect(mockSettingsUpdate).toHaveBeenCalledWith(
                'tactics',
                expect.objectContaining({ fog: expect.objectContaining({ enabled: true }) }),
            );
        });
    });
});
