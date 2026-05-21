import type { Locator, Page } from '@playwright/test';
import { CHIMERA_RENDERER_HOST, CHIMERA_RENDERER_PROTOCOL } from '../../electron/main/renderer-url';

const COMPONENT_GALLERY_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/component-gallery/`;

/**
 * Page Object for the dev/test-only component gallery route.
 *
 * Architecture: §4.35 — UI Design System; §4.37 — Shell Pages UI Contract;
 * §13.6 — E2E page object conventions.
 *
 * Invariant #93: does NOT import game token override CSS.
 * Invariant #94: does NOT import from games/* paths.
 * Invariant #86: token assertions use public DOM/style contracts only
 *               (see component-gallery.spec.ts for --ch-* checks).
 */
export class ComponentGalleryPage {
    /** Gallery root container (`data-testid="component-gallery"`). */
    readonly root: Locator;

    /** Trigger button that opens the Modal overlay. */
    readonly modalTrigger: Locator;

    /**
     * The Modal dialog itself. Resolved by `role="dialog"` with the gallery
     * modal name — stable across UI refactors.
     */
    readonly modalDialog: Locator;

    /** Trigger button that opens the Drawer overlay. */
    readonly drawerTrigger: Locator;

    /** The Drawer dialog element (`data-testid="gallery-drawer"`). */
    readonly drawerDialog: Locator;

    /** Primary variant Button in the Actions panel (themed token assertion anchor). */
    readonly primaryButton: Locator;

    // ── Forms controls ─────────────────────────────────────────────────────────

    /** Volume range slider inside the Forms tab panel. */
    readonly slider: Locator;

    /**
     * "Enable feature" toggle (role="switch") inside the Forms tab panel.
     * Bound after the Forms tab is visible.
     */
    readonly toggle: Locator;

    /**
     * Colour-scheme `<select>` (role="combobox") inside the Forms panel.
     * Targets the *valid* combobox (excludes the invalid example).
     */
    readonly select: Locator;

    /**
     * Quantity `<input type="number">` (role="spinbutton") inside the Forms panel.
     * Targets the *valid* input (excludes the invalid example).
     */
    readonly numberInput: Locator;

    // ── Tab buttons ────────────────────────────────────────────────────────────

    private readonly tabActions: Locator;
    private readonly tabOverlays: Locator;
    private readonly tabContainers: Locator;
    private readonly tabForms: Locator;
    private readonly tabFeedback: Locator;
    private readonly tabTypography: Locator;

    public constructor(private readonly page: Page) {
        this.root = page.getByTestId('component-gallery');
        this.modalTrigger = page.getByTestId('gallery-open-modal');
        this.modalDialog = page.getByRole('dialog', { name: /example modal/i });
        this.drawerTrigger = page.getByTestId('gallery-open-drawer');
        this.drawerDialog = page.getByTestId('gallery-drawer');
        this.primaryButton = page.getByTestId('gallery-button-primary');

        this.tabActions = page.getByRole('tab', { name: /actions/i });
        this.tabOverlays = page.getByRole('tab', { name: /overlays/i });
        this.tabContainers = page.getByRole('tab', { name: /containers/i });
        this.tabForms = page.getByRole('tab', { name: /forms/i });
        this.tabFeedback = page.getByRole('tab', { name: /feedback/i });
        this.tabTypography = page.getByRole('tab', { name: /typography/i });

        // Form controls are scoped to the visible tab panel; the panel is only
        // accessible after clickTabForms() has been called by the test.
        const tabPanel = page.getByRole('tabpanel');
        this.slider = tabPanel.getByRole('slider', { name: /volume/i });
        this.toggle = tabPanel.getByRole('switch', { name: /enable feature/i });
        this.select = tabPanel.getByRole('combobox', { name: /^colour scheme$/i });
        this.numberInput = tabPanel.getByRole('spinbutton', { name: /^quantity$/i });
    }

    /** Navigate to the component gallery route. */
    public async goto(): Promise<void> {
        await this.page.goto(COMPONENT_GALLERY_URL);
    }

    // ── Tab helpers ────────────────────────────────────────────────────────────

    public async clickTabActions(): Promise<void> {
        await this.tabActions.click();
    }

    public async clickTabOverlays(): Promise<void> {
        await this.tabOverlays.click();
    }

    public async clickTabContainers(): Promise<void> {
        await this.tabContainers.click();
    }

    public async clickTabForms(): Promise<void> {
        await this.tabForms.click();
    }

    public async clickTabFeedback(): Promise<void> {
        await this.tabFeedback.click();
    }

    public async clickTabTypography(): Promise<void> {
        await this.tabTypography.click();
    }

    // ── Overlay helpers ────────────────────────────────────────────────────────

    /**
     * Switch to the Overlays tab and open the example Modal.
     * The Overlays tab must be active for the trigger to be present.
     */
    public async openModal(): Promise<void> {
        await this.clickTabOverlays();
        await this.modalTrigger.click();
    }

    /**
     * Switch to the Overlays tab and open the example Drawer.
     * The Overlays tab must be active for the trigger to be present.
     */
    public async openDrawer(): Promise<void> {
        await this.clickTabOverlays();
        await this.drawerTrigger.click();
    }
}
