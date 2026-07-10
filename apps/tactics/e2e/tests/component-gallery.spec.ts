/**
 * F611 — component-gallery.spec.ts
 * §13.x Core E2E Test Specifications
 *
 * Playwright smoke coverage for the dev/test-only component gallery route.
 *
 * Acceptance criteria:
 *   1. Navigate to /component-gallery/ in the Electron fixture.
 *   2. Switch through all six category tabs.
 *   3. Open and close the Modal overlay.
 *   4. Open and close the Drawer overlay.
 *   5. Interact with representative form controls (Slider, Toggle, TextInput, Select, NumberInput).
 *   6. Assert at least one themed Button resolves its background from --ch-color-accent.
 *   7. The default Actions tab does not create document-level vertical overflow.
 *
 * Invariants honoured:
 *   #86 — UI components must reference --ch-* tokens for all visual attributes.
 *   #93 — No game token override CSS imported.
 *   #94 — No games/* imports.
 */

import { test, expect } from '../fixtures/electron.fixture';
import type { Locator } from '@playwright/test';
import { ComponentGalleryPage } from '../pages/ComponentGalleryPage';
import { MainMenuPage } from '../pages/MainMenuPage';

// ── Shared token-match helper (mirrors theme.spec.ts pattern) ─────────────────

interface BrowserStyleDeclaration {
    readonly backgroundColor: string;
    getPropertyValue(propertyName: string): string;
}

interface BrowserWindowAccess {
    getComputedStyle(element: unknown): BrowserStyleDeclaration;
}

interface BrowserProbeElement {
    readonly style: { backgroundColor: string };
    remove(): void;
}

interface BrowserDocumentAccess {
    readonly defaultView: BrowserWindowAccess | null;
    readonly documentElement: unknown;
    readonly body: {
        appendChild(element: BrowserProbeElement): void;
    };
    createElement(tagName: 'div'): BrowserProbeElement;
}

interface BrowserElementWithDocument {
    readonly ownerDocument: BrowserDocumentAccess;
}

interface BrowserPageOverflowMetrics {
    readonly documentClientHeight: number;
    readonly documentScrollHeight: number;
    readonly bodyClientHeight: number;
    readonly bodyScrollHeight: number;
}

interface BrowserPageOverflowElement {
    readonly clientHeight: number;
    readonly scrollHeight: number;
}

interface BrowserPageOverflowDocumentAccess {
    readonly body: BrowserPageOverflowElement;
    readonly documentElement: BrowserPageOverflowElement;
}

interface BrowserPageOverflowGlobalAccess {
    readonly document: BrowserPageOverflowDocumentAccess;
}

interface BrowserPortaledElement {
    readonly parentElement: unknown;
    readonly ownerDocument: { readonly body: unknown };
}

async function expectButtonBackgroundToMatchToken(
    button: Locator,
    tokenName: `--ch-${string}`,
): Promise<void> {
    const colors = await button.evaluate((element, expectedTokenName) => {
        const browserElement = element as unknown as BrowserElementWithDocument;
        const ownerDocument = browserElement.ownerDocument;
        const view = ownerDocument.defaultView;
        if (!view) throw new Error('Button document does not have a defaultView');

        const tokenValue = view
            .getComputedStyle(ownerDocument.documentElement)
            .getPropertyValue(expectedTokenName)
            .trim();
        const probe = ownerDocument.createElement('div');
        probe.style.backgroundColor = tokenValue;
        ownerDocument.body.appendChild(probe);

        const expectedBackgroundColor = view.getComputedStyle(probe).backgroundColor;
        const actualBackgroundColor = view.getComputedStyle(element).backgroundColor;
        probe.remove();

        return { actualBackgroundColor, expectedBackgroundColor };
    }, tokenName);

    expect(colors.actualBackgroundColor).toBe(colors.expectedBackgroundColor);
}

// ── Specs ─────────────────────────────────────────────────────────────────────

