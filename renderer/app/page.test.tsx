// renderer/app/page.test.tsx
// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
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

    it('renders no navigation buttons (page.tsx is boot-smoke only; buttons live at /main-menu)', () => {
        render(<HomePage />);
        expect(screen.queryByTestId('main-menu-play')).toBeNull();
        expect(screen.queryByTestId('main-menu-settings')).toBeNull();
        expect(screen.queryByTestId('main-menu-quit')).toBeNull();
    });
});
