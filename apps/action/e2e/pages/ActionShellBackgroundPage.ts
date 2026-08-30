import { expect, type Locator, type Page } from '@playwright/test';
import {
    ACTION_SHELL_DOLLY_ATTRIBUTE,
    ACTION_SHELL_YAW_ATTRIBUTE,
    type ActionShellDollyPhase,
    type ActionShellYawPhase,
} from '@chimera-engine/action/shell/actionShellCamera.js';

/**
 * The testid on this game's own scene host — the element the rig publishes its
 * camera phases on.
 *
 * Exported because a CSS selector for it is also what the attribute recorder
 * observes, and two spellings of one testid is one of them going stale in
 * silence: the recorder would watch nothing and report an empty timeline.
 */
export const ACTION_SHELL_SCENE_TESTID = 'action-shell-background';

/** The same element as a CSS selector, for `document.querySelectorAll`. */
export const ACTION_SHELL_SCENE_SELECTOR = `[data-testid="${ACTION_SHELL_SCENE_TESTID}"]`;

/**
 * The live shell background: the engine's mount plate and this game's scene
 * inside it.
 *
 * The camera is read through the PHASE attributes the rig publishes, never
 * through pixels or CSS. A WebGL camera transform is not observable from the DOM
 * at all, and the fade around it is collapsed under Playwright-Electron, so a
 * reader that watched either would be watching the wrong thing. The attribute
 * names are imported rather than restated, so a rename cannot leave this suite
 * waiting on an attribute nothing writes.
 */
export class ActionShellBackgroundPage {
    /** The engine's host plate — present on every shell surface. */
    readonly host: Locator;
    /** This game's own scene, mounted inside the plate. */
    readonly scene: Locator;

    public constructor(private readonly page: Page) {
        this.host = page.getByTestId('shell-background');
        this.scene = page.getByTestId(ACTION_SHELL_SCENE_TESTID);
    }

    /** Wait until the GAME's background — not the engine default — is mounted. */
    public async waitForGameBackground(timeout: number): Promise<void> {
        await expect(this.host).toHaveAttribute('data-shell-background-kind', 'game', { timeout });
        await expect(this.scene).toBeVisible({ timeout });
    }

    /**
     * The plate's instance id.
     *
     * One number per MOUNT, so an id that survives a route hop is the proof that
     * the same live scene was carried across it rather than torn down and
     * rebuilt behind the new screen.
     */
    public async instanceId(): Promise<string> {
        const value = await this.host.getAttribute('data-shell-background-instance-id');
        if (value === null) {
            throw new Error('The shell background host exposed no instance id');
        }
        return value;
    }

    /** Wait for the camera's yaw to arrive at an end of its travel. */
    public async expectYaw(phase: ActionShellYawPhase, timeout: number): Promise<void> {
        await expect(this.scene).toHaveAttribute(ACTION_SHELL_YAW_ATTRIBUTE, phase, { timeout });
    }

    /** Wait for the camera's dolly to arrive at an end of its travel. */
    public async expectDolly(phase: ActionShellDollyPhase, timeout: number): Promise<void> {
        await expect(this.scene).toHaveAttribute(ACTION_SHELL_DOLLY_ATTRIBUTE, phase, { timeout });
    }

    /** Click the exact centre of the plate — where the middle primitive sits. */
    public async clickSceneCentre(): Promise<void> {
        const box = await this.host.boundingBox();
        if (box === null) {
            throw new Error('The shell background host has no bounding box');
        }
        await this.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    }
}
