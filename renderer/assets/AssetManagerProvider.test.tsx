// @vitest-environment jsdom

import { cleanup, render, renderHook, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetManager } from './AssetManager';
import { useAssetManager } from './AssetManagerContext.js';
import { AssetManagerProvider } from './AssetManagerProvider.js';

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
        getManifestMetadata(): unknown {
            return undefined;
        },
        async load(): Promise<never> {
            throw new Error('unused stub load');
        },
        dispose(): void {},
    };
}

describe('AssetManagerProvider', () => {
    it("publishes the manager to a child's useAssetManager()", () => {
        const manager = createAssetManagerStub();

        function Probe(): React.ReactElement {
            const provided = useAssetManager();
            return (
                <div
                    data-testid="provider-probe"
                    data-provided={provided === manager ? 'yes' : 'no'}
                />
            );
        }

        render(
            <AssetManagerProvider assetManager={manager}>
                <Probe />
            </AssetManagerProvider>,
        );

        expect(screen.getByTestId('provider-probe').getAttribute('data-provided')).toBe('yes');
    });

    it('outside any provider the hook still throws (Invariant #83)', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { result } = renderHook(() => {
            try {
                useAssetManager();
                return 'no-throw';
            } catch {
                return 'threw';
            }
        }, {});
        consoleError.mockRestore();

        expect(result.current).toBe('threw');
    });
});
