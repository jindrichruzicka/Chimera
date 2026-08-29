// @vitest-environment jsdom

/**
 * renderer/app/InputActionsBootstrap.test.tsx
 *
 * Unit tests for the app-boot input-action registrar (§4.26).
 *
 * Tests written first (TDD — red confirmed: the module did not exist, so the
 * import failed to resolve).
 */

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { InputAction } from '../input/InputAction.js';
import { createInputActionRegistry } from '../input/InputActionRegistry.js';
import { InputActionRegistryContext } from '../input/InputActionRegistryContext.js';
import {
    createRecordingLogsApi,
    type RecordingLogsApi,
} from '../logging/__test-support__/RecordingLogsApi.js';
import { useSettingsStore } from '../state/settingsStore.js';
import { InputActionsBootstrap, registerShellInputActions } from './InputActionsBootstrap';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const loadRendererGameShellMock = vi.hoisted(() => vi.fn());

vi.mock('../game/rendererGameRegistry', () => ({
    loadRendererGameShell: loadRendererGameShellMock,
}));

vi.mock('next/navigation', () => ({
    usePathname: () => '/main-menu',
}));

const END_TURN: InputAction = {
    id: 'game:end-turn',
    description: 'End turn',
    category: 'Game',
    oneShot: true,
};

let container: HTMLDivElement;
let root: Root;
let logs: RecordingLogsApi;

function setUrlGameId(gameId: string | null): void {
    window.history.replaceState(
        {},
        '',
        gameId === null ? '/main-menu' : `/main-menu?gameId=${gameId}`,
    );
}

async function flushPromiseJobs(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    setUrlGameId(null);
    useSettingsStore.setState({ settings: {}, activeGameId: null });
    loadRendererGameShellMock.mockReset();
    loadRendererGameShellMock.mockResolvedValue({ inputActions: [END_TURN] });
    logs = createRecordingLogsApi();
    (globalThis as { __chimera?: { logs: unknown } }).__chimera = { logs };
});

afterEach(() => {
    act(() => {
        root.unmount();
    });
    container.remove();
    useSettingsStore.setState({ settings: {}, activeGameId: null });
    Reflect.deleteProperty(globalThis, '__chimera');
});

describe('InputActionsBootstrap', () => {
    it('registers the URL shell game actions from the SHELL payload, before any match', async () => {
        setUrlGameId('tactics');
        const registry = createInputActionRegistry();

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={registry}>
                    <InputActionsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(loadRendererGameShellMock).toHaveBeenCalledWith('tactics');
        expect(registry.get('game:end-turn')).toBe(END_TURN);
    });

    it('registers the stored active game actions on a route with no ?gameId=', async () => {
        useSettingsStore.setState({ settings: {}, activeGameId: 'tactics' });
        const registry = createInputActionRegistry();

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={registry}>
                    <InputActionsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(loadRendererGameShellMock).toHaveBeenCalledWith('tactics');
        expect(registry.has('game:end-turn')).toBe(true);
    });

    it('loads nothing when there is no game context at all', async () => {
        const registry = createInputActionRegistry();

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={registry}>
                    <InputActionsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(loadRendererGameShellMock).not.toHaveBeenCalled();
        expect(registry.getAll()).toEqual([]);
    });

    it('registers a game that only becomes the context after the mount', async () => {
        const registry = createInputActionRegistry();

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={registry}>
                    <InputActionsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        expect(loadRendererGameShellMock).not.toHaveBeenCalled();

        await act(async () => {
            useSettingsStore.getState().setActiveGameId('tactics');
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(registry.has('game:end-turn')).toBe(true);
    });

    it('leaves the registry empty and logs when the shell load fails', async () => {
        setUrlGameId('tactics');
        loadRendererGameShellMock.mockRejectedValue(new Error('no such game'));
        const registry = createInputActionRegistry();

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={registry}>
                    <InputActionsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(registry.getAll()).toEqual([]);
        // Invariant #67: the Error's stack survives and the entry is attributed
        // to a named module, not the 'global' catch-all.
        expect(logs.emitCalls).toHaveLength(1);
        const entry = logs.emitCalls[0]!;
        expect(entry.level).toBe('error');
        expect(entry.source.module).toBe('input-actions-bootstrap');
        expect(entry.error?.stack).toBeDefined();
        expect(entry.message).toContain("Failed to load the shell payload for 'tactics'");
    });

    it('registers a game with no declared actions without touching the registry', async () => {
        setUrlGameId('tactics');
        loadRendererGameShellMock.mockResolvedValue({});
        const registry = createInputActionRegistry();

        await act(async () => {
            root.render(
                <InputActionRegistryContext.Provider value={registry}>
                    <InputActionsBootstrap />
                </InputActionRegistryContext.Provider>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(registry.getAll()).toEqual([]);
        expect(logs.emitCalls).toEqual([]);
    });

    // StrictMode runs mount → unmount → mount; registration is idempotent, so
    // the second pass must neither throw a duplicate nor double the table.
    it('registers exactly once under StrictMode double-mounting', async () => {
        setUrlGameId('tactics');
        const registry = createInputActionRegistry();

        await act(async () => {
            root.render(
                <React.StrictMode>
                    <InputActionRegistryContext.Provider value={registry}>
                        <InputActionsBootstrap />
                    </InputActionRegistryContext.Provider>
                </React.StrictMode>,
            );
        });
        await act(async () => {
            await flushPromiseJobs();
        });

        expect(registry.getAll()).toHaveLength(1);
    });
});

describe('registerShellInputActions', () => {
    it('does not register when the caller disposed while the load was in flight', async () => {
        const registry = createInputActionRegistry();

        await registerShellInputActions(registry, 'tactics', () => true);

        expect(registry.getAll()).toEqual([]);
    });

    // The identity assert is the safety net: a game shipping different metadata
    // under one id must fail loudly rather than last-write-win. The bootstrap
    // does NOT convert it into a log entry — only a failed LOAD is degraded.
    it('rejects with the identity error when the shell metadata diverges', async () => {
        const registry = createInputActionRegistry([END_TURN]);
        loadRendererGameShellMock.mockResolvedValue({
            inputActions: [{ ...END_TURN, description: 'Finish turn' }],
        });

        await expect(registerShellInputActions(registry, 'tactics', () => false)).rejects.toThrow(
            "Input action 'game:end-turn' is already registered with different metadata.",
        );
        expect(logs.emitCalls).toEqual([]);
    });
});
