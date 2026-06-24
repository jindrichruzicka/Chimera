/**
 * Cross-reference guard: asserts every `getByTestId` string in LobbyPage.ts
 * has a matching `data-testid="..."` attribute in the renderer lobby source
 * files. Lobby locators span several sources:
 *   - renderer/app/lobby/page.tsx  (host, confirm)
 *   - renderer/app/lobby/LobbyEntryTabs.tsx  (join, address)
 *   - renderer/components/shell/ConnectionStatusIndicator.tsx  (connection-status)
 *   - apps/tactics/shell/TacticsLobbyScreen.tsx  (tactics-lobby-screen,
 *     tactics-lobby-player, tactics-ready-toggle, start, leave) — the
 *     registry-loaded lobby screen that actually renders for a Tactics lobby,
 *     replacing the engine default for Tactics (#702).
 *   - renderer/app/lobby/ActiveLobbyPanel.tsx  (start, leave) — the engine-default
 *     fallback rendered only for a game that ships no custom LobbyScreen; kept in
 *     the scan so the guard also covers that path.
 *
 * This prevents silent POM/renderer testid drift — the same class of bug that
 * caused BLOCK-1 in the F31 review (documented in
 * SettingsPage.testid-alignment.test.ts).
 *
 * @chimera-review: intentional filesystem access — structural alignment guard;
 *   mocking defeats the purpose (cf. vitest-config-filename-guard.test.ts).
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');

describe('LobbyPage POM — testid alignment with renderer', () => {
    it('every getByTestId call in LobbyPage.ts resolves against a data-testid in the renderer lobby sources', () => {
        const pomSource = readFileSync(
            path.join(workspaceRoot, 'apps/tactics/e2e/pages/LobbyPage.ts'),
            'utf-8',
        );

        // LobbyPage locators are distributed across several source files.
        const rendererSources = [
            path.join(workspaceRoot, 'renderer/app/lobby/page.tsx'),
            path.join(workspaceRoot, 'renderer/app/lobby/LobbyEntryTabs.tsx'),
            path.join(workspaceRoot, 'renderer/app/lobby/ActiveLobbyPanel.tsx'),
            path.join(workspaceRoot, 'renderer/components/shell/ConnectionStatusIndicator.tsx'),
            path.join(workspaceRoot, 'apps/tactics/shell/TacticsLobbyScreen.tsx'),
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
            const dataAttributeLiteral = `data-testid="${testId}"`;
            const tabTestIdLiteral = `testId: '${testId}'`;
            const hasMatchingRendererTestId =
                rendererSources.includes(dataAttributeLiteral) ||
                rendererSources.includes(tabTestIdLiteral);

            expect(
                hasMatchingRendererTestId,
                `LobbyPage.ts uses getByTestId('${testId}') but data-testid="${testId}" is absent from renderer lobby sources`,
            ).toBe(true);
        }
    });
});
