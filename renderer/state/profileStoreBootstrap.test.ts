// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileAPI, Unsubscribe } from '@chimera-engine/simulation/bridge/api-types.js';
import { bootstrapProfileStore } from './profileStoreBootstrap';
import { useProfileStore } from './profileStore';
import { makeDirectory, makeProfile } from './__test-support__/profileFixtures';

function makeProfileApi(
    onDirectoryChangedImpl?: (
        listener: Parameters<ProfileAPI['onDirectoryChanged']>[0],
    ) => Unsubscribe,
    getLocalProfileImpl?: () => ReturnType<ProfileAPI['getLocalProfile']>,
): Pick<ProfileAPI, 'onDirectoryChanged' | 'getLocalProfile'> {
    return {
        getLocalProfile: vi.fn(
            getLocalProfileImpl ?? (() => Promise.resolve(makeProfile('local-a', 'Alice'))),
        ),
        onDirectoryChanged: vi.fn(onDirectoryChangedImpl ?? (() => vi.fn())),
    };
}

describe('bootstrapProfileStore()', () => {
    beforeEach(() => {
        useProfileStore.getState().applyProfileDirectory({});
        useProfileStore.getState().setLocalProfileId(null);
    });

    it('registers directory change listener on profile API', () => {
        const api = makeProfileApi();

        bootstrapProfileStore(api);

        expect(api.onDirectoryChanged).toHaveBeenCalledOnce();
    });

    it('returns unsubscribe function from profile API', () => {
        const unsubscribe = vi.fn();
        const api = makeProfileApi(() => unsubscribe);

        const stop = bootstrapProfileStore(api);

        expect(typeof stop).toBe('function');
        stop();
        expect(unsubscribe).toHaveBeenCalledOnce();
    });

    it('updates store directory when profile directory push event arrives', () => {
        let capturedListener: Parameters<ProfileAPI['onDirectoryChanged']>[0] | undefined;
        const api = makeProfileApi((listener) => {
            capturedListener = listener;
            return vi.fn();
        });

        bootstrapProfileStore(api);
        expect(capturedListener).toBeDefined();

        const incoming = makeDirectory();
        capturedListener!(incoming);

        expect(useProfileStore.getState().directory).toEqual(incoming);
    });

    it('hydrates localProfileId from getLocalProfile during bootstrap', async () => {
        const api = makeProfileApi(
            () => vi.fn(),
            () => Promise.resolve(makeProfile('local-hydrated', 'Hydrated')),
        );

        bootstrapProfileStore(api);
        await Promise.resolve();

        expect(api.getLocalProfile).toHaveBeenCalledOnce();
        expect(useProfileStore.getState().localProfileId).toBe('local-hydrated');
    });
});
