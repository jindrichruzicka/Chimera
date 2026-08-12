import React from 'react';
import { describe, expect, it } from 'vitest';
import type {
    GameLoadingScreen,
    GameLoadingScreenProps,
    GameScreenProps,
    GameScreenRegistry,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { resolveLoadingScreen } from './resolveLoadingScreen.js';

const Playfield = (_props: GameScreenProps): null => null;
const PerKeyCover = (_props: GameLoadingScreenProps): null => null;
const RegistryWideCover = (_props: GameLoadingScreenProps): null => null;

function makeRegistry(overrides: Partial<GameScreenRegistry> = {}): GameScreenRegistry {
    return { playfield: Playfield, ...overrides };
}

describe('resolveLoadingScreen', () => {
    it('resolves to undefined when the registry declares neither slot', () => {
        expect(resolveLoadingScreen(makeRegistry(), 'playfield')).toBeUndefined();
    });

    it('resolves the registry-wide cover for a key loadingScreens does not name', () => {
        const registry = makeRegistry({
            loadingScreen: RegistryWideCover,
            loadingScreens: { 'tech-tree': PerKeyCover },
        });

        expect(resolveLoadingScreen(registry, 'playfield')).toBe(RegistryWideCover);
    });

    it('prefers the per-key cover over the registry-wide one', () => {
        // Kills the swapped-operand mutant: `registry.loadingScreen ??
        // registry.loadingScreens?.[key]` returns the registry-wide cover here.
        const registry = makeRegistry({
            loadingScreen: RegistryWideCover,
            loadingScreens: { 'tech-tree': PerKeyCover },
        });

        expect(resolveLoadingScreen(registry, 'tech-tree')).toBe(PerKeyCover);
    });

    it("returns 'none' for a key opted out, without falling through to the registry-wide cover", () => {
        // `??` on the map lookup is what lets 'none' SUBTRACT one key: any
        // filter that treats the sentinel as absent hands back RegistryWideCover.
        const registry = makeRegistry({
            loadingScreen: RegistryWideCover,
            loadingScreens: { 'tech-tree': 'none' },
        });

        expect(resolveLoadingScreen(registry, 'tech-tree')).toBe('none');
    });

    it('resolves the per-key cover with no registry-wide slot declared', () => {
        const registry = makeRegistry({ loadingScreens: { 'tech-tree': PerKeyCover } });

        expect(resolveLoadingScreen(registry, 'tech-tree')).toBe(PerKeyCover);
        expect(resolveLoadingScreen(registry, 'playfield')).toBeUndefined();
    });

    it('resolves every form the cover union admits, unchanged', () => {
        // The resolver is form-blind: it hands the caller whatever the registry
        // declared, so `SceneLoadingFallback` owns the whole narrowing.
        const Lazy = React.lazy(() => Promise.resolve({ default: PerKeyCover }));
        const forms: readonly GameLoadingScreen[] = [
            'spinner',
            'progress',
            'none',
            { message: 'game.loading.text' },
            { image: 'chimera://game/loading.png' },
            PerKeyCover,
            Lazy,
        ];

        for (const form of forms) {
            expect(resolveLoadingScreen(makeRegistry({ loadingScreen: form }), 'playfield')).toBe(
                form,
            );
        }
    });
});
