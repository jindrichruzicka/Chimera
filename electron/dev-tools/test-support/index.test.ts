import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import * as testSupport from './index.js';

/**
 * The exported symbol set IS the published API of `@chimera-engine/electron/test-support`
 * — an accidental export is as breaking to remove later as an intentional one.
 * `exports` (not the build) curates the surface (Invariant #5), so this pins what
 * that subpath hands a consumer.
 */
describe('@chimera-engine/electron/test-support barrel', () => {
    it('exports exactly these runtime values — the readers and their error type', () => {
        // RUNTIME values only: `Object.keys` cannot see the `type` exports beside
        // them (`WavFacts`, `GltfDocument`, the `Gltf*` node types), which are
        // equally breaking to remove for a TypeScript consumer and are pinned by
        // the package's own build rather than here.
        expect(Object.keys(testSupport).sort()).toEqual([
            'MalformedAssetFileError',
            'assetPathForRef',
            'readGlbDocument',
            'readWavFacts',
        ]);
    });

    it('declares no direct import of a test framework, Electron, or the renderer stack', async () => {
        // A helper a GAME's unit tests import must run under a plain `node`
        // vitest environment in a standalone project — where `electron` is a
        // devDependency of the app, not of the test runner, and `vitest` is
        // resolvable only from the consumer's own root. Importing either here
        // would make the subpath unusable and, for `vitest`, would fail
        // `verify:publish`'s depcheck on an undeclared runtime dependency.
        //
        // Scope: this reads THIS directory's own source and checks the
        // specifiers it names. The transitive closure is `verify:publish`'s job
        // — it scans the packed `.js` and fails on anything undeclared — so a
        // banned package arriving through a dependency is caught there, not here.
        const { readFile } = await import('node:fs/promises');
        const here = fileURLToPath(new URL('.', import.meta.url));
        const sources = [
            'index.ts',
            'assetRefPath.ts',
            'wavFacts.ts',
            'glbDocument.ts',
            'MalformedAssetFileError.ts',
        ];

        for (const name of sources) {
            const source = await readFile(path.join(here, name), 'utf8');
            const specifiers = Array.from(
                // Both forms: `… from 'x'` and the bare side-effect `import 'x'`,
                // which carries no binding and so matches no `from` clause.
                source.matchAll(/^(?:import|export)(?:[^'"]*from\s*)?'([^']+)'/gmu),
                (match) => match[1] ?? '',
            );
            for (const specifier of specifiers) {
                expect(specifier, `${name} imports ${specifier}`).not.toMatch(
                    /^(?:vitest|electron|three|react)/u,
                );
            }
        }
    });

    it('reads a non-empty specifier set from every source it scans', async () => {
        // The floor for the scan above: a renamed file or a regex that stopped
        // matching would report zero specifiers and pass vacuously. Separate from
        // the ban itself so the two failures are distinguishable — except for
        // MalformedAssetFileError.ts, which legitimately imports nothing.
        const { readFile } = await import('node:fs/promises');
        const here = fileURLToPath(new URL('.', import.meta.url));

        for (const name of ['index.ts', 'assetRefPath.ts', 'wavFacts.ts', 'glbDocument.ts']) {
            const source = await readFile(path.join(here, name), 'utf8');
            expect(
                Array.from(source.matchAll(/^(?:import|export)(?:[^'"]*from\s*)?'([^']+)'/gmu)),
                name,
            ).not.toHaveLength(0);
        }
    });
});
