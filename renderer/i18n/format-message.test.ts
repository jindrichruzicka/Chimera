import { describe, expect, it, vi } from 'vitest';

import { formatMessage, type MessageParams } from './format-message.js';

describe('formatMessage', () => {
    it('substitutes a named param into a plain template', () => {
        expect(formatMessage('Hello, {name}!', { name: 'Ada' })).toBe('Hello, Ada!');
    });

    it('substitutes a numeric param using String() coercion', () => {
        expect(formatMessage('You have {count} points', { count: 42 })).toBe('You have 42 points');
    });

    it('renders escaped double braces as literal single braces', () => {
        expect(formatMessage('{{literal}} and {{another}}')).toBe('{literal} and {another}');
    });

    it('handles a template mixing escaped braces with a real interpolation', () => {
        expect(formatMessage('{{not a param}} but {name} is', { name: 'Ada' })).toBe(
            '{not a param} but Ada is',
        );
    });

    it('selects the English "one" plural category and substitutes # for a singular count', () => {
        const template = '{count, plural, one {# item} other {# items}}';
        expect(formatMessage(template, { count: 1 })).toBe('1 item');
    });

    it('selects the English "other" plural category for a plural count', () => {
        const template = '{count, plural, one {# item} other {# items}}';
        expect(formatMessage(template, { count: 5 })).toBe('5 items');
    });

    it('selects the Czech "few" plural category for count=3, proving locale-driven category selection', () => {
        const template = '{count, plural, one {# kus} few {# kusy} many {# kusu} other {# kusů}}';
        expect(formatMessage(template, { count: 3 }, 'cs')).toBe('3 kusy');
    });

    it('selects the Czech "many" plural category for a fractional count, since integer counts never reach "many" under CLDR cs rules', () => {
        // Czech "many" is a fraction-only CLDR category (Intl.PluralRules('cs')
        // never returns 'many' for an integer) — a fractional count is the only
        // way to reach it, which is why this case differs from the others.
        const template = '{count, plural, one {# kus} few {# kusy} many {# kusu} other {# kusů}}';
        expect(formatMessage(template, { count: 1.5 }, 'cs')).toBe('1.5 kusu');
    });

    it('selects the Czech "other" category for count=5, contrasting with English which also selects "other" but for a different reason', () => {
        const template = '{count, plural, one {# kus} few {# kusy} many {# kusu} other {# kusů}}';
        expect(formatMessage(template, { count: 5 }, 'cs')).toBe('5 kusů');
    });

    it('lets an explicit =0 exact-match branch take precedence over the keyword plural category', () => {
        const template = '{count, plural, =0 {no items} one {# item} other {# items}}';
        expect(formatMessage(template, { count: 0 })).toBe('no items');
    });

    it('falls through to the keyword category when the count does not match any =N branch', () => {
        const template = '{count, plural, =0 {no items} one {# item} other {# items}}';
        expect(formatMessage(template, { count: 1 })).toBe('1 item');
    });

    it('resolves a select construct by exact string match', () => {
        const template = '{gender, select, male {he} female {she} other {they}}';
        expect(formatMessage(template, { gender: 'female' })).toBe('she');
    });

    it('falls back to the select "other" branch when the param does not match any key', () => {
        const template = '{gender, select, male {he} female {she} other {they}}';
        expect(formatMessage(template, { gender: 'nonbinary' })).toBe('they');
    });

    it('supports nested named-param interpolation inside a plural branch body', () => {
        const template = '{count, plural, one {# item for {name}} other {# items for {name}}}';
        expect(formatMessage(template, { count: 2, name: 'Ada' })).toBe('2 items for Ada');
    });

    it('binds # to the innermost enclosing plural when plurals are nested', () => {
        // ICU binds # to the nearest plural: the inner # here resolves to the
        // inner plural's count (b), not the outer one (a).
        const template = '{a, plural, other {{b, plural, other {# inner}}}}';
        expect(formatMessage(template, { a: 2, b: 7 })).toBe('7 inner');
    });

    it('keeps # bound to the enclosing plural inside a nested select branch', () => {
        // A select introduces no count of its own, so # inside its branches
        // stays bound to the surrounding plural's count.
        const template = '{n, plural, other {{g, select, other {# things}}}}';
        expect(formatMessage(template, { n: 4, g: 'x' })).toBe('4 things');
    });

    it('leaves # as a literal character when no plural encloses it', () => {
        expect(formatMessage('rank #{pos}', { pos: 1 })).toBe('rank #1');
    });

    it('substitutes the count for a # adjacent to escaped braces, since {{/}} escape braces not #', () => {
        const template = '{n, plural, other {{{#}}=#}}';
        expect(formatMessage(template, { n: 2 })).toBe('{2}=2');
    });

    it('renders an unknown param as an empty string without throwing', () => {
        expect(() => formatMessage('Hello, {name}!', {})).not.toThrow();
        expect(formatMessage('Hello, {name}!', {})).toBe('Hello, !');
    });

    it('dev-warns exactly once when a param is unknown', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        formatMessage('Hello, {name}!', {});
        expect(warnSpy).toHaveBeenCalledTimes(1);
        warnSpy.mockRestore();
    });

    it('returns the raw template unchanged when a brace is unbalanced, without throwing', () => {
        expect(() => formatMessage('Hello {name')).not.toThrow();
        expect(formatMessage('Hello {name')).toBe('Hello {name');
    });

    it('dev-warns when returning the raw template for a malformed input', () => {
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        formatMessage('Hello {name');
        expect(warnSpy).toHaveBeenCalledTimes(1);
        warnSpy.mockRestore();
    });

    it('returns the raw template unchanged when a plural/select construct is missing its required "other" branch', () => {
        const template = '{count, plural, one {# item}}';
        expect(formatMessage(template, { count: 5 })).toBe(template);
    });

    it('returns the raw template unchanged for an unrecognized construct keyword', () => {
        const template = '{count, ordinal, one {#st} other {#th}}';
        expect(formatMessage(template, { count: 1 })).toBe(template);
    });

    it('returns the raw template unchanged when the plural pivot param is missing', () => {
        const template = '{count, plural, one {# item} other {# items}}';
        expect(formatMessage(template, {})).toBe(template);
    });

    it('returns the raw template unchanged when a placeholder has a name but no construct kind', () => {
        const template = '{count, }';
        expect(formatMessage(template, { count: 1 })).toBe(template);
    });

    it('is deterministic — identical (template, params, locale) inputs produce equal output', () => {
        const template = '{count, plural, one {# item} other {# items}}';
        const params: MessageParams = { count: 3 };
        expect(formatMessage(template, params, 'en')).toEqual(
            formatMessage(template, params, 'en'),
        );
    });

    it('does not mutate the input params object', () => {
        const params: MessageParams = { name: 'Ada', count: 2 };
        formatMessage('Hello, {name}! You have {count}.', params);
        expect(params).toEqual({ name: 'Ada', count: 2 });
    });

    it('defaults to English plural rules when no locale is passed', () => {
        const template = '{count, plural, one {# item} other {# items}}';
        expect(formatMessage(template, { count: 1 })).toBe('1 item');
    });
});
