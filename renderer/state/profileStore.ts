/**
 * renderer/state/profileStore.ts
 *
 * Zustand store for the profile directory mirrored from IPC.
 *
 * Invariant #62: profile data is read from profileStore, never from PlayerSnapshot.
 */

import { createStore, useStore } from 'zustand';
import type { StoreApi } from 'zustand';
import type { PlayerId, PlayerProfile } from '@chimera-engine/simulation/bridge/api-types.js';

export interface ProfileStoreState {
    /** Current lobby profile directory keyed by PlayerId. */
    readonly directory: Readonly<Record<PlayerId, PlayerProfile>>;

    /** Local machine profile identifier for selecting the local profile entry. */
    readonly localProfileId: string | null;

    /**
     * Apply incoming profile directory from IPC.
     * ipcClient only — do NOT call from components directly.
     */
    applyProfileDirectory(directory: Readonly<Record<PlayerId, PlayerProfile>>): void;

    /**
     * Set the local profile id used by useLocalProfile().
     * ipcClient only — do NOT call from components directly.
     */
    setLocalProfileId(localProfileId: string | null): void;
}

export function createProfileStore(): StoreApi<ProfileStoreState> {
    return createStore<ProfileStoreState>()((set) => ({
        directory: {},
        localProfileId: null,

        applyProfileDirectory(directory: Readonly<Record<PlayerId, PlayerProfile>>): void {
            set(() => ({
                directory,
            }));
        },

        setLocalProfileId(localProfileId: string | null): void {
            set(() => ({
                localProfileId,
            }));
        },
    }));
}

const profileStoreInstance = createProfileStore();

export function useProfileStore<T>(selector: (state: ProfileStoreState) => T): T {
    return useStore(profileStoreInstance, selector);
}

useProfileStore.getState = profileStoreInstance.getState.bind(profileStoreInstance);
useProfileStore.subscribe = profileStoreInstance.subscribe.bind(profileStoreInstance);

export function useProfileDirectory(): Readonly<Record<PlayerId, PlayerProfile>> {
    return useProfileStore((state) => state.directory);
}

function selectLocalProfile(state: ProfileStoreState): PlayerProfile | null {
    if (state.localProfileId === null) {
        return null;
    }

    for (const profile of Object.values(state.directory)) {
        if (profile.localProfileId === state.localProfileId) {
            return profile;
        }
    }

    return null;
}

export function useLocalProfile(): PlayerProfile | null {
    return useProfileStore(selectLocalProfile);
}
