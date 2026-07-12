import { afterEach, describe, expect, it } from 'vitest';

import { createDebugI18nStore, useDebugI18nStore } from './debugI18nStore';

afterEach(() => {
    // Reset the module singleton so tests don't leak the flag into each other.
    useDebugI18nStore.getState().setShowTranslationTokens(false);
});

describe('debugI18nStore', () => {
    it('defaults showTranslationTokens to false', () => {
        const store = createDebugI18nStore();
        expect(store.getState().showTranslationTokens).toBe(false);
    });

    it('setShowTranslationTokens flips the flag', () => {
        const store = createDebugI18nStore();

        store.getState().setShowTranslationTokens(true);
        expect(store.getState().showTranslationTokens).toBe(true);

        store.getState().setShowTranslationTokens(false);
        expect(store.getState().showTranslationTokens).toBe(false);
    });

    it('exposes the flag through the singleton hook accessors', () => {
        expect(useDebugI18nStore.getState().showTranslationTokens).toBe(false);
        useDebugI18nStore.getState().setShowTranslationTokens(true);
        expect(useDebugI18nStore.getState().showTranslationTokens).toBe(true);
    });

    it('notifies subscribers when the flag changes', () => {
        const store = createDebugI18nStore();
        const seen: boolean[] = [];
        const unsubscribe = store.subscribe((state) => seen.push(state.showTranslationTokens));

        store.getState().setShowTranslationTokens(true);
        unsubscribe();
        store.getState().setShowTranslationTokens(false);

        expect(seen).toEqual([true]);
    });
});
