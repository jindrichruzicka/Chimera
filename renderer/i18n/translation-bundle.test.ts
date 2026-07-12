import { describe, expect, it } from 'vitest';

import {
    resolveTranslation,
    translationKey,
    type ResolvedBundles,
    type TranslationBundle,
} from './translation-bundle.js';

function makeBundles(overrides: Partial<ResolvedBundles> = {}): ResolvedBundles {
    return {
        locale: 'en-US',
        engineDefault: { greeting: 'Hello' },
        ...overrides,
    };
}

describe('resolveTranslation', () => {
    it('prefers the game override when both bundles declare the key', () => {
        const bundles = makeBundles({
            engineDefault: { greeting: 'Engine hello' },
            gameOverride: { greeting: 'Game hello' },
        });
        expect(resolveTranslation(bundles, translationKey('greeting'))).toEqual({
            template: 'Game hello',
            source: 'game',
        });
    });

    it('falls back to the engine default when the override bundle exists but lacks the key', () => {
        const bundles = makeBundles({
            engineDefault: { greeting: 'Engine hello' },
            gameOverride: { farewell: 'Game bye' },
        });
        expect(resolveTranslation(bundles, translationKey('greeting'))).toEqual({
            template: 'Engine hello',
            source: 'engine',
        });
    });

    it('falls back to the engine default when there is no gameOverride at all', () => {
        const bundles = makeBundles({ engineDefault: { greeting: 'Engine hello' } });
        expect(resolveTranslation(bundles, translationKey('greeting'))).toEqual({
            template: 'Engine hello',
            source: 'engine',
        });
    });

    it('returns the raw key with source "missing" when absent from both bundles', () => {
        const bundles = makeBundles({
            engineDefault: { greeting: 'Engine hello' },
            gameOverride: { farewell: 'Game bye' },
        });
        const key = translationKey('unknown-key');
        expect(resolveTranslation(bundles, key)).toEqual({
            template: key,
            source: 'missing',
        });
    });

    it('returns the raw key with source "token-mode" when showTokens is true, ignoring bundle contents entirely', () => {
        const bundles = makeBundles({
            engineDefault: { greeting: 'Engine hello' },
            gameOverride: { greeting: 'Game hello' },
        });
        const key = translationKey('greeting');
        expect(resolveTranslation(bundles, key, true)).toEqual({
            template: key,
            source: 'token-mode',
        });
    });

    it('is deterministic — identical inputs produce equal output', () => {
        const bundles = makeBundles({
            engineDefault: { greeting: 'Engine hello' },
            gameOverride: { greeting: 'Game hello' },
        });
        const key = translationKey('greeting');
        expect(resolveTranslation(bundles, key)).toEqual(resolveTranslation(bundles, key));
    });

    it('does not mutate the input bundles object or its nested bundle objects', () => {
        const engineDefault: TranslationBundle = { greeting: 'Engine hello' };
        const gameOverride: TranslationBundle = { greeting: 'Game hello' };
        const bundles = makeBundles({ engineDefault, gameOverride });

        resolveTranslation(bundles, translationKey('greeting'));
        resolveTranslation(bundles, translationKey('greeting'), true);

        expect(bundles.engineDefault).toEqual({ greeting: 'Engine hello' });
        expect(bundles.gameOverride).toEqual({ greeting: 'Game hello' });
        expect(bundles.engineDefault).toBe(engineDefault);
        expect(bundles.gameOverride).toBe(gameOverride);
    });
});
