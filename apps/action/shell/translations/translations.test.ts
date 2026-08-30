import { describe, expect, it } from 'vitest';

import { actionMainMenuDefinition } from '../main-menu.js';
import { actionBundleEn } from './en.js';
import { ACTION_KEYS } from './keys.js';

// Three spellings of the same token set have to agree, and no two of them can
// import each other: the catalogue reaches the renderer i18n barrel, the bundle
// is zero-import pure data, and `main-menu.ts` is boundary-restricted and
// writes raw strings. This is where they meet — a token that exists in one and
// not the others renders as its own raw key to the player, which nothing else
// in the suite would notice.

/** Every `game.action.*` token the menu definition names, wherever it names it. */
function menuTokens(): readonly string[] {
    const tokens: string[] = [];
    for (const button of actionMainMenuDefinition.buttons) {
        for (const candidate of [
            button.label,
            button.confirm?.title,
            button.confirm?.body,
            button.confirm?.confirmLabel,
            button.confirm?.cancelLabel,
        ]) {
            if (typeof candidate === 'string' && candidate.startsWith('game.action.')) {
                tokens.push(candidate);
            }
        }
    }
    return tokens;
}

const bundleGameKeys = Object.keys(actionBundleEn).filter((key) => key.startsWith('game.action.'));

describe('action translation bundle', () => {
    it('carries a string for every token in the catalogue', () => {
        for (const key of Object.keys(ACTION_KEYS)) {
            expect(actionBundleEn[key], key).toBeTypeOf('string');
        }
    });

    it('declares no token the catalogue does not', () => {
        // A stray key is dead copy: nothing resolves it, so an edit to it is
        // invisible and the token it was meant to replace stays untranslated.
        expect(bundleGameKeys.sort()).toEqual(Object.keys(ACTION_KEYS).sort());
    });

    it('carries a string for every token the MENU names', () => {
        // The menu cannot import the catalogue, so this is the only place the
        // two spellings are compared.
        const tokens = menuTokens();

        expect(tokens.length).toBeGreaterThan(0);
        for (const token of tokens) {
            expect(actionBundleEn[token], token).toBeTypeOf('string');
        }
    });

    it('leaves no token blank', () => {
        for (const [key, value] of Object.entries(actionBundleEn)) {
            expect(value.trim(), key).not.toBe('');
        }
    });

    it('namespaces every token under this game, overriding no engine token', () => {
        // Invariant #11 reserves `engine.`; this app has no engine copy it wants
        // to re-word, so an `engine.*` key here would be an override nobody asked
        // for.
        for (const key of Object.keys(actionBundleEn)) {
            expect(key, key).toMatch(/^game\.action\./u);
        }
    });

    it('keys the catalogue by each token’s own string', () => {
        for (const [key, value] of Object.entries(ACTION_KEYS)) {
            expect(value, key).toBe(key);
        }
    });
});
