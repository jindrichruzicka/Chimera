/**
 * Cross-reference guard: asserts every `getByTestId` string in MainMenuPage.ts
 * resolves against a source that accounts for it. This prevents silent
 * POM/renderer testid drift, where a page object goes on locating a testid the
 * renderer stopped emitting and the spec fails somewhere else entirely.
 *
 * A main-menu testid has two possible sources, and a guard with only the first
 * arm would reject a correct POM:
 *
 *   - the ENGINE, which derives one from the action for every entry it can name
 *     (`main-menu-play`, `main-menu-continue`, …). Those are asserted against
 *     `renderer/app/main-menu/page.tsx`, which carries them as source literals —
 *     mostly inside the comment block that exists for this guard, since
 *     `getMainMenuButtonTestId` builds them rather than spelling them on an
 *     element. The check is a text search, not a claim about what renders;
 *   - the GAME, through `GameMainMenuButton.id`, which the engine renders as
 *     `main-menu-<id>`. The engine cannot name those, so they are asserted
 *     against the tactics menu definition itself.
 *
 * @chimera-review: intentional filesystem access — structural alignment guard;
 *   mocking defeats the purpose (cf. vitest-config-filename-guard.test.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tacticsMainMenuDefinition } from '../../shell/main-menu';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');

function readSource(relativePath: string): string {
    return readFileSync(path.join(workspaceRoot, relativePath), 'utf-8');
}

/** Every `getByTestId('…')` argument in the POM, in source order. */
function mainMenuPomTestIds(): readonly string[] {
    const pomSource = readSource('apps/tactics/e2e/pages/MainMenuPage.ts');
    const testIdPattern = /getByTestId\('([^']+)'\)/g;
    const pomTestIds: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = testIdPattern.exec(pomSource)) !== null) {
        const captured = match[1];
        if (captured !== undefined) pomTestIds.push(captured);
    }
    return pomTestIds;
}

/** The testids the tactics menu definition names through `GameMainMenuButton.id`. */
function gameDeclaredTestIds(): ReadonlySet<string> {
    return new Set(
        tacticsMainMenuDefinition.buttons
            .map((button) => button.id)
            .filter((id): id is string => id !== undefined)
            .map((id) => `main-menu-${id}`),
    );
}

describe('MainMenuPage POM — testid alignment with renderer', () => {
    it('every getByTestId call in MainMenuPage.ts resolves against the renderer page or a game-declared id', () => {
        const rendererSource = readSource('renderer/app/main-menu/page.tsx');
        const declaredByGame = gameDeclaredTestIds();
        const pomTestIds = mainMenuPomTestIds();

        expect(pomTestIds.length).toBeGreaterThan(0);

        for (const testId of pomTestIds) {
            expect(
                rendererSource.includes(`data-testid="${testId}"`) || declaredByGame.has(testId),
                `MainMenuPage.ts uses getByTestId('${testId}') but data-testid="${testId}" is ` +
                    `absent from renderer/app/main-menu/page.tsx and no tactics menu button ` +
                    `declares the id '${testId.replace(/^main-menu-/, '')}'`,
            ).toBe(true);
        }
    });

    it('resolves main-menu-quick-match through the GAME arm, not the renderer page', () => {
        // Non-vacuity for the second arm: it exists because the engine derives
        // `main-menu-start` from a `start-game` action and cannot know which
        // start this is. If the renderer page ever grew this literal, the arm
        // would still pass while covering nothing.
        const rendererSource = readSource('renderer/app/main-menu/page.tsx');

        expect(mainMenuPomTestIds()).toContain('main-menu-quick-match');
        expect(gameDeclaredTestIds()).toContain('main-menu-quick-match');
        expect(rendererSource).not.toContain('data-testid="main-menu-quick-match"');
    });

    it('resolves main-menu-continue through the RENDERER arm, not a game-declared id', () => {
        // The mirror control: `continue` is an engine action the engine names
        // itself, so the tactics definition declares no id for it.
        const rendererSource = readSource('renderer/app/main-menu/page.tsx');

        expect(mainMenuPomTestIds()).toContain('main-menu-continue');
        expect(rendererSource).toContain('data-testid="main-menu-continue"');
        expect(gameDeclaredTestIds()).not.toContain('main-menu-continue');
    });

    it('main-menu-quit testid is present in renderer/app/main-menu/page.tsx', () => {
        const rendererSource = readSource('renderer/app/main-menu/page.tsx');

        expect(
            rendererSource,
            'data-testid="main-menu-quit" must be present in renderer/app/main-menu/page.tsx',
        ).toContain('data-testid="main-menu-quit"');
    });
});
