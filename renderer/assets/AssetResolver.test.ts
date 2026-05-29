import { describe, expect, it } from 'vitest';

import { MalformedAssetRefError } from '@chimera/shared/asset-ref-parse.js';
import { buildAssetRef, type AssetRef } from '@chimera/simulation/content/AssetRef.js';

import {
    createDevResolver,
    createProductionResolver,
    createRendererGameAssetResolver,
    createRendererProtocolAssetResolver,
    DEFAULT_RENDERER_GAME_ASSET_BASE_URL,
    type AssetResolver,
} from './AssetResolver';

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

describe('createRendererProtocolAssetResolver', () => {
    it('resolves an AssetRef to the renderer asset protocol URL', () => {
        const resolver: AssetResolver = createRendererProtocolAssetResolver();
        const ref = buildAssetRef('tactics', 'audio/sfx/step.ogg');

        const resolved = resolver.resolve(ref);

        expect(resolved).toBe('chimera://renderer/assets/tactics/audio/sfx/step.ogg');
    });

    it('normalises a custom base URL with a trailing slash', () => {
        const resolver: AssetResolver = createRendererProtocolAssetResolver('/assets/');
        const ref = buildAssetRef('tactics', 'audio/sfx/sword hit.ogg');

        const resolved = resolver.resolve(ref);

        expect(resolved).toBe('/assets/tactics/audio/sfx/sword%20hit.ogg');
    });

    it('propagates MalformedAssetRefError for malformed refs', () => {
        const resolver = createRendererProtocolAssetResolver();
        const malformedRef = 'noslash' as AssetRef;

        expect(() => resolver.resolve(malformedRef)).toThrow(MalformedAssetRefError);
    });
});

describe('createRendererGameAssetResolver', () => {
    it('resolves an AssetRef to the renderer game-asset protocol URL', () => {
        const resolver: AssetResolver = createRendererGameAssetResolver();
        const ref = buildAssetRef('tactics', 'audio/sfx/step.wav');

        const resolved = resolver.resolve(ref);

        expect(DEFAULT_RENDERER_GAME_ASSET_BASE_URL).toBe('chimera://renderer/game-assets');
        expect(resolved).toBe('chimera://renderer/game-assets/tactics/audio/sfx/step.wav');
    });

    it('normalises a custom game asset base URL with a trailing slash', () => {
        const resolver: AssetResolver = createRendererGameAssetResolver('/game-assets/');
        const ref = buildAssetRef('tactics', 'fonts/Cinzel Regular.woff2');

        const resolved = resolver.resolve(ref);

        expect(resolved).toBe('/game-assets/tactics/fonts/Cinzel%20Regular.woff2');
    });
});
