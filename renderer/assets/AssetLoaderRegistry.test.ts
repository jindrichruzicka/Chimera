import { describe, expect, it, vi } from 'vitest';

import { type AssetKindBrand, buildAssetRef } from '@chimera/simulation/content/AssetRef.js';

import {
    createAssetLoaderRegistry,
    DuplicateAssetLoaderError,
    type AssetLoadRequest,
    type AssetLoader,
    UnknownAssetKindError,
} from './AssetLoaderRegistry';

interface RendererTestAsset extends AssetKindBrand<'renderer:test-asset'> {
    readonly __rendererTestAsset: unique symbol;
}

declare module '@chimera/simulation/foundation/asset-contract.js' {
    interface AssetKindRegistry {
        readonly 'renderer:test-asset': RendererTestAsset;
    }
}

describe('createAssetLoaderRegistry', () => {
    it('returns loaders registered for custom asset kinds', async () => {
        const ref = buildAssetRef<RendererTestAsset>('renderer-test', 'assets/sample.bin');
        const load = vi.fn(async (request: AssetLoadRequest<RendererTestAsset>) => ({
            kind: request.kind,
            url: request.url,
        }));
        const loader: AssetLoader<RendererTestAsset> = {
            kind: 'renderer:test-asset',
            load,
        };
        const registry = createAssetLoaderRegistry([loader]);

        const resolvedLoader = registry.get<RendererTestAsset>('renderer:test-asset');
        const loaded = await resolvedLoader.load({
            ref,
            kind: 'renderer:test-asset',
            url: 'resolved://renderer-test/assets/sample.bin',
        });

        expect(loaded).toEqual({
            kind: 'renderer:test-asset',
            url: 'resolved://renderer-test/assets/sample.bin',
        });
        expect(load).toHaveBeenCalledWith({
            ref,
            kind: 'renderer:test-asset',
            url: 'resolved://renderer-test/assets/sample.bin',
        });
    });

    it('throws when two loaders register the same kind', () => {
        const loader: AssetLoader<RendererTestAsset> = {
            kind: 'renderer:test-asset',
            async load(): Promise<unknown> {
                return {};
            },
        };

        expect(() => createAssetLoaderRegistry([loader, loader])).toThrow(
            DuplicateAssetLoaderError,
        );
    });

    it('throws a typed error for unknown asset kinds', () => {
        const registry = createAssetLoaderRegistry();

        expect(() => registry.get<RendererTestAsset>('renderer:test-asset')).toThrow(
            UnknownAssetKindError,
        );
    });
});
