/**
 * electron/dev-tools/fetch-google-fonts/relocation.test.ts
 *
 * Anti-rot guard for the relocation of the Google-Fonts self-hosting downloader
 * (the Invariant #97-sanctioned development-time tooling) out of repo-root
 * `tools/` and into `electron/dev-tools/fetch-google-fonts/`, following the
 * dev-harness precedent (§4.32). Locks reference surfaces that would
 * otherwise silently drift back to the old path:
 *
 *   - the root `fetch:fonts` script must run the tool at its new home;
 *   - neither the root manifest, the module-boundaries file-tree doc, nor the
 *     tool's own usage string may still name the retired
 *     `tools/fetch-google-fonts` location. The new path contains
 *     `dev-tools/fetch-google-fonts`, so the stale-reference scan matches the
 *     old path only when it is NOT the `dev-` prefixed one.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

const rootManifestPath = resolve(repoRoot, 'package.json');
const moduleBoundariesDocPath = resolve(
    repoRoot,
    'docs/executive-architecture/module-boundaries-file-tree.md',
);

/** Matches the retired repo-root location but never `dev-tools/fetch-google-fonts`. */
const stalePathPattern = /(?<!dev-)tools\/fetch-google-fonts/u;

interface RootManifest {
    scripts?: Record<string, string>;
}

describe('fetch-google-fonts relocation (Invariant #97 tooling home)', () => {
    it('lives at electron/dev-tools/fetch-google-fonts/index.ts', () => {
        expect(existsSync(resolve(__dirname, 'index.ts'))).toBe(true);
    });

    it('is what the root fetch:fonts script runs', () => {
        const manifest = JSON.parse(readFileSync(rootManifestPath, 'utf8')) as RootManifest;
        expect(manifest.scripts?.['fetch:fonts']).toContain(
            'electron/dev-tools/fetch-google-fonts/index.ts',
        );
    });

    it('leaves no stale tools/fetch-google-fonts reference in the root manifest', () => {
        expect(readFileSync(rootManifestPath, 'utf8')).not.toMatch(stalePathPattern);
    });

    it('names its new home in its own usage string, not the retired path', () => {
        expect(readFileSync(resolve(__dirname, 'index.ts'), 'utf8')).not.toMatch(stalePathPattern);
    });

    it('is documented under dev-tools/ in the module-boundaries file tree, with no stale reference', () => {
        const doc = readFileSync(moduleBoundariesDocPath, 'utf8');
        // Positive anchor first: the doc's file trees list bare names, so the
        // full-path stale scan alone would pass vacuously. The tool is now a
        // directory entry (`fetch-google-fonts/` holding index.ts); the retired
        // repo-root `tools/` tree named the file itself, so the old bare file
        // name must be gone everywhere.
        expect(doc).toContain('── fetch-google-fonts/');
        expect(doc).not.toContain('fetch-google-fonts.ts');
        expect(doc).not.toMatch(stalePathPattern);
    });
});
