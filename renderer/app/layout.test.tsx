// renderer/app/layout.test.tsx
//
// Tests for the root layout CSP meta tag (WARN-1 / #193).
// @vitest-environment jsdom

import { render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RootLayout from './layout';

beforeEach(() => {
    Object.defineProperty(window, '__chimera', {
        configurable: true,
        value: {
            system: {
                onConnectionStatus: vi.fn(() => () => undefined),
            },
        },
    });
});

afterEach(() => {
    delete (window as unknown as Record<string, unknown>)['__chimera'];
    vi.restoreAllMocks();
});

describe('RootLayout', () => {
    it('renders a Content-Security-Policy meta tag in the document head', () => {
        render(<RootLayout>{null}</RootLayout>);

        const metaList = Array.from(
            document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]'),
        );
        expect(metaList.length).toBeGreaterThan(0);

        const content = metaList[0]?.getAttribute('content') ?? '';
        expect(content).toContain("default-src 'self'");
        expect(content).toContain("object-src 'none'");
        expect(content).toContain("base-uri 'none'");
    });

    it('mounts ConnectionStatusIndicator so status is visible on every route', () => {
        render(<RootLayout>{null}</RootLayout>);

        const node = document.querySelector('[data-testid="connection-status"]');
        expect(node).toBeTruthy();
    });
});
