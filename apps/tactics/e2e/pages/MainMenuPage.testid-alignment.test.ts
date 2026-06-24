/**
 * Cross-reference guard: asserts every `getByTestId` string in MainMenuPage.ts
 * has a matching `data-testid="..."` attribute in the renderer main menu page
 * source. This prevents silent POM/renderer testid drift — the same class of
 * bug that caused BLOCK-1 in the F31 review (documented in
 * SettingsPage.testid-alignment.test.ts).
 *
 * @chimera-review: intentional filesystem access — structural alignment guard;
 *   mocking defeats the purpose (cf. vitest-config-filename-guard.test.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');

describe('MainMenuPage POM — testid alignment with renderer', () => {
    it('every getByTestId call in MainMenuPage.ts resolves against a data-testid in the renderer main menu page', () => {
        const pomSource = readFileSync(
            path.join(workspaceRoot, 'apps/tactics/e2e/pages/MainMenuPage.ts'),
            'utf-8',
        );
        const rendererSource = readFileSync(
            path.join(workspaceRoot, 'renderer/app/main-menu/page.tsx'),
            'utf-8',
        );

        const testIdPattern = /getByTestId\('([^']+)'\)/g;
        const pomTestIds: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = testIdPattern.exec(pomSource)) !== null) {
            const captured = match[1];
            if (captured !== undefined) pomTestIds.push(captured);
        }

        expect(pomTestIds.length).toBeGreaterThan(0);

        for (const testId of pomTestIds) {
            expect(
                rendererSource,
                `MainMenuPage.ts uses getByTestId('${testId}') but data-testid="${testId}" is absent from renderer/app/main-menu/page.tsx`,
            ).toContain(`data-testid="${testId}"`);
        }
    });

    it('main-menu-quit testid is present in renderer/app/main-menu/page.tsx', () => {
        const rendererSource = readFileSync(
            path.join(workspaceRoot, 'renderer/app/main-menu/page.tsx'),
            'utf-8',
        );

        expect(
            rendererSource,
            'data-testid="main-menu-quit" must be present in renderer/app/main-menu/page.tsx',
        ).toContain('data-testid="main-menu-quit"');
    });
});
