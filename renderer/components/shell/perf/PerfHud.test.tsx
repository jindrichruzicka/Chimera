// @vitest-environment jsdom

/**
 * renderer/components/shell/perf/PerfHud.test.tsx
 *
 * Unit tests for the PerfHud overlay component (§4.16).
 *
 * Architecture reference: §4.16 — Performance HUD
 * Issue: #583 — Implement PerfHud.tsx
 *
 * Rules:
 *  - Tests written first (red confirmed).
 *  - No real Electron IPC — stores driven via createPerfStore/createSettingsStore.
 *  - No imports from simulation/, electron/main/, ai/, or games/*.
 *  - useInputAction is mocked so we can fire the toggle callback manually.
 */

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { createPerfStore } from './perfStore';
import { createSettingsStore } from '../../../state/settingsStore';
import type { PerfStoreState } from './perfStore';
import type { SettingsStoreState } from '../../../state/settingsStore';

// ── Mock useInputAction ───────────────────────────────────────────────────────

type InputCallback = (event: {
    actionId: string;
    code: string;
    modifiers: readonly string[];
    repeat: boolean;
    pressed: boolean;
    timestamp: number;
}) => void;

const inputActionCallbacks = new Map<string, InputCallback>();

vi.mock('../../../input/useInputAction.js', () => ({
    useInputAction: vi.fn((id: string, cb: InputCallback) => {
        inputActionCallbacks.set(id, cb);
    }),
}));

// ── Mock usePerfStore / useSettingsStore singletons ───────────────────────────
// We replace the singleton accessor so PerfHud reads our isolated stores.

let perfStore = createPerfStore();
let settingsStore = createSettingsStore();

vi.mock('./perfStore', async () => {
    const actual = await vi.importActual<{ createPerfStore: typeof createPerfStore }>(
        './perfStore',
    );
    return {
        ...actual,
        usePerfStore: Object.assign(
            <T,>(selector: (state: PerfStoreState) => T): T => selector(perfStore.getState()),
            {
                getState: () => perfStore.getState(),
                subscribe: (cb: () => void) => perfStore.subscribe(cb),
            },
        ),
    };
});

vi.mock('../../../state/settingsStore', async () => {
    const actual = await vi.importActual<{ createSettingsStore: typeof createSettingsStore }>(
        '../../../state/settingsStore',
    );
    return {
        ...actual,
        useSettingsStore: Object.assign(
            <T,>(selector: (state: SettingsStoreState) => T): T =>
                selector(settingsStore.getState()),
            {
                getState: () => settingsStore.getState(),
                setState: (s: Partial<SettingsStoreState>) =>
                    settingsStore.setState(s as SettingsStoreState),
                subscribe: (cb: () => void) => settingsStore.subscribe(cb),
            },
        ),
    };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function importPerfHud(): Promise<{ PerfHud: React.FC }> {
    const mod = await import('./PerfHud');
    return mod;
}

function fireToggle(pressed = true): void {
    const cb = inputActionCallbacks.get('engine:toggle-perf-hud');
    cb?.({
        actionId: 'engine:toggle-perf-hud',
        code: 'F3',
        modifiers: [],
        repeat: false,
        pressed,
        timestamp: performance.now(),
    });
}

function applySettings(showPerfHud: boolean): void {
    settingsStore.setState({
        settings: {
            __engine__: {
                audio: { masterVolume: 1, sfxVolume: 1, musicVolume: 0.8, muted: false },
                display: { fullscreen: false, vsync: true, targetFps: 60, uiScale: 1 },
                gameplay: {
                    language: 'en-US',
                    autoSave: true,
                    autoSaveIntervalTurns: 5,
                    showHints: true,
                    showPerfHud,
                },
                controls: { bindings: {} },
            },
        },
        activeGameId: null,
    });
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    perfStore = createPerfStore();
    settingsStore = createSettingsStore();
    inputActionCallbacks.clear();
});

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

// ── Tests: visibility ─────────────────────────────────────────────────────────

describe('PerfHud — visibility', () => {
    it('is hidden by default when visible=false and settings showPerfHud=false', async () => {
        const { PerfHud } = await importPerfHud();
        render(<PerfHud />);
        expect(screen.queryByTestId('perf-hud')).toBeNull();
    });

    it('is visible when perfStore.visible is true', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        render(<PerfHud />);
        expect(screen.getByTestId('perf-hud')).toBeTruthy();
    });

    it('is visible when settings.gameplay.showPerfHud is true', async () => {
        const { PerfHud } = await importPerfHud();
        applySettings(true);
        render(<PerfHud />);
        expect(screen.getByTestId('perf-hud')).toBeTruthy();
    });

    it('is visible when both visible and settings are true', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        applySettings(true);
        render(<PerfHud />);
        expect(screen.getByTestId('perf-hud')).toBeTruthy();
    });

    it('registers engine:toggle-perf-hud input action on mount', async () => {
        const { useInputAction } = await import('../../../input/useInputAction.js');
        const { PerfHud } = await importPerfHud();
        render(<PerfHud />);
        expect(vi.mocked(useInputAction as Mock)).toHaveBeenCalledWith(
            'engine:toggle-perf-hud',
            expect.any(Function),
        );
    });

    it('toggling via F3 makes the HUD visible when previously hidden', async () => {
        const { PerfHud } = await importPerfHud();
        const { rerender } = render(<PerfHud />);
        expect(screen.queryByTestId('perf-hud')).toBeNull();

        fireToggle();
        rerender(<PerfHud />);

        expect(screen.getByTestId('perf-hud')).toBeTruthy();
    });

    it('toggling twice restores hidden state', async () => {
        const { PerfHud } = await importPerfHud();
        const { rerender } = render(<PerfHud />);

        fireToggle();
        rerender(<PerfHud />);
        expect(screen.getByTestId('perf-hud')).toBeTruthy();

        fireToggle();
        rerender(<PerfHud />);
        expect(screen.queryByTestId('perf-hud')).toBeNull();
    });

    it('ignores release events so one key press toggles once', async () => {
        const { PerfHud } = await importPerfHud();
        const { rerender } = render(<PerfHud />);

        fireToggle(true);
        rerender(<PerfHud />);
        expect(screen.getByTestId('perf-hud')).toBeTruthy();

        fireToggle(false);
        rerender(<PerfHud />);
        expect(screen.getByTestId('perf-hud')).toBeTruthy();
    });
});

