import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Page Object for the shared chat surface (`renderer/components/chat/ChatPanel.tsx`,
 * §4.29 — Chat System). The component is mounted in-match only — in a Tactics
 * match it lives inside a collapsed-by-default drawer in
 * `apps/tactics/screens/TacticsGameHud.tsx` — so call {@link openInMatchChat}
 * before interacting with it.
 *
 * There is no Send button: messages are submitted by pressing Enter in the body
 * input. Every message is lobby-scoped — the scope selector and the mute/unmute
 * controls were removed from the panel for the initial release (the host relay +
 * IPC mute surface remain available behind the API).
 *
 * Test-id alignment with the renderer source is guarded by
 * `ChatPanelPage.testid-alignment.test.ts`.
 */
export class ChatPanelPage {
    readonly panel: Locator;
    readonly messages: Locator;
    readonly bodyInput: Locator;
    readonly inMatchToggle: Locator;

    public constructor(private readonly page: Page) {
        this.panel = page.getByTestId('chat-panel');
        this.messages = page.getByTestId('chat-message');
        this.bodyInput = page.getByTestId('chat-body-input');
        // In-match chrome (Tactics HUD): the panel lives behind a corner toggle.
        this.inMatchToggle = page.getByTestId('tactics-chat-toggle');
    }

    /** Reveal the in-match chat drawer (collapsed by default in TacticsGameHud). */
    public async openInMatchChat(): Promise<void> {
        await this.inMatchToggle.click();
        await this.panel.waitFor({ state: 'visible' });
        await this.bodyInput.waitFor({ state: 'visible' });
    }

    /** Send a `lobby`-scope message (the only scope this panel exposes). */
    public async sendLobby(body: string): Promise<void> {
        await this.bodyInput.fill(body);
        // Enter submits — there is no Send button (ChatPanel.handleBodyKeyDown).
        await this.bodyInput.press('Enter');
    }

    /** Messages authored by `playerId` (matches the row's `data-from`). */
    public messagesFrom(playerId: string): Locator {
        return this.page.locator(`[data-testid="chat-message"][data-from="${playerId}"]`);
    }

    /** Visible message rows whose text contains `body`. */
    public withText(body: string): Locator {
        return this.messages.filter({ hasText: body });
    }

    public async messageCount(): Promise<number> {
        return this.messages.count();
    }

    public async waitForMessage(body: string, timeout = 15_000): Promise<void> {
        await expect(this.withText(body).first()).toBeVisible({ timeout });
    }
}
