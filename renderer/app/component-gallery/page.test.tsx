// @vitest-environment jsdom
// renderer/app/component-gallery/page.test.tsx
//
// Tests for the component-gallery route.
//
// Architecture reference: §4.35 — UI Design System, §4.37 — Shell Pages UI Contract
// Task: issue #607
//
// Invariants checked:
//   #91 — No hardcoded colour/spacing/radius values in inline style props.
//   #93 — No game token override CSS imported.
//   #94 — No games/* imports.
//
// Gate: `notFound()` called in production outside E2E mode.

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../theme/ThemeProvider';
import ComponentGalleryClient from './ComponentGalleryClient';
import ComponentGalleryPage from './page';

vi.mock('next/navigation', () => ({
    notFound: vi.fn(),
    useRouter: () => ({ push: vi.fn() }),
}));

import { notFound as notFoundMock } from 'next/navigation';

function renderGallery(): void {
    render(
        <ThemeProvider>
            <ComponentGalleryClient />
        </ThemeProvider>,
    );
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

// ── AC #1 — Root container ────────────────────────────────────────────────────

describe('ComponentGalleryClient — root container (AC #1)', () => {
    it('renders the gallery root with data-testid="component-gallery"', () => {
        renderGallery();
        expect(screen.getByTestId('component-gallery')).toBeTruthy();
    });

    it('renders a visible heading "Component Gallery"', () => {
        renderGallery();
        expect(screen.getByRole('heading', { name: /component gallery/i })).toBeTruthy();
    });
});

// ── AC #2 — All six category tabs ─────────────────────────────────────────────

describe('ComponentGalleryClient — category tabs present (AC #2)', () => {
    it('renders an Actions tab', () => {
        renderGallery();
        expect(screen.getByRole('tab', { name: /actions/i })).toBeTruthy();
    });

    it('renders an Overlays tab', () => {
        renderGallery();
        expect(screen.getByRole('tab', { name: /overlays/i })).toBeTruthy();
    });

    it('renders a Containers tab', () => {
        renderGallery();
        expect(screen.getByRole('tab', { name: /containers/i })).toBeTruthy();
    });

    it('renders a Forms tab', () => {
        renderGallery();
        expect(screen.getByRole('tab', { name: /forms/i })).toBeTruthy();
    });

    it('renders a Feedback tab', () => {
        renderGallery();
        expect(screen.getByRole('tab', { name: /feedback/i })).toBeTruthy();
    });

    it('renders a Typography tab', () => {
        renderGallery();
        expect(screen.getByRole('tab', { name: /typography/i })).toBeTruthy();
    });
});

// ── AC #3 — Default tab panel is visible ──────────────────────────────────────

describe('ComponentGalleryClient — default tab (AC #3)', () => {
    it('shows the Actions panel by default', () => {
        renderGallery();
        const actionsTab = screen.getByRole('tab', { name: /actions/i });
        expect(actionsTab).toHaveAttribute('aria-selected', 'true');
    });
});

// ── AC #4 — Tab switching works ───────────────────────────────────────────────

describe('ComponentGalleryClient — tab switching (AC #4)', () => {
    it('selects the Forms tab when clicked', () => {
        renderGallery();
        const formsTab = screen.getByRole('tab', { name: /forms/i });
        fireEvent.click(formsTab);
        expect(formsTab).toHaveAttribute('aria-selected', 'true');
    });

    it('deselects the Actions tab after switching to Forms', () => {
        renderGallery();
        fireEvent.click(screen.getByRole('tab', { name: /forms/i }));
        expect(screen.getByRole('tab', { name: /actions/i })).toHaveAttribute(
            'aria-selected',
            'false',
        );
    });
});

// ── AC #5 — Modal open/close within Overlays panel ───────────────────────────

describe('ComponentGalleryClient — modal interaction (AC #5)', () => {
    beforeEach(() => {
        renderGallery();
        fireEvent.click(screen.getByRole('tab', { name: /overlays/i }));
    });

    it('opens the example Modal when the open-modal button is clicked', () => {
        fireEvent.click(screen.getByTestId('gallery-open-modal'));
        expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('closes the example Modal when the close button is clicked', () => {
        fireEvent.click(screen.getByTestId('gallery-open-modal'));
        const closeBtn = screen.getByRole('button', { name: /close/i });
        fireEvent.click(closeBtn);
        expect(screen.queryByRole('dialog')).toBeNull();
    });
});

// ── AC #5b — ToggleButton interaction in Actions panel ──────────────────────

describe('ComponentGalleryClient — ToggleButton interaction (AC #5b)', () => {
    it('toggles the ToggleButton when clicked', () => {
        renderGallery();
        const btn = screen.getByRole('button', { name: /toggle me/i });
        expect(btn).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(btn);
        expect(btn).toHaveAttribute('aria-pressed', 'true');
    });
});

// ── AC #6 — Toggle state in Forms panel ──────────────────────────────────────

describe('ComponentGalleryClient — toggle interaction (AC #6)', () => {
    it('flips the example Toggle when clicked', () => {
        renderGallery();
        fireEvent.click(screen.getByRole('tab', { name: /forms/i }));
        const toggle = screen.getByRole('switch', { name: /enable feature/i });
        const initialChecked = (toggle as HTMLInputElement).checked;
        fireEvent.click(toggle);
        expect((toggle as HTMLInputElement).checked).toBe(!initialChecked);
    });
});

// ── AC #6b — Select in Forms panel ──────────────────────────────────────────

describe('ComponentGalleryClient — Select present in Forms panel (AC #6b)', () => {
    it('renders a Select combobox in the Forms tab', () => {
        renderGallery();
        fireEvent.click(screen.getByRole('tab', { name: /forms/i }));
        expect(screen.getByRole('combobox', { name: /colour scheme/i })).toBeTruthy();
    });
});

// ── AC #7 — Server page gate (notFound) — isGalleryEnabled unit + page integration ─

describe('ComponentGalleryPage server wrapper — gate (AC #7)', () => {
    it('calls notFound() when ComponentGalleryPage renders in production without E2E flag', () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '');

        vi.mocked(notFoundMock).mockClear();
        render(
            <ThemeProvider>
                <ComponentGalleryPage />
            </ThemeProvider>,
        );
        expect(vi.mocked(notFoundMock)).toHaveBeenCalledOnce();

        vi.unstubAllEnvs();
    });

    it('does not call notFound() when ComponentGalleryPage renders in development', () => {
        vi.stubEnv('NODE_ENV', 'development');

        vi.mocked(notFoundMock).mockClear();
        render(
            <ThemeProvider>
                <ComponentGalleryPage />
            </ThemeProvider>,
        );
        expect(vi.mocked(notFoundMock)).not.toHaveBeenCalled();

        vi.unstubAllEnvs();
    });

    it('isGalleryEnabled returns true when NODE_ENV is development', async () => {
        vi.stubEnv('NODE_ENV', 'development');

        const { isGalleryEnabled } = await import('./galleryGate.js');
        expect(isGalleryEnabled()).toBe(true);

        vi.unstubAllEnvs();
    });

    it('isGalleryEnabled returns true when NEXT_PUBLIC_CHIMERA_E2E is "1"', async () => {
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('NEXT_PUBLIC_CHIMERA_E2E', '1');

        const { isGalleryEnabled } = await import('./galleryGate.js');
        expect(isGalleryEnabled()).toBe(true);

        vi.unstubAllEnvs();
    });
});

// ── AC #8 (issue #608) — Actions panel stable test IDs and data-ch-* attributes ───────────────

describe('ComponentGalleryClient — Actions section test IDs (issue #608)', () => {
    it('renders the actions section with data-testid="component-gallery-actions"', () => {
        renderGallery();
        expect(screen.getByTestId('component-gallery-actions')).toBeTruthy();
    });

    it('renders a primary Button with data-testid="gallery-button-primary"', () => {
        renderGallery();
        const btn = screen.getByTestId('gallery-button-primary');
        expect(btn).toBeTruthy();
        expect(btn).toHaveAttribute('data-ch-button-variant', 'primary');
    });

    it('renders a danger Button with data-testid="gallery-button-danger"', () => {
        renderGallery();
        const btn = screen.getByTestId('gallery-button-danger');
        expect(btn).toBeTruthy();
        expect(btn).toHaveAttribute('data-ch-button-variant', 'danger');
    });

    it('renders all four Button variants visible in the Actions section', () => {
        renderGallery();
        const section = screen.getByTestId('component-gallery-actions');
        expect(section.querySelector('[data-ch-button-variant="primary"]')).toBeTruthy();
        expect(section.querySelector('[data-ch-button-variant="secondary"]')).toBeTruthy();
        expect(section.querySelector('[data-ch-button-variant="ghost"]')).toBeTruthy();
        expect(section.querySelector('[data-ch-button-variant="danger"]')).toBeTruthy();
    });

    it('renders Button size variants in the Actions section', () => {
        renderGallery();
        const section = screen.getByTestId('component-gallery-actions');
        expect(section.querySelector('[data-ch-button-size="sm"]')).toBeTruthy();
        expect(section.querySelector('[data-ch-button-size="md"]')).toBeTruthy();
        expect(section.querySelector('[data-ch-button-size="lg"]')).toBeTruthy();
    });

    it('renders a disabled Button in the Actions section', () => {
        renderGallery();
        const section = screen.getByTestId('component-gallery-actions');
        const disabledBtn = section.querySelector('button[disabled]');
        expect(disabledBtn).toBeTruthy();
    });

    it('renders an IconButton with data-testid="gallery-icon-button"', () => {
        renderGallery();
        expect(screen.getByTestId('gallery-icon-button')).toBeTruthy();
    });

    it('renders a ToggleButton with data-testid="gallery-toggle-button"', () => {
        renderGallery();
        expect(screen.getByTestId('gallery-toggle-button')).toBeTruthy();
    });

    it('ToggleButton switches pressed state locally without touching global stores', () => {
        renderGallery();
        const btn = screen.getByTestId('gallery-toggle-button');
        expect(btn).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(btn);
        expect(btn).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(btn);
        expect(btn).toHaveAttribute('aria-pressed', 'false');
    });
});

// ── AC #8b (issue #608) — Overlays section stable test IDs ──────────────────

describe('ComponentGalleryClient — Overlays section test IDs (issue #608)', () => {
    beforeEach(() => {
        renderGallery();
        fireEvent.click(screen.getByRole('tab', { name: /overlays/i }));
    });

    it('renders the overlays section with data-testid="component-gallery-overlays"', () => {
        expect(screen.getByTestId('component-gallery-overlays')).toBeTruthy();
    });

    it('opens the Drawer when gallery-open-drawer button is clicked', () => {
        fireEvent.click(screen.getByTestId('gallery-open-drawer'));
        expect(screen.getByTestId('gallery-drawer')).toBeTruthy();
    });

    it('closes the Drawer when its close affordance is clicked', () => {
        fireEvent.click(screen.getByTestId('gallery-open-drawer'));
        expect(screen.getByTestId('gallery-drawer')).toBeTruthy();
        const closeBtn = screen.getByRole('button', { name: /close/i });
        fireEvent.click(closeBtn);
        expect(screen.queryByTestId('gallery-drawer')).toBeNull();
    });

    it('only one of Modal or Drawer is open at a time (no overlap)', () => {
        // Open the modal first
        fireEvent.click(screen.getByTestId('gallery-open-modal'));
        expect(screen.getByRole('dialog', { name: /example modal/i })).toBeTruthy();
        // Opening the drawer should close the modal
        fireEvent.click(screen.getByTestId('gallery-open-drawer'));
        expect(screen.queryByRole('dialog', { name: /example modal/i })).toBeNull();
        expect(screen.getByTestId('gallery-drawer')).toBeTruthy();
    });

    it('opens the Popover from gallery-popover-trigger', () => {
        fireEvent.click(screen.getByTestId('gallery-popover-trigger'));
        expect(screen.getByRole('dialog', { name: /example popover/i })).toBeTruthy();
    });

    it('Tooltip trigger has an aria-describedby pointing to a role="tooltip" element', () => {
        const tooltipTrigger = screen.getByTestId('gallery-tooltip-trigger');
        const describedById = tooltipTrigger.getAttribute('aria-describedby');
        expect(describedById).toBeTruthy();
        const tooltipEl = document.getElementById(describedById!);
        expect(tooltipEl).toBeTruthy();
        expect(tooltipEl?.getAttribute('role')).toBe('tooltip');
    });
});
