// electron/preload/contract.test.ts
//
// Contract tests for the composed `window.__chimera` surface exposed by
// `preload/api.ts`. Each of the five namespace factories already has a
// focused unit suite that drives it through a hand-rolled narrow-port stub.
// This file sits one layer higher and drives every namespace through the
// real `preload/api.ts` runtime with a mocked Electron module, so the
// channel-routing contract is verified end-to-end:
//
//   1. Every method sends to or invokes the correct IPC channel.
//   2. Payloads are forwarded verbatim (no mutation, no extra arguments).
//   3. Every subscription method returns a working Unsubscribe that removes
//      the registered listener.
//
// Also pins invariant 28 one more time: the composed bridge exposes exactly
// the `__chimera` key and never a `__chimeraDebug` key.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionRejection, ChimeraAPI, EngineAction, PlayerSnapshot } from './api-types.js';

// ─── Electron module mock ────────────────────────────────────────────────────

const exposeInMainWorld = vi.fn<(key: string, api: Record<string, unknown>) => void>();

/**
 * Shape of a listener registered against the mocked `ipcRenderer`. Matches
 * the real Electron listener signature closely enough for our callers.
 */
type MockIpcListener = (event: unknown, ...args: unknown[]) => void;

interface InvokeCall {
    readonly channel: string;
    readonly args: readonly unknown[];
}

interface SendCall {
    readonly channel: string;
    readonly args: readonly unknown[];
}

const invokeCalls: InvokeCall[] = [];
const sendCalls: SendCall[] = [];
const listeners = new Map<string, Set<MockIpcListener>>();
const invokeResults = new Map<string, unknown>();

const ipcRendererInvoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(
    (channel, ...args) => {
        invokeCalls.push({ channel, args });
        return Promise.resolve(invokeResults.get(channel));
    },
);

const ipcRendererSend = vi.fn<(channel: string, ...args: unknown[]) => void>((channel, ...args) => {
    sendCalls.push({ channel, args });
});

const ipcRendererOn = vi.fn<(channel: string, listener: MockIpcListener) => void>(
    (channel, listener) => {
        const set = listeners.get(channel) ?? new Set<MockIpcListener>();
        set.add(listener);
        listeners.set(channel, set);
    },
);

const ipcRendererRemoveListener = vi.fn<(channel: string, listener: MockIpcListener) => void>(
    (channel, listener) => {
        listeners.get(channel)?.delete(listener);
    },
);

vi.mock('electron', () => ({
    contextBridge: {
        exposeInMainWorld,
    },
    ipcRenderer: {
        invoke: ipcRendererInvoke,
        send: ipcRendererSend,
        on: ipcRendererOn,
        removeListener: ipcRendererRemoveListener,
    },
}));

// ─── Test helpers ────────────────────────────────────────────────────────────

/**
 * Reload `preload/api.ts` with a clean slate of recorded calls so each
 * describe-block sees a freshly-composed `ChimeraAPI`. The module's import
 * side effect hands the composed API to `contextBridge.exposeInMainWorld`;
 * we extract it from there instead of touching `globalThis`.
 */
async function loadApi(): Promise<ChimeraAPI> {
    exposeInMainWorld.mockClear();
    ipcRendererInvoke.mockClear();
    ipcRendererSend.mockClear();
    ipcRendererOn.mockClear();
    ipcRendererRemoveListener.mockClear();
    invokeCalls.length = 0;
    sendCalls.length = 0;
    listeners.clear();
    invokeResults.clear();

    // Seed the mocked `ipcRenderer.invoke` with payloads that satisfy the
    // preload-side Zod schemas (see `electron/preload/schemas.ts`). Tests
    // that care about a specific return value override these before calling;
    // tests that only assert on channel names + arguments can ignore them.
    invokeResults.set('chimera:system:platform', { os: 'linux', version: '33.0.0' });
    invokeResults.set('chimera:lobby:host', { sessionId: '', hostId: '', gameId: '' });
    invokeResults.set('chimera:lobby:join', { sessionId: '', hostId: '', gameId: '' });
    invokeResults.set('chimera:lobby:leave', undefined);
    invokeResults.set('chimera:saves:list', []);
    invokeResults.set('chimera:saves:save', {
        slotId: '',
        gameId: '',
        tick: 0,
        savedAt: 0,
    });
    invokeResults.set('chimera:settings:get', {});
    invokeResults.set('chimera:settings:update', {});
    invokeResults.set('chimera:settings:reset', {});

    vi.resetModules();
    await import('./api.js');

    const call = exposeInMainWorld.mock.calls[0];
    if (!call) {
        throw new Error('preload/api.ts did not call contextBridge.exposeInMainWorld');
    }
    return call[1] as unknown as ChimeraAPI;
}

function emit(channel: string, ...args: readonly unknown[]): void {
    const set = listeners.get(channel);
    if (!set) return;
    const event = { sender: 'fake-webcontents' };
    for (const listener of set) {
        listener(event, ...args);
    }
}

