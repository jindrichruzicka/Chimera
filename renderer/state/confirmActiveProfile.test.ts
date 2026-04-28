// renderer/state/confirmActiveProfile.test.ts
// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { confirmActiveProfile } from './confirmActiveProfile';
import { useProfileStore } from './profileStore';

describe('confirmActiveProfile', () => {
    it('calls getLocalProfile and writes localProfileId into profileStore', async () => {
        useProfileStore.getState().setLocalProfileId(null);

        const getLocalProfile = vi.fn(async () => ({
            localProfileId: 'local-b',
            displayName: 'Bob',
            avatar: { kind: 'builtin' as const, ref: 'avatar/default' as never },
            locale: 'en',
        }));

        await confirmActiveProfile({ getLocalProfile });

        expect(getLocalProfile).toHaveBeenCalledOnce();
        expect(useProfileStore.getState().localProfileId).toBe('local-b');
    });
});
