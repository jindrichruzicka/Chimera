/**
 * Cross-reference guard: asserts every `getByTestId` string in SettingsPage.ts
 * has a matching testid literal in the renderer settings-surface sources. This
 * prevents silent POM/renderer testid drift — the bug that caused BLOCK-1 in
 * the F31 review.
 *
 * The settings surface authors some ids as `data-testid="..."` JSX attributes,
 * others as Modal action `testId: '...'` props (Modal renders those to
 * `data-testid`), and the Language field's id as a `testId="..."` component
 * prop in the shell wrapper `SettingsLanguageSelector.tsx` — so the guard scans
 * both source files and accepts any of the three literal forms.
 *
 * @chimera-review: intentional filesystem access — structural alignment guard;
 *   mocking defeats the purpose (cf. vitest-config-filename-guard.test.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');

const RENDERER_SETTINGS_SOURCES = [
    'renderer/app/settings/page.tsx',
    'renderer/shell/SettingsLanguageSelector.tsx',
] as const;

describe('SettingsPage POM — testid alignment with renderer', () => {
    it('every getByTestId call in SettingsPage.ts resolves against a testid in the renderer settings sources', () => {
        const pomSource = readFileSync(
            path.join(workspaceRoot, 'apps/tactics/e2e/pages/SettingsPage.ts'),
            'utf-8',
        );
        const rendererSources = RENDERER_SETTINGS_SOURCES.map((source) =>
            readFileSync(path.join(workspaceRoot, source), 'utf-8'),
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
            const present = rendererSources.some(
                (source) =>
                    source.includes(`data-testid="${testId}"`) ||
                    source.includes(`testId: '${testId}'`) ||
                    source.includes(`testId="${testId}"`),
            );
            expect(
                present,
                `SettingsPage.ts uses getByTestId('${testId}') but no data-testid="${testId}", testId: '${testId}', or testId="${testId}" literal is present in ${RENDERER_SETTINGS_SOURCES.join(' or ')}`,
            ).toBe(true);
        }
    });
});
