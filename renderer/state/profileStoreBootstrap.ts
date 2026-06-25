/**
 * renderer/state/profileStoreBootstrap.ts
 *
 * Side-effect-free bootstrap function that wires profile directory push events
 * into the profileStore singleton.
 */

import type { ProfileAPI, Unsubscribe } from '@chimera/simulation/bridge/api-types.js';
import { useProfileStore } from './profileStore';

export function bootstrapProfileStore(
    api: Pick<ProfileAPI, 'onDirectoryChanged' | 'getLocalProfile'>,
): Unsubscribe {
    const unsubscribe = api.onDirectoryChanged((directory) => {
        useProfileStore.getState().applyProfileDirectory(directory);
    });

    void api
        .getLocalProfile()
        .then((profile) => {
            useProfileStore.getState().setLocalProfileId(profile.localProfileId);
        })
        .catch(() => {
            useProfileStore.getState().setLocalProfileId(null);
        });

    return unsubscribe;
}
