/**
 * renderer/components/r3f/__test-support__/fakeDisplay.ts
 *
 * A display whose device-pixel ratio a test can move, and the `matchMedia` a
 * browser gives it. jsdom has no `matchMedia` at all, so a subscription to the
 * ratio cannot be driven there without one. This fake reproduces the semantics
 * that subscription turns on, as measured in Electron 33 by moving the zoom
 * factor across a range of ratios, fractional ones included:
 *
 *  - `(resolution: Ndppx)`, built from the ratio the browser reports, matches
 *    while the ratio is N.
 *  - A listener hears `change` when its query's match flips — so a query built
 *    for one ratio fires as the ratio leaves it.
 *
 * NOT modelled, deliberately:
 *  - Any other media feature. A query this fake cannot parse never matches and
 *    never fires, so a subscription built on anything but an exact `resolution`
 *    query hears nothing here.
 *  - Timing. `setRatio` delivers every change synchronously, inside the
 *    caller's `act`.
 */

import { vi } from 'vitest';

export type FakeDisplay = Readonly<{
    /** Move the ratio, and deliver `change` to every listener whose query's match flipped. */
    setRatio: (next: number) => void;
    /** `change` listeners added and not yet removed, across every query. */
    liveListenerCount: () => number;
}>;

type ChangeListener = (event: MediaQueryListEvent) => void;

type Registration = Readonly<{ query: MediaQueryList; listener: ChangeListener }>;

const RESOLUTION_QUERY = /^\(resolution: (\d+(?:\.\d+)?)dppx\)$/;

/**
 * Install a display at `ratio`. Both globals it replaces — `devicePixelRatio`
 * and `matchMedia` — go through `vi.stubGlobal`, so `vi.unstubAllGlobals()`
 * takes the display away again.
 */
export function installFakeDisplay(ratio: number): FakeDisplay {
    let current = ratio;
    const registrations: Registration[] = [];

    const matchMedia = (media: string): MediaQueryList => {
        const parsed = RESOLUTION_QUERY.exec(media);
        const target = parsed === null ? null : Number(parsed[1]);
        const query = {
            media,
            get matches(): boolean {
                return target === current;
            },
            addEventListener(type: string, listener: ChangeListener): void {
                if (type === 'change') {
                    registrations.push({ query: query as unknown as MediaQueryList, listener });
                }
            },
            removeEventListener(type: string, listener: ChangeListener): void {
                const index = registrations.findIndex(
                    (entry) => entry.query === (query as unknown) && entry.listener === listener,
                );
                if (type === 'change' && index !== -1) {
                    registrations.splice(index, 1);
                }
            },
        };

        return query as unknown as MediaQueryList;
    };

    vi.stubGlobal('devicePixelRatio', current);
    vi.stubGlobal('matchMedia', matchMedia);

    return {
        setRatio: (next) => {
            const before = registrations.map((entry) => ({
                entry,
                matched: entry.query.matches,
            }));
            current = next;
            vi.stubGlobal('devicePixelRatio', next);

            for (const { entry, matched } of before) {
                // A listener an earlier one removed during this delivery hears
                // nothing, and one added during it was built for the new ratio.
                if (registrations.includes(entry) && entry.query.matches !== matched) {
                    entry.listener({
                        matches: entry.query.matches,
                        media: entry.query.media,
                    } as MediaQueryListEvent);
                }
            }
        },
        liveListenerCount: () => registrations.length,
    };
}
