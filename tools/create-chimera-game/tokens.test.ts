import { describe, expect, it } from 'vitest';
import { normalizeGameName } from './normalize';
import { findLeftoverTokens, renameTokensInPath, substituteTokens } from './tokens';

/**
 * Template files carry named placeholders (`__game_kebab__`, `__GamePascal__`, …) in both
 * their contents and their paths; the scaffolder swaps them for the concrete game casings.
 * These tests cover content substitution, path-segment renaming, idempotency, and the
 * leftover-token check — including that the check does NOT mistake legitimate `__dirname`
 * / `__filename` dunders in boilerplate for unsubstituted placeholders.
 */
describe('substituteTokens', () => {
    const names = normalizeGameName('my card game');

    it('replaces every named token in file contents', () => {
        const template = [
            'id: __game_kebab__',
            'const __gameCamel__Contribution = {};',
            'export class __GamePascal__Board {}',
            'title: "__Game Title__"',
            'const __GAME_CONSTANT__ = 1;',
            'package: __gamelower__',
        ].join('\n');

        const result = substituteTokens(template, names);

        expect(result).toBe(
            [
                'id: my-card-game',
                'const myCardGameContribution = {};',
                'export class MyCardGameBoard {}',
                'title: "My Card Game"',
                'const MY_CARD_GAME = 1;',
                'package: mycardgame',
            ].join('\n'),
        );
        expect(findLeftoverTokens(result)).toEqual([]);
    });

    it('is idempotent — a second pass changes nothing and leaves no tokens', () => {
        const template = 'apps/__game_kebab__ uses __GamePascal__ as __GAME_CONSTANT__';
        const once = substituteTokens(template, names);
        expect(substituteTokens(once, names)).toBe(once);
        expect(findLeftoverTokens(once)).toEqual([]);
    });
});

describe('renameTokensInPath', () => {
    const names = normalizeGameName('my card game');

    it('substitutes tokens within each path segment', () => {
        expect(
            renameTokensInPath('apps/__game_kebab__/renderer/__GamePascal__Board.tsx', names),
        ).toBe('apps/my-card-game/renderer/MyCardGameBoard.tsx');
    });

    it('leaves a path without tokens untouched', () => {
        expect(renameTokensInPath('apps/shared/index.ts', names)).toBe('apps/shared/index.ts');
    });
});

describe('findLeftoverTokens', () => {
    it('reports unsubstituted known tokens', () => {
        expect(findLeftoverTokens('still has __game_kebab__ and __GAME_CONSTANT__')).toEqual([
            '__game_kebab__',
            '__GAME_CONSTANT__',
        ]);
    });

    it('does not flag legitimate __dirname / __filename dunders', () => {
        const boilerplate = 'const dir = __dirname;\nconst file = __filename;\n';
        expect(findLeftoverTokens(boilerplate)).toEqual([]);
    });
});
