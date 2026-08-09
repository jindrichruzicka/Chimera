/**
 * simulation/content/animationManifest.test.ts
 *
 * Unit tests for the `modelAnimationEntry` / `spriteAnimationEntry` authoring
 * builders: the write-only helpers games call to attach a clip sheet to a
 * `'gltf-model'` or `'sprite-sheet'` manifest entry. Each builder writes the
 * sheet into the opaque `AssetManifestEntry.metadata` slot VERBATIM — carried by
 * reference, never copied and never inspected.
 *
 * Feature reference: F82 — Animation System (clip sheets),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Properties pinned:
 *   The sheet rides `AssetManifestEntry.metadata`, which stays typed `unknown`.
 *   Each builder stores the sheet by identity and omits the `metadata` key
 *     entirely when none is passed.
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { buildAssetRef, type GLTFModelAsset, type SpriteSheetAsset } from './AssetRef';
import type { AssetManifestEntry } from './AssetManifest';
import {
    modelAnimationEntry,
    spriteAnimationEntry,
    type ModelAnimationMetadata,
    type SpriteAnimationMetadata,
} from './animationManifest';

describe('modelAnimationEntry', () => {
    it('builds a `gltf-model` entry carrying the passed sheet BY REFERENCE', () => {
        const ref = buildAssetRef<GLTFModelAsset>('tactics', 'models/units/warrior.glb');
        const metadata: ModelAnimationMetadata = {
            clips: {
                swing: {
                    durationSeconds: 0.4,
                    loop: 'once',
                    notifies: { impact: { at: { seconds: 0.15 } } },
                    passages: { hit: { from: 0.25, to: 0.5, beatWindow: [2, 4], window: 'sword' } },
                },
            },
        };

        const entry = modelAnimationEntry({ ref, priority: 'critical', metadata });

        expect(entry.ref).toBe(ref);
        expect(entry.kind).toBe('gltf-model');
        expect(entry.priority).toBe('critical');
        // Verbatim by identity, not a structural copy — the renderer must read
        // exactly the object the game authored.
        expect(entry.metadata).toBe(metadata);
    });

    it('omitting metadata yields a behaviour-neutral entry with no `metadata` key', () => {
        const ref = buildAssetRef<GLTFModelAsset>('tactics', 'models/props/crate.glb');

        const entry = modelAnimationEntry({ ref, priority: 'deferred' });

        // Matches a hand-authored entry exactly — no `metadata` key at all
        // (exactOptionalPropertyTypes distinguishes absent from `undefined`).
        expect(entry).toEqual({ ref, kind: 'gltf-model', priority: 'deferred' });
        expect(Object.hasOwn(entry, 'metadata')).toBe(false);
    });

    it('returns exactly an `AssetManifestEntry<GLTFModelAsset>`', () => {
        expectTypeOf(modelAnimationEntry).returns.toEqualTypeOf<
            AssetManifestEntry<GLTFModelAsset>
        >();
    });
});

describe('spriteAnimationEntry', () => {
    it('builds a `sprite-sheet` entry carrying the passed sheet BY REFERENCE', () => {
        const ref = buildAssetRef<SpriteSheetAsset>('tactics', 'sprites/explosion.png');
        const metadata: SpriteAnimationMetadata = {
            clips: { blast: { frames: [0, 1, 2, 3], frameCount: 4, durationSeconds: 0.2 } },
        };

        const entry = spriteAnimationEntry({ ref, priority: 'deferred', metadata });

        expect(entry.ref).toBe(ref);
        expect(entry.kind).toBe('sprite-sheet');
        expect(entry.priority).toBe('deferred');
        expect(entry.metadata).toBe(metadata);
    });

    it('omitting metadata yields a behaviour-neutral entry with no `metadata` key', () => {
        const ref = buildAssetRef<SpriteSheetAsset>('tactics', 'sprites/ui-icons.png');

        const entry = spriteAnimationEntry({ ref, priority: 'critical' });

        expect(entry).toEqual({ ref, kind: 'sprite-sheet', priority: 'critical' });
        expect(Object.hasOwn(entry, 'metadata')).toBe(false);
    });

    it('returns exactly an `AssetManifestEntry<SpriteSheetAsset>`', () => {
        expectTypeOf(spriteAnimationEntry).returns.toEqualTypeOf<
            AssetManifestEntry<SpriteSheetAsset>
        >();
    });
});

describe('AssetManifestEntry.metadata (opaque slot the clip sheet rides on)', () => {
    it('keeps the slot typed `unknown` — narrowing it would break this', () => {
        expectTypeOf<AssetManifestEntry['metadata']>().toEqualTypeOf<unknown>();

        // A symbol is assignable to `unknown` but not to a sheet type; if the
        // slot is ever narrowed, this assignment stops compiling.
        const slot: AssetManifestEntry['metadata'] = Symbol('opaque');
        expect(typeof slot).toBe('symbol');
    });
});
