// electron/preload/debug-api.ts
//
// Inspector window preload runtime entry point (§4.12 — Runtime Debug
// Layer). Electron loads this file (after bundling to
// `electron/preload/debug-api.js`) as the preload of the Inspector
// `BrowserWindow` created by `electron/main/debug-bridge.ts` — and of no
// other window. The side effect at the bottom is the one and only call to
// `contextBridge.exposeInMainWorld` for `__chimeraDebug` (Invariant 28: the
// game renderer's `api.ts` must never expose any debug surface).
//
// The full type surface of `window.__chimeraDebug` lives in
// `electron/preload/debug-api-types.ts`; this module owns only the runtime
// wiring. Protocol types are consumed via `import type`, so this module has
// zero runtime coupling to `simulation/debug` (Invariant #27).
//
// The debug channel constants live in `shared/constants.ts` — the documented
// exception to the per-namespace channel rule — so this preload and the main
// bridge share the same literals without importing the debug module graph.
//
// Responses are not Zod-validated here: the bridge sender-validates and
// Zod-validates every request (Invariant #29) and never throws on the invoke
// channel — failures come back as `{ type: 'ERROR' }`. A discriminant check
// suffices, matching the `subscribePush` trust precedent in
// `shared/listener.ts`.

import { contextBridge, ipcRenderer } from 'electron';
import { DEBUG_CHANNEL, DEBUG_PUSH_CHANNEL } from '@chimera/shared/constants.js';
import type { DebugRequest, DebugResponse } from '@chimera/simulation/debug/DebugProtocol.js';
import type { ChimeraDebugApi } from './debug-api-types.js';
import type { PushListenerPort } from './shared/listener.js';
import { subscribePush } from './shared/listener.js';

/**
 * Narrow port over `ipcRenderer`. Extends {@link PushListenerPort} for the
 * on/removeListener slice and adds the `invoke` method every query uses.
 * Unit tests inject a pure in-memory stub instead of mocking Electron.
 */
export interface DebugApiIpcPort extends PushListenerPort {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
}

/**
 * Send one {@link DebugRequest} over the `chimera:debug` invoke channel and
 * unwrap the matching {@link DebugResponse} variant.
 *
 * Rejections: an `ERROR` response (checked first, so a bridge failure never
 * reports as a mismatch), a malformed/absent response (e.g. no handler in a
 * misconfigured window), or a discriminant mismatch. Transport rejections
 * from `invoke` itself propagate untouched.
 */
async function request<K extends DebugResponse['type']>(
    port: DebugApiIpcPort,
    expected: K,
    req: DebugRequest,
): Promise<Extract<DebugResponse, { type: K }>> {
    const raw: unknown = await port.invoke(DEBUG_CHANNEL, req);
    if (raw === null || typeof raw !== 'object' || !('type' in raw)) {
        throw new Error(
            `chimera:debug ${req.type}: malformed response (expected ${expected}, got ${String(raw)})`,
        );
    }
    const response = raw as DebugResponse;
    if (response.type === 'ERROR') {
        throw new Error(`chimera:debug ${req.type} failed: ${response.message}`);
    }
    if (response.type !== expected) {
        throw new Error(
            `chimera:debug ${req.type}: expected ${expected} response, got ${response.type}`,
        );
    }
    return response as Extract<DebugResponse, { type: K }>;
}

/**
 * Build the `window.__chimeraDebug` surface — one method per
 * {@link DebugRequest} variant plus the `onLiveTick` push subscription. The
 * caller supplies the `ipcRenderer` port so the factory has no hidden
 * dependency on the Electron module graph.
 */
export function createDebugApi(port: DebugApiIpcPort): ChimeraDebugApi {
    return {
        listTicks: () =>
            request(port, 'TICK_LIST', { type: 'GET_TICK_LIST' }).then((res) => res.ticks),
        getSnapshot: (tick) =>
            request(port, 'SNAPSHOT', { type: 'GET_SNAPSHOT', tick }).then(
                ({ tick: resolvedTick, snapshot }) => ({ tick: resolvedTick, snapshot }),
            ),
        getProjection: (tick, playerId) =>
            request(port, 'PROJECTION', { type: 'GET_PROJECTION', tick, playerId }).then(
                ({ tick: resolvedTick, playerId: resolvedPlayerId, snapshot }) => ({
                    tick: resolvedTick,
                    playerId: resolvedPlayerId,
                    snapshot,
                }),
            ),
        diff: (fromTick, toTick) =>
            request(port, 'DIFF', { type: 'GET_DIFF', fromTick, toTick }).then((res) => res.diff),
        getActionLog: (fromTick, toTick) =>
            request(port, 'ACTION_LOG', {
                type: 'GET_ACTION_LOG',
                // Bounds are "absent, not undefined" — the bridge's Zod
                // schema and the protocol's JSON-serialization convention
                // distinguish a missing key from an undefined value.
                ...(fromTick !== undefined ? { fromTick } : {}),
                ...(toTick !== undefined ? { toTick } : {}),
            }).then((res) => res.entries),
        getPerfStats: () =>
            request(port, 'PERF_STATS', { type: 'GET_PERF_STATS' }).then((res) => res.stats),
        subscribeLive: () => request(port, 'ACK', { type: 'SUBSCRIBE_LIVE' }).then(() => undefined),
        unsubscribeLive: () =>
            request(port, 'ACK', { type: 'UNSUBSCRIBE_LIVE' }).then(() => undefined),
        onLiveTick: (cb) =>
            subscribePush<DebugResponse | undefined>(port, DEBUG_PUSH_CHANNEL, (payload) => {
                // Anything that is not a LIVE_TICK push is silently ignored.
                if (payload?.type === 'LIVE_TICK') {
                    cb({ tick: payload.tick, snapshot: payload.snapshot });
                }
            }),
    };
}

const port: DebugApiIpcPort = {
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
    on: (channel, listener) => {
        ipcRenderer.on(channel, listener);
    },
    removeListener: (channel, listener) => {
        ipcRenderer.removeListener(channel, listener);
    },
};

contextBridge.exposeInMainWorld('__chimeraDebug', createDebugApi(port));
