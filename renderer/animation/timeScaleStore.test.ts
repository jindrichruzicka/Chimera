import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { useTimeScaleStore } from './timeScaleStore.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function readStoreSource(): string {
    return readFileSync(resolve(__dirname, 'timeScaleStore.ts'), 'utf8');
}

/**
 * `source` with comments and string literals removed, so a surviving `/` is a
 * division operator and a surviving `1000` is a numeric literal.
 *
 * Both are what the claim is about, and both appear in this module for reasons
 * that are not arithmetic: the import specifier carries slashes, and the prose
 * names the permille scale. Stripping is what separates the claim from the
 * mentions.
 */
function arithmeticResidue(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//gu, '')
        .replace(/(^|[^:])\/\/.*$/gmu, '$1')
        .replace(/'(?:[^'\\]|\\.)*'/gu, "''")
        .replace(/"(?:[^"\\]|\\.)*"/gu, '""')
        .replace(/`(?:[^`\\]|\\.)*`/gu, '``');
}

beforeEach(() => {
    // Module singleton: restore real time so no case inherits another's scale.
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

describe('timeScaleStore', () => {
    it('starts at real time', () => {
        expect(useTimeScaleStore.getState().timeScale).toBe(1);
    });

    // Literal expectations, never `timeScaleMultiplier(input)`: comparing the
    // store against the helper it calls asserts nothing about the arithmetic.
    it.each([
        ['a quarter-speed permille', 250, 0.25],
        ['a double-speed permille', 2000, 2],
        ['real time', 1000, 1],
        ['a permille under the floor', 10, 0.05],
        ['a permille over the ceiling', 9000, 4],
        ['a fractional permille, which is refused rather than rounded', 250.5, 1],
        ['an absent permille', undefined, 1],
    ])('seats %s', (_name, permille, expected) => {
        useTimeScaleStore.getState().setAuthoritativePermille(permille);

        expect(useTimeScaleStore.getState().timeScale).toBe(expected);
    });

    it('returns to real time when the authoritative permille goes away', () => {
        useTimeScaleStore.getState().setAuthoritativePermille(250);
        expect(useTimeScaleStore.getState().timeScale).toBe(0.25);

        useTimeScaleStore.getState().setAuthoritativePermille(undefined);

        expect(useTimeScaleStore.getState().timeScale).toBe(1);
    });

    it('notifies its subscribers on a change', () => {
        const listener = vi.fn();
        const unsubscribe = useTimeScaleStore.subscribe(listener);

        useTimeScaleStore.getState().setAuthoritativePermille(250);
        unsubscribe();

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0]?.[0]).toMatchObject({ timeScale: 0.25 });
    });
});

describe('timeScaleStore derives its float only through timeScaleMultiplier', () => {
    // The stripper is pinned on fixtures rather than on the module's live prose:
    // a guard that leans on another file's wording breaks when that file is
    // reworded, for a reason unrelated to what it guards.
    it.each([
        ['a block comment naming the scale', '/* 1000 permille */\nconst a = 1;', '\nconst a = 1;'],
        ['a line comment naming a division', '// x / 1000\nconst b = 2;', '\nconst b = 2;'],
        [
            'an import specifier, whose slashes are not division',
            `import { m } from '@x/foundation/time-scale.js';`,
            `import { m } from '';`,
        ],
        ['a double-quoted path', 'const p = "a/b/c";', 'const p = "";'],
        ['a template path', 'const p = `a/b/c`;', 'const p = ``;'],
        ['a url, whose // is not a comment', 'const u = "https://x/y";', 'const u = "";'],
        [
            'real division, which survives',
            'const q = permille / 1000;',
            'const q = permille / 1000;',
        ],
    ])('strips %s', (_name, input, expected) => {
        expect(arithmeticResidue(input)).toBe(expected);
    });

    it('would catch a hand-rolled permille division', () => {
        // The positive control for the two assertions below: had the store been
        // written with the arithmetic inline, this is the residue it would leave.
        const residue = arithmeticResidue('const timeScale = clamped / 1000;');

        expect(residue).toContain('/');
        expect(residue).toMatch(/\b1000\b/u);
    });

    it('contains no division and no literal 1000', () => {
        const residue = arithmeticResidue(readStoreSource());

        expect(residue).not.toContain('/');
        expect(residue).not.toMatch(/\b1000\b/u);
    });

    it('imports the shared multiplier from the one foundation subpath', () => {
        expect(readStoreSource()).toContain(
            `import { timeScaleMultiplier } from '@chimera-engine/simulation/foundation/time-scale.js';`,
        );
    });
});
