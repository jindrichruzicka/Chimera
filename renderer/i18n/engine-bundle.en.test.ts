import { describe, expect, it } from 'vitest';

import { engineBundleEn } from './engine-bundle.en.js';
import { ENGINE_KEYS } from './engine-keys.js';
import { formatMessage } from './format-message.js';
import { resolveTranslation, translationKey } from './translation-bundle.js';

// The set of raw key strings the catalogue declares. ENGINE_KEYS is the flat
// aggregate of every grouped area map; its values are branded TranslationKeys,
// which are structurally strings.
const catalogueKeys = new Set<string>(Object.values(ENGINE_KEYS));
const bundleKeys = new Set<string>(Object.keys(engineBundleEn));

// A template "carries an ICU construct" when it contains a `plural`/`select`
// keyword inside a placeholder. We render each such template with a benign
// param set and assert the result is not the raw template — a malformed
// construct (e.g. a missing required `other` branch) makes formatMessage
// fall back to the raw text, which this catches.
const ICU_CONSTRUCT = /\{[^}]*,\s*(?:plural|select)\s*,/;

describe('engineBundleEn ↔ ENGINE_KEYS parity', () => {
    it('has a template for every catalogue key (no missing keys)', () => {
        const missing = [...catalogueKeys].filter((key) => engineBundleEn[key] === undefined);
        expect(missing).toEqual([]);
    });

    it('has no bundle key absent from the catalogue (no orphans)', () => {
        const orphans = [...bundleKeys].filter((key) => !catalogueKeys.has(key));
        expect(orphans).toEqual([]);
    });

    it('declares exactly the same key set in catalogue and bundle', () => {
        expect([...bundleKeys].sort()).toEqual([...catalogueKeys].sort());
    });

    it('never maps a key to an empty template (empty strings resolve as present and would mask a gap)', () => {
        const empties = Object.entries(engineBundleEn)
            .filter(([, template]) => template === '')
            .map(([key]) => key);
        expect(empties).toEqual([]);
    });
});

describe('engineBundleEn namespace convention', () => {
    it('keys all use the reserved dotted engine.<area>.<name> shape', () => {
        // engine.<area>.<name…> — a reserved `engine` root, a lowercase-initial
        // area segment, then one or more dot-separated name segments.
        const shape = /^engine\.[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z][a-zA-Z0-9]*)+$/;
        const malformed = Object.keys(engineBundleEn).filter((key) => !shape.test(key));
        expect(malformed).toEqual([]);
    });
});

describe('engineBundleEn resolution through the runtime', () => {
    it('resolves an engine token via resolveTranslation with source "engine"', () => {
        const resolved = resolveTranslation(
            { locale: 'en', engineDefault: engineBundleEn },
            translationKey('engine.menu.play'),
        );
        expect(resolved).toEqual({ template: 'Play', source: 'engine' });
    });

    it('lets a game override win over the engine default when it re-keys the same token', () => {
        const resolved = resolveTranslation(
            {
                locale: 'en',
                engineDefault: engineBundleEn,
                gameOverride: { 'engine.chat.title': 'Match chat' },
            },
            translationKey('engine.chat.title'),
        );
        expect(resolved).toEqual({ template: 'Match chat', source: 'game' });
    });
});

describe('engineBundleEn ICU templates', () => {
    it('formats the saves slot-count plural for the "one" and "other" categories', () => {
        const template = engineBundleEn['engine.saves.slotCount'];
        expect(template).toBeDefined();
        expect(formatMessage(template!, { n: 1 })).toBe('1 save');
        expect(formatMessage(template!, { n: 3 })).toBe('3 saves');
    });

    it('formats the replay tick-count plural for the "one" and "other" categories', () => {
        const template = engineBundleEn['engine.replays.ticksSuffix'];
        expect(template).toBeDefined();
        expect(formatMessage(template!, { n: 1 })).toBe('1 tick');
        expect(formatMessage(template!, { n: 42 })).toBe('42 ticks');
    });

    it('interpolates a named param into the player-left toast', () => {
        const template = engineBundleEn['engine.toast.playerLeftGame'];
        expect(template).toBeDefined();
        expect(formatMessage(template!, { displayName: 'Ada' })).toBe('Ada left game.');
    });

    it('interpolates a named param into the profile-rejected toast prefix', () => {
        const template = engineBundleEn['engine.toast.profileRejectedPrefix'];
        expect(template).toBeDefined();
        expect(formatMessage(template!, { reason: 'display name is too long' })).toBe(
            'Profile rejected: display name is too long',
        );
    });

    it('renders every ICU-bearing template without falling back to raw text', () => {
        // A benign param bag: any pivot/name a template references resolves to a
        // finite number or a string, so a well-formed template always produces a
        // string different from its own source. Malformed constructs (missing
        // `other`, unbalanced braces) fall back to the raw template — caught here.
        const params = {
            n: 2,
            reconnected: 1,
            total: 2,
            connected: 1,
            expected: 2,
            count: 2,
            displayName: 'x',
            reason: 'x',
            title: 'x',
            message: 'x',
            error: 'x',
            crashId: 'x',
            status: 'x',
            code: 'x',
            recorded: 'x',
            label: 'x',
        };
        const rawFallbacks = Object.entries(engineBundleEn)
            .filter(([, template]) => ICU_CONSTRUCT.test(template))
            .filter(([, template]) => formatMessage(template, params) === template)
            .map(([key]) => key);
        expect(rawFallbacks).toEqual([]);
    });
});
