import { expect, type Locator } from '@playwright/test';
import { LobbyPage } from './LobbyPage';

/**
 * Page object for the Tactics customizable lobby (#702). Extends {@link LobbyPage}
 * with the Tactics-specific colour controls rendered by
 * `games/tactics/shell/TacticsLobbyScreen.tsx`:
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
        return this.page.getByTestId(`tactics-player-color-select-${playerId}`);
    }

    public playerSwatch(playerId: string): Locator {
        return this.page.getByTestId(`tactics-player-swatch-${playerId}`);
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
     * Computed CSS background colour of a player's swatch (e.g. `rgb(22, 163, 74)`),
     * which `TacticsLobbyScreen` drives from the synced player colour.
     */
    public async swatchBackgroundColor(playerId: string): Promise<string> {
        return this.playerSwatch(playerId).evaluate((element) => {
            const getComputedStyle = (
                globalThis as typeof globalThis & {
                    readonly getComputedStyle: (el: unknown) => {
                        readonly backgroundColor: string;
                    };
                }
            ).getComputedStyle;
            return getComputedStyle(element).backgroundColor;
        });
    }
}
