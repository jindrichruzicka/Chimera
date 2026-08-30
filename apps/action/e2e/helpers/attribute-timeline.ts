/**
 * apps/action/e2e/helpers/attribute-timeline.ts
 *
 * Records every value a set of attributes takes, from inside the page.
 *
 * WHY A RECORDER RATHER THAN A POLL. The background's camera phases are
 * published by the rig's frame loop, and the background is UNMOUNTED the moment
 * the match surface lands — so the whole window in which a dolly-in is visible
 * is bounded by an IPC round trip the runner cannot synchronise with. An
 * out-of-process poll samples whatever is there when it happens to look, and a
 * phase that was published and replaced between two samples reads exactly like
 * a phase that was never published at all.
 *
 * A `MutationObserver` over the document subtree sees every write, including
 * the ones on an element that is later removed, so what a spec asserts is the
 * SEQUENCE the app actually produced.
 *
 * Module boundary: `@playwright/test` types only. The recorder is shipped into
 * the renderer as SOURCE TEXT, so it closes over nothing and reaches every
 * global through a structural interface (this program carries no DOM lib).
 */

import type { Page } from '@playwright/test';

/** One recorded write: which attribute, and what it became. */
export interface AttributeSample {
    readonly attribute: string;
    readonly value: string;
}

interface AttributeTimelineStore {
    readonly samples: AttributeSample[];
    /**
     * The live observer, parked on the store.
     *
     * A `MutationObserver` whose only strong reference was the local binding in
     * the installer can be collected between the install and the change being
     * measured, and what that looks like from out here is a timeline holding
     * nothing but its seeds — indistinguishable from an app that never wrote
     * the attribute. Holding it here is what makes the recording survive a GC.
     */
    observer?: unknown;
}

interface AttributeTimelineHost {
    __chimeraAttributeTimeline?: AttributeTimelineStore;
}

interface ObservedElement {
    getAttribute(name: string): string | null;
    matches(selector: string): boolean;
    querySelectorAll(selector: string): Iterable<ObservedElement>;
}

interface ObservedMutation {
    readonly attributeName: string | null;
    readonly target: ObservedElement;
}

interface ObserverGlobalAccess {
    readonly document: {
        readonly documentElement: ObservedElement;
        querySelectorAll(selector: string): Iterable<ObservedElement>;
    };
    MutationObserver: new (callback: (mutations: ObservedMutation[]) => void) => {
        observe(
            target: ObservedElement,
            options: {
                attributes: boolean;
                attributeFilter: string[];
                subtree: boolean;
            },
        ): void;
    };
}

/**
 * Arm the recorder for `selector`'s attributes in the page's CURRENT document.
 *
 * Idempotent: a second install would double every later sample, so the first
 * one wins and the caller's `attributes` are ignored — which is why a spec arms
 * once, before the navigation it measures.
 *
 * The CURRENT value of each matching element is seeded first, so a phase that
 * was already published when the recorder was armed is in the timeline rather
 * than only the changes after it.
 */
export async function installAttributeTimeline(
    page: Page,
    selector: string,
    attributes: readonly string[],
): Promise<void> {
    await page.evaluate(
        ({ watchedSelector, watchedAttributes }) => {
            const browser = globalThis as unknown as ObserverGlobalAccess & AttributeTimelineHost;
            if (browser.__chimeraAttributeTimeline !== undefined) {
                return;
            }
            const store: AttributeTimelineStore = { samples: [] };
            browser.__chimeraAttributeTimeline = store;

            // Last value seen PER ATTRIBUTE. Per attribute rather than "the last
            // sample overall", because the attributes interleave: two axes
            // publishing `a, b, a` would leave the repeat of `a` in the stream if
            // the comparison were against whatever landed most recently.
            const seen: Record<string, string> = {};
            const push = (element: ObservedElement, attribute: string): void => {
                const value = element.getAttribute(attribute);
                // A repeat is dropped: the seed below can restate a value the
                // observer then reports again for the same element.
                if (value === null || seen[attribute] === value) {
                    return;
                }
                seen[attribute] = value;
                store.samples.push({ attribute, value });
            };

            for (const element of browser.document.querySelectorAll(watchedSelector)) {
                for (const attribute of watchedAttributes) {
                    push(element, attribute);
                }
            }

            const observer = new browser.MutationObserver((mutations) => {
                for (const mutation of mutations) {
                    const attribute = mutation.attributeName;
                    if (attribute === null || !mutation.target.matches(watchedSelector)) {
                        continue;
                    }
                    push(mutation.target, attribute);
                }
            });
            observer.observe(browser.document.documentElement, {
                attributes: true,
                attributeFilter: [...watchedAttributes],
                subtree: true,
            });
            store.observer = observer;
        },
        { watchedSelector: selector, watchedAttributes: [...attributes] },
    );
}

/** Every recorded write, in the order the page made them. */
export async function readAttributeTimeline(page: Page): Promise<readonly AttributeSample[]> {
    return page.evaluate(() => {
        const browser = globalThis as unknown as AttributeTimelineHost;
        const store = browser.__chimeraAttributeTimeline;
        if (store === undefined) {
            throw new Error(
                'The attribute timeline was not installed in this page — ' +
                    'installAttributeTimeline() must run before the change being measured.',
            );
        }
        return store.samples.slice();
    });
}

/** The recorded values of one attribute, in order. */
export function valuesOf(
    timeline: readonly AttributeSample[],
    attribute: string,
): readonly string[] {
    return timeline
        .filter((sample) => sample.attribute === attribute)
        .map((sample) => sample.value);
}
