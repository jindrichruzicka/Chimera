// @vitest-environment jsdom
// renderer/assets/__tests__/environment-map-refusal-handle.test.tsx
//
// How a game recognises an `environment-map` entry whose extension the engine
// does not decode: `useAsset` reports the rejection as its `error`, and the game
// tests that against the class the public assets barrel exports.
//
// What is held is the BARREL's binding to the class the loader throws, not the
// loader module's own. The manager is the real one, because what is measured is what the loader
// throws rather than what a double was told to reject with.

import { cleanup, renderHook, waitFor, type RenderHookResult } from '@testing-library/react';
import React, { type ReactElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import {
    buildAssetRef,
    type AssetRef,
    type EnvironmentMapAsset,
} from '@chimera-engine/simulation/content/AssetRef.js';

import { DefaultAssetManager } from '../AssetManager.js';
import {
    AssetManagerProvider,
    UnknownAssetManifestEntryError,
    UnsupportedEnvironmentMapFormatError,
    useAsset,
    type UseAssetState,
} from '../index.js';

const PNG_SKY = buildAssetRef<EnvironmentMapAsset>('demo', 'environment/sky.png');
/** Never declared, so its load fails for a reason that is not the format. */
const UNDECLARED_SKY = buildAssetRef<EnvironmentMapAsset>('demo', 'environment/absent.hdr');

afterEach(() => {
    cleanup();
});

function renderLoad(
    ref: AssetRef<EnvironmentMapAsset>,
): RenderHookResult<UseAssetState<EnvironmentMapAsset>, unknown> {
    const assetManager = new DefaultAssetManager({ resolve: () => 'unused:' }, undefined, {
        gameId: 'demo',
        entries: [{ ref: PNG_SKY, kind: 'environment-map', priority: 'deferred' }],
    });
    const wrapper = ({ children }: { readonly children: ReactNode }): ReactElement => (
        <AssetManagerProvider assetManager={assetManager}>{children}</AssetManagerProvider>
    );
    return renderHook(() => useAsset(ref), { wrapper });
}

describe('recognising a refused environment-map format through the assets barrel', () => {
    it("reports the refusal as the barrel's class, carrying the ref and the refused extension", async () => {
        const { result } = renderLoad(PNG_SKY);
        await waitFor(() => expect(result.current.loading).toBe(false));

        const { error } = result.current;
        expect(error).toBeInstanceOf(UnsupportedEnvironmentMapFormatError);
        if (!(error instanceof UnsupportedEnvironmentMapFormatError)) {
            throw new Error('unreachable: the assertion above has already failed');
        }
        // `ref` and `extension` are typed only on the narrowed error.
        expect(error.ref).toBe(PNG_SKY);
        expect(error.extension).toBe('.png');
    });

    it('does not match a load that failed for another reason', async () => {
        const { result } = renderLoad(UNDECLARED_SKY);
        await waitFor(() => expect(result.current.loading).toBe(false));

        expect(result.current.error).toBeInstanceOf(UnknownAssetManifestEntryError);
        expect(result.current.error).not.toBeInstanceOf(UnsupportedEnvironmentMapFormatError);
    });
});
