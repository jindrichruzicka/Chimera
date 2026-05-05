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
            saves: {
                checkCrashRecovery: vi.fn(async () => ({ needsRecovery: false, slotId: null })),
            },
        },
    });
});

afterEach(() => {
    cleanup();
    Reflect.deleteProperty(window, '__chimera');
    vi.restoreAllMocks();
});

describe('HomePage page object locators', () => {
    it('marks the main menu screen for the page object model', () => {
        render(<HomePage />);
        expect(screen.getByTestId('main-menu')).toBeTruthy();
    });
});
