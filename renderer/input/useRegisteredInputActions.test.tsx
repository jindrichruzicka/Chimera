// @vitest-environment jsdom

/**
 * renderer/input/useRegisteredInputActions.test.tsx
 *
 * Unit tests for the registry-subscribing action-list hook.
 *
 * Architecture reference: §4.26 — Input & Keybindings
 *
 * Tests written first (TDD — red confirmed: the module did not exist, so the
 * import failed to resolve).
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { InputAction } from './InputAction.js';
import { createInputActionRegistry, type InputActionRegistry } from './InputActionRegistry.js';
import { InputActionRegistryContext } from './InputActionRegistryContext.js';
import { useRegisteredInputActions } from './useRegisteredInputActions.js';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const END_TURN: InputAction = {
    id: 'game:end-turn',
    description: 'End turn',
    category: 'Game',
    oneShot: true,
};

const UNDO: InputAction = {
    id: 'engine:undo',
    description: 'Undo',
    category: 'Engine',
    oneShot: true,
};

let container: HTMLDivElement;
let root: Root;
let renderCount = 0;

function Probe(): React.ReactElement {
    renderCount += 1;
    const actions = useRegisteredInputActions();
    return <span data-testid="ids">{actions.map((action) => action.id).join(',')}</span>;
}

/** Hands each render's array out, so a test can compare the values themselves. */
function SnapshotProbe({
    onRead,
}: {
    readonly onRead: (actions: readonly InputAction[]) => void;
}): React.ReactElement {
    const actions = useRegisteredInputActions();
    onRead(actions);
    return <span data-testid="ids">{actions.map((action) => action.id).join(',')}</span>;
}

function mount(registry: InputActionRegistry): void {
    act(() => {
        root.render(
            <InputActionRegistryContext.Provider value={registry}>
                <Probe />
            </InputActionRegistryContext.Provider>,
        );
    });
}

function renderedIds(): string {
    return container.querySelector('[data-testid="ids"]')?.textContent ?? '';
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    renderCount = 0;
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
});

describe('useRegisteredInputActions', () => {
    it('returns the actions already registered at mount', () => {
        mount(createInputActionRegistry([UNDO, END_TURN]));

        expect(renderedIds()).toBe('engine:undo,game:end-turn');
    });

    // The reason the hook exists: app-boot registration resolves a game's shell
    // payload asynchronously, so it lands AFTER the pane that lists it mounted.
    it('re-renders with an action registered after the mount', () => {
        const registry = createInputActionRegistry([UNDO]);
        mount(registry);
        expect(renderedIds()).toBe('engine:undo');

        act(() => {
            registry.register(END_TURN);
        });

        expect(renderedIds()).toBe('engine:undo,game:end-turn');
    });

    it('returns the identical array across renders with no registration between them', () => {
        const registry = createInputActionRegistry([UNDO]);
        const seen: (readonly InputAction[])[] = [];
        act(() => {
            root.render(
                <InputActionRegistryContext.Provider value={registry}>
                    <SnapshotProbe onRead={(actions) => seen.push(actions)} />
                </InputActionRegistryContext.Provider>,
            );
        });

        act(() => {
            root.render(
                <InputActionRegistryContext.Provider value={registry}>
                    <SnapshotProbe onRead={(actions) => seen.push(actions)} />
                </InputActionRegistryContext.Provider>,
            );
        });

        // Identity across renders is what makes the second render an ordinary
        // one: `useSyncExternalStore` re-renders its consumer whenever
        // `getSnapshot` returns a value it has not seen.
        expect(seen.length).toBeGreaterThan(1);
        expect(new Set(seen).size).toBe(1);
    });

    it('stops re-rendering after unmount', () => {
        const registry = createInputActionRegistry([UNDO]);
        mount(registry);
        act(() => {
            root.unmount();
        });
        const rendersAtUnmount = renderCount;

        act(() => {
            registry.register(END_TURN);
        });

        expect(renderCount).toBe(rendersAtUnmount);

        // Re-arm the shared afterEach unmount against the already-unmounted root.
        root = createRoot(container);
    });
});
