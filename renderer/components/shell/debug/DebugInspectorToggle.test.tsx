// @vitest-environment jsdom

/**
 * renderer/components/shell/debug/DebugInspectorToggle.test.tsx
 *
 * Unit tests for the headless Debug Inspector toggle component.
 *
 * Architecture reference: §4.12 — Runtime Debug Layer; §4.26 — Input & Keybindings
 * Issue: #696 — F47 T7
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

async function importToggle(): Promise<{ DebugInspectorToggle: React.FC }> {
    return import('./DebugInspectorToggle');
}

function fireToggle(pressed = true): void {
    const cb = inputActionCallbacks.get('engine:toggle-debug-inspector');
    cb?.({
        actionId: 'engine:toggle-debug-inspector',
        code: 'F9',
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

describe('DebugInspectorToggle', () => {
    it('renders nothing', async () => {
        const { DebugInspectorToggle } = await importToggle();
        const { container } = render(<DebugInspectorToggle />);
        expect(container.firstChild).toBeNull();
    });

    it('subscribes to the engine:toggle-debug-inspector action', async () => {
        const { DebugInspectorToggle } = await importToggle();
        render(<DebugInspectorToggle />);
        expect(inputActionCallbacks.has('engine:toggle-debug-inspector')).toBe(true);
    });

    it('calls toggleDebugInspector() once per key press', async () => {
        const toggleDebugInspector = vi.fn().mockResolvedValue(undefined);
        stubBridge({ toggleDebugInspector });
        const { DebugInspectorToggle } = await importToggle();

        render(<DebugInspectorToggle />);
        fireToggle(true);

        expect(toggleDebugInspector).toHaveBeenCalledTimes(1);
    });

    it('ignores release events so one key press fires once', async () => {
        const toggleDebugInspector = vi.fn().mockResolvedValue(undefined);
        stubBridge({ toggleDebugInspector });
        const { DebugInspectorToggle } = await importToggle();

        render(<DebugInspectorToggle />);
        fireToggle(true);
        fireToggle(false);

        expect(toggleDebugInspector).toHaveBeenCalledTimes(1);
    });

    it('is a silent no-op when the bridge is unavailable', async () => {
        const { DebugInspectorToggle } = await importToggle();
        render(<DebugInspectorToggle />);
        expect(() => fireToggle(true)).not.toThrow();
    });

    it('is a silent no-op when system lacks toggleDebugInspector', async () => {
        stubBridge({});
        const { DebugInspectorToggle } = await importToggle();
        render(<DebugInspectorToggle />);
        expect(() => fireToggle(true)).not.toThrow();
    });
});
