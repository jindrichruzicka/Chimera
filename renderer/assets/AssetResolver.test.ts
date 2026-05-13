import { describe, expect, it } from 'vitest';

import { MalformedAssetRefError } from '@chimera/shared/asset-ref-parse.js';
import { buildAssetRef, type AssetRef } from '@chimera/simulation/content/AssetRef.js';

import { createDevResolver, createProductionResolver, type AssetResolver } from './AssetResolver';

describe('createDevResolver', () => {
    it('resolves an AssetRef to the source-tree game assets URL', () => {
        const resolver: AssetResolver = createDevResolver('/workspace/Chimera');
        const ref = buildAssetRef('tactics', 'textures/units/warrior.webp');

        const resolved = resolver.resolve(ref);

        expect(resolved).toBe(
            'file:///workspace/Chimera/games/tactics/assets/textures/units/warrior.webp',
        );
    });

    it('propagates MalformedAssetRefError for malformed refs', () => {
        const resolver = createDevResolver('/workspace/Chimera');
        const malformedRef = 'noslash' as AssetRef;

        expect(() => resolver.resolve(malformedRef)).toThrow(MalformedAssetRefError);
    });

    it('propagates MalformedAssetRefError when gameId is ".." (path-traversal)', () => {
        const resolver = createDevResolver('/workspace/Chimera');
        const traversalRef = '../textures/grass.webp' as AssetRef;

        expect(() => resolver.resolve(traversalRef)).toThrow(MalformedAssetRefError);
    });

    it('propagates MalformedAssetRefError when relativePath contains ".." (path-traversal)', () => {
        const resolver = createDevResolver('/workspace/Chimera');
        const traversalRef = 'tactics/../etc/shadow' as AssetRef;

        expect(() => resolver.resolve(traversalRef)).toThrow(MalformedAssetRefError);
    });
});

describe('createProductionResolver', () => {
    it('resolves an AssetRef to the packaged resources assets URL', () => {
        const resolver: AssetResolver = createProductionResolver(
            '/Applications/Chimera.app/Contents/Resources',
        );
        const ref = buildAssetRef('tactics', 'models/units/warrior.glb');

        const resolved = resolver.resolve(ref);

        expect(resolved).toBe(
            'file:///Applications/Chimera.app/Contents/Resources/assets/tactics/models/units/warrior.glb',
        );
    });

    it('propagates MalformedAssetRefError for malformed refs', () => {
        const resolver = createProductionResolver('/Applications/Chimera.app/Contents/Resources');
        const malformedRef = 'noslash' as AssetRef;

        expect(() => resolver.resolve(malformedRef)).toThrow(MalformedAssetRefError);
    });

    it('propagates MalformedAssetRefError when gameId is ".." (path-traversal)', () => {
        const resolver = createProductionResolver('/Applications/Chimera.app/Contents/Resources');
        const traversalRef = '../textures/grass.webp' as AssetRef;

        expect(() => resolver.resolve(traversalRef)).toThrow(MalformedAssetRefError);
    });

    it('propagates MalformedAssetRefError when relativePath contains ".." (path-traversal)', () => {
        const resolver = createProductionResolver('/Applications/Chimera.app/Contents/Resources');
        const traversalRef = 'tactics/../etc/shadow' as AssetRef;

        expect(() => resolver.resolve(traversalRef)).toThrow(MalformedAssetRefError);
    });
});
