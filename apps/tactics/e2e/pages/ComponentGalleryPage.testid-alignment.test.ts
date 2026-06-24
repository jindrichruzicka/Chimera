/**
 * Cross-reference guard: asserts every `getByTestId` string in
 * ComponentGalleryPage.ts has a matching `data-testid="..."` attribute in the
 * renderer source (ComponentGalleryClient.tsx).
 *
 * This is the same class of drift-prevention guard that exists for
 * MainMenuPage, LobbyPage, and SettingsPage. Intentional filesystem access —
 * mocking defeats the structural alignment purpose.
 *
 * @chimera-review: intentional filesystem access — structural alignment guard.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = path.resolve(import.meta.dirname, '../../../..');

describe('ComponentGalleryPage POM — testid alignment with renderer', () => {
    it('every getByTestId call in ComponentGalleryPage.ts resolves against a data-testid in ComponentGalleryClient.tsx', () => {
        const pomSource = readFileSync(
            path.join(workspaceRoot, 'apps/tactics/e2e/pages/ComponentGalleryPage.ts'),
            'utf-8',
        );
        const rendererSource = readFileSync(
            path.join(workspaceRoot, 'renderer/app/component-gallery/ComponentGalleryClient.tsx'),
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
                `ComponentGalleryPage.ts uses getByTestId('${testId}') but data-testid="${testId}" is absent from ComponentGalleryClient.tsx`,
            ).toContain(`data-testid="${testId}"`);
        }
    });

    it('gallery-button-primary testid is present in ComponentGalleryClient.tsx', () => {
        const rendererSource = readFileSync(
            path.join(workspaceRoot, 'renderer/app/component-gallery/ComponentGalleryClient.tsx'),
            'utf-8',
        );

        expect(
            rendererSource,
            'data-testid="gallery-button-primary" must be present in ComponentGalleryClient.tsx',
        ).toContain('data-testid="gallery-button-primary"');
    });

    it('gallery-open-modal testid is present in ComponentGalleryClient.tsx', () => {
        const rendererSource = readFileSync(
            path.join(workspaceRoot, 'renderer/app/component-gallery/ComponentGalleryClient.tsx'),
            'utf-8',
        );

        expect(
            rendererSource,
            'data-testid="gallery-open-modal" must be present in ComponentGalleryClient.tsx',
        ).toContain('data-testid="gallery-open-modal"');
    });

    it('gallery-open-drawer testid is present in ComponentGalleryClient.tsx', () => {
        const rendererSource = readFileSync(
            path.join(workspaceRoot, 'renderer/app/component-gallery/ComponentGalleryClient.tsx'),
            'utf-8',
        );

        expect(
            rendererSource,
            'data-testid="gallery-open-drawer" must be present in ComponentGalleryClient.tsx',
        ).toContain('data-testid="gallery-open-drawer"');
    });

    it('gallery-drawer testid is present in ComponentGalleryClient.tsx', () => {
        const rendererSource = readFileSync(
            path.join(workspaceRoot, 'renderer/app/component-gallery/ComponentGalleryClient.tsx'),
            'utf-8',
        );

        expect(
            rendererSource,
            'data-testid="gallery-drawer" must be present in ComponentGalleryClient.tsx',
        ).toContain('data-testid="gallery-drawer"');
    });
});
