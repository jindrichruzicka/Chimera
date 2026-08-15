// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import type {
    GameLoadingScreenProps,
    GameScreenProps,
    GameScreenRegistry,
} from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { I18nProvider } from '../../i18n/I18nProvider.js';
import { isRouteCoverGameDeclared, RouteEntryLoadingCover } from './RouteEntryLoadingCover.js';

const Playfield = (_props: GameScreenProps): null => null;

function makeRegistry(overrides: Partial<GameScreenRegistry> = {}): GameScreenRegistry {
    return { playfield: Playfield, ...overrides };
}

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    return { tick: 1, ...overrides } as unknown as PlayerSnapshot;
}

/** `SceneId` is branded; the same widening the sibling SceneRouter spec uses. */
function makeSceneId(raw: string): NonNullable<PlayerSnapshot['sceneId']> {
    return raw as NonNullable<PlayerSnapshot['sceneId']>;
}

/** Reports the props the resolved cover was handed, so the wiring is readable. */
function ReportingCover(props: GameLoadingScreenProps): React.ReactElement {
    return (
        <div
            data-testid="reporting-cover"
            data-screen-key={props.screenKey}
            data-scene-id={props.sceneId}
            data-reason={props.reason}
            data-progress={String(props.progress)}
        />
    );
}

function renderCover(
    registry: GameScreenRegistry,
    snapshot: PlayerSnapshot,
): ReturnType<typeof render> {
    return render(
        <I18nProvider>
            <RouteEntryLoadingCover registry={registry} snapshot={snapshot} />
        </I18nProvider>,
    );
}

afterEach(() => {
    cleanup();
});

describe('RouteEntryLoadingCover', () => {
    it('resolves the cover against the SNAPSHOT’s declared default screen', () => {
        const registry = makeRegistry({
            sceneDefaultScreens: { 'engine:game': 'playfield' },
            loadingScreens: { summary: ReportingCover },
        });

        renderCover(
            registry,
            makeSnapshot({ sceneId: makeSceneId('engine:game'), sceneDefaultScreen: 'summary' }),
        );

        expect(screen.getByTestId('reporting-cover').dataset['screenKey']).toBe('summary');
    });

    it('falls back to the registry’s default screen for the scene', () => {
        const registry = makeRegistry({
            sceneDefaultScreens: { 'engine:post-game': 'summary' },
            loadingScreens: { summary: ReportingCover },
        });

        renderCover(registry, makeSnapshot({ sceneId: makeSceneId('engine:post-game') }));

        expect(screen.getByTestId('reporting-cover').dataset['screenKey']).toBe('summary');
    });

    it('falls back to playfield, and to the engine scene id, when the snapshot declares neither', () => {
        const registry = makeRegistry({ loadingScreens: { playfield: ReportingCover } });

        renderCover(registry, makeSnapshot());

        const cover = screen.getByTestId('reporting-cover');
        expect(cover.dataset['screenKey']).toBe('playfield');
        expect(cover.dataset['sceneId']).toBe('engine:game');
    });

    it('reports the wait as an asset wait with no measured progress', () => {
        const registry = makeRegistry({ loadingScreen: ReportingCover });

        renderCover(registry, makeSnapshot({ sceneId: makeSceneId('engine:game') }));

        const cover = screen.getByTestId('reporting-cover');
        // 'assets' rather than 'code': this cover stands in for the preload the
        // route measures, which is the wait a game's cover can render.
        expect(cover.dataset['reason']).toBe('assets');
        // `null`, not 0: the route awaits `preloadCritical`, which exposes no
        // fraction to this caller — an unmeasured wait is stated, never drawn.
        expect(cover.dataset['progress']).toBe('null');
    });

    it('renders the engine default cover for a registry declaring no slot', () => {
        renderCover(makeRegistry(), makeSnapshot());

        expect(screen.getByTestId('scene-screen-loading')).toBeTruthy();
    });

    // Every placement axis is its own mutant: the layer is only a layer if it
    // fills its container, sits above the scene, and — being a cover, which the
    // contract gives no way to dispatch from — never eats a click meant for a
    // modal underneath it.
    it.each([
        ['position', 'absolute'],
        ['inset', '0px'],
        ['zIndex', 'var(--ch-z-loading-hud)'],
        ['pointerEvents', 'none'],
    ])('sets %s on the cover layer', (property, value) => {
        renderCover(makeRegistry(), makeSnapshot());

        const layer = screen.getByTestId('route-entry-loading-cover');
        expect(layer.style[property as unknown as number]).toBe(value);
    });
});

describe('isRouteCoverGameDeclared', () => {
    const CoverComponent = (_props: GameLoadingScreenProps): null => null;

    it('is false when the cascade resolves nothing — the engine placeholder is not a declared form', () => {
        expect(isRouteCoverGameDeclared(makeRegistry(), makeSnapshot())).toBe(false);
    });

    it("is false when the route's key resolves the 'none' opt-out", () => {
        const registry = makeRegistry({
            loadingScreen: 'spinner',
            loadingScreens: { playfield: 'none' },
        });
        expect(isRouteCoverGameDeclared(registry, makeSnapshot())).toBe(false);
    });

    it.each([
        ['a preset string', 'spinner' as const],
        ['a static message', { message: 'loading' }],
        ['a component', CoverComponent],
    ])('is true for %s declared registry-wide', (_form, cover) => {
        expect(
            isRouteCoverGameDeclared(makeRegistry({ loadingScreen: cover }), makeSnapshot()),
        ).toBe(true);
    });

    it("resolves through the ROUTE's key chain, not a fixed 'playfield'", () => {
        // The snapshot's declared default screen wins the chain; its per-key
        // entry says 'none' while 'playfield' declares a cover — so a predicate
        // hardwired to 'playfield' answers true where the route's cover is the
        // opt-out.
        const registry = makeRegistry({
            loadingScreen: 'spinner',
            loadingScreens: { briefing: 'none' },
        });
        const snapshot = makeSnapshot({ sceneDefaultScreen: 'briefing' });
        expect(isRouteCoverGameDeclared(registry, snapshot)).toBe(false);
    });

    it("falls back to the registry's per-scene default screen for the key", () => {
        const registry = makeRegistry({
            sceneDefaultScreens: { 'engine:custom': 'briefing' },
            loadingScreens: { briefing: 'progress' },
        });
        const snapshot = makeSnapshot({ sceneId: makeSceneId('engine:custom') });
        expect(isRouteCoverGameDeclared(registry, snapshot)).toBe(true);
    });
});
