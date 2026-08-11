/**
 * renderer/components/shell/GameScreenRegistry.test.ts
 *
 * Pins the shell's re-export surface for the game-screen contract.
 *
 * Architecture reference: §4.33–§4.36 — GameScreenRegistry / GameShell
 *
 * Two independent halves, because either alone is half a pin:
 *
 *   1. The `binds every re-exported name` case below binds each name in a typed
 *      position, so a name missing from the re-export list reds
 *      `tsc -p renderer/tsconfig.json`. A census alone would not — it reads text
 *      and never resolves a type.
 *   2. A census of the module's own export declarations asserts the EXACT set,
 *      so an accidental widening of this module reds too. Binding alone would
 *      not — an extra re-export is invisible to a consumer that never names it.
 *
 * The census is parity with THIS FILE's declared surface, deliberately not with
 * `game-screen-contract.ts`'s export list. Six of the contract's names stay
 * unexported here: `InGameMenuProps`, `GameEventAudioBinding`,
 * `GameResultOutcome` and `resolveGameResultOutcome`, and the two static cover
 * forms `GameLoadingMessage` / `GameLoadingImage`, which are reachable through
 * the `GameLoadingScreen` union. A parity assertion against the contract would
 * force all six and is exactly what this test must not do.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import type {
    GameHudProps,
    GameLoadingScreen,
    GameLoadingScreenProps,
    GameResultBannerProps,
    GameScreenComponent,
    GameScreenProps,
    GameScreenRegistry,
    SceneLoadingReason,
    SendAction,
    TransitionOverlayProps,
} from './GameScreenRegistry.js';

const SOURCE_PATH = resolve(dirname(fileURLToPath(import.meta.url)), 'GameScreenRegistry.ts');

/**
 * Every name this module is required to carry. Sorted, and asserted as the whole
 * set — see the header for why parity is with this file and not the contract.
 */
const EXPECTED_RE_EXPORTS: readonly string[] = [
    'GameHudProps',
    'GameLoadingScreen',
    'GameLoadingScreenProps',
    'GameResultBannerProps',
    'GameScreenComponent',
    'GameScreenProps',
    'GameScreenRegistry',
    'SceneLoadingReason',
    'SendAction',
    'TransitionOverlayProps',
];

/**
 * Names a module exports, read off the AST rather than matched with a regex: an
 * `export { … }` clause spans lines, renames with `as`, and is spelled nothing
 * like an `export interface`.
 *
 * A star re-export contributes the sentinel `'*'`, never nothing — it forwards an
 * unknowable set, so a set assertion must fail loudly rather than read as "no
 * extra names".
 */
function listExportedNames(source: string): readonly string[] {
    const parsed = ts.createSourceFile('module.ts', source, ts.ScriptTarget.ESNext, true);
    const names: string[] = [];

    for (const statement of parsed.statements) {
        if (ts.isExportDeclaration(statement)) {
            if (statement.exportClause === undefined) {
                names.push('*');
            } else if (ts.isNamedExports(statement.exportClause)) {
                for (const element of statement.exportClause.elements) {
                    names.push(element.name.text);
                }
            } else {
                // `export * as ns from '…'` — one bound namespace name.
                names.push(statement.exportClause.name.text);
            }
            continue;
        }
        if (!hasExportModifier(statement)) {
            continue;
        }
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) {
                    names.push(declaration.name.text);
                }
            }
            continue;
        }
        const named = statement as ts.DeclarationStatement;
        if (named.name !== undefined && ts.isIdentifier(named.name)) {
            names.push(named.name.text);
        }
    }

    return names;
}

function hasExportModifier(statement: ts.Statement): boolean {
    return (
        ts.canHaveModifiers(statement) &&
        (ts.getModifiers(statement) ?? []).some(
            (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
        )
    );
}

// ─── The scanner itself ───────────────────────────────────────────────────────

describe('listExportedNames', () => {
    it('reads a multi-line type re-export clause', () => {
        expect(
            listExportedNames(`export type {\n    Alpha,\n    Beta,\n} from './contract.js';\n`),
        ).toEqual(['Alpha', 'Beta']);
    });

    it('reports the exported name of a renamed re-export, not the local one', () => {
        expect(listExportedNames(`export type { Local as Public } from './c.js';`)).toEqual([
            'Public',
        ]);
    });

    it('reports a star re-export as an unknowable set rather than as nothing', () => {
        expect(listExportedNames(`export * from './c.js';`)).toEqual(['*']);
    });

    it('reports the bound name of a namespace re-export', () => {
        expect(listExportedNames(`export * as contract from './c.js';`)).toEqual(['contract']);
    });

    it('reads exported declarations and a local export clause', () => {
        expect(
            listExportedNames(
                `export interface Alpha { readonly a: string }\n` +
                    `export type Beta = string;\n` +
                    `export const gamma = 1;\n` +
                    `function delta(): void {}\n` +
                    `export { delta };\n`,
            ),
        ).toEqual(['Alpha', 'Beta', 'gamma', 'delta']);
    });

    it('reports nothing for an unexported declaration or a bare import', () => {
        expect(listExportedNames(`import type { A } from './c.js';\ntype Hidden = A;\n`)).toEqual(
            [],
        );
    });
});

// ─── The re-export surface ────────────────────────────────────────────────────

describe('renderer shell GameScreenRegistry re-exports', () => {
    it('carries exactly the names in EXPECTED_RE_EXPORTS, and nothing else', () => {
        const exported = [...listExportedNames(readFileSync(SOURCE_PATH, 'utf8'))].sort();

        expect(exported).toEqual([...EXPECTED_RE_EXPORTS].sort());
    });

    it('binds every re-exported name to a real type from the contract', () => {
        const playfield: GameScreenComponent<GameScreenProps> = () => null;
        const hud: GameScreenComponent<GameHudProps> = () => null;
        const gameResultBanner: GameScreenComponent<GameResultBannerProps> = () => null;
        const transitionOverlay: GameScreenComponent<TransitionOverlayProps> = () => null;
        const cover: GameScreenComponent<GameLoadingScreenProps> = () => null;
        const loadingScreen: GameLoadingScreen = 'spinner';
        const reason: SceneLoadingReason = 'code';
        const sendAction: SendAction = () => undefined;

        const registry: GameScreenRegistry = {
            playfield,
            hud,
            gameResultBanner,
            transitionOverlay,
            loadingScreen,
            loadingScreens: { summary: cover },
        };

        expect(registry.playfield).toBe(playfield);
        expect(registry.hud).toBe(hud);
        expect(registry.gameResultBanner).toBe(gameResultBanner);
        expect(registry.transitionOverlay).toBe(transitionOverlay);
        expect(registry.loadingScreen).toBe('spinner');
        expect(registry.loadingScreens?.['summary']).toBe(cover);
        expect(reason).toBe('code');
        expect(sendAction).toBeTypeOf('function');
    });
});
