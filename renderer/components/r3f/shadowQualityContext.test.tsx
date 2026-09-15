// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import React from 'react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShadowQualityContext, useCanvasShadowQuality } from './shadowQualityContext';

afterEach(() => {
    vi.restoreAllMocks();
});

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
});
