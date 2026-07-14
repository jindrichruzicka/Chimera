import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * One error treatment everywhere: every shell error line renders as the boxed
 * tinted panel (error surface + border + text on a rounded, padded box), never
 * as a bare red text line. The drawer-hosted chat composer keeps the same box
 * with tighter padding so it fits the compact composer column.
 */
const errorModules = [
    {
        fileName: './listBrowser.module.css',
        padding: 'padding: calc(var(--ch-space-sm) + var(--ch-space-xs)) var(--ch-space-md)',
    },
    {
        fileName: '../../app/lobby/page.module.css',
        padding: 'padding: calc(var(--ch-space-sm) + var(--ch-space-xs)) var(--ch-space-md)',
    },
    {
        fileName: '../chat/ChatPanel.module.css',
        padding: 'padding: var(--ch-space-sm)',
    },
] as const;

function readModuleCss(fileName: string): string {
    return readFileSync(fileURLToPath(new URL(fileName, import.meta.url)), 'utf8');
}

function extractErrorDeclarations(css: string): string {
    const match = /\.error\s*\{([^}]*)\}/.exec(css);

    if (match?.[1] === undefined) {
        throw new Error('Missing .error rule');
    }

    return match[1];
}

describe.each(errorModules)('boxed error treatment ($fileName)', ({ fileName, padding }) => {
    const declarations = extractErrorDeclarations(readModuleCss(fileName));

    it('tints and outlines the panel with the error tokens', () => {
        expect(declarations).toContain('background: var(--ch-color-error-surface)');
        expect(declarations).toContain(
            'border: var(--ch-border-width-sm) solid var(--ch-color-error-border)',
        );
        expect(declarations).toContain('color: var(--ch-color-error-text)');
    });

    it('rounds and pads the panel so it reads as a box, not a bare text line', () => {
        expect(declarations).toContain('border-radius: var(--ch-radius-sm)');
        expect(declarations).toContain(padding);
    });
});
