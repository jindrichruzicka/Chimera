/**
 * Unit tests for ComponentGalleryPage POM.
 *
 * TDD red phase: tests are written before the implementation file exists.
 * Architecture: §13, §4.35, §4.37 — E2E page object conventions; no real
 * Electron launch; no game module imports.
 *
 * Invariant #93: no game token override CSS imported here.
 * Invariant #94: no games/* imports.
 */

import { describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { ComponentGalleryPage } from './ComponentGalleryPage';

interface ChainableLocator {
    click: () => Promise<void>;
    waitFor: (options?: { state?: string }) => Promise<void>;
    getByRole: (role: string, options?: { name?: string | RegExp }) => ChainableLocator;
    getByTestId: (testId: string) => ChainableLocator;
    locator: (selector: string) => ChainableLocator;
}

interface TestPage {
    goto: (url: string) => Promise<null>;
    getByTestId: (testId: string) => ChainableLocator;
    getByRole: (role: string, options?: { name?: string | RegExp }) => ChainableLocator;
    locator: (selector: string) => ChainableLocator;
}

const buildPageDouble = (): {
    readonly page: Page;
    readonly requestedTestIds: string[];
    readonly requestedRoles: { role: string; options?: { name?: string | RegExp } }[];
    readonly visitedUrls: string[];
    readonly clickedTestIds: string[];
    readonly waitedTestIds: string[];
} => {
    const requestedTestIds: string[] = [];
    const requestedRoles: { role: string; options?: { name?: string | RegExp } }[] = [];
    const visitedUrls: string[] = [];
    const clickedTestIds: string[] = [];
    const waitedTestIds: string[] = [];

    const createLocator = (id: string): ChainableLocator => ({
        click: async (): Promise<void> => {
            clickedTestIds.push(id);
        },
        waitFor: async (): Promise<void> => {
            waitedTestIds.push(id);
        },
        getByRole: (role: string, _options?: { name?: string | RegExp }): ChainableLocator =>
            createLocator(`${id}:sub-role:${role}`),
        getByTestId: (testId: string): ChainableLocator =>
            createLocator(`${id}:sub-testid:${testId}`),
        locator: (selector: string): ChainableLocator =>
            createLocator(`${id}:sub-locator:${selector}`),
    });

    const page: TestPage = {
        goto: async (url: string): Promise<null> => {
            visitedUrls.push(url);
            return null;
        },
        getByTestId: (testId: string): ChainableLocator => {
            requestedTestIds.push(testId);
            return createLocator(testId);
        },
        getByRole: (role: string, options?: { name?: string | RegExp }): ChainableLocator => {
            requestedRoles.push(options ? { role, options } : { role });
            return createLocator(`role:${role}`);
        },
        locator: (selector: string): ChainableLocator => createLocator(selector),
    };

    return {
        page: page as unknown as Page,
        requestedTestIds,
        requestedRoles,
        visitedUrls,
        clickedTestIds,
        waitedTestIds,
    };
};

describe('ComponentGalleryPage', () => {
    it('binds root locator using data-testid="component-gallery"', () => {
        const { page, requestedTestIds } = buildPageDouble();

        const galleryPage = new ComponentGalleryPage(page);

        expect(galleryPage.root).toBeDefined();
        expect(requestedTestIds).toContain('component-gallery');
    });

    it('binds modalTrigger using data-testid="gallery-open-modal"', () => {
        const { page, requestedTestIds } = buildPageDouble();

        new ComponentGalleryPage(page);

        expect(requestedTestIds).toContain('gallery-open-modal');
    });

    it('binds drawerTrigger using data-testid="gallery-open-drawer"', () => {
        const { page, requestedTestIds } = buildPageDouble();

        new ComponentGalleryPage(page);

        expect(requestedTestIds).toContain('gallery-open-drawer');
    });

    it('binds drawerDialog using data-testid="gallery-drawer"', () => {
        const { page, requestedTestIds } = buildPageDouble();

        new ComponentGalleryPage(page);

        expect(requestedTestIds).toContain('gallery-drawer');
    });

    it('binds primaryButton using data-testid="gallery-button-primary"', () => {
        const { page, requestedTestIds } = buildPageDouble();

        new ComponentGalleryPage(page);

        expect(requestedTestIds).toContain('gallery-button-primary');
    });

    it('navigates to /component-gallery/ through the Electron renderer protocol', async () => {
        const { page, visitedUrls } = buildPageDouble();
        const galleryPage = new ComponentGalleryPage(page);

        await galleryPage.goto();

        expect(visitedUrls).toEqual(['chimera://renderer/component-gallery/']);
    });

    it('clickTabActions clicks the Actions role=tab', async () => {
        const { page, clickedTestIds, requestedRoles } = buildPageDouble();
        const galleryPage = new ComponentGalleryPage(page);

        await galleryPage.clickTabActions();

        expect(requestedRoles.some((r) => r.role === 'tab')).toBe(true);
        expect(clickedTestIds.some((id) => id.includes('tab'))).toBe(true);
    });

    it('clickTabOverlays clicks the Overlays role=tab', async () => {
        const { page, requestedRoles } = buildPageDouble();
        const galleryPage = new ComponentGalleryPage(page);

        await galleryPage.clickTabOverlays();

        expect(
            requestedRoles.some(
                (r) =>
                    r.role === 'tab' && String(r.options?.name).toLowerCase().includes('overlay'),
            ),
        ).toBe(true);
    });

    it('clickTabForms clicks the Forms role=tab', async () => {
        const { page, requestedRoles } = buildPageDouble();
        const galleryPage = new ComponentGalleryPage(page);

        await galleryPage.clickTabForms();

        expect(
            requestedRoles.some(
                (r) => r.role === 'tab' && String(r.options?.name).toLowerCase().includes('form'),
            ),
        ).toBe(true);
    });

    it('openModal clicks gallery-open-modal trigger', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const galleryPage = new ComponentGalleryPage(page);

        await galleryPage.openModal();

        expect(clickedTestIds).toContain('gallery-open-modal');
    });

    it('openDrawer first switches to Overlays tab then clicks gallery-open-drawer', async () => {
        const { page, clickedTestIds } = buildPageDouble();
        const galleryPage = new ComponentGalleryPage(page);

        await galleryPage.openDrawer();

        expect(clickedTestIds).toContain('gallery-open-drawer');
    });
});
