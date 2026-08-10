// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useTimeScaleStore } from '../../animation/timeScaleStore.js';
import { TimeScaleBridge } from './TimeScaleBridge.js';

function currentTimeScale(): number {
    return useTimeScaleStore.getState().timeScale;
}

beforeEach(() => {
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

afterEach(() => {
    cleanup();
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

describe('TimeScaleBridge', () => {
    it('seats the multiplier for the authoritative permille', () => {
        render(<TimeScaleBridge permille={250} />);

        // The MULTIPLIER, not the permille: writing 250 through, or its
        // reciprocal 4, would each be a whole-game speed error with no other
        // symptom.
        expect(currentTimeScale()).toBe(0.25);
    });

    it('seats real time for a snapshot that carries no permille', () => {
        render(<TimeScaleBridge permille={undefined} />);

        expect(currentTimeScale()).toBe(1);
    });

    it('re-seats the multiplier when the snapshot changes it', () => {
        const { rerender } = render(<TimeScaleBridge permille={250} />);
        expect(currentTimeScale()).toBe(0.25);

        rerender(<TimeScaleBridge permille={2000} />);
        expect(currentTimeScale()).toBe(2);

        rerender(<TimeScaleBridge permille={undefined} />);
        expect(currentTimeScale()).toBe(1);
    });

    it('returns the renderer to real time when it unmounts', () => {
        // The multiplier belongs to a live snapshot, and an unmounted bridge has
        // none. Leaving the last value seated would slow every clip in the app —
        // menus, galleries and showcase routes included, since `useClipPlayer`
        // follows this store by default — with nothing able to reset it: the
        // writer reaches no barrel and `setState` is withheld (§5.5).
        const { unmount } = render(<TimeScaleBridge permille={250} />);
        expect(currentTimeScale()).toBe(0.25);

        unmount();

        expect(currentTimeScale()).toBe(1);
    });

    it('renders nothing at all', () => {
        const { container } = render(<TimeScaleBridge permille={250} />);

        expect(container.innerHTML).toBe('');
    });

    it('clamps through the one shared clamp rather than trusting the wire', () => {
        // A permille is an optional wire field on a snapshot the host owns; the
        // bridge hands it to the store verbatim and the shared helper decides
        // what an out-of-range or fractional one means (Invariant #130).
        const { rerender } = render(<TimeScaleBridge permille={9000} />);
        expect(currentTimeScale()).toBe(4);

        rerender(<TimeScaleBridge permille={250.5} />);
        expect(currentTimeScale()).toBe(1);
    });
});
