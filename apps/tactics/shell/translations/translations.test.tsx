// @vitest-environment jsdom

// apps/tactics/shell/translations/translations.test.ts
//
// Parity coverage for the Tactics translation catalogue + its EN/CS bundles.
// Mirrors the engine parity test (renderer/i18n/engine-bundle.en.test.ts): the
// two locale bundles and the token catalogue (TACTICS_KEYS) must declare the
// exact same key set, no key may resolve to an empty template, every key stays in
// the reserved namespace, and the bundles resolve/format through the real
// runtime.
//
// ICU/interpolation is exercised through the public I18nProvider → useTranslate
// path (which internally runs the real formatMessage under the effective locale),
// since the barrel intentionally does not export the formatter directly.

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import type { GameLanguage } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';
import {
    I18nProvider,
    resolveTranslation,
    translationKey,
    useTranslate,
    type MessageParams,
    type TranslationBundle,
} from '@chimera-engine/renderer/i18n';

import { tacticsBundleCs } from './cs.js';
import { tacticsBundleEn } from './en.js';
import { TACTICS_KEYS } from './keys.js';

const catalogueKeys = new Set<string>(Object.values(TACTICS_KEYS));
const enKeys = new Set<string>(Object.keys(tacticsBundleEn));
const csKeys = new Set<string>(Object.keys(tacticsBundleCs));

const TACTICS_LANGUAGES: readonly GameLanguage[] = [
    { code: 'en-US', label: 'English' },
    { code: 'cs-CZ', label: 'Čeština' },
];

// Renders one translated key through the real hook → context → provider path so
// ICU/interpolation runs under the effective locale, exactly as a component does.
function Translated({
    tKey,
    params,
}: {
    readonly tKey: string;
    readonly params?: MessageParams;
}): React.ReactElement {
    const t = useTranslate();
    return <span data-testid="out">{t(translationKey(tKey), params)}</span>;
}

function renderTactics(
    locale: string,
    bundle: TranslationBundle,
    tKey: string,
    params?: MessageParams,
): string {
    render(
        <I18nProvider locale={locale} languages={TACTICS_LANGUAGES} gameOverride={bundle}>
            <Translated tKey={tKey} {...(params !== undefined ? { params } : {})} />
        </I18nProvider>,
    );
    return screen.getByTestId('out').textContent ?? '';
}

afterEach(() => {
    cleanup();
});

describe('tactics bundle ↔ catalogue parity', () => {
    it('has an English template for every catalogue key (no missing keys)', () => {
        const missing = [...catalogueKeys].filter((key) => tacticsBundleEn[key] === undefined);
        expect(missing).toEqual([]);
    });

    it('has a Czech template for every catalogue key (no missing keys)', () => {
        const missing = [...catalogueKeys].filter((key) => tacticsBundleCs[key] === undefined);
        expect(missing).toEqual([]);
    });

    it('has no English bundle key absent from the catalogue (only the engine override is exempt)', () => {
        const orphans = [...enKeys].filter(
            (key) => !catalogueKeys.has(key) && key !== 'engine.chat.title',
        );
        expect(orphans).toEqual([]);
    });

    it('declares exactly the same key set in the EN and CS bundles', () => {
        expect([...enKeys].sort()).toEqual([...csKeys].sort());
    });

    it('carries the engine.chat.title override in both locales', () => {
        expect(enKeys.has('engine.chat.title')).toBe(true);
        expect(csKeys.has('engine.chat.title')).toBe(true);
    });
});

describe('tactics bundle values', () => {
    it('never maps a key to an empty template in either locale', () => {
        const emptyEn = Object.entries(tacticsBundleEn)
            .filter(([, template]) => template === '')
            .map(([key]) => key);
        const emptyCs = Object.entries(tacticsBundleCs)
            .filter(([, template]) => template === '')
            .map(([key]) => key);
        expect(emptyEn).toEqual([]);
        expect(emptyCs).toEqual([]);
    });

    it('keeps every key in the reserved game.tactics/engine namespace', () => {
        const shape = /^(game\.tactics|engine)\./;
        const malformedEn = Object.keys(tacticsBundleEn).filter((key) => !shape.test(key));
        const malformedCs = Object.keys(tacticsBundleCs).filter((key) => !shape.test(key));
        expect(malformedEn).toEqual([]);
        expect(malformedCs).toEqual([]);
    });
});

describe('tactics bundle resolution through the runtime', () => {
    it('resolves an English token via resolveTranslation with source "game"', () => {
        const resolved = resolveTranslation(
            { locale: 'en-US', engineDefault: {}, gameOverride: tacticsBundleEn },
            translationKey('game.tactics.hud.endTurn'),
        );
        expect(resolved).toEqual({ template: 'End Turn', source: 'game' });
    });

    it('resolves a Czech token via resolveTranslation with source "game"', () => {
        const resolved = resolveTranslation(
            { locale: 'cs-CZ', engineDefault: {}, gameOverride: tacticsBundleCs },
            translationKey('game.tactics.hud.endTurn'),
        );
        expect(resolved).toEqual({ template: 'Ukončit tah', source: 'game' });
    });

    it('lets the Tactics override win over the engine chat title in both locales', () => {
        const en = resolveTranslation(
            {
                locale: 'en-US',
                engineDefault: { 'engine.chat.title': 'Chat' },
                gameOverride: tacticsBundleEn,
            },
            translationKey('engine.chat.title'),
        );
        const cs = resolveTranslation(
            {
                locale: 'cs-CZ',
                engineDefault: { 'engine.chat.title': 'Chat' },
                gameOverride: tacticsBundleCs,
            },
            translationKey('engine.chat.title'),
        );
        expect(en).toEqual({ template: 'Match chat', source: 'game' });
        expect(cs).toEqual({ template: 'Zápasový chat', source: 'game' });
    });
});

describe('tactics bundle ICU templates (rendered through the provider)', () => {
    it('interpolates the reveal overlay params in both locales', () => {
        expect(
            renderTactics('en-US', tacticsBundleEn, 'game.tactics.board.revealed', {
                player: 'p1',
                actions: 'move',
            }),
        ).toBe('Revealed p1: move');
        cleanup();
        expect(
            renderTactics('cs-CZ', tacticsBundleCs, 'game.tactics.board.revealed', {
                player: 'p1',
                actions: 'move',
            }),
        ).toBe('Odhaleno p1: move');
    });

    it('interpolates the ready-summary counts in both locales', () => {
        expect(
            renderTactics('en-US', tacticsBundleEn, 'game.tactics.lobby.readySummary', {
                ready: 1,
                total: 2,
            }),
        ).toBe('Ready: 1/2');
        cleanup();
        expect(
            renderTactics('cs-CZ', tacticsBundleCs, 'game.tactics.lobby.readySummary', {
                ready: 1,
                total: 2,
            }),
        ).toBe('Připraveni: 1/2');
    });

    it('interpolates the AI player name in both locales and the remove label in English', () => {
        expect(
            renderTactics('en-US', tacticsBundleEn, 'game.tactics.lobby.aiPlayerName', { n: 3 }),
        ).toBe('AI Player 3');
        cleanup();
        expect(
            renderTactics('cs-CZ', tacticsBundleCs, 'game.tactics.lobby.aiPlayerName', { n: 3 }),
        ).toBe('Hráč AI 3');
        cleanup();
        expect(
            renderTactics('en-US', tacticsBundleEn, 'game.tactics.lobby.removeAiAriaLabel', {
                n: 3,
            }),
        ).toBe('Remove AI Player 3');
    });
});
