/**
 * renderer/__tests__/package-exports-contract.test.ts
 *
 * Locks the `@chimera/renderer` package surface declared in `package.json`
 * (issue #772 — F61 surface contract):
 *
 *   - the ONLY public `exports` entry points are the two component barrels
 *     `./components/ui` and `./components/chat` — no `.` barrel (there is
 *     intentionally no `renderer/index.ts`) and no deep internal subpath
 *     (Invariant #96, AC #2);
 *   - each subpath's `types` condition points at the in-tree source barrel so a
 *     consumer (e.g. tactics) RESOLVES it today — the renderer `dist/` build is
 *     deferred to #773 — while its `default` (runtime) condition points at the
 *     `dist/` artifact #773 emits; #773 flips `types` onto `dist/.d.ts` once the
 *     declarations exist;
 *   - `@chimera/simulation` is the only `@chimera/*` dependency (Invariant #1);
 *     `@chimera/ai` / `@chimera/networking` / `@chimera/electron` are NOT
 *     dependencies;
 *   - React / React-DOM / Three / `@react-three/fiber` / Next are peers so the
 *     consumer app owns a single copy; renderer-internal runtime libs (zustand)
 *     are direct dependencies.
 *
 * Reading the manifest directly guards the contract against drift even before the
 * `dist/` build exists.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface RendererManifest {
    type?: string;
    files?: string[];
    types?: string;
    exports?: Record<string, { types?: string; default?: string }>;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
}

const manifest = JSON.parse(
    readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
) as RendererManifest;

describe('@chimera/renderer package surface (issue #772)', () => {
    it('is an ES module shipping the dist/ build', () => {
        expect(manifest.type).toBe('module');
        expect(manifest.files).toContain('dist');
        // No top-level `types`/`.` barrel — the renderer has no root index.
        expect(manifest.types).toBeUndefined();
    });

    it('exposes exactly the two component barrels, pointing at dist/', () => {
        const exportsMap = manifest.exports ?? {};
        expect(Object.keys(exportsMap).sort()).toEqual(['./components/chat', './components/ui']);

        // `types` → in-tree source (resolvable before the #773 dist build);
        // `default` → the dist/ runtime artifact #773 emits.
        expect(exportsMap['./components/ui']).toEqual({
            types: './components/ui/index.ts',
            default: './dist/components/ui/index.js',
        });
        expect(exportsMap['./components/chat']).toEqual({
            types: './components/chat/index.ts',
            default: './dist/components/chat/index.js',
        });

        // No `.` barrel and no deep internal subpath leaks the package internals.
        expect(exportsMap['.']).toBeUndefined();
        for (const key of Object.keys(exportsMap)) {
            expect(key === './components/ui' || key === './components/chat').toBe(true);
        }
    });

    it('depends on @chimera/simulation only among @chimera/* packages', () => {
        const deps = manifest.dependencies ?? {};
        const chimeraDeps = Object.keys(deps).filter((name) => name.startsWith('@chimera/'));
        expect(chimeraDeps).toEqual(['@chimera/simulation']);
        expect(deps['@chimera/simulation']).toBe('workspace:*');

        // Sibling engine packages must NOT be declared as renderer dependencies.
        expect(deps['@chimera/networking']).toBeUndefined();
        expect(deps['@chimera/ai']).toBeUndefined();
        expect(deps['@chimera/electron']).toBeUndefined();

        // Renderer-internal runtime libs are direct dependencies.
        expect(deps['zustand']).toBeDefined();
    });

    it('declares React/Three/Next stack as peer dependencies (consumer owns one copy)', () => {
        const peers = manifest.peerDependencies ?? {};
        for (const peer of ['react', 'react-dom', 'three', '@react-three/fiber', 'next']) {
            expect(peers[peer]).toBeDefined();
        }
        // Peers must not be duplicated as hard dependencies.
        const deps = manifest.dependencies ?? {};
        for (const peer of ['react', 'react-dom', 'three', '@react-three/fiber', 'next']) {
            expect(deps[peer]).toBeUndefined();
        }
    });
});
