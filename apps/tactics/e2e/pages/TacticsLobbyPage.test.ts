/**
 * Unit coverage for the swatch-half diagnosis on {@link TacticsLobbyPage}.
 *
 * A Vitest unit test, not a Playwright E2E spec: the describer is pure, and the
 * read that feeds it takes a `Page` double, so neither needs a browser.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import {
    describeSwatchStall,
    SWATCH_READ_TEST_IDS,
    TacticsLobbyPage,
    type SwatchState,
} from './TacticsLobbyPage';

const MOUNTED: SwatchState = {
    screenPresent: true,
    rowCount: 2,
    swatchPresent: true,
    selectValue: 'green',
    optionCount: 6,
    inlineBackground: 'rgb(22, 163, 74)',
    computedBackground: 'rgb(22, 163, 74)',
};

/**
 * A `Page` double exposing `evaluate` (all the swatch read uses) plus the
 * `getByTestId` the base page object calls from its constructor.
 */
function pageDouble(evaluate: (fn: unknown, arg: unknown) => Promise<unknown>): Page {
    return { evaluate, getByTestId: () => ({}) } as unknown as Page;
}

/** A stub element carrying the fields the read touches, plus its computed colour. */
interface StubElement {
    readonly value?: string;
    readonly length?: number;
    readonly style?: { readonly backgroundColor: string };
    readonly computed?: string;
}

/**
 * Run the callback `readSwatchState` hands to `page.evaluate` against a stub DOM.
 *
 * That callback runs in the browser, so nothing else in the fast suite executes
 * it — and it is where every field the diagnosis branches on is derived. Pulling
 * it off the double and calling it here is what puts those derivations under
 * test; a canned `SwatchState` measures the describer only.
 */
