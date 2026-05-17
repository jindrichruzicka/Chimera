// @vitest-environment jsdom
/**
 * renderer/input/useInputAction.test.tsx
 *
 * Unit tests for the useInputAction hook (§4.26 — Input & Keybindings).
 *
 * Architecture reference: §4.26 — Input & Keybindings
 * Invariant #65: InputManager is renderer-only; this hook must never be
 *                imported by simulation/ or ai/.
 */

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mocked } from 'vitest';

import type { InputActionId, InputEvent } from './InputAction.js';
import type { InputManager } from './InputManager.js';
import { InputManagerContext } from './InputManagerContext.js';
import { useInputAction } from './useInputAction.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEvent(actionId: InputActionId): InputEvent {
    return {
        actionId,
        code: 'Escape',
        modifiers: [],
        repeat: false,
        pressed: true,
        timestamp: 0,
    };
}

function createManagerStub(): Mocked<InputManager> & {
    triggerAction: (id: InputActionId, event: InputEvent) => void;
} {
    const subscribers = new Map<InputActionId, ((event: InputEvent) => void)[]>();

    const onAction = vi.fn(
        (id: InputActionId, callback: (event: InputEvent) => void): (() => void) => {
            const existing = subscribers.get(id) ?? [];
            existing.push(callback);
            subscribers.set(id, existing);
            return vi.fn(() => {
                const cbs = subscribers.get(id);
                if (cbs) {
                    const idx = cbs.indexOf(callback);
                    if (idx !== -1) cbs.splice(idx, 1);
                }
            });
        },
    );

    return {
        start: vi.fn(),
        stop: vi.fn(),
        isPressed: vi.fn().mockReturnValue(false),
        onAction,
        setActiveCategory: vi.fn(),
        rebind: vi.fn().mockResolvedValue({ ok: true }),
        pollGamepad: vi.fn(),
        getActions: vi.fn().mockReturnValue([]),
        getBinding: vi.fn().mockReturnValue(undefined),
        resetBinding: vi.fn().mockResolvedValue(undefined),
        triggerAction(id: InputActionId, event: InputEvent): void {
            const cbs = subscribers.get(id) ?? [];
            for (const cb of cbs) cb(event);
        },
    };
}

function createWrapper(
    manager: InputManager,
): React.ComponentType<{ readonly children: React.ReactNode }> {
    return function InputManagerWrapper({ children }): React.ReactElement {
        return (
            <InputManagerContext.Provider value={manager}>{children}</InputManagerContext.Provider>
        );
    };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useInputAction — subscription lifecycle', () => {
    let manager: ReturnType<typeof createManagerStub>;

    beforeEach(() => {
        manager = createManagerStub();
    });

    it('subscribes to the given action id on mount', () => {
        renderHook(() => useInputAction('engine:toggle-menu', vi.fn()), {
            wrapper: createWrapper(manager),
        });

        expect(manager.onAction).toHaveBeenCalledOnce();
        expect(manager.onAction).toHaveBeenCalledWith('engine:toggle-menu', expect.any(Function));
    });

    it('unsubscribes (calls the returned function) on unmount', () => {
        const unsubscribeSpy = vi.fn();
        manager.onAction.mockImplementation(
            (_id: InputActionId, _cb: (event: InputEvent) => void) => unsubscribeSpy,
        );

        const { unmount } = renderHook(() => useInputAction('engine:toggle-menu', vi.fn()), {
            wrapper: createWrapper(manager),
        });

        expect(unsubscribeSpy).not.toHaveBeenCalled();
        unmount();
        expect(unsubscribeSpy).toHaveBeenCalledOnce();
    });

    it('does not call onAction again when only the callback identity changes', () => {
        const { rerender } = renderHook(
            ({ cb }: { cb: (event: InputEvent) => void }) =>
                useInputAction('engine:toggle-menu', cb),
            {
                initialProps: { cb: vi.fn() },
                wrapper: createWrapper(manager),
            },
        );

        const callCountAfterMount = manager.onAction.mock.calls.length;

        rerender({ cb: vi.fn() });

        expect(manager.onAction.mock.calls.length).toBe(callCountAfterMount);
    });

    it('delivers events to the latest callback even after identity change', () => {
        const firstCb = vi.fn();
        const secondCb = vi.fn();

        const { rerender } = renderHook(
            ({ cb }: { cb: (event: InputEvent) => void }) =>
                useInputAction('engine:toggle-menu', cb),
            {
                initialProps: { cb: firstCb },
                wrapper: createWrapper(manager),
            },
        );

        rerender({ cb: secondCb });

        const event = makeEvent('engine:toggle-menu');
        manager.triggerAction('engine:toggle-menu', event);

        expect(firstCb).not.toHaveBeenCalled();
        expect(secondCb).toHaveBeenCalledWith(event);
    });

    it('unsubscribes old id and subscribes new id when id changes', () => {
        const unsubscribeSpy = vi.fn();
        manager.onAction.mockImplementation(
            (_id: InputActionId, _cb: (event: InputEvent) => void) => unsubscribeSpy,
        );

        const { rerender } = renderHook(
            ({ id }: { id: InputActionId }) => useInputAction(id, vi.fn()),
            {
                initialProps: { id: 'engine:toggle-menu' as InputActionId },
                wrapper: createWrapper(manager),
            },
        );

        // Sanity: subscribed once on mount
        expect(manager.onAction).toHaveBeenCalledTimes(1);
        expect(unsubscribeSpy).not.toHaveBeenCalled();

        rerender({ id: 'engine:undo' as InputActionId });

        // Old subscription torn down
        expect(unsubscribeSpy).toHaveBeenCalledOnce();
        // New subscription established
        expect(manager.onAction).toHaveBeenCalledTimes(2);
        expect(manager.onAction.mock.calls[1]![0]).toBe('engine:undo');
    });

    it('only subscribes once even when rerendered with the same id', () => {
        const { rerender } = renderHook(
            ({ id }: { id: InputActionId }) => useInputAction(id, vi.fn()),
            {
                initialProps: { id: 'engine:toggle-menu' as InputActionId },
                wrapper: createWrapper(manager),
            },
        );

        rerender({ id: 'engine:toggle-menu' as InputActionId });
        rerender({ id: 'engine:toggle-menu' as InputActionId });

        expect(manager.onAction).toHaveBeenCalledTimes(1);
    });

    it('throws a descriptive error when used outside InputManagerContext.Provider', () => {
        expect(() => renderHook(() => useInputAction('engine:toggle-menu', vi.fn()))).toThrow(
            'useInputManager() must be used within the app root (inside <Providers>).',
        );
    });
});
