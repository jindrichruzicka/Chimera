// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    SetGameAssetManagerContext,
    useReleaseGameAssetManager,
    useSetGameAssetManager,
    type GameAssetManagerBinding,
} from './SetGameAssetManagerContext.js';

afterEach(() => {
    cleanup();
});

/**
 * One binding object per test, built OUTSIDE the wrapper. A wrapper that built a
 * fresh object per render would hand every consumer a new `set`/`release` on every
 * render, which is exactly what the identity assertions below are here to rule out.
 */
function makeWrapper(binding: GameAssetManagerBinding) {
    return function Wrapper({
        children,
    }: {
        readonly children: React.ReactNode;
    }): React.ReactElement {
        return (
            <SetGameAssetManagerContext.Provider value={binding}>
                {children}
            </SetGameAssetManagerContext.Provider>
        );
    };
}

describe('SetGameAssetManagerContext', () => {
    it('throws a descriptive error when used outside the provider', () => {
        expect(() => renderHook(() => useSetGameAssetManager())).toThrow(
            'useSetGameAssetManager() must be used within the app root (inside <Providers>).',
        );
    });

    it('returns the injected setter inside the provider', () => {
        const binding: GameAssetManagerBinding = { set: vi.fn(), release: vi.fn() };

        const { result } = renderHook(() => useSetGameAssetManager(), {
            wrapper: makeWrapper(binding),
        });

        expect(result.current).toBe(binding.set);
    });
});

describe('useReleaseGameAssetManager', () => {
    it('throws a descriptive error when used outside the provider', () => {
        expect(() => renderHook(() => useReleaseGameAssetManager())).toThrow(
            'useReleaseGameAssetManager() must be used within the app root (inside <Providers>).',
        );
    });

    it('returns the injected release verb inside the provider', () => {
        const binding: GameAssetManagerBinding = { set: vi.fn(), release: vi.fn() };

        const { result } = renderHook(() => useReleaseGameAssetManager(), {
            wrapper: makeWrapper(binding),
        });

        expect(result.current).toBe(binding.release);
    });

    it('keeps both verbs stable across a rerender, so either is safe in a dependency list', () => {
        const binding: GameAssetManagerBinding = { set: vi.fn(), release: vi.fn() };
        const wrapper = makeWrapper(binding);

        const { result, rerender } = renderHook(
            () => [useSetGameAssetManager(), useReleaseGameAssetManager()] as const,
            { wrapper },
        );
        const [firstSet, firstRelease] = result.current;
        rerender();

        expect(result.current[0]).toBe(firstSet);
        expect(result.current[1]).toBe(firstRelease);
    });
});
