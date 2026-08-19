import React from 'react';
import { describe, expect, it } from 'vitest';
import type {
    GameLoadingScreen,
    GameLoadingScreenProps,
    GameScreenProps,
    GameScreenRegistry,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import type { PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import {
    isRouteCoverGameDeclared,
    resolveLoadingScreen,
    resolveRouteCoverTarget,
} from './resolveLoadingScreen.js';

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

// ── The route-owned key chain ──────────────────────────────────────────────────

function makeRouteSnapshot(overrides: Record<string, unknown> = {}): PlayerSnapshot {
    return {
        tick: 0,
        phase: 'playing',
        players: {},
        isMyTurn: true,
        undoMeta: { canUndo: false, canRedo: false },
        sceneId: 'engine:game',
        ...overrides,
    } as unknown as PlayerSnapshot;
}

describe('resolveRouteCoverTarget', () => {
    it('prefers the SNAPSHOT’s declared default screen', () => {
        const target = resolveRouteCoverTarget(
            { playfield: Playfield, sceneDefaultScreens: { 'engine:game': 'playfield' } },
            makeRouteSnapshot({ sceneDefaultScreen: 'summary' }),
        );

        expect(target).toEqual({ sceneId: 'engine:game', screenKey: 'summary' });
    });

    it('falls back to the registry’s default screen for the scene', () => {
        const target = resolveRouteCoverTarget(
            { playfield: Playfield, sceneDefaultScreens: { 'engine:post-game': 'summary' } },
            makeRouteSnapshot({ sceneId: 'engine:post-game' }),
        );

        expect(target).toEqual({ sceneId: 'engine:post-game', screenKey: 'summary' });
    });

    it('falls back to playfield, and to the engine scene id, when the snapshot declares neither', () => {
        expect(resolveRouteCoverTarget({ playfield: Playfield }, makeRouteSnapshot())).toEqual({
            sceneId: 'engine:game',
            screenKey: 'playfield',
        });
    });
});

describe('isRouteCoverGameDeclared', () => {
    it('is false when the cascade resolves nothing — the engine placeholder is not a declared form', () => {
        expect(isRouteCoverGameDeclared({ playfield: Playfield }, makeRouteSnapshot())).toBe(false);
    });

    it("is false when the route's key resolves the 'none' opt-out", () => {
        expect(
            isRouteCoverGameDeclared(
                {
                    playfield: Playfield,
                    loadingScreen: 'spinner',
                    loadingScreens: { playfield: 'none' },
                },
                makeRouteSnapshot(),
            ),
        ).toBe(false);
    });

    it.each([
        ['a preset string', 'spinner' as const],
        ['a static message', { message: 'loading' }],
        ['a component', PerKeyCover],
    ])('is true for %s declared registry-wide', (_form, cover) => {
        expect(
            isRouteCoverGameDeclared(
                { playfield: Playfield, loadingScreen: cover as GameLoadingScreen },
                makeRouteSnapshot(),
            ),
        ).toBe(true);
    });

    it("resolves through the ROUTE's key chain, not a fixed 'playfield'", () => {
        // The snapshot's declared default screen wins the chain; its per-key
        // entry says 'none' while 'playfield' would declare a cover — so a
        // predicate hardwired to 'playfield' answers true where the route's own
        // cover is the opt-out.
        expect(
            isRouteCoverGameDeclared(
                {
                    playfield: Playfield,
                    loadingScreen: 'spinner',
                    loadingScreens: { briefing: 'none' },
                },
                makeRouteSnapshot({ sceneDefaultScreen: 'briefing' }),
            ),
        ).toBe(false);
    });

    it("falls back to the registry's per-scene default screen for the key", () => {
        expect(
            isRouteCoverGameDeclared(
                {
                    playfield: Playfield,
                    sceneDefaultScreens: { 'engine:custom': 'briefing' },
                    loadingScreens: { briefing: 'progress' },
                },
                makeRouteSnapshot({ sceneId: 'engine:custom' }),
            ),
        ).toBe(true);
    });
});
