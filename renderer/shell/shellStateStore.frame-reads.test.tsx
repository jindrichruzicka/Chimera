// @vitest-environment jsdom

/**
 * renderer/shell/shellStateStore.frame-reads.test.tsx
 *
 * `getShellState()` is the transient read (§4.37.18): the form a `useFrame`
 * callback takes, because a per-frame read through a SUBSCRIPTION would
 * re-render the component on every write it observes.
 *
 * The claim is about renders, and a settled DOM cannot see a render — so the
 * instrument is a module-level render counter on each probe, with the
 * subscribing twin beside it as the positive control: without it, a store that
 * had stopped publishing entirely would satisfy the transient half.
 *
 * `@react-three/fiber` is mocked (the PerfProbe pattern): no WebGL context is
 * needed to hold a claim about subscriptions.
 *
 * Kill confirmed by mutation: swapping the probe's `getShellState()` for
 * `useShellState((state) => state)` — the shape this file exists to rule out —
 * fails three of the five cases below.
 */

import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFrame } from '@react-three/fiber';

type ReactModule = typeof React;
import {
    _resetShellStateForTest,
    getShellState,
    setShellDraft,
    setShellRoute,
    useShellState,
    type ShellState,
} from './shellStateStore';

type FrameCallback = () => void;

const frameCallbacks: FrameCallback[] = [];

vi.mock('@react-three/fiber', async () => {
    const { useRef } = await vi.importActual<ReactModule>('react');
    return {
        useFrame: (callback: FrameCallback): void => {
            const indexRef = useRef<number | null>(null);
            indexRef.current ??= frameCallbacks.length;
            frameCallbacks[indexRef.current] = callback;
        },
    };
});

function runFrame(): void {
    for (const callback of frameCallbacks) {
        callback();
    }
}

let transientRenders = 0;
let subscribedRenders = 0;
let seenInFrame: ShellState | null = null;

/** Reads the shell state every frame WITHOUT subscribing. */
function TransientReader(): null {
    transientRenders += 1;
    useFrame(() => {
        seenInFrame = getShellState();
    });
    return null;
}

/** The positive control: the same read, through a subscription. */
function SubscribedReader(): null {
    subscribedRenders += 1;
    useShellState((state) => state.draft);
    return null;
}

beforeEach(() => {
    _resetShellStateForTest();
    frameCallbacks.length = 0;
    transientRenders = 0;
    subscribedRenders = 0;
    seenInFrame = null;
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('getShellState() inside useFrame', () => {
    it('does not re-render the reader when the draft is written', () => {
        render(
            <>
                <TransientReader />
                <SubscribedReader />
            </>,
        );
        const transientBefore = transientRenders;
        const subscribedBefore = subscribedRenders;

        act(() => {
            setShellDraft({ hostAttributes: { team: 'red' } });
        });

        expect(transientRenders).toBe(transientBefore);
        // The control: a subscriber DOES re-render, so the assertion above is
        // about the read form and not about a store that stopped publishing.
        expect(subscribedRenders).toBeGreaterThan(subscribedBefore);
    });

    it('does not re-render the reader when the route is republished', () => {
        render(<TransientReader />);
        const before = transientRenders;

        act(() => {
            setShellRoute({ surface: 'match', pathname: '/game', gameId: 'tactics' });
        });

        expect(transientRenders).toBe(before);
    });

    it('still sees the newest value on the next frame', () => {
        render(<TransientReader />);

        act(() => {
            setShellDraft({ hostAttributes: { team: 'blue' } });
        });
        runFrame();

        expect(seenInFrame).toMatchObject({ draft: { hostAttributes: { team: 'blue' } } });
    });

    it('sees a newly published route on the next frame', () => {
        render(<TransientReader />);

        act(() => {
            setShellRoute({ surface: 'main-menu', pathname: '/main-menu', gameId: 'tactics' });
        });
        runFrame();

        expect(seenInFrame).toMatchObject({ surface: 'main-menu', gameId: 'tactics' });
    });

    it('costs no render even across many writes', () => {
        render(<TransientReader />);
        const before = transientRenders;

        act(() => {
            for (let index = 0; index < 20; index += 1) {
                setShellDraft({ hostAttributes: { team: `t${index}` } });
            }
        });
        runFrame();

        expect(transientRenders).toBe(before);
        expect(seenInFrame).toMatchObject({ draft: { hostAttributes: { team: 't19' } } });
    });
});
