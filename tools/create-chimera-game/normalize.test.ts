import { describe, expect, it } from 'vitest';
import { type GameNames, InvalidGameNameError, normalizeGameName } from './normalize';

/**
 * The scaffolder takes a single game name and must expand it deterministically into
 * every casing the blank template references — kebab, camel, Pascal, Title, CONSTANT,
 * and lower. These tests pin all six casings for single-word and multiword inputs, the
 * `tactics`/`Tactics` split that motivated the design, the input-shape invariance (any
 * casing of the same name normalises identically), and the validation rejections. No
 * filesystem, no CLI — `normalizeGameName` is a pure function.
 */
describe('normalizeGameName', () => {
    it('expands a single word into all six casings', () => {
        expect(normalizeGameName('tactics')).toEqual<GameNames>({
            kebab: 'tactics',
            camel: 'tactics',
            pascal: 'Tactics',
            title: 'Tactics',
            constant: 'TACTICS',
            lower: 'tactics',
        });
    });

    it('expands a multiword name into all six casings', () => {
        expect(normalizeGameName('my card game')).toEqual<GameNames>({
            kebab: 'my-card-game',
            camel: 'myCardGame',
            pascal: 'MyCardGame',
            title: 'My Card Game',
            constant: 'MY_CARD_GAME',
            lower: 'mycardgame',
        });
    });

    it('resolves the tactics -> Tactics case split for Pascal and Title', () => {
        const names = normalizeGameName('tactics');
        expect(names.pascal).toBe('Tactics');
        expect(names.title).toBe('Tactics');
    });

    it('is invariant to the input casing shape', () => {
        const expected = normalizeGameName('my card game');
        for (const shape of [
            'my-card-game',
            'my_card_game',
            'myCardGame',
            'MyCardGame',
            'MY_CARD_GAME',
            '  my   card   game  ',
        ]) {
            expect(normalizeGameName(shape)).toEqual(expected);
        }
    });

    describe('validation', () => {
        it.each([
            ['empty string', ''],
            ['whitespace only', '   '],
            ['path separator', 'bad/name'],
            ['non-ascii letter', 'café'],
            ['purely numeric', '123'],
            ['leading digit', '3d-chess'],
        ])('rejects %s', (_label, input) => {
            expect(() => normalizeGameName(input)).toThrow(InvalidGameNameError);
        });

        it('includes the offending input in the error message', () => {
            expect(() => normalizeGameName('bad/name')).toThrow(/bad\/name/);
        });
    });
});
