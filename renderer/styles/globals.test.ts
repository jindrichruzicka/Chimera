import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function readRendererFile(relativePath: string): string {
    return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
}

describe('renderer global stylesheet', () => {
    it('paints every scrollbar as a token-backed thumb on a transparent track', () => {
        const css = readRendererFile('./globals.css');

        expect(css).toMatch(
            /:root\s*\{[^}]*scrollbar-color: var\(--ch-color-border\) var\(--ch-color-transparent\);/,
        );
        expect(css).toMatch(/\*\s*\{[^}]*scrollbar-width: thin;/);
    });

    it('keeps the global stylesheet free of hardcoded visual literals', () => {
        const css = readRendererFile('./globals.css');

        expect(css).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
        expect(css).not.toMatch(/\brgba?\s*\(/iu);
        expect(css).not.toMatch(/\bhsla?\s*\(/iu);
        expect(css.replace(/var\([^)]+\)/g, '')).not.toMatch(/\b\d+(?:\.\d+)?(?:px|rem)\b/);
    });

    it('is imported by the root layout after the design tokens', () => {
        const layout = readRendererFile('../app/layout.tsx');
        const tokensImportIndex = layout.indexOf("import '../styles/tokens.css';");
        const globalsImportIndex = layout.indexOf("import '../styles/globals.css';");

        expect(tokensImportIndex).toBeGreaterThanOrEqual(0);
        expect(globalsImportIndex).toBeGreaterThan(tokensImportIndex);
    });
});
