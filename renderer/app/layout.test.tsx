// renderer/app/layout.test.tsx
//
// Tests for the root layout CSP meta tag (WARN-1 / #193).
// @vitest-environment jsdom

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RootLayout from './layout';

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    usePathname: () => '/',
}));

function renderLayoutDocument(): Document {
    const markup = `<!DOCTYPE html>${renderToStaticMarkup(<RootLayout>{null}</RootLayout>)}`;
    return new DOMParser().parseFromString(markup, 'text/html');
}

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
        const renderedDocument = renderLayoutDocument();

        const metaList = Array.from(
            renderedDocument.querySelectorAll('meta[http-equiv="Content-Security-Policy"]'),
        );
        expect(metaList.length).toBeGreaterThan(0);

        const content = metaList[0]?.getAttribute('content') ?? '';
        expect(content).toContain("default-src 'self'");
        expect(content).toContain("script-src 'self' 'unsafe-inline'");
        expect(content).toContain("style-src 'self' 'unsafe-inline'");
        expect(content).toContain("img-src 'self' data:");
        expect(content).toContain("object-src 'none'");
        expect(content).toContain("base-uri 'none'");
    });

    it('mounts ConnectionStatusIndicator so status is visible on every route', () => {
        const renderedDocument = renderLayoutDocument();

        const node = renderedDocument.querySelector('[data-testid="connection-status"]');
        expect(node).toBeTruthy();
    });
});
