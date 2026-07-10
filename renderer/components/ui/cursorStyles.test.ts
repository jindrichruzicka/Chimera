import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { defaultTheme } from '../../theme/default-theme';

/**
 * Cursor token contract (F69): every engine cursor style routes through the
 * --ch-cursor-* token family declared in styles/tokens.css, so a game can
 * replace the OS cursor with its own textures purely via token overrides
 * (Invariant #85). With no overrides the computed cursors are byte-identical
 * to the pre-token behaviour: `auto` at the root, `pointer` on interactive
 * controls, `not-allowed` on disabled ones. Hardcoded cursor values in engine
 * modules would escape the override surface and are banned here.
 */

const rendererRoot = fileURLToPath(new URL('../..', import.meta.url));

function readRendererFile(relativePath: string): string {
    return readFileSync(join(rendererRoot, relativePath), 'utf8');
}

function extractDeclarations(css: string, selector: string): string {
    const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`).exec(css);

    if (match?.[1] === undefined) {
        throw new Error(`Missing rule for selector "${selector}"`);
    }

    return match[1];
}

describe('cursor token declarations', () => {
    const tokensCss = readRendererFile('styles/tokens.css');

    it.each([
        ['--ch-cursor-default', 'auto'],
        ['--ch-cursor-pointer', 'pointer'],
        ['--ch-cursor-disabled', 'not-allowed'],
    ])('tokens.css declares %s with the system value %s', (token, value) => {
        expect(tokensCss).toContain(`${token}: ${value};`);
    });

    it('globals.css applies the default cursor token at the document root', () => {
        const rootDeclarations = extractDeclarations(
            readRendererFile('styles/globals.css'),
            ':root',
        );

        expect(rootDeclarations).toContain('cursor: var(--ch-cursor-default)');
    });
});

describe('hardcoded cursor ban', () => {
    const scannedDirectories = ['components', 'app'] as const;

    const moduleCssFiles = scannedDirectories.flatMap((directory) =>
        readdirSync(join(rendererRoot, directory), { recursive: true })
            .map((entry) => join(directory, String(entry)))
            .filter((path) => path.endsWith('.module.css')),
    );

    /** A cursor value is legal only as a token indirection (an optional plain
     * fallback keyword keeps components usable without tokens.css) or as
     * explicit inheritance. */
    const allowedCursorValue = /^(?:var\(--ch-cursor-[a-z-]+(?:,\s*[a-z-]+)?\)|inherit)$/;

    it('scans a non-empty engine CSS module set', () => {
        expect(moduleCssFiles.length).toBeGreaterThan(0);
    });

    it('every engine cursor declaration routes through a --ch-cursor-* token', () => {
        const violations = moduleCssFiles.flatMap((path) => {
            const css = readRendererFile(path);

            return [...css.matchAll(/cursor\s*:\s*([^;}]+)[;}]/g)]
                .map((match) => (match[1] ?? '').trim())
                .filter((value) => !allowedCursorValue.test(value))
                .map(
                    (value) =>
                        `${relative(rendererRoot, join(rendererRoot, path))}: cursor: ${value}`,
                );
        });

        expect(violations).toEqual([]);
    });
});

describe('theme cursor contract', () => {
    it('defaultTheme button base routes its cursor through the pointer token', () => {
        expect(defaultTheme.palette.button.base.cursor).toBe('var(--ch-cursor-pointer, pointer)');
    });
});
