import { describe, expect, it } from 'vitest';
import { buildAssetRef, type GLTFModelAsset, type TextureAsset } from './AssetRef';
import { type AssetManifest, type AssetManifestEntry, type AssetPriority } from './AssetManifest';

// ---------------------------------------------------------------------------
// AssetManifest types — structural checks
// simulation/content/AssetManifest.ts  §4.10
// ---------------------------------------------------------------------------

describe('AssetPriority', () => {
    it("literal values are 'critical' and 'deferred'", () => {
        const critical: AssetPriority = 'critical';
        const deferred: AssetPriority = 'deferred';
        expect(critical).toBe('critical');
        expect(deferred).toBe('deferred');
    });
});

describe('AssetManifestEntry', () => {
    it('holds a ref and a priority', () => {
        const entry: AssetManifestEntry<TextureAsset> = {
            ref: buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp'),
            priority: 'critical',
        };
        expect(entry.ref).toBe('tactics/textures/grass.webp');
        expect(entry.priority).toBe('critical');
    });

    it('accepts deferred priority', () => {
        const entry: AssetManifestEntry<GLTFModelAsset> = {
            ref: buildAssetRef<GLTFModelAsset>('tactics', 'models/warrior.glb'),
            priority: 'deferred',
        };
        expect(entry.priority).toBe('deferred');
    });
});

describe('AssetManifest', () => {
    it('holds gameId and a readonly entries array', () => {
        const manifest: AssetManifest = {
            gameId: 'tactics',
            entries: [
                {
                    ref: buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp'),
                    priority: 'critical',
                },
                {
                    ref: buildAssetRef<GLTFModelAsset>('tactics', 'models/warrior.glb'),
                    priority: 'deferred',
                },
            ],
        };
        expect(manifest.gameId).toBe('tactics');
        expect(manifest.entries).toHaveLength(2);
        const [first, second] = manifest.entries;
        expect(first?.priority).toBe('critical');
        expect(second?.priority).toBe('deferred');
    });

    it('round-trips all refs via entries array', () => {
        const refs = [
            buildAssetRef<TextureAsset>('tactics', 'textures/bg.webp'),
            buildAssetRef<GLTFModelAsset>('tactics', 'models/hero.glb'),
            buildAssetRef<TextureAsset>('tactics', 'textures/ui/cursor.webp'),
        ] as const;

        const manifest: AssetManifest = {
            gameId: 'tactics',
            entries: [
                { ref: refs[0], priority: 'critical' },
                { ref: refs[1], priority: 'critical' },
                { ref: refs[2], priority: 'deferred' },
            ],
        };

        expect(manifest.entries.map((e) => e.ref)).toEqual([...refs]);
    });

    it('entries array is typed as readonly (push is disallowed at compile time)', () => {
        // Structural constraint: entries is `readonly AssetManifestEntry[]`.
        // The directive on the next meaningful line is the live assertion: if the type
        // is ever changed to a mutable array TypeScript emits "Unused directive" during
        // pnpm typecheck, turning this test red at the type level.
        const manifest: AssetManifest = { gameId: 'x', entries: [] };
        // @ts-expect-error — readonly array: push is not permitted
        manifest.entries.push({ ref: buildAssetRef('x', 'a.png'), priority: 'critical' });
        void manifest;
    });
});
