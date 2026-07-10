// @vitest-environment jsdom
// renderer/app/layout.test.tsx
//
// Tests for the root layout CSP meta tag (WARN-1 / #193).

import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToastStore } from '../state/toastStore';
import { AppShell } from './AppShell';
import RootLayout from './layout';

const { mockEmitRendererError, mockInstallRendererLogger, mockRendererLoggerTeardown } = vi.hoisted(
    () => {
        const teardown = vi.fn();
        return {
            mockEmitRendererError: vi.fn(),
            mockInstallRendererLogger: vi.fn(() => teardown),
            mockRendererLoggerTeardown: teardown,
        };
    },
);

vi.mock('../logging/rendererLogger', () => ({
    emitRendererError: mockEmitRendererError,
    installRendererLogger: mockInstallRendererLogger,
}));

vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
}));

const TOAST_ID = '00000000-0000-4000-8000-000000000645';

function installMatchMedia(): void {
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: false,
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            dispatchEvent: vi.fn(() => true),
        })),
    });
}

function renderLayoutDocument(children: React.ReactNode = null): Document {
    const markup = `<!DOCTYPE html>${renderToStaticMarkup(<RootLayout>{children}</RootLayout>)}`;
    return new DOMParser().parseFromString(markup, 'text/html');
}

function ThrowingRoute(): React.ReactElement {
    throw new Error('simulated route crash');
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => TOAST_ID) });
    vi.spyOn(performance, 'now').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockEmitRendererError.mockClear();
    mockInstallRendererLogger.mockClear();
    mockRendererLoggerTeardown.mockClear();
    installMatchMedia();
    useToastStore.getState().dismissAll();

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
    useToastStore.getState().dismissAll();
    cleanup();
    delete (window as unknown as Record<string, unknown>)['__chimera'];
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
        expect(content).toContain("media-src 'self'");
        expect(content).toContain("object-src 'none'");
        expect(content).toContain("base-uri 'none'");
    });

    it('mounts ConnectionStatusIndicator so status is visible on every route', () => {
        const renderedDocument = renderLayoutDocument();

        const node = renderedDocument.querySelector('[data-testid="connection-status"]');
        expect(node).toBeTruthy();
    });

    it('mounts ToastHost as a sibling of routed content in the shell root', () => {
        const renderedDocument = renderLayoutDocument(<main data-testid="route-content" />);

        const routeContent = renderedDocument.querySelector('[data-testid="route-content"]');
        const toastHost = renderedDocument.querySelector('[data-testid="toast-host"]');

        expect(routeContent).toBeTruthy();
        expect(toastHost).toBeTruthy();
        expect(toastHost?.parentElement).toBe(routeContent?.parentElement);
        expect(routeContent?.contains(toastHost)).toBe(false);
        expect(toastHost?.contains(routeContent)).toBe(false);
    });

    it('keeps ToastHost mounted when RootErrorBoundary catches a routed subtree crash', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        act(() => {
            useToastStore.getState().push({
                severity: 'error',
                title: 'Crash toast survives',
                durationMs: 60_000,
            });
        });

        render(
            <AppShell>
                <ThrowingRoute />
            </AppShell>,
        );

        expect(screen.getByRole('alert')).toHaveTextContent('An unexpected error occurred.');
        expect(screen.getByTestId('toast-host')).toBeInTheDocument();
        expect(screen.getByText('Crash toast survives')).toBeInTheDocument();
    });

    it('installs renderer logging from the window.__chimera.logs IPC surface', () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const logsApi = {
            emit: vi.fn(),
            readRecent: vi.fn(() => Promise.resolve([])),
        };
        (window as unknown as { __chimera: { logs?: typeof logsApi } }).__chimera.logs = logsApi;

        const rendered = render(
            <AppShell>
                <main />
            </AppShell>,
        );

        expect(mockInstallRendererLogger).toHaveBeenCalledWith(logsApi);

        rendered.unmount();

        expect(mockRendererLoggerTeardown).toHaveBeenCalledOnce();
    });

    it('seeds shell pages with first-paint-safe token background and text colors', () => {
        const renderedDocument = renderLayoutDocument();
        const htmlStyle = renderedDocument.documentElement.getAttribute('style') ?? '';
        const bodyStyle = renderedDocument.body.getAttribute('style') ?? '';

        expect(htmlStyle).toContain('background-color:var(--ch-color-surface, #111113)');
        expect(bodyStyle).toContain('background-color:var(--ch-color-surface, #111113)');
        expect(bodyStyle).toContain('color:var(--ch-color-text-primary)');
        expect(bodyStyle).toContain('font-family:var(--ch-font-ui)');
    });
});
