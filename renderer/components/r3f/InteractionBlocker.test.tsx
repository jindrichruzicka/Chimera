// @vitest-environment jsdom
//
// Unit tests for InteractionBlocker context provider and useInteractionContext hook.
// Architecture: §4.23 — Pointer and Click Interactions
// Issue: #552

import { renderHook } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameStore } from '../../state/gameStore.js';
import { InteractionBlocker, useInteractionContext } from './InteractionBlocker.js';

vi.mock('../../state/gameStore.js', () => ({
    useGameStore: vi.fn(),
}));

function mockGameStoreWith(sceneTransition: unknown): void {
    vi.mocked(useGameStore).mockImplementation((selector: any) =>
        selector({ snapshot: sceneTransition === undefined ? null : { sceneTransition } }),
    );
}

function makeBlockerWrapper() {
    return ({ children }: { children: ReactNode }) => (
        <InteractionBlocker>{children}</InteractionBlocker>
    );
}

describe('useInteractionContext', () => {
    beforeEach(() => {
        mockGameStoreWith(null);
    });

    it('provides isBlocked=false when sceneTransition is null', () => {
        mockGameStoreWith(null);
        const { result } = renderHook(() => useInteractionContext(), {
            wrapper: makeBlockerWrapper(),
        });
        expect(result.current.isBlocked).toBe(false);
    });

    it('provides isBlocked=true when sceneTransition is non-null', () => {
        mockGameStoreWith({ from: 'scene-a', to: 'scene-b' });
        const { result } = renderHook(() => useInteractionContext(), {
            wrapper: makeBlockerWrapper(),
        });
        expect(result.current.isBlocked).toBe(true);
    });

    it('provides isBlocked=false when snapshot is null (game not yet started)', () => {
        mockGameStoreWith(undefined);
        const { result } = renderHook(() => useInteractionContext(), {
            wrapper: makeBlockerWrapper(),
        });
        expect(result.current.isBlocked).toBe(false);
    });

    it('throws a descriptive error when called outside an InteractionBlocker provider', () => {
        expect(() => renderHook(() => useInteractionContext())).toThrow(
            /useInteractionContext must be called inside/,
        );
    });
});
