// renderer/app/page.test.tsx
// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import HomePage from './page';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            system: {
                platform: vi.fn(async () => ({ os: 'macos', version: 'test' })),
            },
        },
    });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

describe('HomePage (boot-smoke page)', () => {
    it('renders the root container with data-testid="boot-smoke" for boot-smoke verification', () => {
        render(<HomePage />);
        expect(screen.getByTestId('boot-smoke')).toBeTruthy();
    });

    it('renders the Chimera logo for boot-smoke visual confirmation', () => {
        render(<HomePage />);
        expect(screen.getByAltText('Chimera')).toBeTruthy();
    });

    it('renders the logo eagerly (priority image, no lazy loading) so it paints without tearing', () => {
        render(<HomePage />);
        const logo = screen.getByAltText('Chimera');
        // `priority` drops next/image's default loading="lazy" (browser default
        // is eager); the matching <link rel="preload"> is an export-time concern
        // asserted by the boot-smoke e2e.
        expect(logo.getAttribute('loading')).toBeNull();
    });

    it('keeps the logo hidden until fully decoded, then reveals it atomically (no tearing)', async () => {
        let resolveDecode!: () => void;
        const decodePromise = new Promise<void>((resolve) => {
            resolveDecode = resolve;
        });
        Object.defineProperty(HTMLImageElement.prototype, 'decode', {
            configurable: true,
            value: vi.fn(() => decodePromise),
        });

        try {
            render(<HomePage />);
            const logo = screen.getByAltText('Chimera');

            // Hidden while the bitmap is still decoding — the browser must never
            // paint a partially decoded frame.
            expect(logo.style.opacity).toBe('0');

            resolveDecode();
            await waitFor(() => expect(logo.style.opacity).toBe('1'));
        } finally {
            Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
        }
    });

    it('reveals the logo even when the environment lacks img.decode() (fail open)', async () => {
        render(<HomePage />);
        const logo = screen.getByAltText('Chimera');
        await waitFor(() => expect(logo.style.opacity).toBe('1'));
    });

    it('renders no navigation buttons (page.tsx is boot-smoke only; buttons live at /main-menu)', () => {
        render(<HomePage />);
        expect(screen.queryByTestId('main-menu-play')).toBeNull();
        expect(screen.queryByTestId('main-menu-settings')).toBeNull();
        expect(screen.queryByTestId('main-menu-quit')).toBeNull();
    });
});