// ── Tests: 9 metrics rendered ─────────────────────────────────────────────────

describe('PerfHud — metrics rendered', () => {
    async function renderVisible(): Promise<void> {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        perfStore.getState().setPerfFrame({
            fps: 60,
            frameMsAvg: 16.7,
            frameMsP95: 18.2,
            drawCalls: 120,
            triangles: 50000,
        });
        perfStore.getState().setSimTick(42);
        perfStore.getState().setPingMs(35);
        render(<PerfHud />);
    }

    it('renders FPS metric', async () => {
        await renderVisible();
        expect(screen.getByTestId('perf-fps')).toBeTruthy();
    });

    it('renders frame time avg metric', async () => {
        await renderVisible();
        expect(screen.getByTestId('perf-frame-ms-avg')).toBeTruthy();
    });

    it('renders frame time p95 metric', async () => {
        await renderVisible();
        expect(screen.getByTestId('perf-frame-ms-p95')).toBeTruthy();
    });

    it('renders sim tick metric', async () => {
        await renderVisible();
        expect(screen.getByTestId('perf-sim-tick')).toBeTruthy();
    });

    it('renders actions/sec metric', async () => {
        await renderVisible();
        expect(screen.getByTestId('perf-actions-sec')).toBeTruthy();
    });

    it('renders action RTT metric', async () => {
        await renderVisible();
        expect(screen.getByTestId('perf-action-rtt')).toBeTruthy();
    });

    it('renders ping metric', async () => {
        await renderVisible();
        expect(screen.getByTestId('perf-ping')).toBeTruthy();
    });

    it('renders heap metric', async () => {
        await renderVisible();
        expect(screen.getByTestId('perf-heap')).toBeTruthy();
    });

    it('renders draw calls metric', async () => {
        await renderVisible();
        expect(screen.getByTestId('perf-draw-calls')).toBeTruthy();
    });

    it('renders triangles metric', async () => {
        await renderVisible();
        expect(screen.getByTestId('perf-triangles')).toBeTruthy();
    });
});

// ── Tests: metric values ──────────────────────────────────────────────────────

