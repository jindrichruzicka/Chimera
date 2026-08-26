/**
 * renderer/shell/shellStateStore.test.ts
 *
 * Unit tests for the shell-state store (§4.37.18) — the reactivity spine the
 * shell publishes to a game's own pages and backgrounds.
 *
 * What is measured here is the STORE's protocol: which writer may touch which
 * field, that a re-publish of an unchanged route notifies nobody (the bridge
 * republishes on every commit), and the arm/clear lifecycle of `transition`
 * in both directions. The classification that decides `surface` is
 * `ShellStateBridge`'s and is tested there.
 *
 * Tests written first (TDD — red confirmed: the module did not exist).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { QuickStartConfig } from '@chimera-engine/simulation/foundation/quick-start-contract.js';
import {
    _resetShellStateForTest,
    armShellTransition,
    clearShellTransition,
    getShellState,
    setShellDraft,
    setShellRoute,
    shellStateStore,
    type ShellState,
} from './shellStateStore';

beforeEach(() => {
    _resetShellStateForTest();
});

/** Collect every published state, so a no-op write is visible as an absent entry. */
function recordPublishes(): { readonly states: readonly ShellState[]; stop(): void } {
    const states: ShellState[] = [];
    const stop = shellStateStore.subscribe((state) => {
        states.push(state);
    });
    return { states, stop };
}

describe('shellStateStore — initial state', () => {
    it('starts on the boot surface with no game, no transition and an empty draft', () => {
        expect(getShellState()).toEqual({
            surface: 'boot',
            pathname: '/',
            gameId: null,
            transition: null,
            draft: {},
        });
    });
});

describe('setShellRoute', () => {
    it('publishes surface, pathname and gameId together', () => {
        setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });

        const state = getShellState();
        expect(state.surface).toBe('main-menu');
        expect(state.pathname).toBe('/main-menu');
        expect(state.gameId).toBe('tactics');
    });

    it('leaves the draft and an armed transition untouched', () => {
        setShellDraft({ matchSettings: { mapSize: 'small' } });
        armShellTransition({ kind: 'to-match', durationMs: 200 });

        setShellRoute({ surface: 'page', pathname: '/character-select', gameId: 'tactics' });

        expect(getShellState().draft).toEqual({ matchSettings: { mapSize: 'small' } });
        expect(getShellState().transition).toEqual({ kind: 'to-match', durationMs: 200 });
    });

    it('notifies nobody when the route it publishes is the one already published', () => {
        setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });
        const before = getShellState();
        const recorder = recordPublishes();

        setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });

        expect(recorder.states).toEqual([]);
        expect(getShellState()).toBe(before);
        recorder.stop();
    });

    it('publishes when only the gameId changes', () => {
        setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: null });
        const recorder = recordPublishes();

        setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });

        expect(recorder.states).toHaveLength(1);
        expect(getShellState().gameId).toBe('tactics');
        recorder.stop();
    });

    it('publishes when only the pathname changes under one surface', () => {
        setShellRoute({ surface: 'page', pathname: '/credits', gameId: 'tactics' });
        const recorder = recordPublishes();

        setShellRoute({ surface: 'page', pathname: '/atlas', gameId: 'tactics' });

        expect(recorder.states).toHaveLength(1);
        expect(getShellState().pathname).toBe('/atlas');
        recorder.stop();
    });

    it('publishes when only the surface changes under one pathname', () => {
        setShellRoute({ surface: 'page', pathname: '/credits', gameId: 'tactics' });
        const recorder = recordPublishes();

        setShellRoute({ surface: 'boot', pathname: '/credits', gameId: 'tactics' });

        expect(recorder.states).toHaveLength(1);
        expect(getShellState().surface).toBe('boot');
        recorder.stop();
    });
});

describe('transition arm/clear', () => {
    it('arms with the kind and the duration a background times its dolly on', () => {
        armShellTransition({ kind: 'to-match', durationMs: 320 });

        expect(getShellState().transition).toEqual({ kind: 'to-match', durationMs: 320 });
    });

    it('clears an armed transition', () => {
        armShellTransition({ kind: 'to-match', durationMs: 200 });

        clearShellTransition();

        expect(getShellState().transition).toBeNull();
    });

    it('notifies nobody when clearing with nothing armed', () => {
        const before = getShellState();
        const recorder = recordPublishes();

        clearShellTransition();

        expect(recorder.states).toEqual([]);
        expect(getShellState()).toBe(before);
        recorder.stop();
    });

    it('clears a to-match transition once the match surface is reached', () => {
        armShellTransition({ kind: 'to-match', durationMs: 200 });

        setShellRoute({ surface: 'match', pathname: '/game', gameId: 'tactics' });

        expect(getShellState().transition).toBeNull();
    });

    it('keeps a to-match transition armed across shell routes on the way there', () => {
        armShellTransition({ kind: 'to-match', durationMs: 200 });

        setShellRoute({ surface: 'saves', pathname: '/saves', gameId: 'tactics' });

        expect(getShellState().transition).toEqual({ kind: 'to-match', durationMs: 200 });
    });

    it('clears a to-shell transition once a non-match surface is reached', () => {
        setShellRoute({ surface: 'match', pathname: '/game', gameId: 'tactics' });
        armShellTransition({ kind: 'to-shell', durationMs: 200 });

        setShellRoute({ surface: 'lobby', pathname: '/lobby', gameId: 'tactics' });

        expect(getShellState().transition).toBeNull();
    });

    it('keeps a to-shell transition armed while the match surface still holds', () => {
        setShellRoute({ surface: 'match', pathname: '/game', gameId: 'tactics' });
        armShellTransition({ kind: 'to-shell', durationMs: 200 });

        setShellRoute({ surface: 'match', pathname: '/game', gameId: 'other' });

        expect(getShellState().transition).toEqual({ kind: 'to-shell', durationMs: 200 });
    });
});

