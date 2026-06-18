import { describe, expect, it } from 'vitest';
import { tacticsAssetManifest } from '../asset-manifest.js';
import { TacticsGameScreenRegistry } from './index.js';

describe('TacticsGameScreenRegistry', () => {
    it('declares event audio bindings for core tactics action events', () => {
        expect(TacticsGameScreenRegistry.eventAudioBinding).toBeDefined();
        expect(TacticsGameScreenRegistry.eventAudioBinding?.['tactics:move_unit']).toBeDefined();
        expect(TacticsGameScreenRegistry.eventAudioBinding?.['tactics:attack']).toBeDefined();
        expect(TacticsGameScreenRegistry.eventAudioBinding?.['tactics:reveal_tile']).toBeDefined();
    });

    it('declares every event audio ref in the tactics asset manifest', () => {
        const manifestRefs = new Set(tacticsAssetManifest.entries.map((entry) => entry.ref));
        const eventAudioRefs = Object.values(TacticsGameScreenRegistry.eventAudioBinding ?? {}).map(
            (binding) => binding.ref,
        );

        expect(eventAudioRefs).not.toHaveLength(0);
        expect(eventAudioRefs.every((ref) => manifestRefs.has(ref))).toBe(true);
    });

    it('registers a concrete summary screen for engine:post-game', () => {
        expect(TacticsGameScreenRegistry.sceneDefaultScreens?.['engine:post-game']).toBe('summary');
        expect(TacticsGameScreenRegistry.screens?.['summary']).toBeDefined();
    });

    it('code-splits the summary screen behind React.lazy (Invariant #87)', () => {
        const summary = TacticsGameScreenRegistry.screens?.['summary'];
        // React.lazy components are exotic objects, not plain functions.
        // Invariant #87: every screen exported from screens/index.ts must be
        // wrapped in React.lazy so it does not bloat the initial registry bundle.
        expect(typeof summary).toBe('object');
        expect(summary).not.toBeNull();
    });

    it('registers a lazy in-game menu on inGameMenu (F55 · Invariant #87)', () => {
        const menu = TacticsGameScreenRegistry.inGameMenu;
        expect(menu).toBeDefined();
        // Not the `'none'` opt-out and not the omitted engine-default fallback.
        expect(menu).not.toBe('none');
        // React.lazy components are exotic objects, not plain functions.
        expect(typeof menu).toBe('object');
        expect(menu).not.toBeNull();
    });
});
