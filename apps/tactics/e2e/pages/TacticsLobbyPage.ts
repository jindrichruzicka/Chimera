import { expect, type Locator } from '@playwright/test';
import { LobbyPage } from './LobbyPage';

/**
 * The DOM fields one swatch read touches. The e2e tsconfig carries no DOM lib,
 * so the read declares the shapes it uses instead of importing them: a
 * `<select>`'s `value` and option count, and an element's inline background.
 */
interface DomElementView {
    readonly value: string;
    readonly length: number;
    readonly style: { readonly backgroundColor: string };
}

/** The testids one swatch read resolves, passed into the page as one argument. */
interface SwatchTestIds {
    readonly screenTestId: string;
    readonly rowTestId: string;
    readonly selectTestId: string;
    readonly swatchTestId: string;
}

/**
 * The testids {@link TacticsLobbyPage.readSwatchState} spells directly.
 *
 * The read runs inside `page.evaluate`, so it needs the STRINGS, not the
 * `getByTestId` locators the rest of this page object uses — which puts them
 * outside the reach of the literal-argument scan in
 * `TacticsLobbyPage.testid-alignment.test.ts`. That guard therefore asserts this
 * object against the renderer separately: two spellings each pinned to the same
 * renderer source cannot silently drift apart. The first two are also spelled in
 * `LobbyPage.ts`, whose own alignment guard covers them there.
 */
export const SWATCH_READ_TEST_IDS = {
    screen: 'tactics-lobby-screen',
    row: 'tactics-lobby-player',
    selectPrefix: 'tactics-player-color-select-',
    swatchPrefix: 'tactics-player-swatch-',
} as const;

/**
 * One row's colour state, as of a single evaluate.
 *
 * `TacticsLobbyScreen` renders a row's `<select>` value and its swatch's
 * background from the SAME `color` in the SAME render — the select from the
 * value itself, the swatch from `palette.playerColorHex[color]`, both built from
 * one `player-colors` collection whose schema REQUIRES a `hex`. So a mounted row
 * offering a colour as an option and rendering no background for it is a broken
 * content contract, not a slow one; the fields below separate that from the far
 * likelier reading — that the row was no longer on the page.
 */
export interface SwatchState {
    /** Whether the game's lobby screen is on the page at all. */
    readonly screenPresent: boolean;
    /** Human roster rows currently rendered. */
    readonly rowCount: number;
    /** Whether THIS player's swatch is on the page. */
    readonly swatchPresent: boolean;
    /** That row's colour select value, or `null` when the select is absent. */
    readonly selectValue: string | null;
    /** Options on that select — 0 means the content-derived palette is empty. */
    readonly optionCount: number;
    /** The swatch's inline `style.backgroundColor` (`''` when unset or absent). */
    readonly inlineBackground: string;
    /** The swatch's computed background (`''` when the swatch is absent). */
    readonly computedBackground: string;
}

/**
 * Why a swatch poll never reached its colour.
 *
 * A swatch poll that times out reports `Expected <rgb> / Received <rgb|null>`
 * and nothing else, which is true of every way the row can fail to carry a
 * colour: the game lobby screen unmounting, the seat leaving the roster, the
 * content fetch never settling, and a palette that has the colour as an option
 * but no hex for it. Each arm below names a different one of those.
 *
 * Pure, and takes the state rather than reading one: the arms are the part worth
 * pinning, and the read that feeds them can fail on its own terms — `null` is
 * that case, not an absent row.
 */
export function describeSwatchStall(state: SwatchState | null, playerId: string): string {
    if (state === null) {
        return 'the lobby DOM could not be read, so why the colour is missing is unknown';
    }

    if (!state.screenPresent) {
        return (
            'the tactics lobby screen is not mounted — the page is not rendering the ' +
            'game lobby at all, so no row of it exists to carry a colour'
        );
    }

    if (!state.swatchPresent) {
        return (
            `no roster row for ${playerId} is mounted while ${state.rowCount} row(s) are — ` +
            'the lobby state that seat came from is not the one being rendered'
        );
    }

    if (state.optionCount === 0) {
        return (
            'the colour palette is empty — the game content fetch has not settled, so no ' +
            'colour has a hex to render'
        );
    }

    if (state.inlineBackground === '') {
        return (
            `the row rendered with no inline background — the palette holds ${state.optionCount} ` +
            `option(s) but no hex for "${String(state.selectValue)}"`
        );
    }

    return (
        `the row carries background "${state.inlineBackground}" (computed ` +
        `"${state.computedBackground}") while its select reads "${String(state.selectValue)}"`
    );
}