describe('setShellDraft', () => {
    it('merges per key rather than replacing the draft', () => {
        setShellDraft({ matchSettings: { mapSize: 'small' } });

        setShellDraft({ hostAttributes: { team: 'red' } });

        expect(getShellState().draft).toEqual({
            matchSettings: { mapSize: 'small' },
            hostAttributes: { team: 'red' },
        });
    });

    it('replaces a key it names', () => {
        setShellDraft({ aiSeats: [{ attributes: { team: 'green' } }] });

        setShellDraft({ aiSeats: [] });

        expect(getShellState().draft.aiSeats).toEqual([]);
    });

    it('round-trips a draft written by one reader to a second reader', () => {
        const written: QuickStartConfig = {
            matchSettings: { mapSize: 'large' },
            localSeats: [{ attributes: { team: 'blue' } }],
        };

        setShellDraft(written);

        expect(getShellState().draft).toEqual(written);
        expect(shellStateStore.getState().draft).toEqual(written);
    });

    it('leaves the published route and an armed transition untouched', () => {
        setShellRoute({ surface: 'page', pathname: '/character-select', gameId: 'tactics' });
        armShellTransition({ kind: 'to-match', durationMs: 200 });

        setShellDraft({ hostAttributes: { team: 'red' } });

        expect(getShellState().surface).toBe('page');
        expect(getShellState().pathname).toBe('/character-select');
        expect(getShellState().gameId).toBe('tactics');
        expect(getShellState().transition).toEqual({ kind: 'to-match', durationMs: 200 });
    });

    it('publishes a new draft object so a selector on it re-renders', () => {
        const before = getShellState().draft;
        const recorder = recordPublishes();

        setShellDraft({ hostAttributes: { team: 'red' } });

        expect(recorder.states).toHaveLength(1);
        expect(getShellState().draft).not.toBe(before);
        recorder.stop();
    });
});

describe('_resetShellStateForTest', () => {
    it('returns every field to its initial value', () => {
        setShellRoute({ surface: 'match', pathname: '/game', gameId: 'tactics' });
        setShellDraft({ hostAttributes: { team: 'red' } });
        armShellTransition({ kind: 'to-shell', durationMs: 200 });

        _resetShellStateForTest();

        expect(getShellState()).toEqual({
            surface: 'boot',
            pathname: '/',
            gameId: null,
            transition: null,
            draft: {},
        });
    });
});

describe('transition arrival is asked on a route CHANGE only', () => {
    it('keeps a to-shell transition armed from the replay player across a republish of that route', () => {
        // The reverse navigation gate arms `to-shell` from the replay player,
        // whose surface already satisfies "not the match" — so an arrival test
        // taken on every republish would clear the arm on the spot and leave a
        // background nothing to move on.
        const replayPlayer = {
            surface: 'replay-player',
            pathname: '/replays/player',
            gameId: 'tactics',
        } as const;
        setShellRoute(replayPlayer);
        armShellTransition({ kind: 'to-shell', durationMs: 200 });

        setShellRoute(replayPlayer);

        expect(getShellState().transition).toEqual({ kind: 'to-shell', durationMs: 200 });
    });

    it('clears it on the hop that actually leaves the replay player', () => {
        setShellRoute({ surface: 'replay-player', pathname: '/replays/player', gameId: 'tactics' });
        armShellTransition({ kind: 'to-shell', durationMs: 200 });

        setShellRoute({ surface: 'lobby', pathname: '/lobby', gameId: 'tactics' });

        expect(getShellState().transition).toBeNull();
    });

    it('keeps a to-match transition armed across a republish of the match route it reached', () => {
        // Symmetric: the forward gate's arm is cleared by the ARRIVAL at
        // `/game`, and a later republish of that same route must not be able to
        // clear an arm raised after it.
        const match = { surface: 'match', pathname: '/game', gameId: 'tactics' } as const;
        setShellRoute(match);
        armShellTransition({ kind: 'to-match', durationMs: 200 });

        setShellRoute(match);

        expect(getShellState().transition).toEqual({ kind: 'to-match', durationMs: 200 });
    });
});
