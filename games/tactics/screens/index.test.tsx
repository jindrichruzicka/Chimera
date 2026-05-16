import { describe, expect, it } from 'vitest';
import { tacticsAssetManifest } from '../asset-manifest.js';
import { MatchScreenRegistry } from './index.js';

describe('MatchScreenRegistry', () => {
    it('declares event audio bindings for core tactics action events', () => {
        expect(MatchScreenRegistry.eventAudioBinding).toBeDefined();
        expect(MatchScreenRegistry.eventAudioBinding?.['tactics:move_unit']).toBeDefined();
        expect(MatchScreenRegistry.eventAudioBinding?.['tactics:attack']).toBeDefined();
        expect(MatchScreenRegistry.eventAudioBinding?.['tactics:reveal_tile']).toBeDefined();
    });

    it('declares every event audio ref in the tactics asset manifest', () => {
        const manifestRefs = new Set(tacticsAssetManifest.entries.map((entry) => entry.ref));
        const eventAudioRefs = Object.values(MatchScreenRegistry.eventAudioBinding ?? {}).map(
            (binding) => binding.ref,
        );

        expect(eventAudioRefs).not.toHaveLength(0);
        expect(eventAudioRefs.every((ref) => manifestRefs.has(ref))).toBe(true);
    });

    it('registers a concrete summary screen for engine:post-match', () => {
        expect(MatchScreenRegistry.sceneDefaultScreens?.['engine:post-match']).toBe('summary');
        expect(MatchScreenRegistry.screens?.['summary']).toBeDefined();
    });

    it('code-splits the summary screen behind React.lazy (Invariant #87)', () => {
        const summary = MatchScreenRegistry.screens?.['summary'];
        // React.lazy components are exotic objects, not plain functions.
        // Invariant #87: every screen exported from screens/index.ts must be
        // wrapped in React.lazy so it does not bloat the initial registry bundle.
        expect(typeof summary).toBe('object');
        expect(summary).not.toBeNull();
    });
});