/**
 * Page object for the Tactics customizable lobby. Extends {@link LobbyPage}
 * with the Tactics-specific colour controls rendered by
 * `apps/tactics/shell/TacticsLobbyScreen.tsx`:
 *   - board colour select (`tactics-board-color-select`)
 *   - per-player colour selects (`tactics-player-color-select-${playerId}`)
 *   - per-player swatches (`tactics-player-swatch-${playerId}`)
 *
 * Each colour control is a native `<select>` with the testid spread onto the
 * `<select>` itself, editable only for the host (`disabled={!isHost}`). Writes go
 * through host-authority IPC (fire-and-forget), so reads must poll `inputValue()`
 * until the round-tripped lobby state re-renders the control.
 */
export class TacticsLobbyPage extends LobbyPage {
    public boardColorSelect(): Locator {
        return this.page.getByTestId('tactics-board-color-select');
    }

    public playerColorSelect(playerId: string): Locator {
        return this.page.getByTestId(`${SWATCH_READ_TEST_IDS.selectPrefix}${playerId}`);
    }

    public playerSwatch(playerId: string): Locator {
        return this.page.getByTestId(`${SWATCH_READ_TEST_IDS.swatchPrefix}${playerId}`);
    }

    public async setBoardColor(value: string): Promise<void> {
        await this.boardColorSelect().selectOption(value);
    }

    public async setPlayerColor(playerId: string, value: string): Promise<void> {
        await this.playerColorSelect(playerId).selectOption(value);
    }

    /** Poll until the board colour select reflects the round-tripped value. */
    public async expectBoardColor(value: string): Promise<void> {
        await expect.poll(() => this.boardColorSelect().inputValue()).toBe(value);
    }

    /** Poll until a player's colour select reflects the round-tripped value. */
    public async expectPlayerColor(playerId: string, value: string): Promise<void> {
        await expect.poll(() => this.playerColorSelect(playerId).inputValue()).toBe(value);
    }

    /**
     * Everything a player row's swatch colour is derived from, read in ONE
     * `page.evaluate` so the fields cannot straddle a re-render — a row read
     * field by field could report a select from before a re-render and a swatch
     * from after it, which is the very disagreement this is here to explain.
     *
     * Deliberately not a `locator.evaluate`: that waits for the element to
     * attach, with no timeout of its own, so a poll over a DETACHED swatch dies
     * as a bare `expect.poll` timeout and the fact that the row was gone is
     * lost. `null` is an unreadable page (closed, navigating), not an absent
     * row — the arms of {@link describeSwatchStall} separate those.
     */
    public async readSwatchState(playerId: string): Promise<SwatchState | null> {
        try {
            return await this.page.evaluate(
                (testIds: SwatchTestIds): SwatchState => {
                    // The e2e tsconfig is DOM-less, so the handful of browser
                    // shapes this body touches are typed off `globalThis` here
                    // (cf. tactics-replay-initial-color.spec.ts).
                    const browser = globalThis as typeof globalThis & {
                        readonly document: {
                            readonly querySelector: (selector: string) => DomElementView | null;
                            readonly querySelectorAll: (selector: string) => {
                                readonly length: number;
                            };
                        };
                        readonly getComputedStyle: (element: unknown) => {
                            readonly backgroundColor: string;
                        };
                    };
                    const byTestId = (testId: string): DomElementView | null =>
                        browser.document.querySelector(`[data-testid="${testId}"]`);
                    const swatch = byTestId(testIds.swatchTestId);
                    const select = byTestId(testIds.selectTestId);
                    return {
                        screenPresent: byTestId(testIds.screenTestId) !== null,
                        rowCount: browser.document.querySelectorAll(
                            `[data-testid="${testIds.rowTestId}"]`,
                        ).length,
                        swatchPresent: swatch !== null,
                        selectValue: select?.value ?? null,
                        optionCount: select?.length ?? 0,
                        inlineBackground: swatch?.style.backgroundColor ?? '',
                        computedBackground:
                            swatch === null ? '' : browser.getComputedStyle(swatch).backgroundColor,
                    };
                },
                {
                    screenTestId: SWATCH_READ_TEST_IDS.screen,
                    rowTestId: SWATCH_READ_TEST_IDS.row,
                    selectTestId: `${SWATCH_READ_TEST_IDS.selectPrefix}${playerId}`,
                    swatchTestId: `${SWATCH_READ_TEST_IDS.swatchPrefix}${playerId}`,
                },
            );
        } catch {
            return null;
        }
    }

