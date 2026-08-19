/**
 * e2e/helpers/reveal-timeline.ts
 *
 * An in-page recorder for the surfaces the asset gates drive: the app-level
 * scrim, the shell it hides, the in-game transition overlay with its preload
 * fraction, and the scene preload cover.
 *
 * WHY A RECORDER RATHER THAN A POLL. Both gates exist to be RELEASED, so what
 * proves one is a state that has already ended by the time a spec could look —
 * the route-entry gate is released before `game.fixture` hands the spec
 * control at all. And the states differ from their absence by DURATION: a build
 * with no gate still paints one frame with the shell mounted under an opaque
 * scrim, because the fade-in runs in a passive effect after that commit. An
 * out-of-process `expect.poll` can neither see the past nor resolve a frame, so
 * the timeline is recorded from inside the page and the specs assert on how
 * long a state lasted.
 *
 * Reads INLINE style, never `getComputedStyle`: `ScreenFadeOverlay` writes the
 * scrim's opacity as an inline style and no CSS transition animates it, so the
 * inline value is the exact commanded one — and a computed read would force a
 * style recalc on every mutation batch, inside the very timing being measured.
 *
 * Architecture: §13.7 — IPC and WebSocket Test Helpers
 *
 * Module boundary: `@playwright/test` types only. The recorder below is shipped
 * into the renderer as SOURCE TEXT by Playwright, so it must close over nothing
 * — every selector it uses is written inline, and the browser globals it needs
 * are reached through structural interfaces (this program carries no DOM lib).
 */

import type { Page } from '@playwright/test';

/** One state of the recorded surfaces, stamped when the state began. */
export interface RevealSample {
    /** `performance.now()` in the page when this state began. */
    readonly at: number;
    /** Is `GameShell`'s canvas section mounted? */
    readonly canvasMounted: boolean;
    /** Is the route-entry loading cover — the §4.10 gate's own cover — up? */
    readonly routeCoverMounted: boolean;
    /** The app-level scrim's inline opacity, or null when the overlay is absent. */
    readonly screenFadeOpacity: string | null;
    /** Is the in-game transition overlay mounted (i.e. a transition is in flight)? */
    readonly transitionOverlayMounted: boolean;
    /**
     * The transition overlay's `data-preload-progress`. Null covers BOTH an
     * absent overlay and an overlay without the attribute — the callers that
     * care about the difference read `transitionOverlayMounted` alongside it.
     */
    readonly preloadProgress: string | null;
    /** Text of the scene preload cover, or null when no cover is up. */
    readonly preloadCoverText: string | null;
    /** The scene router's committed scene id. */
    readonly activeSceneId: string | null;
    /**
     * Is the match HUD row mounted?
     *
     * The loading beat withholds it until the reveal, so this is what separates
     * "the shell is up" from "the player is looking at the match" — and it is
     * decided in RENDER, which is what keeps it readable once every beat
     * duration collapses to zero under the e2e flag.
     */
    readonly hudMounted: boolean;
    /** The beat's phase, as the shell publishes it, or null before it mounts. */
    readonly revealPhase: string | null;
}

/** Every recorded state, plus the moment the timeline was read out. */
export interface RevealTimeline {
    readonly samples: readonly RevealSample[];
    /** `performance.now()` at read time — the end of the FINAL state. */
    readonly readAt: number;
}

interface RevealTimelineStore {
    readonly samples: RevealSample[];
}

interface RevealTimelineHost {
    __chimeraRevealTimeline?: RevealTimelineStore;
}

interface BrowserElementAccess {
    getAttribute(name: string): string | null;
    readonly style: { readonly opacity: string };
    readonly textContent: string | null;
}

interface BrowserObserverAccess {
    observe(target: unknown, options: Readonly<Record<string, unknown>>): void;
}

interface BrowserGlobalAccess {
    readonly document: {
        readonly documentElement: unknown;
        querySelector(selector: string): BrowserElementAccess | null;
    };
    readonly performance: { now(): number };
    readonly MutationObserver: new (callback: () => void) => BrowserObserverAccess;
}

/**
 * Installed into the page. Self-contained by necessity — Playwright ships this
 * function's source, so a reference to anything in this module would be
 * undefined at the far end.
 *
 * Idempotent: a second install must not restart the timeline, which would
 * silently discard everything a spec had already recorded.
 */