test.describe('Component Gallery', () => {
    test('navigates to /component-gallery/ successfully', async ({ mainWindow }) => {
        const gallery = new ComponentGalleryPage(mainWindow);
        await gallery.goto();

        await expect(gallery.root).toBeVisible();
    });

    test('default Actions tab does not create document-level vertical overflow', async ({
        mainWindow,
    }) => {
        const gallery = new ComponentGalleryPage(mainWindow);
        await gallery.goto();
        await expect(gallery.root).toBeVisible();

        const metrics = await mainWindow.evaluate((): BrowserPageOverflowMetrics => {
            const browser = globalThis as unknown as BrowserPageOverflowGlobalAccess;

            return {
                bodyClientHeight: browser.document.body.clientHeight,
                bodyScrollHeight: browser.document.body.scrollHeight,
                documentClientHeight: browser.document.documentElement.clientHeight,
                documentScrollHeight: browser.document.documentElement.scrollHeight,
            };
        });

        expect(metrics.documentScrollHeight).toBeLessThanOrEqual(metrics.documentClientHeight);
        expect(metrics.bodyScrollHeight).toBeLessThanOrEqual(metrics.bodyClientHeight);
    });

    test('all six category tabs are present and can be switched', async ({ mainWindow }) => {
        const gallery = new ComponentGalleryPage(mainWindow);
        await gallery.goto();
        await expect(gallery.root).toBeVisible();

        // Each click selects the corresponding tab and makes its panel visible.
        const tabs = [
            { click: () => gallery.clickTabActions(), name: /actions/i },
            { click: () => gallery.clickTabOverlays(), name: /overlays/i },
            { click: () => gallery.clickTabContainers(), name: /containers/i },
            { click: () => gallery.clickTabForms(), name: /forms/i },
            { click: () => gallery.clickTabFeedback(), name: /feedback/i },
            { click: () => gallery.clickTabTypography(), name: /typography/i },
        ];

        for (const { click, name } of tabs) {
            await click();
            const tab = mainWindow.getByRole('tab', { name });
            await expect(tab).toHaveAttribute('aria-selected', 'true');
        }
    });

    test('Modal opens and closes', async ({ mainWindow }) => {
        const gallery = new ComponentGalleryPage(mainWindow);
        await gallery.goto();
        await expect(gallery.root).toBeVisible();

        await gallery.openModal();
        await expect(gallery.modalDialog).toBeVisible();

        // Close via the accessible close button inside the dialog
        const closeBtn = gallery.modalDialog.getByRole('button', { name: /close/i });
        await closeBtn.click();
        await expect(gallery.modalDialog).not.toBeVisible();
    });

    test('Overlays tab Tooltip is lifted to <body> so the scrolling panel cannot clip it', async ({
        mainWindow,
    }) => {
        const gallery = new ComponentGalleryPage(mainWindow);
        await gallery.goto();
        await expect(gallery.root).toBeVisible();

        await gallery.showTooltip();

        await expect(gallery.tooltip).toBeVisible();
        await expect(gallery.tooltip).toHaveText(/tooltip example/i);

        // The bubble is portaled to <body>, escaping the tab panel's
        // overflow:auto — a z-index alone cannot climb out of that clip.
        const parentIsBody = await gallery.tooltip.evaluate((element) => {
            const el = element as unknown as BrowserPortaledElement;
            return el.parentElement === el.ownerDocument.body;
        });
        expect(parentIsBody).toBe(true);
    });

    test('Drawer opens and closes', async ({ mainWindow }) => {
        const gallery = new ComponentGalleryPage(mainWindow);
        await gallery.goto();
        await expect(gallery.root).toBeVisible();

        await gallery.openDrawer();
        await expect(gallery.drawerDialog).toBeVisible();

        const closeBtn = gallery.drawerDialog.getByRole('button', { name: /close/i });
        await closeBtn.click();
        await expect(gallery.drawerDialog).not.toBeVisible();
    });

    test('Slider, Toggle, TextInput, Select, and NumberInput can be updated in the Forms tab', async ({
        mainWindow,
    }) => {
        const gallery = new ComponentGalleryPage(mainWindow);
        await gallery.goto();
        await expect(gallery.root).toBeVisible();
        await gallery.clickTabForms();

        // Slider
        await gallery.slider.fill('80');
        await gallery.slider.dispatchEvent('input');
        await gallery.slider.dispatchEvent('change');
        await expect(gallery.slider).toHaveValue('80');

        // Toggle
        const toggleCheckedBefore = await gallery.toggle.isChecked();
        await gallery.toggle.click();
        const toggleCheckedAfter = await gallery.toggle.isChecked();
        expect(toggleCheckedAfter).toBe(!toggleCheckedBefore);

        // TextInput
        await gallery.textInput.fill('Grace Hopper');
        await gallery.textInput.dispatchEvent('input');
        await expect(gallery.textInput).toHaveValue('Grace Hopper');

        // Select
        await gallery.select.selectOption('light');
        await expect(gallery.select).toHaveValue('light');

        // NumberInput
        await gallery.numberInput.fill('7');
        await gallery.numberInput.dispatchEvent('change');
        await expect(gallery.numberInput).toHaveValue('7');
    });

    test('Escape traverses back to the main menu, preserving gameId', async ({ mainWindow }) => {
        const mainMenu = new MainMenuPage(mainWindow);
        await mainMenu.goto({ gameId: 'tactics' });
        await expect(mainMenu.componentGalleryButton).toBeVisible();
        await mainMenu.openComponentGallery();

        const gallery = new ComponentGalleryPage(mainWindow);
        await expect(gallery.root).toBeVisible();
        await expect(mainWindow).toHaveURL(/\/component-gallery\/?\?gameId=tactics$/);

        await mainWindow.keyboard.press('Escape');

        await expect(mainWindow).toHaveURL(/\/main-menu\/?\?gameId=tactics$/);
        await expect(mainMenu.menu).toBeVisible();
    });

    test('Escape closes an open overlay before exiting the gallery', async ({ mainWindow }) => {
        const gallery = new ComponentGalleryPage(mainWindow);
        await gallery.goto();
        await expect(gallery.root).toBeVisible();

        await gallery.openModal();
        await expect(gallery.modalDialog).toBeVisible();

        // First Escape is consumed by the open Modal (EscapeStack top layer).
        await mainWindow.keyboard.press('Escape');
        await expect(gallery.modalDialog).not.toBeVisible();
        await expect(gallery.root).toBeVisible();

        // Second Escape exits the gallery to the main menu.
        await mainWindow.keyboard.press('Escape');
        await expect(mainWindow).toHaveURL(/\/main-menu\/?$/);
        await expect(mainWindow.getByTestId('main-menu')).toBeVisible();
    });

    test('primary Button background matches --ch-color-accent token', async ({ mainWindow }) => {
        const gallery = new ComponentGalleryPage(mainWindow);
        await gallery.goto();
        await expect(gallery.root).toBeVisible();

        // Ensure Actions tab is active (default)
        await gallery.clickTabActions();
        await expect(gallery.primaryButton).toBeVisible();
        await expect(gallery.primaryButton).toHaveAttribute('data-ch-button-variant', 'primary');

        await expectButtonBackgroundToMatchToken(gallery.primaryButton, '--ch-color-accent');
    });

    test('keyboard-focused tab shows the accent focus border with no clipped halo', async ({
        mainWindow,
    }) => {
        const gallery = new ComponentGalleryPage(mainWindow);
        await gallery.goto();
        await expect(gallery.root).toBeVisible();

        // Occluded Playwright windows never advance CSS transition clocks, so
        // the 120ms border-color transition would stay frozen at its resting
        // value. Reduced motion collapses the app's durations to 0ms, which
        // both stabilises the assertion and exercises that support.
        await mainWindow.emulateMedia({ reducedMotion: 'reduce' });

        // Pointer-select a neighbouring tab, then move by keyboard so the
        // roving-tabindex focus carries :focus-visible (keyboard modality).
        await gallery.clickTabOverlays();
        await mainWindow.keyboard.press('ArrowLeft');

        const actionsTab = mainWindow.getByRole('tab', { name: /actions/i });
        await expect(actionsTab).toBeFocused();
        await expect(actionsTab).toHaveAttribute('aria-selected', 'true');

        const styles = await actionsTab.evaluate((element) => {
            const browserElement = element as unknown as BrowserElementWithDocument;
            const ownerDocument = browserElement.ownerDocument;
            const view = ownerDocument.defaultView;
            if (!view) throw new Error('Tab document does not have a defaultView');

            const tokenValue = view
                .getComputedStyle(ownerDocument.documentElement)
                .getPropertyValue('--ch-focus-ring-color')
                .trim();
            const probe = ownerDocument.createElement('div');
            probe.style.backgroundColor = tokenValue;
            ownerDocument.body.appendChild(probe);
            const expectedBorderColor = view.getComputedStyle(probe).backgroundColor;
            probe.remove();

            const computed = view.getComputedStyle(element);
            return {
                actualBorderColor: computed.getPropertyValue('border-top-color'),
                expectedBorderColor,
                outlineColor: computed.getPropertyValue('outline-color'),
                outlineOffset: computed.getPropertyValue('outline-offset'),
            };
        });

        // The focus indicator is the tab's own accent border; the outline is a
        // transparent inset ring, so nothing paints outside the tab for the
        // tablist scroll container to clip into a stray sliver.
        expect(styles.actualBorderColor).toBe(styles.expectedBorderColor);
        expect(styles.outlineColor).toBe('rgba(0, 0, 0, 0)');
        expect(styles.outlineOffset).toBe('-2px');
    });
});
