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
import { TransitionOverlay } from './TransitionOverlay.js';

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

afterEach(() => {
    cleanup();
});

describe('TransitionOverlay', () => {
    it('renders nothing without a scene transition', () => {
        renderOverlay(makeSnapshot({ sceneTransition: null }));

        expect(screen.queryByTestId('transition-overlay')).toBeNull();
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

    it('renders a null fraction exactly as it renders an absent one', () => {
        const { container: absent } = renderOverlay(makeTransitioningSnapshot());
        const absentHtml = absent.innerHTML;
        cleanup();

        const { container: explicitNull } = renderOverlay(makeTransitioningSnapshot(), null);

        expect(explicitNull.innerHTML).toBe(absentHtml);
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
    preloadProgress?: number | null,
): React.ReactElement {
    return (
        <FadeContext.Provider value={fadeControl}>
            <TransitionOverlay
                snapshot={snapshot}
                {...(preloadProgress === undefined ? {} : { preloadProgress })}
            />
        </FadeContext.Provider>
    );
}

function renderOverlay(
    snapshot: PlayerSnapshot,
    preloadProgress?: number | null,
): ReturnType<typeof render> {
    return render(overlayTree(snapshot, preloadProgress));
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
