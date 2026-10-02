// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShadowQuality } from './rendererConfig';
import {
    ShadowQualityContext,
    ShadowQualityProvider,
    useCanvasShadowQuality,
} from './shadowQualityContext';

afterEach(() => {
    vi.restoreAllMocks();
});

/** Every resolved quality, held complete by `satisfies`. */
const EVERY_QUALITY = Object.keys({
    off: true,
    basic: true,
    percentage: true,
    soft: true,
    variance: true,
} satisfies Record<ShadowQuality, true>) as ShadowQuality[];

describe('useCanvasShadowQuality', () => {
    it('returns the shadow quality the nearest provider holds', () => {
        const wrapper = ({ children }: { readonly children: ReactNode }): React.ReactElement => (
            <ShadowQualityContext.Provider value="percentage">
                {children}
            </ShadowQualityContext.Provider>
        );

        const { result } = renderHook(() => useCanvasShadowQuality(), { wrapper });

        expect(result.current).toBe('percentage');
    });

    it('throws a descriptive error outside a GameCanvas', () => {
        // React logs the uncaught render error before rethrowing it.
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderHook(() => useCanvasShadowQuality())).toThrow(
            /must be called inside a <GameCanvas>/u,
        );
    });

    it('names ShadowQualityProvider as the stand-in for a component test', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        expect(() => renderHook(() => useCanvasShadowQuality())).toThrow(
            /inside a <ShadowQualityProvider>/u,
        );
    });
});

describe('ShadowQualityProvider', () => {
    it('provides its quality to useCanvasShadowQuality', () => {
        const wrapper = ({ children }: { readonly children: ReactNode }): React.ReactElement => (
            <ShadowQualityProvider quality="soft">{children}</ShadowQualityProvider>
        );

        const { result } = renderHook(() => useCanvasShadowQuality(), { wrapper });

        expect(result.current).toBe('soft');
    });

    it.each(EVERY_QUALITY)('throws inside a GameCanvas that resolved %s', (resolved) => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        // What GameCanvas mounts around every child.
        const wrapper = ({ children }: { readonly children: ReactNode }): React.ReactElement => (
            <ShadowQualityContext.Provider value={resolved}>
                <ShadowQualityProvider quality="soft">{children}</ShadowQualityProvider>
            </ShadowQualityContext.Provider>
        );

        expect(() => renderHook(() => useCanvasShadowQuality(), { wrapper })).toThrow(
            /must not be mounted inside a <GameCanvas>/u,
        );
    });

    it('throws inside another ShadowQualityProvider', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const wrapper = ({ children }: { readonly children: ReactNode }): React.ReactElement => (
            <ShadowQualityProvider quality="off">
                <ShadowQualityProvider quality="soft">{children}</ShadowQualityProvider>
            </ShadowQualityProvider>
        );

        expect(() => renderHook(() => useCanvasShadowQuality(), { wrapper })).toThrow(
            /or inside another ShadowQualityProvider/u,
        );
    });
});
