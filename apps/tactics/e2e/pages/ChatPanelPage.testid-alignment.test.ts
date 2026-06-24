/**
 * Cross-reference guard: asserts every literal `getByTestId('...')` string in
 * ChatPanelPage.ts has a matching `data-testid="..."` attribute in the renderer
 * chat sources. ChatPanelPage locators span two sources:
 *   - renderer/components/chat/ChatPanel.tsx  (panel, messages, body input,
 *     send error, empty/loading)
 *   - apps/tactics/screens/TacticsGameHud.tsx  (in-match toggle + drawer)
 *
 * Prevents silent POM/renderer test-id drift (cf. LobbyPage.testid-alignment.test.ts).
 *
 * @chimera-review: intentional filesystem access — structural alignment guard;
 *   mocking defeats the purpose.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');

describe('ChatPanelPage POM — testid alignment with renderer', () => {
    it('every literal getByTestId call in ChatPanelPage.ts resolves against a data-testid in the chat sources', () => {
        const pomSource = readFileSync(
            path.join(workspaceRoot, 'apps/tactics/e2e/pages/ChatPanelPage.ts'),
            'utf-8',
        );

        const rendererSources = [
            path.join(workspaceRoot, 'renderer/components/chat/ChatPanel.tsx'),
            path.join(workspaceRoot, 'apps/tactics/screens/TacticsGameHud.tsx'),
        ]
            .map((p) => readFileSync(p, 'utf-8'))
            .join('\n');

        const testIdPattern = /getByTestId\('([^']+)'\)/g;
        const pomTestIds: string[] = [];
        let match: RegExpExecArray | null;
        while ((match = testIdPattern.exec(pomSource)) !== null) {
            const captured = match[1];
            if (captured !== undefined) pomTestIds.push(captured);
        }

        expect(pomTestIds.length).toBeGreaterThan(0);

        for (const testId of pomTestIds) {
            const hasMatchingRendererTestId = rendererSources.includes(`data-testid="${testId}"`);
            expect(
                hasMatchingRendererTestId,
                `ChatPanelPage.ts uses getByTestId('${testId}') but data-testid="${testId}" is absent from the renderer chat sources`,
            ).toBe(true);
        }
    });
});
