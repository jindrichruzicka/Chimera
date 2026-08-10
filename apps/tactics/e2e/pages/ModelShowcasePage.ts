import { type Locator, type Page } from '@playwright/test';
import {
    CHIMERA_RENDERER_HOST,
    CHIMERA_RENDERER_PROTOCOL,
} from '../../../../electron/main/renderer-url';
import { minimumColorPixels, waitForCanvasPixelExpectation } from '../helpers/canvas-probe';

const MODEL_SHOWCASE_URL = `${CHIMERA_RENDERER_PROTOCOL}://${CHIMERA_RENDERER_HOST}/model-showcase/`;

/**
 * Page Object for the tactics model-showcase route (§4.10).
 *
 * A test-only screen no in-app navigation reaches, so this object's `goto()`
 * is the only way in (why it is isolated: `TacticsModelShowcaseScreen`). It
 * needs no match, no lobby and no `GameShell` — the route opens its own game
 * asset session, so a single Electron window on this URL is the whole fixture.
 */
export class ModelShowcasePage {
    /** Screen root (`data-testid="tactics-model-showcase"`). */
    readonly root: Locator;

    /**
     * The showcase status element. Carries what pixels cannot show: whether
     * both instances settled, their error name, whether their scene-graph
     * roots are distinct, and each instance's posed bone rotation.
     */
    readonly status: Locator;

    /**
     * The clip-player status element. Written IMPERATIVELY from the frame loop
     * (§6.3 forbids `setState` there), so its attributes are ABSENT until the
     * first frame writes them — their absence is itself the "nothing is running"
     * signal.
     *
     * That is why {@link clipAttribute} answers `null` rather than throwing, and
     * why a caller must poll it rather than reach for `.not.toHaveAttribute`:
     * Playwright treats a MISSING attribute as a non-match, which under `.not`
     * resolves immediately and waits for nothing.
     */
    readonly clipStatus: Locator;

    /** The R3F `<canvas>` the showcase renders into. */
    readonly canvas: Locator;

    public constructor(private readonly page: Page) {
        this.root = page.getByTestId('tactics-model-showcase');
        this.status = page.getByTestId('tactics-model-showcase-status');
        this.clipStatus = page.getByTestId('tactics-model-showcase-clip-status');
        this.canvas = this.root.locator('canvas').first();
    }

    /** The current value of one clip-status data attribute, or `null` if unwritten. */
    public async clipAttribute(name: string): Promise<string | null> {
        return this.clipStatus.getAttribute(`data-${name}`);
    }

    public async goto(): Promise<void> {
        await this.page.goto(MODEL_SHOWCASE_URL);
    }

    /**
     * The showcase quads are the only geometry in this scene, so any magenta
     * at all proves the clones rasterized — the model decoded, the protocol
     * served real bytes, and the unlit magenta material is on screen.
     */
    public async assertCanvasHasMagentaPrimitive(): Promise<void> {
        await waitForCanvasPixelExpectation({
            page: this.page,
            canvas: this.canvas,
            predicate: (stats) => stats.magentaPixels >= minimumColorPixels(stats),
            failureMessage:
                'Model showcase canvas did not render the expected magenta showcase-model pixels',
        });
    }
}
