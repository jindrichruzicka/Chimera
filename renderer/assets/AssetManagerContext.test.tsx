// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { AssetManager } from './AssetManager';
import { AssetManagerContext, useAssetManager } from './AssetManagerContext.js';

afterEach(() => {
    cleanup();
});

function createAssetManagerStub(): AssetManager {
    return {
        registerManifest(): void {},
        async preloadCritical(): Promise<void> {},
        get(): null {
            return null;
        },
        async load(): Promise<never> {
            throw new Error('unused asset manager stub');
        },
        dispose(): void {},
    };
}

describe('AssetManagerContext', () => {
    it('throws a descriptive error when used outside the provider', () => {
        expect(() => renderHook(() => useAssetManager())).toThrow(
            'useAssetManager must be used inside AssetManagerContext.Provider',
        );
    });

    it('returns the injected AssetManager instance inside the provider', () => {
        const manager = createAssetManagerStub();
        const wrapper = ({
            children,
        }: {
            readonly children: React.ReactNode;
        }): React.ReactElement => (
            <AssetManagerContext.Provider value={manager}>{children}</AssetManagerContext.Provider>
        );

        const { result } = renderHook(() => useAssetManager(), { wrapper });

        expect(result.current).toBe(manager);
    });
});