    /**
     * Computed CSS background colour of a player's swatch (e.g. `rgb(22, 163, 74)`),
     * which `TacticsLobbyScreen` drives from the synced player colour. `null`
     * when that row is not on the page — a value the poll can report, unlike a
     * wait that never returns.
     */
    public async swatchBackgroundColor(playerId: string): Promise<string | null> {
        const state = await this.readSwatchState(playerId);
        return state?.swatchPresent === true ? state.computedBackground : null;
    }

    /**
     * Poll a player's swatch to `expected`, and say WHY if it never gets there.
     *
     * `timeout` exists for this page object's own unit tests, which must not sit
     * out the suite's 10 s expect budget to reach the failure path.
     */
    public async expectSwatchColor(
        playerId: string,
        expected: string,
        timeout?: number,
    ): Promise<void> {
        try {
            await expect
                .poll(
                    () => this.swatchBackgroundColor(playerId),
                    timeout === undefined ? {} : { timeout },
                )
                .toBe(expected);
        } catch (error: unknown) {
            throw new Error(
                `${error instanceof Error ? error.message : String(error)}\n\n` +
                    `The swatch for ${playerId} never reached ${expected}.\n` +
                    `Why: ${describeSwatchStall(await this.readSwatchState(playerId), playerId)}`,
                // The message is rewritten, so the matcher's own error survives
                // only here — anything reading the failure programmatically
                // needs it.
                { cause: error },
            );
        }
    }

    // ── Lobby address sharing (host-only Battle Setup affordance) ─────────────

    /** The host-only joinable lobby address (`lobby-address`). */
    public lobbyAddress(): Locator {
        return this.page.getByTestId('lobby-address');
    }

    /** The host-only "copy lobby address" affordance (`lobby-address-copy`). */
    public copyAddressButton(): Locator {
        return this.page.getByTestId('lobby-address-copy');
    }

    // ── Commitment scheme (host-authored Battle Setup toggle) ────────────

    /** The commitment-scheme toggle (`<input type=checkbox>`, host-only editable). */
    public commitmentToggle(): Locator {
        return this.page.getByTestId('tactics-commitment-scheme-toggle');
    }

    /** Enable the commitment battle mode (host only). */
    public async enableCommitmentScheme(): Promise<void> {
        await this.commitmentToggle().check();
    }

    /** Poll until the toggle reflects the round-tripped checked state. */
    public async expectCommitmentEnabled(enabled: boolean): Promise<void> {
        await expect.poll(() => this.commitmentToggle().isChecked()).toBe(enabled);
    }

    // ── Spectators (host-authored Battle Setup toggle) ───────────────────

    /** The allow-spectators toggle (`<input type=checkbox>`, host-only editable). */
    public allowSpectatorsToggle(): Locator {
        return this.page.getByTestId('tactics-allow-spectators-toggle');
    }

    /** Enable spectator admission for the running match (host only). */
    public async enableSpectators(): Promise<void> {
        await this.allowSpectatorsToggle().check();
    }

    /** Poll until the toggle reflects the round-tripped checked state. */
    public async expectSpectatorsEnabled(enabled: boolean): Promise<void> {
        await expect.poll(() => this.allowSpectatorsToggle().isChecked()).toBe(enabled);
    }

    // ── AI players ──────────────────────────────────────────────────────

    /** The "Add AI player" button (host-only; disabled when the lobby is full). */
    public addAiButton(): Locator {
        return this.page.getByTestId('tactics-add-ai');
    }

    /** All AI roster rows (`tactics-lobby-ai-player`). */
    public aiPlayerRows(): Locator {
        return this.page.getByTestId('tactics-lobby-ai-player');
    }

    /** The "Remove" button for the AI slot at `slotIndex`. */
    public removeAiButton(slotIndex: number): Locator {
        return this.page.getByTestId(`tactics-remove-ai-${slotIndex}`);
    }

    /** Click "Add AI player" (host only). */
    public async addAi(): Promise<void> {
        await this.addAiButton().click();
    }

    /** Poll until the AI roster has exactly `count` rows. */
    public async expectAiCount(count: number): Promise<void> {
        await expect.poll(() => this.aiPlayerRows().count()).toBe(count);
    }
}
