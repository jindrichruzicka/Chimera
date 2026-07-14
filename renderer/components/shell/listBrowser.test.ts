import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The saves and replays browsers are the same list-browser surface, so they
 * share one shell stylesheet. This locks the dedupe: both pages import the
 * shared module and the per-page duplicates stay deleted.
 */
const SHARED_MODULE_IMPORT = "from '../../components/shell/listBrowser.module.css'";

const listBrowserPages = [
    { pagePath: '../../app/saves/page.tsx' },
    { pagePath: '../../app/replays/page.tsx' },
] as const;

function resolvePath(relativePath: string): string {
    return fileURLToPath(new URL(relativePath, import.meta.url));
}

describe.each(listBrowserPages)('list-browser stylesheet ($pagePath)', ({ pagePath }) => {
    const source = readFileSync(resolvePath(pagePath), 'utf8');

    it('imports the shared shell list-browser module', () => {
        expect(source).toContain(SHARED_MODULE_IMPORT);
    });

    it('keeps the duplicated per-page stylesheet deleted', () => {
        expect(source).not.toContain("from './page.module.css'");
        expect(existsSync(resolvePath(pagePath.replace('page.tsx', 'page.module.css')))).toBe(
            false,
        );
    });
});

describe('shared list-browser module', () => {
    it('exists beside the shell components', () => {
        expect(existsSync(resolvePath('./listBrowser.module.css'))).toBe(true);
    });
});
