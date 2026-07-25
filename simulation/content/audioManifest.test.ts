/**
 * simulation/content/audioManifest.test.ts
 *
 * Unit tests for the `audioClipEntry` authoring builder: the write-only helper
 * games call to attach an `AudioClipMetadata` cue sheet to an `'audio-clip'`
 * manifest entry. The builder writes the sheet into the opaque
 * `AssetManifestEntry.metadata` slot verbatim and never inspects it.
 *
 * Architecture reference: §4.25 — Audio System → Cue, Fade & Crossfade Extensions.
 *
 * Invariants upheld:
 *   #124 — the cue sheet rides `AssetManifestEntry.metadata`, which stays typed
 *     `unknown` (opaque to `simulation/`/`ai/`, extends #20); the builder only
 *     WRITES the value, never parses it. This test pins the entry shape and pins
 *     `metadata` as still `unknown`.
 *   §3 Module Boundary — `simulation/content/` imports only within `simulation/`
 *     (no renderer/DOM/React/Electron).
 */

import { describe, expect, expectTypeOf, it } from 'vitest';
import { buildAssetRef, type AudioClipAsset } from './AssetRef';
import type { AssetManifestEntry } from './AssetManifest';
import { audioClipEntry, type AudioClipMetadata } from './audioManifest';

describe('audioClipEntry', () => {
    it('builds an `audio-clip` entry whose metadata deep-equals the passed sheet', () => {
        const ref = buildAssetRef<AudioClipAsset>('tactics', 'audio/music/theme.ogg');
        const metadata: AudioClipMetadata = {
            cues: { intro: 4, loopStart: 4, loopEnd: 86, outro: 86 },
            defaultLoopRegion: ['loopStart', 'loopEnd'],
            durationSeconds: 90,
        };

        const entry = audioClipEntry({ ref, priority: 'critical', metadata });

        expect(entry.ref).toBe(ref);
        expect(entry.kind).toBe('audio-clip');
        expect(entry.priority).toBe('critical');
        expect(entry.metadata).toEqual(metadata);
    });

    it('omitting metadata yields a behaviour-neutral entry with no `metadata` key', () => {
        const ref = buildAssetRef<AudioClipAsset>('tactics', 'audio/sfx/sword-hit.ogg');

        const entry = audioClipEntry({ ref, priority: 'deferred' });

        // Matches a hand-authored entry exactly — no `metadata` key at all
        // (exactOptionalPropertyTypes distinguishes absent from `undefined`).
        expect(entry).toEqual({ ref, kind: 'audio-clip', priority: 'deferred' });
        expect('metadata' in entry).toBe(false);
    });

    it('returns exactly an `AssetManifestEntry<AudioClipAsset>`', () => {
        expectTypeOf(audioClipEntry).returns.toEqualTypeOf<AssetManifestEntry<AudioClipAsset>>();
    });

    it('keeps `AssetManifestEntry.metadata` typed `unknown` — the slot stays opaque (#124)', () => {
        // Anti-rot: narrowing the slot from `unknown` to `AudioClipMetadata` (or
        // `object`) fails this equality at `pnpm typecheck`.
        expectTypeOf<AssetManifestEntry['metadata']>().toEqualTypeOf<unknown>();

        // A symbol is assignable to `unknown` but not to `AudioClipMetadata`; if the
        // slot is ever narrowed, this assignment stops compiling.
        const slot: AssetManifestEntry['metadata'] = Symbol('opaque');
        expect(typeof slot).toBe('symbol');
    });
});
