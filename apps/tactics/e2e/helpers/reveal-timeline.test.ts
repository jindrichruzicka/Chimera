// @vitest-environment jsdom
/**
 * e2e/helpers/reveal-timeline.test.ts
 *
 * Unit tests for the in-page reveal recorder. The recorder is the instrument
 * both gate specs measure with, so the two things it can get silently wrong are
 * pinned here rather than inside a 90 s Playwright run: that a change to any
 * recorded surface produces a sample (a missed transition is an unmeasurable
 * gate) and that an unchanged tuple produces NONE (an in-match DOM churns
 * constantly, and an undeduped recorder would report a held gate as thousands
 * of zero-length states).
 *
 * jsdom, because the recorder body is DOM code: it is shipped into the page as
 * source text by Playwright, so running it against a real document is the only
 * way to execute it outside a browser.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 *
 * Tests written FIRST (red confirmed before implementation).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import {
    durationWhere,
    installRevealTimeline,
    readRevealTimeline,
    type RevealSample,
    type RevealTimeline,
} from './reveal-timeline';

// ---------------------------------------------------------------------------
// Doubles
// ---------------------------------------------------------------------------

/**
 * A Page whose `evaluate` runs the callback in THIS process, against jsdom's
 * document — the same thing Playwright does after shipping the function's
 * source into the renderer.
 */
function makePage(): Page {
    return {
        evaluate: vi.fn(async (fn: () => unknown) => fn()),
        // @chimera-review: partial mock of Page (Playwright external class) — only evaluate() is exercised
    } as unknown as Page;
}

/**
 * The DOM this file drives, reached structurally rather than through the `dom`
 * lib: `apps/tactics/e2e/**` is deliberately excluded from the app's DOM/react
 * program and type-checked by the root flat `tsc --noEmit`, which carries no
 * DOM lib. Same shape the specs use for their in-page reads.
 */
interface TestElement {
    setAttribute(name: string, value: string): void;
    append(child: TestElement): void;
    readonly style: { opacity: string };
    textContent: string | null;
}

interface TestDocument {
    createElement(tag: string): TestElement;
    readonly body: TestElement & { innerHTML: string };
}

const dom = globalThis as unknown as { readonly document: TestDocument };

