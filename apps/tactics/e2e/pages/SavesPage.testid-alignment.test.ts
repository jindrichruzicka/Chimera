/**
 * Cross-reference guard: asserts every `getByTestId` string in SavesPage.ts
 * has a matching testid literal in the saves screen source. This prevents
 * silent POM/renderer testid drift — the same class of bug that caused
 * BLOCK-1 in the F31 review (documented in
 * SettingsPage.testid-alignment.test.ts).
 *
 * The saves screen authors some ids as `data-testid="..."` JSX attributes and
 * others as Modal action `testId: '...'` props (Modal renders those to
 * `data-testid`), so the guard accepts either source literal.
 *
 * @chimera-review: intentional filesystem access — structural alignment guard;
 *   mocking defeats the purpose (cf. vitest-config-filename-guard.test.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');

describe('SavesPage POM — testid alignment with renderer', () => {
    it('every getByTestId call in SavesPage.ts resolves against a testid literal in the saves screen', () => {
        const pomSource = readFileSync(
            path.join(workspaceRoot, 'apps/tactics/e2e/pages/SavesPage.ts'),
            'utf-8',
        );
        const rendererSource = readFileSync(
            path.join(workspaceRoot, 'renderer/app/saves/page.tsx'),
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
            const present =
                rendererSource.includes(`data-testid="${testId}"`) ||
                rendererSource.includes(`testId: '${testId}'`);
            expect(
                present,
                `SavesPage.ts uses getByTestId('${testId}') but neither data-testid="${testId}" nor testId: '${testId}' is present in renderer/app/saves/page.tsx`,
            ).toBe(true);
        }
    });
});
