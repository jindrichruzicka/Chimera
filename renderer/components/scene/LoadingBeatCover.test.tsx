// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PlayerSnapshot } from '@chimera-engine/simulation/bridge/api-types.js';
import type { GameScreenRegistry } from '@chimera-engine/simulation/foundation/game-screen-contract.js';
import { I18nProvider } from '../../i18n/I18nProvider.js';
import { LoadingBeatCover } from './LoadingBeatCover.js';

const FADE_MS = 200;

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
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

function renderCover(
    props: Partial<React.ComponentProps<typeof LoadingBeatCover>> = {},
): ReturnType<typeof render> {
    const registry: GameScreenRegistry = {
        playfield: () => null,
        loadingScreen: 'spinner',
    };
    return render(
        <I18nProvider>
            <LoadingBeatCover
                registry={registry}
                snapshot={makeSnapshot()}
                surface="route"
                visible={true}
                fadeMs={FADE_MS}
                {...props}
            />
        </I18nProvider>,
    );
}

/**
 * Let the post-mount raise commit, which is what starts the enter ramp.
 *
 * The raise rides an animation frame, so a microtask flush is not enough —
 * jsdom services `requestAnimationFrame` on a ~16 ms timer. That delay is the
 * mechanism, not an implementation detail: it is what puts a paint between the
 * cover's transparent first commit and its opaque second one.
 */
async function settle(): Promise<void> {
    await act(async () => {
        await new Promise((resolve) => {
            setTimeout(resolve, 32);
        });
    });
}

afterEach(() => {
    cleanup();
});

describe('LoadingBeatCover', () => {
    it('paints an opaque backdrop, so nothing beneath it is visible', async () => {
        // The defect the whole feature exists for: the previous cover declared
        // no background, so it was a glyph over whatever stood behind it and
        // could not be shown without showing the scene too.
        renderCover();
        await settle();

        const layer = screen.getByTestId('route-entry-loading-cover');
        expect(layer.style.backgroundColor).toBe('var(--ch-color-scrim)');
    });

    it('fills the viewport rather than its positioned ancestor', async () => {
        // `fixed`, not `absolute`: on the replay route the old cover filled the
        // playfield wrapper and left the transport controls uncovered, which is
        // exactly the "something else is visible" this beat rules out.
        renderCover();
        await settle();

        const layer = screen.getByTestId('route-entry-loading-cover');
        expect(layer.style.position).toBe('fixed');
        expect(layer.style.inset).toBe('0px');
        expect(layer.style.zIndex).toBe('var(--ch-z-loading-hud)');
    });

    it('escapes the route stacking context so it can paint over the curtain', async () => {
        // AppShell wraps the routes in their own stacking context, so a cover
        // rendered inside it has a LOCAL z-index and the app scrim — a sibling
        // above that context — paints over it. The beat needs the opposite.
        const { container } = renderCover();
        await settle();

        const layer = screen.getByTestId('route-entry-loading-cover');
        expect(container.contains(layer)).toBe(false);
        expect(document.body.contains(layer)).toBe(true);
    });

    it('rises from transparent, so the enter is a ramp rather than a cut', async () => {
        // Mounting already opaque gives the browser no start value to animate
        // from; the cover would appear instantly over the black.
        const { container } = renderCover();

        expect(screen.getByTestId('route-entry-loading-cover').style.opacity).toBe('0');

        await settle();
        expect(screen.getByTestId('route-entry-loading-cover').style.opacity).toBe('1');
        expect(container).toBeTruthy();
    });

    it('carries its transition for the cover’s whole life, not only while leaving', async () => {
        // One property change against an already-rendered declaration. A
        // transition added at the same moment opacity moves is not reliably
        // animated.
        renderCover();
        await settle();

        expect(screen.getByTestId('route-entry-loading-cover').style.transition).toContain(
            `opacity ${FADE_MS}ms`,
        );
    });

    it('falls back to transparent when the beat stops showing it', async () => {
        const { rerender } = renderCover();
        await settle();

        rerender(
            <I18nProvider>
                <LoadingBeatCover
                    registry={{ playfield: () => null, loadingScreen: 'spinner' }}
                    snapshot={makeSnapshot()}
                    surface="route"
                    visible={false}
                    fadeMs={FADE_MS}
                />
            </I18nProvider>,
        );

        expect(screen.getByTestId('route-entry-loading-cover').style.opacity).toBe('0');
    });

    it('cuts instead of ramping when the duration collapses', async () => {
        // Under the e2e flag and reduced motion every duration is 0. The cover
        // must be fully opaque on its first commit then — a spec that waited
        // for a ramp would wait forever, and a reduced-motion user would see a
        // half-transparent scene.
        renderCover({ fadeMs: 0 });

        const layer = screen.getByTestId('route-entry-loading-cover');
        expect(layer.style.opacity).toBe('1');
        expect(layer.style.transition).toBe('');
    });

    it('renders the game’s declared cover through the unchanged cascade', async () => {
        renderCover();
        await settle();

        expect(screen.getByRole('status')).toBeTruthy();
    });

    it('states the wait as an asset wait with no measured progress', async () => {
        // A route cover stands in for assets that have not arrived, and this
        // route measures no fraction — so `progress` is null rather than 0.
        // `0` is a MEASUREMENT that happens to be zero, and a progress preset
        // handed one draws an empty bar instead of degrading to a spinner.
        const seen: { reason?: string | undefined; progress?: number | null | undefined } = {};
        const ReportingCover = (props: { reason?: string; progress?: number | null }): null => {
            seen.reason = props.reason;
            seen.progress = props.progress;
            return null;
        };

        renderCover({
            registry: {
                playfield: () => null,
                loadingScreen: ReportingCover as never,
            },
        });
        await settle();

        expect(seen.reason).toBe('assets');
        expect(seen.progress).toBeNull();
    });

    it('keeps the scene surface in the tree, under its own testid', async () => {
        // The scene-transition site sits inside the shell, below the app
        // curtain, and the recorded e2e timeline reads it by this name.
        const { container } = renderCover({ surface: 'scene' });
        await settle();

        const layer = screen.getByTestId('scene-preload-cover');
        expect(container.contains(layer)).toBe(true);
        expect(layer.style.backgroundColor).toBe('var(--ch-color-scrim)');
    });
});