// ─── Shared exposure assertions ──────────────────────────────────────────────

describe('preload/api.ts — contextBridge exposure', () => {
    beforeEach(async () => {
        await loadApi();
    });

    it("exposes exactly one key and it is '__chimera' (invariant 28: no __chimeraDebug)", () => {
        expect(exposeInMainWorld).toHaveBeenCalledOnce();
        const keys = exposeInMainWorld.mock.calls.map(([k]) => k);
        expect(keys).toEqual(['__chimera']);
        expect(keys).not.toContain('__chimeraDebug');
    });
});

// ─── game namespace ──────────────────────────────────────────────────────────

describe('window.__chimera.game — contract', () => {
    let api: ChimeraAPI;

    beforeEach(async () => {
        api = await loadApi();
    });

    it('sendAction() forwards the payload verbatim to chimera:game:send-action', () => {
        const action: EngineAction = {
            type: 'example',
            playerId: 'p1',
            tick: 7,
            payload: { key: 'value' },
        };
        api.game.sendAction(action);

        expect(sendCalls).toEqual([{ channel: 'chimera:game:send-action', args: [action] }]);
        // Payload identity preserved — no defensive copy, no mutation.
        expect(sendCalls[0]?.args[0]).toBe(action);
    });

    it('switchActiveSeat() invokes chimera:game:switch-seat with the playerId', async () => {
        await api.game.switchActiveSeat('p2');

        expect(invokeCalls).toEqual([{ channel: 'chimera:game:switch-seat', args: ['p2'] }]);
    });

    it('onSnapshot() registers on chimera:game:snapshot; Unsubscribe removes the listener', () => {
        const seen: PlayerSnapshot[] = [];
        const unsubscribe = api.game.onSnapshot((snapshot) => {
            seen.push(snapshot);
        });

        expect(listeners.get('chimera:game:snapshot')?.size).toBe(1);

        const snapshot: PlayerSnapshot = {
            tick: 3,
            viewerId: 'p1',
            players: {},
            entities: {},
            phase: 'main',
            events: [],
            commitments: {},
            undoMeta: { canUndo: false, canRedo: false },
        };
        emit('chimera:game:snapshot', snapshot);
        expect(seen).toEqual([snapshot]);
        // Payload forwarded verbatim.
        expect(seen[0]).toBe(snapshot);

        unsubscribe();
        expect(listeners.get('chimera:game:snapshot')?.size).toBe(0);
        emit('chimera:game:snapshot', snapshot);
        expect(seen).toHaveLength(1);
    });

    it('onActionRejected() registers on chimera:game:action-rejected; payload forwarded verbatim; Unsubscribe removes the listener', () => {
        const seen: ActionRejection[] = [];
        const unsubscribe = api.game.onActionRejected((rejection) => {
            seen.push(rejection);
        });

        expect(listeners.get('chimera:game:action-rejected')?.size).toBe(1);

        const rejection: ActionRejection = {
            reason: 'ipc-validation:chimera:game:send-action',
            tick: 7,
            actionType: 'noop',
        };
        emit('chimera:game:action-rejected', rejection);
        expect(seen).toEqual([rejection]);

        unsubscribe();
        expect(listeners.get('chimera:game:action-rejected')?.size).toBe(0);
        emit('chimera:game:action-rejected', rejection);
        expect(seen).toHaveLength(1);
    });
});

// ─── lobby namespace ─────────────────────────────────────────────────────────

describe('window.__chimera.lobby — contract', () => {
    let api: ChimeraAPI;

    beforeEach(async () => {
        api = await loadApi();
    });

    it('host() invokes chimera:lobby:host with the HostLobbyParams', async () => {
        const params = { gameId: 'sample-game', maxPlayers: 4 } as const;
        await api.lobby.host(params);
        expect(invokeCalls).toEqual([{ channel: 'chimera:lobby:host', args: [params] }]);
        expect(invokeCalls[0]?.args[0]).toBe(params);
    });

    it('join() invokes chimera:lobby:join with the JoinLobbyParams', async () => {
        const params = { address: 'ws://127.0.0.1:7777' } as const;
        await api.lobby.join(params);
        expect(invokeCalls).toEqual([{ channel: 'chimera:lobby:join', args: [params] }]);
    });

    it('leave() invokes chimera:lobby:leave with no payload', async () => {
        await api.lobby.leave();
        expect(invokeCalls).toEqual([{ channel: 'chimera:lobby:leave', args: [] }]);
    });

    it('onUpdate() registers on chimera:lobby:update; Unsubscribe removes the listener', () => {
        const calls: unknown[] = [];
        const unsubscribe = api.lobby.onUpdate((state) => {
            calls.push(state);
        });
        expect(listeners.get('chimera:lobby:update')?.size).toBe(1);

        const state = {
            info: { sessionId: 's', hostId: 'p1', gameId: 'sample-game' },
            players: [],
        };
        emit('chimera:lobby:update', state);
        expect(calls).toEqual([state]);

        unsubscribe();
        expect(listeners.get('chimera:lobby:update')?.size).toBe(0);
    });
});

