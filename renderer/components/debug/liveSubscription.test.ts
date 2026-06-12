// renderer/components/debug/liveSubscription.test.ts
//
// The main-side LIVE_TICK subscription is window-scoped (one slot per
// sender in `debug-bridge.ts`), so panels must share it: only the first
// holder may subscribe and only the last release may unsubscribe.

import { describe, expect, it, vi } from 'vitest';
import { createDebugApiMock } from './__test-support__/DebugApiStubs';
import { acquireLiveSubscription } from './liveSubscription';

describe('acquireLiveSubscription', () => {
    it('subscribes on the first acquire only', () => {
        const api = createDebugApiMock();

        acquireLiveSubscription(api);
        acquireLiveSubscription(api);

        expect(api.subscribeLive).toHaveBeenCalledTimes(1);
    });

    it('keeps the subscription until the last holder releases', () => {
        const api = createDebugApiMock();

        const releaseFirst = acquireLiveSubscription(api);
        const releaseSecond = acquireLiveSubscription(api);

        releaseFirst();
        expect(api.unsubscribeLive).not.toHaveBeenCalled();

        releaseSecond();
        expect(api.unsubscribeLive).toHaveBeenCalledTimes(1);
    });

    it('ignores a double release of the same handle', () => {
        const api = createDebugApiMock();

        const releaseFirst = acquireLiveSubscription(api);
        acquireLiveSubscription(api);

        releaseFirst();
        releaseFirst();

        expect(api.unsubscribeLive).not.toHaveBeenCalled();
    });

    it('re-subscribes after a full release and re-acquire cycle', () => {
        const api = createDebugApiMock();

        const release = acquireLiveSubscription(api);
        release();
        acquireLiveSubscription(api);

        expect(api.subscribeLive).toHaveBeenCalledTimes(2);
        expect(api.unsubscribeLive).toHaveBeenCalledTimes(1);
    });

    it('tracks each api instance independently', () => {
        const first = createDebugApiMock();
        const second = createDebugApiMock();

        acquireLiveSubscription(first);
        const releaseSecond = acquireLiveSubscription(second);
        releaseSecond();

        expect(first.unsubscribeLive).not.toHaveBeenCalled();
        expect(second.unsubscribeLive).toHaveBeenCalledTimes(1);
    });

    it('swallows subscribe and unsubscribe rejections', async () => {
        const api = createDebugApiMock();
        vi.mocked(api.subscribeLive).mockRejectedValue(new Error('bridge unavailable'));
        vi.mocked(api.unsubscribeLive).mockRejectedValue(new Error('bridge unavailable'));

        const release = acquireLiveSubscription(api);
        release();

        // Rejections must be caught inside the helper; an unhandled
        // rejection here would fail the run after this flush.
        await new Promise((resolve) => {
            setTimeout(resolve, 0);
        });
        expect(api.subscribeLive).toHaveBeenCalledTimes(1);
        expect(api.unsubscribeLive).toHaveBeenCalledTimes(1);
    });
});
