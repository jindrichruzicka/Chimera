import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `var()`/`calc(var())` is invalid inside a media-query condition — such a
 * prelude never matches, so the narrow-layout fallback silently never fires.
 * These modules must keep the resolved px literal (the token math written
 * out), not a token expression that looks tidier but is dead.
 */
const responsiveModules = [
    { fileName: '../../app/settings/page.module.css', condition: '@media (max-width: 480px)' },
    { fileName: '../../app/lobby/page.module.css', condition: '@media (max-width: 480px)' },
    { fileName: './PlayerList.module.css', condition: '@media (max-width: 400px)' },
] as const;

function readModuleCss(fileName: string): string {
    return readFileSync(fileURLToPath(new URL(fileName, import.meta.url)), 'utf8');
}

describe.each(responsiveModules)('responsive fallback ($fileName)', ({ fileName, condition }) => {
    const css = readModuleCss(fileName);

    it('declares the narrow-layout fallback with a working px condition', () => {
        expect(css).toContain(condition);
    });

    it('keeps token expressions out of the media-query condition', () => {
        expect(css).not.toMatch(/@media[^{]*(?:var\(|calc\()/u);
    });
});
