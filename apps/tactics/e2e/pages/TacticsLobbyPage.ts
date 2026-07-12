import { expect, type Locator } from '@playwright/test';
import { LobbyPage } from './LobbyPage';

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
