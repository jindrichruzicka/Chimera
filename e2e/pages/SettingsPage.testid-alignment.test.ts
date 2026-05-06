/**
 * Cross-reference guard: asserts every `getByTestId` string in SettingsPage.ts
 * has a matching `data-testid="..."` attribute in the renderer settings page
 * source. This prevents silent POM/renderer testid drift — the bug that caused
 * BLOCK-1 in the F31 review.
 *
 * @chimera-review: intentional filesystem access — structural alignment guard;
 *   mocking defeats the purpose (cf. vitest-config-filename-guard.test.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../..');

describe('SettingsPage POM — testid alignment with renderer', () => {
    it('every getByTestId call in SettingsPage.ts resolves against a data-testid in the renderer settings page', () => {
        const pomSource = readFileSync(
            path.join(workspaceRoot, 'e2e/pages/SettingsPage.ts'),
            'utf-8',
        );
        const rendererSource = readFileSync(
            path.join(workspaceRoot, 'renderer/app/settings/page.tsx'),
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
                `SettingsPage.ts uses getByTestId('${testId}') but data-testid="${testId}" is absent from renderer/app/settings/page.tsx`,
            ).toContain(`data-testid="${testId}"`);
        }
    });
});
