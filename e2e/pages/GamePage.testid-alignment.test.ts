/**
 * Cross-reference guard: asserts every `getByTestId` string in GamePage.ts
 * has a matching `data-testid="..."` attribute in the renderer game shell
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

const workspaceRoot = path.resolve(import.meta.dirname, '../..');

describe('GamePage POM — testid alignment with renderer', () => {
    it('every getByTestId call in GamePage.ts resolves against a data-testid in the renderer game shell', () => {
        const pomSource = readFileSync(path.join(workspaceRoot, 'e2e/pages/GamePage.ts'), 'utf-8');
        const rendererSources = [
            readFileSync(
                path.join(workspaceRoot, 'renderer/components/shell/GameShell.tsx'),
                'utf-8',
            ),
            readFileSync(
                path.join(workspaceRoot, 'renderer/components/scene/SceneRouter.tsx'),
                'utf-8',
            ),
            readFileSync(
                path.join(workspaceRoot, 'renderer/components/scene/TransitionOverlay.tsx'),
                'utf-8',
            ),
            readFileSync(
                path.join(workspaceRoot, 'games/tactics/screens/TacticsDemoBoard.tsx'),
                'utf-8',
            ),
            readFileSync(
                path.join(workspaceRoot, 'games/tactics/screens/TacticsGameHud.tsx'),
                'utf-8',
            ),
            readFileSync(
                path.join(workspaceRoot, 'games/tactics/screens/TacticsGameResultBanner.tsx'),
                'utf-8',
            ),
            readFileSync(
                path.join(workspaceRoot, 'games/tactics/screens/TacticsPostGameSummary.tsx'),
                'utf-8',
            ),
            readFileSync(
                path.join(workspaceRoot, 'renderer/components/shell/perf/PerfHud.tsx'),
                'utf-8',
            ),
        ];
        const rendererSource = rendererSources.join('\n');

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
                `GamePage.ts uses getByTestId('${testId}') but data-testid="${testId}" is absent from renderer/components/shell/GameShell.tsx`,
            ).toContain(`data-testid="${testId}"`);
        }
    });
});
