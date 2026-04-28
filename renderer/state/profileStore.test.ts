// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
    createProfileStore,
    useLocalProfile,
    useProfileDirectory,
    useProfileStore,
} from './profileStore';
import { makeDirectory } from './__test-support__/profileFixtures';

describe('profileStore', () => {
    beforeEach(() => {
        useProfileStore.getState().applyProfileDirectory({});
        useProfileStore.getState().setLocalProfileId(null);
    });

    it('initializes with empty directory and null local profile id', () => {
        const store = createProfileStore();

        expect(store.getState().directory).toEqual({});
        expect(store.getState().localProfileId).toBeNull();
    });

    it('useProfileDirectory() returns current directory', () => {
        const directory = makeDirectory();

        useProfileStore.getState().applyProfileDirectory(directory);

        const { result } = renderHook(() => useProfileDirectory());
        expect(result.current).toEqual(directory);
    });

    it('useLocalProfile() returns profile matching localProfileId', () => {
        const directory = makeDirectory();

        useProfileStore.getState().applyProfileDirectory(directory);
        useProfileStore.getState().setLocalProfileId('local-b');

        const { result } = renderHook(() => useLocalProfile());
        expect(result.current).toEqual(directory['playerB']);
    });

    it('useLocalProfile() returns null when no profile matches localProfileId', () => {
        const directory = makeDirectory();

        useProfileStore.getState().applyProfileDirectory(directory);
        useProfileStore.getState().setLocalProfileId('missing-profile');

        const { result } = renderHook(() => useLocalProfile());
        expect(result.current).toBeNull();
    });
});