function recordRevealTimeline(): void {
    const browser = globalThis as unknown as BrowserGlobalAccess & RevealTimelineHost;
    if (browser.__chimeraRevealTimeline !== undefined) {
        return;
    }
    const store: RevealTimelineStore = { samples: [] };
    browser.__chimeraRevealTimeline = store;

    const read = (): RevealSample => {
        const scrim = browser.document.querySelector('[data-testid="screen-fade-overlay"]');
        const overlay = browser.document.querySelector('[data-testid="transition-overlay"]');
        const cover = browser.document.querySelector('[data-testid="scene-preload-cover"]');
        const router = browser.document.querySelector('[data-testid="scene-router"]');
        const shell = browser.document.querySelector('[data-testid="game-shell-root"]');
        return {
            at: browser.performance.now(),
            hudMounted: browser.document.querySelector('[data-testid="game-hud-slot"]') !== null,
            revealPhase: shell === null ? null : shell.getAttribute('data-reveal-phase'),
            canvasMounted: browser.document.querySelector('[data-testid="game-canvas"]') !== null,
            routeCoverMounted:
                browser.document.querySelector('[data-testid="route-entry-loading-cover"]') !==
                null,
            screenFadeOpacity: scrim === null ? null : scrim.style.opacity,
            transitionOverlayMounted: overlay !== null,
            preloadProgress:
                overlay === null ? null : overlay.getAttribute('data-preload-progress'),
            preloadCoverText: cover === null ? null : cover.textContent,
            activeSceneId: router === null ? null : router.getAttribute('data-active-scene-id'),
        };
    };

    // Everything but `at` — an in-match DOM mutates continuously (HUD text, r3f
    // sizing), and one sample per batch would bury the handful of transitions
    // that matter and report each held state as thousands of zero-length ones.
    const sameState = (left: RevealSample, right: RevealSample): boolean =>
        left.canvasMounted === right.canvasMounted &&
        left.routeCoverMounted === right.routeCoverMounted &&
        left.screenFadeOpacity === right.screenFadeOpacity &&
        left.transitionOverlayMounted === right.transitionOverlayMounted &&
        left.preloadProgress === right.preloadProgress &&
        left.preloadCoverText === right.preloadCoverText &&
        left.activeSceneId === right.activeSceneId &&
        // A field left out here does not merely go unrecorded — it silently
        // merges two distinct states into one, so the transition it marks
        // disappears from the timeline rather than showing up wrong.
        left.hudMounted === right.hudMounted &&
        left.revealPhase === right.revealPhase;

    const sample = (): void => {
        const next = read();
        const last = store.samples[store.samples.length - 1];
        if (last !== undefined && sameState(last, next)) {
            return;
        }
        store.samples.push(next);
    };

    sample();
    new browser.MutationObserver(sample).observe(browser.document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        // The scrim's opacity rides `style`; the other two are read by name. A
        // cover's text arrives with the cover itself, so `childList` carries it.
        attributeFilter: [
            'style',
            'data-preload-progress',
            'data-active-scene-id',
            'data-reveal-phase',
        ],
    });
}

/**
 * Arm the recorder in `page`'s CURRENT document.
 *
 * That is the whole instrumentation, because every hop these specs record is a
 * client-side route push: `asset-preload-gate.spec.ts` arms the recorder on
 * `/lobby` and reads samples spanning the hop to `/game` out of the same store.
 * A route that reloaded instead would drop the recorder, and nothing here would
 * say so — so no spec may assume one is armed across a navigation it did not
 * check.
 */
export async function installRevealTimeline(page: Page): Promise<void> {
    await page.evaluate(recordRevealTimeline);
}

/** Read the recorded states out of `page`, stamping the end of the final one. */
export async function readRevealTimeline(page: Page): Promise<RevealTimeline> {
    return page.evaluate(() => {
        const browser = globalThis as unknown as BrowserGlobalAccess & RevealTimelineHost;
        const store = browser.__chimeraRevealTimeline;
        if (store === undefined) {
            throw new Error(
                'The reveal timeline recorder was not installed in this page — ' +
                    'installRevealTimeline() must run before the state being measured.',
            );
        }
        return { samples: store.samples.slice(), readAt: browser.performance.now() };
    });
}

/**
 * How long, in ms, the page spent in states matching `predicate`.
 *
 * A state runs until the NEXT recorded state begins, and the final one runs to
 * the read — which is why {@link readRevealTimeline} stamps it. Summed rather
 * than maximised: a gate re-armed mid-run holds the reveal twice, and both
 * halves are the wait.
 */
export function durationWhere(
    timeline: RevealTimeline,
    predicate: (sample: RevealSample) => boolean,
): number {
    return timeline.samples.reduce((total, entry, index) => {
        if (!predicate(entry)) {
            return total;
        }
        const next = timeline.samples[index + 1];
        return total + (next === undefined ? timeline.readAt : next.at) - entry.at;
    }, 0);
}
