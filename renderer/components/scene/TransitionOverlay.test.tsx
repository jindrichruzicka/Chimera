// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import { FadeContext, type FadeControl } from '../shell/FadeContext.js';
import { TransitionOverlay, type TransitionOverlayProps } from './TransitionOverlay.js';

const LOCAL_PLAYER = playerId('local-player');

const fadeControl: FadeControl = {
    phase: 'fade-out',
    opacity: 0.5,
    setPhase: () => undefined,
    fadeOut: () => Promise.resolve(),
    fadeIn: () => Promise.resolve(),
    claim: () => ({
        isActive: true,
        fadeOut: () => Promise.resolve(),
        fadeIn: () => Promise.resolve(),
    }),
};

/** The curtain fully down: nothing to paint, whatever the snapshot says. */
const transparentFade: FadeControl = { ...fadeControl, phase: 'idle', opacity: 0 };

afterEach(() => {
    cleanup();
});

describe('TransitionOverlay', () => {
    it('renders nothing with no transition and the curtain fully down', () => {
        renderOverlay(makeSnapshot({ sceneTransition: null }), undefined, transparentFade);

        expect(screen.queryByTestId('transition-overlay')).toBeNull();
    });

    it('stays for as long as the curtain is up, transition or not', () => {
        // This provider has no other painter, so unmounting the instant the
        // transition ends left the curtain with nothing drawing it: the
        // fade-in that follows had no pixels to animate and the scene
        // arrived by a hard cut. The reveal is deferred PAST the commit
        // while a loading cover serves its minimum (§4.36), so the span
        // this layer has to cover is the curtain’s, not the transition’s.
        renderOverlay(makeSnapshot({ sceneTransition: null }));

        const layer = screen.getByTestId('transition-overlay');
        expect(layer.style.opacity).toBe('0.5');
        expect(layer.style.backgroundColor).toBe('var(--ch-color-scrim)');
    });

    it('reports the fade’s own phase once no transition describes it', () => {
        renderOverlay(makeSnapshot({ sceneTransition: null }));

        expect(screen.getByTestId('transition-overlay').dataset['fadePhase']).toBe('fade-out');
    });

    it('paints the same black the app-level curtain does', () => {
        // A translucent grey let the outgoing scene show through the hold, so a
        // loading cover standing above it was never the only thing on screen.
        // The whole point of the sequence is that a scene swap passes through
        // black, and this is the layer that has to be black for that to hold.
        renderOverlay(makeTransitioningSnapshot());

        expect(screen.getByTestId('transition-overlay').style.backgroundColor).toBe(
            'var(--ch-color-scrim)',
        );
    });

    it('carries the displayed fade phase and stays out of the accessibility tree', () => {
        renderOverlay(makeTransitioningSnapshot());

        const overlay = screen.getByTestId('transition-overlay');
        expect(overlay.getAttribute('data-fade-phase')).toBe('fade-out');
        expect(overlay.getAttribute('aria-hidden')).toBe('true');
        expect(overlay.style.opacity).toBe('0.5');
    });

    // The preload fraction is ADDITIVE: a transition with no measured preload
    // must produce the byte-identical element it produced before the prop
    // existed, so the overlay a game already sees is unchanged.
    it('emits no preload attribute when the fraction is absent', () => {
        renderOverlay(makeTransitioningSnapshot());

        const overlay = screen.getByTestId('transition-overlay');
        expect(overlay.hasAttribute('data-preload-progress')).toBe(false);
        expect([...overlay.getAttributeNames()].sort()).toEqual([
            'aria-hidden',
            'data-fade-phase',
            'data-testid',
            'style',
        ]);
    });

    // This prop mirrors the game-facing `TransitionOverlayProps` contract's,
    // and `SceneRouter` feeds both slots from one withheld-or-passed value — so
    // it admits the same two states and no third. Widened back to `| null`, this
    // overlay would document a state its only render site strips.
    it('admits a fraction or an absent prop, and rejects null, at compile time', () => {
        const snapshot = makeTransitioningSnapshot();
        const measured: TransitionOverlayProps = { snapshot, preloadProgress: 0.25 };
        const absent: TransitionOverlayProps = { snapshot };
        const rejected: TransitionOverlayProps = {
            snapshot,
            // @ts-expect-error: an unmeasured wait is an ABSENT prop, not a
            // `null` one — see the contract field this mirrors.
            preloadProgress: null,
        };

        expect(measured.preloadProgress).toBe(0.25);
        expect(absent.preloadProgress).toBeUndefined();
        expect(rejected.preloadProgress).toBeNull();
    });

    it('surfaces a measured fraction and follows it across a two-ref scene', () => {
        const snapshot = makeTransitioningSnapshot();
        const { rerender } = renderOverlay(snapshot, 0);

        expect(readPreloadProgress()).toBe('0');

        rerender(overlayTree(snapshot, 0.5));
        expect(readPreloadProgress()).toBe('0.5');

        rerender(overlayTree(snapshot, 1));
        expect(readPreloadProgress()).toBe('1');
    });
});

function readPreloadProgress(): string | null {
    return screen.getByTestId('transition-overlay').getAttribute('data-preload-progress');
}

function overlayTree(
    snapshot: PlayerSnapshot,
    preloadProgress?: number,
    fade: FadeControl = fadeControl,
): React.ReactElement {
    return (
        <FadeContext.Provider value={fade}>
            <TransitionOverlay
                snapshot={snapshot}
                {...(preloadProgress === undefined ? {} : { preloadProgress })}
            />
        </FadeContext.Provider>
    );
}

function renderOverlay(
    snapshot: PlayerSnapshot,
    preloadProgress?: number,
    fade?: FadeControl,
): ReturnType<typeof render> {
    return render(overlayTree(snapshot, preloadProgress, fade));
}

function makeSceneId(raw: string): NonNullable<PlayerSnapshot['sceneId']> {
    return raw as NonNullable<PlayerSnapshot['sceneId']>;
}

function makeTransitioningSnapshot(): PlayerSnapshot {
    return makeSnapshot({
        sceneTransition: {
            toSceneId: makeSceneId('engine:post-game'),
            phase: 'preparing',
            startedAtTick: 2,
            params: {},
            playersReady: [],
        },
    });
}

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    return {
        tick: 3,
        viewerId: LOCAL_PLAYER,
        players: { [LOCAL_PLAYER]: { id: LOCAL_PLAYER } },
        entities: {},
        phase: gamePhase('playing'),
        sceneId: makeSceneId('engine:game'),
        sceneTransition: null,
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...overrides,
    };
}
