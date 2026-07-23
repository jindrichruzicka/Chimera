// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    SetGameAssetManagerContext,
    useSetGameAssetManager,
} from './SetGameAssetManagerContext.js';

afterEach(() => {
    cleanup();
});

describe('SetGameAssetManagerContext', () => {
    it('throws a descriptive error when used outside the provider', () => {
        expect(() => renderHook(() => useSetGameAssetManager())).toThrow(
            'useSetGameAssetManager() must be used within the app root (inside <Providers>).',
        );
    });

    it('returns the injected setter inside the provider', () => {
        const setGameAssetManager = vi.fn();
        const wrapper = ({
            children,
        }: {
            readonly children: React.ReactNode;
        }): React.ReactElement => (
            <SetGameAssetManagerContext.Provider value={setGameAssetManager}>
                {children}
            </SetGameAssetManagerContext.Provider>
        );

        const { result } = renderHook(() => useSetGameAssetManager(), { wrapper });

        expect(result.current).toBe(setGameAssetManager);
    });
});