async function readAgainstStubDom(
    playerId: string,
    elements: Readonly<Record<string, StubElement>>,
    rowCount: number,
): Promise<SwatchState> {
    let body: ((testIds: unknown) => SwatchState) | undefined;
    let testIds: unknown;
    const page = new TacticsLobbyPage(
        pageDouble((fn, arg) => {
            body = fn as (ids: unknown) => SwatchState;
            testIds = arg;
            return Promise.resolve(null);
        }),
    );
    await page.readSwatchState(playerId);
    if (body === undefined) {
        throw new Error('readSwatchState did not hand a callback to page.evaluate');
    }

    vi.stubGlobal('document', {
        querySelector: (selector: string): StubElement | null => elements[selector] ?? null,
        querySelectorAll: (selector: string) => ({
            length: selector === `[data-testid="${SWATCH_READ_TEST_IDS.row}"]` ? rowCount : 0,
        }),
    });
    vi.stubGlobal('getComputedStyle', (element: StubElement) => ({
        backgroundColor: element.computed ?? '',
    }));

    return body(testIds);
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('describeSwatchStall', () => {
    it('says the DOM was unreadable when no state could be read', () => {
        expect(describeSwatchStall(null, 'p1')).toContain('could not be read');
    });

    it('names an unmounted lobby screen before anything about the row', () => {
        const message = describeSwatchStall(
            { ...MOUNTED, screenPresent: false, rowCount: 0, swatchPresent: false },
            'p1',
        );

        expect(message).toContain('tactics lobby screen is not mounted');
        expect(message).not.toContain('no roster row');
    });

    it('names a missing row and how many rows the roster does hold', () => {
        const message = describeSwatchStall(
            { ...MOUNTED, swatchPresent: false, rowCount: 1 },
            'p1',
        );

        expect(message).toContain('no roster row for p1');
        expect(message).toContain('1 row');
    });

    it('names the missing row before the palette when neither is there', () => {
        // A screen that mounted with no roster yet has both an absent row and an
        // empty palette; the row is the one that decides whether any of the rest
        // could even render.
        const message = describeSwatchStall(
            { ...MOUNTED, swatchPresent: false, rowCount: 0, optionCount: 0 },
            'p1',
        );

        expect(message).toContain('no roster row for p1');
        expect(message).not.toContain('palette is empty');
    });

    it('blames an unsettled content fetch when the palette has no options', () => {
        const message = describeSwatchStall(
            {
                ...MOUNTED,
                optionCount: 0,
                inlineBackground: '',
                computedBackground: 'rgba(0, 0, 0, 0)',
            },
            'p1',
        );

        expect(message).toContain('palette is empty');
        expect(message).toContain('content fetch');
    });

    it('blames a missing hex when the palette has options but the row has no inline colour', () => {
        const message = describeSwatchStall(
            { ...MOUNTED, inlineBackground: '', computedBackground: 'rgba(0, 0, 0, 0)' },
            'p1',
        );

        expect(message).toContain('no hex for "green"');
        expect(message).not.toContain('palette is empty');
    });

    it('prints the colours it did read when the row is fully rendered', () => {
        const message = describeSwatchStall(MOUNTED, 'p1');

        expect(message).toContain('rgb(22, 163, 74)');
        expect(message).toContain('green');
        expect(message).not.toContain('no hex');
    });
});

describe('TacticsLobbyPage swatch reads', () => {
    it('passes the row-scoped testids to a single page evaluate', async () => {
        const evaluate = vi.fn<(fn: unknown, arg: unknown) => Promise<unknown>>(() =>
            Promise.resolve(MOUNTED),
        );
        const page = new TacticsLobbyPage(pageDouble(evaluate));

        await page.readSwatchState('p1');

        expect(evaluate).toHaveBeenCalledTimes(1);
        expect(evaluate.mock.calls[0]?.[1]).toEqual({
            screenTestId: 'tactics-lobby-screen',
            rowTestId: 'tactics-lobby-player',
            selectTestId: 'tactics-player-color-select-p1',
            swatchTestId: 'tactics-player-swatch-p1',
        });
    });

    it('derives every field from the DOM the row is actually in', async () => {
        // The computed colour differs from the inline one on purpose: reading the
        // inline value here would serialise identically on a real happy path and
        // hide that the computed style is what the assertion compares.
        const state = await readAgainstStubDom(
            'p1',
            {
                [`[data-testid="${SWATCH_READ_TEST_IDS.screen}"]`]: {},
                [`[data-testid="${SWATCH_READ_TEST_IDS.selectPrefix}p1"]`]: {
                    value: 'green',
                    length: 6,
                },
                [`[data-testid="${SWATCH_READ_TEST_IDS.swatchPrefix}p1"]`]: {
                    style: { backgroundColor: '#16a34a' },
                    computed: 'rgb(22, 163, 74)',
                },
            },
            2,
        );

        expect(state).toEqual({
            screenPresent: true,
            rowCount: 2,
            swatchPresent: true,
            selectValue: 'green',
            optionCount: 6,
            inlineBackground: '#16a34a',
            computedBackground: 'rgb(22, 163, 74)',
        });
    });

    it('reports a row that is not in the DOM as absent rather than as a colourless one', async () => {
        // The whole diagnosis turns on this: a swatch reported present with an
        // empty background sends the describer down the empty-palette arm and
        // blames the content fetch for a row that simply was not there.
        const state = await readAgainstStubDom(
            'p1',
            { [`[data-testid="${SWATCH_READ_TEST_IDS.screen}"]`]: {} },
            1,
        );

        expect(state).toEqual({
            screenPresent: true,
            rowCount: 1,
            swatchPresent: false,
            selectValue: null,
            optionCount: 0,
            inlineBackground: '',
            computedBackground: '',
        });
    });

    it('reports an unmounted lobby screen as absent, not as a row that went missing', async () => {
        // `screenPresent` is the first arm the describer branches on, so a read
        // that cannot report `false` here blames the seat for a screen that never
        // rendered at all.
        const state = await readAgainstStubDom('p1', {}, 0);

        expect(state.screenPresent).toBe(false);
        expect(describeSwatchStall(state, 'p1')).toContain('tactics lobby screen is not mounted');
    });

    it('returns null instead of throwing when the evaluate fails', async () => {
        const page = new TacticsLobbyPage(
            pageDouble(() => Promise.reject(new Error('page closed'))),
        );

        await expect(page.readSwatchState('p1')).resolves.toBeNull();
    });

    it('reads the computed background of a mounted swatch', async () => {
        const page = new TacticsLobbyPage(pageDouble(() => Promise.resolve(MOUNTED)));

        await expect(page.swatchBackgroundColor('p1')).resolves.toBe('rgb(22, 163, 74)');
    });

    it('reports an absent swatch as null rather than waiting for it to attach', async () => {
        const page = new TacticsLobbyPage(
            pageDouble(() =>
                Promise.resolve({ ...MOUNTED, swatchPresent: false, computedBackground: '' }),
            ),
        );

        await expect(page.swatchBackgroundColor('p1')).resolves.toBeNull();
    });

    it('appends the stall description when the swatch never reaches the colour', async () => {
        const page = new TacticsLobbyPage(
            pageDouble(() =>
                Promise.resolve({
                    ...MOUNTED,
                    swatchPresent: false,
                    rowCount: 1,
                    computedBackground: '',
                }),
            ),
        );

        await expect(page.expectSwatchColor('p1', 'rgb(22, 163, 74)', 50)).rejects.toThrow(
            /no roster row for p1/,
        );
    });

    it('resolves without a diagnosis when the swatch already carries the colour', async () => {
        const page = new TacticsLobbyPage(pageDouble(() => Promise.resolve(MOUNTED)));

        await expect(page.expectSwatchColor('p1', 'rgb(22, 163, 74)', 50)).resolves.toBeUndefined();
    });
});
