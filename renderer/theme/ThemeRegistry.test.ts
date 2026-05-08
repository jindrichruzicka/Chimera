import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultTheme } from './default-theme';
import * as ThemeRegistryModule from './ThemeRegistry';
import { ThemeRegistry } from './ThemeRegistry';
import { ThemeRegistryTestHelpers } from './__test-support__/ThemeRegistry.test-helpers';
import type { ThemeDefinition } from './types';
import { themeId } from './types';

const testTheme: ThemeDefinition = {
    ...defaultTheme,
    id: themeId('test-override'),
    name: 'Test Override',
};

describe('ThemeRegistry', () => {
    afterEach(() => {
        // Clean up any themes registered during tests
        ThemeRegistryTestHelpers.reset();
    });

    beforeEach(() => {
        ThemeRegistryTestHelpers.reset();
    });

    it('pre-registers the engine-default theme', () => {
        expect(ThemeRegistry.get(themeId('engine-default'))).toBe(defaultTheme);
    });

    it('does not export test helpers from the production module', () => {
        expect('ThemeRegistryTestHelpers' in ThemeRegistryModule).toBe(false);
    });

    it('returns undefined for an unregistered id', () => {
        expect(ThemeRegistry.get(themeId('no-such-theme'))).toBeUndefined();
    });

    it('stores and retrieves a registered theme by id', () => {
        ThemeRegistry.register(testTheme.id, testTheme);

        expect(ThemeRegistry.get(testTheme.id)).toBe(testTheme);
    });

    it('overrides an existing theme when registered with the same id', () => {
        const overrideA: ThemeDefinition = { ...defaultTheme, id: themeId('dupe'), name: 'A' };
        const overrideB: ThemeDefinition = { ...defaultTheme, id: themeId('dupe'), name: 'B' };

        ThemeRegistry.register(overrideA.id, overrideA);
        ThemeRegistry.register(overrideB.id, overrideB);

        expect(ThemeRegistry.get(themeId('dupe'))).toBe(overrideB);
    });

    it('reset restores only the engine-default theme', () => {
        ThemeRegistry.register(testTheme.id, testTheme);
        ThemeRegistryTestHelpers.reset();

        expect(ThemeRegistry.get(testTheme.id)).toBeUndefined();
        expect(ThemeRegistry.get(themeId('engine-default'))).toBe(defaultTheme);
    });
});
