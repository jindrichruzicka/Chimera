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

    /**
     * The clip toggle — the route's only control, and the only way anything here
     * asks for a clip CHANGE. It carries the clip the screen currently declares,
     * which is what separates "the transition never started" from "the
     * transition started and did not blend": a bone rotation says neither.
     */
    readonly clipToggle: Locator;

    public constructor(private readonly page: Page) {
        this.root = page.getByTestId('tactics-model-showcase');
        this.status = page.getByTestId('tactics-model-showcase-status');
        this.clipStatus = page.getByTestId('tactics-model-showcase-clip-status');
        this.canvas = this.root.locator('canvas').first();
        this.clipToggle = page.getByTestId('tactics-model-showcase-clip-toggle');
    }

    /** The current value of one clip-status data attribute, or `null` if unwritten. */
    public async clipAttribute(name: string): Promise<string | null> {
        return this.clipStatus.getAttribute(`data-${name}`);
    }

    /**
     * The played instance's animated bone rotation, in radians, or `NaN` while
     * there is no rotation to read.
     *
     * TWO states mean that, and both are load-bearing: the attribute is ABSENT
     * until the first frame writes anything, and it is written EMPTY on every
     * frame before the model has loaded or if the animated bone cannot be found
     * by name. `Number` answers 0 for both of those, and 0 is a rotation the rig
     * really poses — so a caller reading the raw number could not tell a bone at
     * rest from a model that never arrived.
     */
    public async playedBoneRotation(): Promise<number> {
        const raw = await this.clipAttribute('clip-played-bone-z');
        return raw === null || raw === '' ? Number.NaN : Number(raw);
    }

    /**
     * Every played-bone rotation the screen RECORDED since the clip it is
     * playing was asked for, in the order the frames took them.
     *
     * Not a series of reads from out here: the screen appends from inside its
     * own render loop, so a rotation the bone passed through between two reads a
     * caller could make is still in this list. That is the whole difference for
     * a TRANSIENT — a blend lasts about a second and a caller sampling from
     * outside sees only the instants it happened to ask on.
     *
     * Empty until the first frame contributes a rotation. What a frame
     * contributes is `TacticsAnimatedShowcase`'s `recordSample`, which skips a
     * repeat of the entry before it and stops at a cap — so this is the series
     * of rotations VISITED, and its length is not a frame count.
     */
    public async playedBoneRecording(): Promise<readonly number[]> {
        return (await this.recordedSamples('clip-played-bone-z-recording')).map(Number);
    }

    /**
     * The same recording for the CONTROL instance, left as the strings the
     * screen published.
     *
     * The at-rest claim its callers make is `'0.0000'`.
     */
    public async controlBoneRecording(): Promise<readonly string[]> {
        return this.recordedSamples('clip-control-bone-z-recording');
    }

    /**
     * The clip the two recordings above are scoped to.
     *
     * `null` before the first frame writes the attribute at all, and `''` once
     * a frame has written it for a screen declaring no clip.
     */
    public async recordedClip(): Promise<string | null> {
        return this.clipAttribute('clip-recording-clip');
    }

    /** One recording attribute, split into its samples. */
    private async recordedSamples(name: string): Promise<readonly string[]> {
        const raw = await this.clipAttribute(name);
        return raw === null || raw === '' ? [] : raw.split(',');
    }

    /** Ask the screen for the other clip. */
    public async toggleClip(): Promise<void> {
        await this.clipToggle.click();
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
