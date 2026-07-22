'use client';

// renderer/app/LoggingBootstrap.tsx
//
// Installs the renderer logging bridge (§4.27, Invariant #67). The renderer has
// no injected Logger: installRendererLogger patches console.warn/console.error
// and forwards over window.__chimera.logs, so those two methods *are* the
// sanctioned channel — and anything logged before the patch lands is lost.
//
// The install therefore runs during render, not in an effect: React runs a
// parent's render strictly before any child's effect, so an effect here would
// miss everything <Providers> logs while rendering (its AudioManager-init warn,
// among others). AppShell mounts this as its first child so the patch is live
// before any later sibling renders. The guarantee is bounded at React: client-
// bundle module evaluation (e.g. the chimera-game-registration side-effect
// import) precedes every render and sits outside the bridge.
// renderer/app/AppShell.test.tsx pins the ordering end to end; this file's own
// tests pin the install's idempotency, its StrictMode re-arm, its ownership
// discipline, and its teardown.

import { useEffect } from 'react';
import type { LogsAPI } from '@chimera-engine/simulation/bridge/api-types.js';
import { installRendererLogger } from '../logging/rendererLogger';

// Module scope, not component state: the install has to survive a render that
// React discards, and the effect below has to be able to re-arm it after
// StrictMode's simulated unmount (every Next host in the tree sets
// reactStrictMode: true — apps/<game>/renderer/next.config.ts and the scaffold
// template) without re-running the render-phase call.
let activeTeardown: (() => void) | null = null;
let mountedCount = 0;

function ensureInstalled(): void {
    if (activeTeardown !== null) return;

    const logsApi = resolveLogsApi();
    // null during the static-export prerender (no window) and in any host
    // without the preload bridge — nothing to forward to, so stay unpatched.
    if (logsApi === null) return;

    // installRendererLogger returns null when the bridge is already installed
    // (e.g. after a Fast Refresh re-evaluated this module but not the logger's):
    // never claim — and later run — a teardown this module did not create. The
    // bridge keeps forwarding under its real owner; the next render after that
    // owner tears down re-installs here.
    activeTeardown = installRendererLogger(logsApi);
}

function uninstall(): void {
    // Clear the claim before invoking so a throwing teardown cannot leave a
    // stale one behind that blocks every future re-install — the same
    // guard-both-steps rule Invariant #67 imposes on refuseToStart.
    const teardown = activeTeardown;
    activeTeardown = null;
    teardown?.();
}

export function LoggingBootstrap(): null {
    ensureInstalled();

    useEffect(() => {
        // StrictMode runs mount → cleanup → mount; the cleanup below uninstalls,
        // and the render-phase call above does not run again, so the effect is
        // what puts the bridge back. Idempotent for every other mount. The
        // count keeps a second mounted bootstrap alive when the first unmounts.
        mountedCount += 1;
        ensureInstalled();
        return () => {
            mountedCount -= 1;
            if (mountedCount === 0) uninstall();
        };
    }, []);

    return null;
}

function resolveLogsApi(): LogsAPI | null {
    if (typeof window === 'undefined') return null;

    const chimera = (window as unknown as { __chimera?: unknown }).__chimera;
    const logs = (chimera as { logs?: unknown } | null | undefined)?.logs;

    if (!isLogsApi(logs)) return null;
    return logs;
}

function isLogsApi(value: unknown): value is LogsAPI {
    if (value === null || typeof value !== 'object') return false;

    const candidate = value as Partial<Record<keyof LogsAPI, unknown>>;
    return typeof candidate.emit === 'function' && typeof candidate.readRecent === 'function';
}