// ─── saves namespace ─────────────────────────────────────────────────────────

describe('window.__chimera.saves — contract', () => {
    let api: ChimeraAPI;

    beforeEach(async () => {
        api = await loadApi();
    });

    it('list() invokes chimera:saves:list with the gameId', async () => {
        await api.saves.list('sample-game');
        expect(invokeCalls).toEqual([{ channel: 'chimera:saves:list', args: ['sample-game'] }]);
    });

    it('save() invokes chimera:saves:save with the SaveRequest verbatim', async () => {
        const request = { gameId: 'sample-game', label: 'autosave' } as const;
        await api.saves.save(request);
        expect(invokeCalls).toEqual([{ channel: 'chimera:saves:save', args: [request] }]);
        expect(invokeCalls[0]?.args[0]).toBe(request);
    });

    it('load() invokes chimera:saves:load with the slotId', async () => {
        await api.saves.load('slot-a');
        expect(invokeCalls).toEqual([{ channel: 'chimera:saves:load', args: ['slot-a'] }]);
    });

    it('delete() invokes chimera:saves:delete with the slotId', async () => {
        await api.saves.delete('slot-a');
        expect(invokeCalls).toEqual([{ channel: 'chimera:saves:delete', args: ['slot-a'] }]);
    });

    it('onSlotUpdate() registers on chimera:saves:slot-update; Unsubscribe removes it', () => {
        const calls: unknown[] = [];
        const unsubscribe = api.saves.onSlotUpdate((slots) => {
            calls.push(slots);
        });
        expect(listeners.get('chimera:saves:slot-update')?.size).toBe(1);

        const slots = [{ slotId: 'slot-a', gameId: 'sample-game', tick: 1, savedAt: 0 }];
        emit('chimera:saves:slot-update', slots);
        expect(calls).toEqual([slots]);

        unsubscribe();
        expect(listeners.get('chimera:saves:slot-update')?.size).toBe(0);
    });
});

// ─── settings namespace ──────────────────────────────────────────────────────

describe('window.__chimera.settings — contract', () => {
    let api: ChimeraAPI;

    beforeEach(async () => {
        api = await loadApi();
    });

    it('get() invokes chimera:settings:get with the gameId', async () => {
        await api.settings.get('sample-game');
        expect(invokeCalls).toEqual([{ channel: 'chimera:settings:get', args: ['sample-game'] }]);
    });

    it('update() invokes chimera:settings:update with (gameId, patch) verbatim', async () => {
        const patch = { masterVolume: 0.5 };
        await api.settings.update('sample-game', patch);
        expect(invokeCalls).toEqual([
            { channel: 'chimera:settings:update', args: ['sample-game', patch] },
        ]);
        expect(invokeCalls[0]?.args[1]).toBe(patch);
    });

    it('reset() invokes chimera:settings:reset with the gameId', async () => {
        await api.settings.reset('sample-game');
        expect(invokeCalls).toEqual([{ channel: 'chimera:settings:reset', args: ['sample-game'] }]);
    });

    it('onChange() registers on chimera:settings:change; Unsubscribe removes it', () => {
        const calls: { id: string; settings: unknown }[] = [];
        const unsubscribe = api.settings.onChange((id, settings) => {
            calls.push({ id, settings });
        });
        expect(listeners.get('chimera:settings:change')?.size).toBe(1);

        const settings = { masterVolume: 0.25 };
        emit('chimera:settings:change', 'sample-game', settings);
        expect(calls).toEqual([{ id: 'sample-game', settings }]);

        unsubscribe();
        expect(listeners.get('chimera:settings:change')?.size).toBe(0);
    });
});

// ─── system namespace ────────────────────────────────────────────────────────

describe('window.__chimera.system — contract', () => {
    let api: ChimeraAPI;

    beforeEach(async () => {
        api = await loadApi();
    });

    it('platform() invokes chimera:system:platform with no arguments', async () => {
        await api.system.platform();
        expect(invokeCalls).toEqual([{ channel: 'chimera:system:platform', args: [] }]);
    });

    it('quit() sends to chimera:system:quit with no payload', () => {
        api.system.quit();
        expect(sendCalls).toEqual([{ channel: 'chimera:system:quit', args: [] }]);
    });

    it('onConnectionStatus() registers on chimera:system:connection-status; Unsubscribe removes it', () => {
        const calls: unknown[] = [];
        const unsubscribe = api.system.onConnectionStatus((status) => {
            calls.push(status);
        });
        expect(listeners.get('chimera:system:connection-status')?.size).toBe(1);

        emit('chimera:system:connection-status', 'connected');
        expect(calls).toEqual(['connected']);

        unsubscribe();
        expect(listeners.get('chimera:system:connection-status')?.size).toBe(0);
    });
});