describe('PerfHud — metric values', () => {
    it('displays fps value', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        perfStore
            .getState()
            .setPerfFrame({ fps: 55, frameMsAvg: 18, frameMsP95: 20, drawCalls: 0, triangles: 0 });
        render(<PerfHud />);
        expect(screen.getByTestId('perf-fps').textContent).toContain('55');
    });

    it('displays sim tick value', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        perfStore.getState().setSimTick(999);
        render(<PerfHud />);
        expect(screen.getByTestId('perf-sim-tick').textContent).toContain('999');
    });

    it('displays ping value', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        perfStore.getState().setPingMs(42);
        render(<PerfHud />);
        expect(screen.getByTestId('perf-ping').textContent).toContain('42');
    });

    it('displays "—" for null ping', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        // pingMs is null by default
        render(<PerfHud />);
        expect(screen.getByTestId('perf-ping').textContent).toContain('—');
    });

    it('displays "—" for null actionRoundTripMs', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        render(<PerfHud />);
        expect(screen.getByTestId('perf-action-rtt').textContent).toContain('—');
    });

    it('displays "—" for null heapMb', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        render(<PerfHud />);
        expect(screen.getByTestId('perf-heap').textContent).toContain('—');
    });

    it('displays draw calls value', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        perfStore
            .getState()
            .setPerfFrame({ fps: 60, frameMsAvg: 16, frameMsP95: 18, drawCalls: 99, triangles: 0 });
        render(<PerfHud />);
        expect(screen.getByTestId('perf-draw-calls').textContent).toContain('99');
    });

    it('displays triangles value', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        perfStore.getState().setPerfFrame({
            fps: 60,
            frameMsAvg: 16,
            frameMsP95: 18,
            drawCalls: 0,
            triangles: 75000,
        });
        render(<PerfHud />);
        expect(screen.getByTestId('perf-triangles').textContent).toContain('75000');
    });
});

// ── Tests: FPS colour thresholds ──────────────────────────────────────────────

describe('PerfHud — FPS colour status', () => {
    async function renderWithFps(fps: number): Promise<void> {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        perfStore
            .getState()
            .setPerfFrame({ fps, frameMsAvg: 16, frameMsP95: 18, drawCalls: 0, triangles: 0 });
        render(<PerfHud />);
    }

    it('FPS row has data-status="good" when fps >= 55', async () => {
        await renderWithFps(60);
        expect(screen.getByTestId('perf-fps').getAttribute('data-status')).toBe('good');
    });

    it('FPS row has data-status="good" at exactly 55 fps', async () => {
        await renderWithFps(55);
        expect(screen.getByTestId('perf-fps').getAttribute('data-status')).toBe('good');
    });

    it('FPS row has data-status="warn" when fps is between 30 and 54', async () => {
        await renderWithFps(45);
        expect(screen.getByTestId('perf-fps').getAttribute('data-status')).toBe('warn');
    });

    it('FPS row has data-status="warn" at exactly 30 fps', async () => {
        await renderWithFps(30);
        expect(screen.getByTestId('perf-fps').getAttribute('data-status')).toBe('warn');
    });

    it('FPS row has data-status="bad" when fps < 30', async () => {
        await renderWithFps(20);
        expect(screen.getByTestId('perf-fps').getAttribute('data-status')).toBe('bad');
    });

    it('FPS row has data-status="bad" at exactly 0 fps', async () => {
        await renderWithFps(0);
        expect(screen.getByTestId('perf-fps').getAttribute('data-status')).toBe('bad');
    });
});

// ── Tests: design tokens ───────────────────────────────────────────────────────

describe('PerfHud — design token discipline', () => {
    it('container uses CSS variable tokens for positioning and background', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        render(<PerfHud />);

        const hud = screen.getByTestId('perf-hud');
        const style = hud.getAttribute('style') ?? '';
        // Must use tokens, not hardcoded hex/px
        expect(style).toContain('var(--ch-');
        expect(style).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    });

    it('line-height uses a CSS variable token, not a bare number', async () => {
        const { PerfHud } = await importPerfHud();
        perfStore.getState().setVisible(true);
        render(<PerfHud />);

        const hud = screen.getByTestId('perf-hud');
        const style = hud.getAttribute('style') ?? '';
        // lineHeight must reference a var(--ch-*) token, not a bare numeric literal
        expect(style).not.toMatch(/line-height: [0-9]/);
    });
});
