/**
 * Cross-reference guard: asserts every `getByTestId` string in
 * ModelShowcasePage.ts has a matching `data-testid="..."` attribute in the
 * screen source (TacticsModelShowcaseScreen.tsx).
 *
 * Same drift-prevention guard as MainMenuPage / LobbyPage / SettingsPage /
 * ComponentGalleryPage. It matters more here than usual: the model-showcase
 * route is exercised by exactly ONE e2e spec, so a renamed testid would
 * otherwise surface only in a full Playwright run — the most expensive gate in
 * the repo.
 *
 * Intentional filesystem access — mocking defeats the structural alignment
 * purpose.
 *
 * @chimera-review: intentional filesystem access — structural alignment guard.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');
const SCREEN_SOURCE_PATH = 'apps/tactics/screens/TacticsModelShowcaseScreen.tsx';

function readSource(relativePath: string): string {
    return readFileSync(path.join(workspaceRoot, relativePath), 'utf-8');
}

describe('ModelShowcasePage POM — testid alignment with the screen', () => {
    it('every getByTestId call in ModelShowcasePage.ts resolves against a data-testid in the screen', () => {
        const pomSource = readSource('apps/tactics/e2e/pages/ModelShowcasePage.ts');
        const screenSource = readSource(SCREEN_SOURCE_PATH);

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
                screenSource,
                `ModelShowcasePage.ts uses getByTestId('${testId}') but data-testid="${testId}" is absent from ${SCREEN_SOURCE_PATH}`,
            ).toContain(`data-testid="${testId}"`);
        }
    });

    it('the screen root testid the page object locates is present in the screen', () => {
        expect(
            readSource(SCREEN_SOURCE_PATH),
            `data-testid="tactics-model-showcase" must be present in ${SCREEN_SOURCE_PATH}`,
        ).toContain('data-testid="tactics-model-showcase"');
    });

    it('the status testid every scene-graph assertion reads is present in the screen', () => {
        expect(
            readSource(SCREEN_SOURCE_PATH),
            `data-testid="tactics-model-showcase-status" must be present in ${SCREEN_SOURCE_PATH}`,
        ).toContain('data-testid="tactics-model-showcase-status"');
    });

    it('the route the page object navigates to exists in the app router tree', () => {
        // `goto()` builds a chimera:// URL by hand, so nothing else ties the
        // page object to the route directory; a renamed directory would 404 at
        // runtime only.
        expect(readSource('apps/tactics/e2e/pages/ModelShowcasePage.ts')).toContain(
            '/model-showcase/',
        );
        expect(() => readSource('apps/tactics/renderer/app/model-showcase/page.tsx')).not.toThrow();
    });
});
