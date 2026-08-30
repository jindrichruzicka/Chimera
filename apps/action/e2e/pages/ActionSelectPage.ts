import type { Locator, Page } from '@playwright/test';

/**
 * The game-owned `/select` page: the pre-match picker declared through
 * `shellRoutes` and served by `apps/action/renderer/app/select/page.tsx`.
 *
 * The two pick captions are the DOM readout of the quick-start draft — the only
 * place either seat's pick is observable, since the rings themselves are drawn
 * in the WebGL background behind this page.
 */
export class ActionSelectPage {
    readonly container: Locator;
    readonly hostPick: Locator;
    /** Rendered only while the pass-and-play seat is open. */
    readonly secondPick: Locator;
    readonly secondPlayerToggle: Locator;
    readonly backButton: Locator;
    readonly startButton: Locator;
    readonly startFailed: Locator;

    public constructor(private readonly page: Page) {
        this.container = page.getByTestId('action-select-page');
        this.hostPick = page.getByTestId('action-select-host-pick');
        this.secondPick = page.getByTestId('action-select-second-pick');
        this.secondPlayerToggle = page.getByTestId('action-select-second-player');
        this.backButton = page.getByTestId('action-select-back');
        this.startButton = page.getByTestId('action-select-start');
        this.startFailed = page.getByTestId('action-select-start-failed');
    }

    /**
     * Move a seat's ring one step along the primitive row.
     *
     * The keys pressed are the DEFAULT bindings of that seat's own movement
     * actions — arrows for player one, WASD for player two. So the press travels
     * the shipped route: the engine's input layer resolves the binding to the
     * action, and the page's `useInputAction` subscription steps the pick. A
     * spec that reached the pick any other way would say nothing about the
     * app-boot registration that makes these keys work before a match, and a
     * rebind spec presses the REBOUND key on this same surface to prove the
     * binding is what is being read.
     */
    public async stepHostPick(direction: 'left' | 'right'): Promise<void> {
        await this.page.keyboard.press(direction === 'left' ? 'ArrowLeft' : 'ArrowRight');
    }

    public async stepSecondPick(direction: 'left' | 'right'): Promise<void> {
        await this.page.keyboard.press(direction === 'left' ? 'KeyA' : 'KeyD');
    }

    public async enableSecondPlayer(): Promise<void> {
        await this.secondPlayerToggle.click();
    }

    public async start(): Promise<void> {
        await this.startButton.click();
    }
}
