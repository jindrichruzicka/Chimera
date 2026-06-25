// renderer/components/debug/liveSubscription.ts
//
// Refcounted access to the bridge's LIVE_TICK subscription. Main-side
// subscription state is one slot per window (`debug-bridge.ts` keys it by
// sender id), so if every panel called `subscribeLive()`/`unsubscribeLive()`
// directly, the first panel to unmount would silently kill the pushes for
// every other panel in the window. Panels acquire through here instead:
// only the first holder subscribes and only the last release unsubscribes.
//
// Counts are keyed per api instance (a WeakMap, so a torn-down bridge can
// be collected); a window reload drops the renderer-side count with the
// page, and the main side cleans its slot up on window close regardless.

import type { ChimeraDebugApi } from '@chimera/simulation/bridge/debug-api-types.js';

const holderCounts = new WeakMap<ChimeraDebugApi, number>();

/**
 * Join the window's shared live-tick subscription. Returns an idempotent
 * release function; bridge failures are swallowed (live pushes are an
 * enhancement — panels render their fetched data regardless).
 */
export function acquireLiveSubscription(api: ChimeraDebugApi): () => void {
    const holders = (holderCounts.get(api) ?? 0) + 1;
    holderCounts.set(api, holders);
    if (holders === 1) {
        void api.subscribeLive().catch(() => {
            // Live pushes unavailable; fetched data still renders.
        });
    }

    let released = false;
    return () => {
        if (released) {
            return;
        }
        released = true;
        const remaining = Math.max(0, (holderCounts.get(api) ?? 0) - 1);
        holderCounts.set(api, remaining);
        if (remaining === 0) {
            void api.unsubscribeLive().catch(() => {
                // Main side cleans up on window close regardless.
            });
        }
    };
}
