// electron/preload/listener.ts
//
// Shared helpers for main→renderer push-channel subscriptions. Every
// preload namespace (`system`, `lobby`, `saves`, `settings`, `game`) exposes
// at least one `onXxx(cb): Unsubscribe` method that registers an
// `ipcRenderer.on` listener, forwards the payload to `cb`, and returns an
// `Unsubscribe` closure that calls `ipcRenderer.removeListener`. Each namespace
// would otherwise duplicate an `XxxApiListener` alias identical to
// `IpcListener` below plus a ~7-line listener body (typed listener → ipc.on →
// Unsubscribe). Centralising the subscribe/unsubscribe lifecycle collapses each
// call site to one line and gives the pattern a single canonical implementation.
//
// Scope boundary: this module is transport-level only. It does not import
// channel constants, does not know about any specific payload type, and is
// NOT a place to declare namespace IPC contracts (those stay per-namespace,
// invariant 5). The helpers are a thin generic utility — nothing more.

import type { z } from 'zod';
import type { Unsubscribe } from '../api-types.js';
import { PreloadIpcValidationError, parseInvokeResponse } from './schemas.js';

/**
 * Shape of a renderer-side `ipcRenderer` listener. Electron's real
 * signature is `(event: IpcRendererEvent, ...args: unknown[]) => void`. We
 * keep the event argument typed as `unknown` so a test stub can invoke the
 * listener with any payload shape; the first positional argument after the
 * event is the channel payload (single-arg case) or a tuple (multi-arg,
 * e.g. `chimera:settings:change` → `(gameId, settings)`).
 *
 * The single alias every preload namespace shares instead of declaring a
 * private `XxxApiListener` of the same shape.
 */
export type IpcListener = (event: unknown, ...args: unknown[]) => void;

/**
 * Narrow port exposing just the `on` / `removeListener` slice of
 * `ipcRenderer` that a push-channel subscription needs. Each per-namespace
 * `XxxApiIpcPort` interface `extends PushListenerPort` so the namespaces
 * still declare their own `invoke` / `send` shapes (which legitimately
 * differ — e.g. `saves` has no `send`) without redeclaring the push-channel
 * surface.
 */
export interface PushListenerPort {
    on(channel: string, listener: IpcListener): void;
    removeListener(channel: string, listener: IpcListener): void;
}

/**
 * Register a listener on a single-payload main→renderer push channel.
 * Returns an {@link Unsubscribe} that removes exactly the listener this
 * call registered — other subscriptions on the same channel are unaffected.
 *
 * `T` is the declared payload type. The `as T` cast is deliberate: the
 * preload contract declares the callback signature, and main is trusted to
 * push a conforming payload on the wire. Call sites that need a stronger guarantee
 * (e.g. `chimera:game:action-rejected` where drift would surface as
 * garbage in a React error boundary) use {@link subscribeValidatedPush}
 * instead.
 */
export function subscribePush<T>(
    port: PushListenerPort,
    channel: string,
    cb: (payload: T) => void,
): Unsubscribe {
    const listener: IpcListener = (_event, ...args) => {
        cb(args[0] as T);
    };
    port.on(channel, listener);
    return () => {
        port.removeListener(channel, listener);
    };
}

/**
 * Register a listener on a single-payload push channel AND validate the
 * payload against `schema` before invoking `cb`. A malformed push throws
 * {@link import('./schemas.js').PreloadIpcValidationError} naming the
 * channel, so main-side drift surfaces as a single clear error at the
 * boundary instead of propagating as garbage into renderer state.
 *
 * Used for push channels where the payload carries user-visible semantics
 * and silent drift would be a debugging nightmare (today: only
 * `chimera:game:action-rejected`; future candidates include snapshot /
 * commitment reveal pushes once they are wired).
 */
export function subscribeValidatedPush<T>(
    port: PushListenerPort,
    channel: string,
    schema: z.ZodType<T>,
    cb: (payload: T) => void,
): Unsubscribe {
    const listener: IpcListener = (_event, ...args) => {
        cb(parseInvokeResponse(schema, channel, args[0]));
    };
    port.on(channel, listener);
    return () => {
        port.removeListener(channel, listener);
    };
}

/**
 * Fail-closed variant of {@link subscribeValidatedPush}: a malformed push is
 * logged via `logInvalid` and DROPPED — `cb` never sees it and nothing
 * throws, so one bad push cannot take down a renderer subscription that
 * outlives it (e.g. a status overlay). Valid pushes keep flowing afterwards.
 *
 * Used for lifecycle push channels the renderer merely observes (today:
 * `chimera:saves:restore-status`). Channels where drift must be
 * LOUD (a rejected action disappearing would be a debugging nightmare) stay
 * on the throwing {@link subscribeValidatedPush}.
 *
 * `logInvalid` defaults to `console.error` — the preload layer has no
 * injected logger, and the renderer devtools console is where a developer
 * looks first. It is injectable so tests stay spy-free and a future preload
 * logger can slot in.
 */
export function subscribeGuardedPush<T>(
    port: PushListenerPort,
    channel: string,
    schema: z.ZodType<T>,
    cb: (payload: T) => void,
    logInvalid: (error: PreloadIpcValidationError) => void = (error) => {
        console.error(error.message);
    },
): Unsubscribe {
    const listener: IpcListener = (_event, ...args) => {
        let payload: T;
        try {
            payload = parseInvokeResponse(schema, channel, args[0]);
        } catch (error) {
            if (error instanceof PreloadIpcValidationError) {
                logInvalid(error);
                return;
            }
            throw error;
        }
        cb(payload);
    };
    port.on(channel, listener);
    return () => {
        port.removeListener(channel, listener);
    };
}