/** One task turn, so jsdom delivers the queued MutationObserver records. */
async function settleObserver(): Promise<void> {
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

function mountTestId(testId: string): TestElement {
    const element = dom.document.createElement('div');
    element.setAttribute('data-testid', testId);
    dom.document.body.append(element);
    return element;
}

afterEach(() => {
    dom.document.body.innerHTML = '';
    delete (globalThis as { __chimeraRevealTimeline?: unknown }).__chimeraRevealTimeline;
});

// ---------------------------------------------------------------------------
// The recorder
// ---------------------------------------------------------------------------

describe('installRevealTimeline', () => {
    it('takes a first sample of the surfaces as they already are', async () => {
        const scrim = mountTestId('screen-fade-overlay');
        scrim.style.opacity = '1';

        const page = makePage();
        await installRevealTimeline(page);

        const timeline = await readRevealTimeline(page);
        expect(timeline.samples).toHaveLength(1);
        expect(timeline.samples[0]?.screenFadeOpacity).toBe('1');
        expect(timeline.samples[0]?.canvasMounted).toBe(false);
    });

    it('samples the shell mount and the scrim release as two separate states', async () => {
        const scrim = mountTestId('screen-fade-overlay');
        scrim.style.opacity = '1';

        const page = makePage();
        await installRevealTimeline(page);

        mountTestId('game-canvas');
        await settleObserver();
        scrim.style.opacity = '0';
        await settleObserver();

        const timeline = await readRevealTimeline(page);
        expect(
            timeline.samples.map((sample) => [sample.canvasMounted, sample.screenFadeOpacity]),
        ).toEqual([
            [false, '1'],
            [true, '1'],
            [true, '0'],
        ]);
    });

    it('appends exactly one sample per recorded surface, changed one at a time', async () => {
        // A dropped comparison or a frozen read is invisible to any case that
        // moves more than one surface at a time. Every step below moves EXACTLY
        // one, and the sample count is the kill.
        const scrim = mountTestId('screen-fade-overlay');
        scrim.style.opacity = '1';
        const router = mountTestId('scene-router');
        router.setAttribute('data-active-scene-id', 'engine:game');

        const page = makePage();
        await installRevealTimeline(page);

        mountTestId('game-canvas');
        await settleObserver();
        mountTestId('route-entry-loading-cover');
        await settleObserver();
        scrim.style.opacity = '0';
        await settleObserver();
        const overlay = mountTestId('transition-overlay');
        await settleObserver();
        overlay.setAttribute('data-preload-progress', '0.5');
        await settleObserver();
        mountTestId('scene-preload-cover');
        await settleObserver();
        router.setAttribute('data-active-scene-id', 'tactics:asset-demo');
        await settleObserver();

        // The install sample plus one per step.
        const timeline = await readRevealTimeline(page);
        expect(timeline.samples).toHaveLength(8);
    });

    it('records no sample for DOM churn that leaves every recorded surface unchanged', async () => {
        mountTestId('screen-fade-overlay');

        const page = makePage();
        await installRevealTimeline(page);

        for (let mutation = 0; mutation < 5; mutation += 1) {
            mountTestId(`hud-widget-${String(mutation)}`);
        }
        await settleObserver();

        const timeline = await readRevealTimeline(page);
        expect(timeline.samples).toHaveLength(1);
    });

    it('records the route-entry cover the reveal gate raises', async () => {
        const page = makePage();
        await installRevealTimeline(page);

        mountTestId('route-entry-loading-cover');
        await settleObserver();

        const timeline = await readRevealTimeline(page);
        expect(timeline.samples.map((entry) => entry.routeCoverMounted)).toEqual([false, true]);
    });

    it('records the transition overlay, its preload fraction and the entering cover', async () => {
        const page = makePage();
        await installRevealTimeline(page);

        const overlay = mountTestId('transition-overlay');
        overlay.setAttribute('data-preload-progress', '0.25');
        const cover = mountTestId('scene-preload-cover');
        cover.textContent = 'Loading scene assets…';
        const router = mountTestId('scene-router');
        router.setAttribute('data-active-scene-id', 'engine:game');
        await settleObserver();

        const timeline = await readRevealTimeline(page);
        const last = timeline.samples[timeline.samples.length - 1];
        expect(last?.transitionOverlayMounted).toBe(true);
        expect(last?.preloadProgress).toBe('0.25');
        expect(last?.preloadCoverText).toBe('Loading scene assets…');
        expect(last?.activeSceneId).toBe('engine:game');
    });

    it('reports an absent data-preload-progress as null while the overlay is up', async () => {
        const page = makePage();
        await installRevealTimeline(page);

        mountTestId('transition-overlay');
        await settleObserver();

        const timeline = await readRevealTimeline(page);
        const last = timeline.samples[timeline.samples.length - 1];
        expect(last?.transitionOverlayMounted).toBe(true);
        expect(last?.preloadProgress).toBeNull();
    });

    it('installs once, so a second call cannot restart the timeline mid-run', async () => {
        const scrim = mountTestId('screen-fade-overlay');
        scrim.style.opacity = '1';

        const page = makePage();
        await installRevealTimeline(page);
        mountTestId('game-canvas');
        await settleObserver();
        await installRevealTimeline(page);

        const timeline = await readRevealTimeline(page);
        expect(timeline.samples).toHaveLength(2);
    });
});

describe('readRevealTimeline', () => {
    it('throws when no recorder was installed in the page', async () => {
        await expect(readRevealTimeline(makePage())).rejects.toThrow(
            'reveal timeline recorder was not installed',
        );
    });

    it('stamps the read so the final state has a duration', async () => {
        const page = makePage();
        await installRevealTimeline(page);

        const timeline = await readRevealTimeline(page);
        expect(timeline.readAt).toBeGreaterThanOrEqual(timeline.samples[0]?.at ?? 0);
    });
});

// ---------------------------------------------------------------------------
// durationWhere
// ---------------------------------------------------------------------------

function sample(at: number, overrides: Partial<RevealSample> = {}): RevealSample {
    return {
        at,
        canvasMounted: false,
        routeCoverMounted: false,
        screenFadeOpacity: null,
        transitionOverlayMounted: false,
        preloadProgress: null,
        preloadCoverText: null,
        activeSceneId: null,
        ...overrides,
    };
}

describe('durationWhere', () => {
    it('measures a matching state up to the next sample', () => {
        const timeline: RevealTimeline = {
            samples: [
                sample(0, { canvasMounted: false }),
                sample(100, { canvasMounted: true }),
                sample(450, { canvasMounted: false }),
            ],
            readAt: 900,
        };

        expect(durationWhere(timeline, (entry) => entry.canvasMounted)).toBe(350);
    });

    it('runs the final state to the read, not to itself', () => {
        const timeline: RevealTimeline = {
            samples: [sample(0), sample(200, { canvasMounted: true })],
            readAt: 700,
        };

        expect(durationWhere(timeline, (entry) => entry.canvasMounted)).toBe(500);
    });

    it('sums every matching state, not just the longest', () => {
        const timeline: RevealTimeline = {
            samples: [
                sample(0, { canvasMounted: true }),
                sample(10, { canvasMounted: false }),
                sample(30, { canvasMounted: true }),
                sample(70, { canvasMounted: false }),
            ],
            readAt: 100,
        };

        expect(durationWhere(timeline, (entry) => entry.canvasMounted)).toBe(50);
    });

    it('is zero when nothing matches', () => {
        const timeline: RevealTimeline = {
            samples: [sample(0), sample(10)],
            readAt: 100,
        };

        expect(durationWhere(timeline, (entry) => entry.canvasMounted)).toBe(0);
    });
});
