// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDebugI18nStore } from '../state/debugI18nStore';
import { DebugI18nBootstrap } from './DebugI18nBootstrap';

function installSystemBridge(onI18nTokenMode: ReturnType<typeof vi.fn>): void {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: { system: { onI18nTokenMode } },
    });
}

afterEach(() => {
    cleanup();
    delete (window as unknown as { __chimera?: unknown }).__chimera;
    useDebugI18nStore.getState().setShowTranslationTokens(false);
    vi.restoreAllMocks();
});

describe('DebugI18nBootstrap', () => {
    it('subscribes to system.onI18nTokenMode on mount and flips the store when a push arrives', () => {
        let pushed: ((enabled: boolean) => void) | undefined;
        const onI18nTokenMode = vi.fn((cb: (enabled: boolean) => void) => {
            pushed = cb;
            return () => undefined;
        });
        installSystemBridge(onI18nTokenMode);

        render(<DebugI18nBootstrap />);

        expect(onI18nTokenMode).toHaveBeenCalledTimes(1);
        expect(useDebugI18nStore.getState().showTranslationTokens).toBe(false);

        pushed?.(true);
        expect(useDebugI18nStore.getState().showTranslationTokens).toBe(true);

        pushed?.(false);
        expect(useDebugI18nStore.getState().showTranslationTokens).toBe(false);
    });

    it('unsubscribes on unmount', () => {
        const unsubscribe = vi.fn();
        const onI18nTokenMode = vi.fn(() => unsubscribe);
        installSystemBridge(onI18nTokenMode);

        const { unmount } = render(<DebugI18nBootstrap />);
        unmount();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when the system bridge is unavailable', () => {
        // No __chimera on window (e.g. web preview / production before wiring).
        expect(() => render(<DebugI18nBootstrap />)).not.toThrow();
        expect(useDebugI18nStore.getState().showTranslationTokens).toBe(false);
    });
});
