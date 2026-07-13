// @vitest-environment jsdom

/**
 * renderer/components/shell/debug/I18nTokenModeToggle.test.tsx
 *
 * Unit tests for the headless i18n token-mode toggle component (F4).
 *
 * Architecture reference: §4.12 — Runtime Debug Layer; §4.26 — Input & Keybindings;
 * §4.39 — Localisation
 *
 * Rules:
 *  - Tests written first (red confirmed).
 *  - No real Electron IPC — the preload bridge is stubbed on globalThis.
 *  - useInputAction is mocked so we can fire the toggle callback manually.
 */

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

async function importToggle(): Promise<{ I18nTokenModeToggle: React.FC }> {
    return import('./I18nTokenModeToggle');
}

function fireToggle(pressed = true): void {
    const cb = inputActionCallbacks.get('engine:toggle-i18n-token-mode');
    cb?.({
        actionId: 'engine:toggle-i18n-token-mode',
        code: 'F4',
        modifiers: [],
        repeat: false,
        pressed,
        timestamp: performance.now(),
    });
}

function stubBridge(system: unknown): void {
    Object.defineProperty(globalThis, '__chimera', {
        configurable: true,
        value: { system },
    });
}

beforeEach(() => {
    inputActionCallbacks.clear();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    Reflect.deleteProperty(globalThis, '__chimera');
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('I18nTokenModeToggle', () => {
    it('renders nothing', async () => {
        const { I18nTokenModeToggle } = await importToggle();
        const { container } = render(<I18nTokenModeToggle />);
        expect(container.firstChild).toBeNull();
    });

    it('subscribes to the engine:toggle-i18n-token-mode action', async () => {
        const { I18nTokenModeToggle } = await importToggle();
        render(<I18nTokenModeToggle />);
        expect(inputActionCallbacks.has('engine:toggle-i18n-token-mode')).toBe(true);
    });

    it('calls toggleI18nTokenMode() once per key press', async () => {
        const toggleI18nTokenMode = vi.fn().mockResolvedValue(undefined);
        stubBridge({ toggleI18nTokenMode });
        const { I18nTokenModeToggle } = await importToggle();

        render(<I18nTokenModeToggle />);
        fireToggle(true);

        expect(toggleI18nTokenMode).toHaveBeenCalledTimes(1);
    });

    it('ignores release events so one key press fires once', async () => {
        const toggleI18nTokenMode = vi.fn().mockResolvedValue(undefined);
        stubBridge({ toggleI18nTokenMode });
        const { I18nTokenModeToggle } = await importToggle();

        render(<I18nTokenModeToggle />);
        fireToggle(true);
        fireToggle(false);

        expect(toggleI18nTokenMode).toHaveBeenCalledTimes(1);
    });

    it('is a silent no-op when the bridge is unavailable', async () => {
        const { I18nTokenModeToggle } = await importToggle();
        render(<I18nTokenModeToggle />);
        expect(() => fireToggle(true)).not.toThrow();
    });

    it('is a silent no-op when system lacks toggleI18nTokenMode', async () => {
        stubBridge({});
        const { I18nTokenModeToggle } = await importToggle();
        render(<I18nTokenModeToggle />);
        expect(() => fireToggle(true)).not.toThrow();
    });
});
