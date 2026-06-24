/**
 * Cross-reference guard: asserts every statically-spelled `getByTestId` string
 * in TacticsLobbyPage.ts has a matching `data-testid="..."` attribute in
 * apps/tactics/shell/TacticsLobbyScreen.tsx. Per-player selects/swatches use
 * template-literal testids (backticks) and are intentionally out of scope for
 * this regex — their static prefixes are exercised by the E2E spec.
 *
 * Prevents silent POM/renderer testid drift (cf. LobbyPage.testid-alignment.test.ts).
 *
 * @chimera-review: intentional filesystem access — structural alignment guard;
 *   mocking defeats the purpose.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');

describe('TacticsLobbyPage POM — testid alignment with renderer', () => {
    it('every getByTestId call in TacticsLobbyPage.ts resolves against a data-testid in TacticsLobbyScreen.tsx', () => {
        const pomSource = readFileSync(
            path.join(workspaceRoot, 'apps/tactics/e2e/pages/TacticsLobbyPage.ts'),
            'utf-8',
        );
        const rendererSource = readFileSync(
            path.join(workspaceRoot, 'apps/tactics/shell/TacticsLobbyScreen.tsx'),
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
                rendererSource.includes(`data-testid="${testId}"`),
                `TacticsLobbyPage.ts uses getByTestId('${testId}') but data-testid="${testId}" is absent from TacticsLobbyScreen.tsx`,
            ).toBe(true);
        }
    });
});
