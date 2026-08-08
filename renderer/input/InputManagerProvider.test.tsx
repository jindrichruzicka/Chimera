// @vitest-environment jsdom
/**
 * renderer/input/InputManagerProvider.test.tsx
 *
 * Unit tests for the publish-only InputManagerProvider (§4.26).
 *
 * The component exists so that the public `@chimera-engine/renderer/input`
 * barrel ships something a game's own component tests can MOUNT — the internal
 * context object satisfies `useInputManager()` too, but Invariant #96 keeps it
 * out of a game's reach. So the tests below hold the
 * two properties that make it safe to publish — it constructs nothing, and it
 * drives no lifecycle (`start`/`stop` stay with `renderer/app/providers.tsx`,
 * the app-lifetime singleton's one owner).
 */

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi, type Mocked } from 'vitest';

import type { InputManager } from './InputManager.js';
import { InputManagerProvider } from './InputManagerProvider.js';
import { useInputManager } from './InputManagerContext.js';

function createManagerStub(): Mocked<InputManager> {
    return {
        start: vi.fn(),
        stop: vi.fn(),
        isPressed: vi.fn().mockReturnValue(false),
        onAction: vi.fn().mockReturnValue(vi.fn()),
        setActiveCategory: vi.fn(),
        rebind: vi.fn().mockResolvedValue({ ok: true }),
        pollGamepad: vi.fn(),
        getActions: vi.fn().mockReturnValue([]),
        getBinding: vi.fn().mockReturnValue(undefined),
        resetBinding: vi.fn().mockResolvedValue(undefined),
    };
}

function ManagerProbe(): React.ReactElement {
    const manager = useInputManager();
    return <span data-testid="probe">{manager.isPressed('engine:undo') ? 'down' : 'up'}</span>;
}

afterEach(() => {
    cleanup();
});

describe('InputManagerProvider', () => {
    it('publishes the passed manager to useInputManager() consumers', () => {
        const manager = createManagerStub();

        render(
            <InputManagerProvider inputManager={manager}>
                <ManagerProbe />
            </InputManagerProvider>,
        );

        expect(screen.getByTestId('probe').textContent).toBe('up');
        expect(manager.isPressed).toHaveBeenCalledWith('engine:undo');
    });

    it('renders its children', () => {
        render(
            <InputManagerProvider inputManager={createManagerStub()}>
                <span data-testid="child">child</span>
            </InputManagerProvider>,
        );

        expect(screen.getByTestId('child').textContent).toBe('child');
    });

    it('never drives the manager lifecycle — not on mount, not on unmount', () => {
        const manager = createManagerStub();

        const { unmount } = render(
            <InputManagerProvider inputManager={manager}>
                <span />
            </InputManagerProvider>,
        );

        expect(manager.start).not.toHaveBeenCalled();
        expect(manager.stop).not.toHaveBeenCalled();

        unmount();

        // The lifecycle owner is renderer/app/providers.tsx, which starts the
        // singleton once and stops it on app teardown. A provider that stopped
        // the manager on unmount would silently kill input for the rest of the
        // app's life the first time a game unmounted a test double's provider.
        expect(manager.start).not.toHaveBeenCalled();
        expect(manager.stop).not.toHaveBeenCalled();
    });
});
