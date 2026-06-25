/**
 * renderer/__tests__/package-exports-contract.test.ts
 *
 * Locks the `@chimera/renderer` package surface declared in `package.json`
 * (issue #772 — F61 surface contract; updated by #773 once the dist/ build landed):
 *
 *   - the public `exports` entry points are the two component barrels
 *     `./components/ui` and `./components/chat` plus the game-registration seam
 *     `./game` (#784 — the runtime injection point a consumer app populates via
 *     `registerRendererGame`) — no `.` barrel (there is intentionally no
 *     `renderer/index.ts`) and no deep internal subpath (Invariant #96, AC #2);
 *   - #773 emitted the dist/ build, so each barrel's `types` AND `default`
 *     conditions now both point at the built `dist/` artifact (the #772 bridge
 *     where `types` pointed at in-tree source is gone);
 *   - a `./styles/*.css` entry ships the design-token stylesheet so a consumer
 *     can `import '@chimera/renderer/styles/tokens.css'` to load the `--ch-*`
 *     tokens the barrel components reference at `:root` (#773);
 *   - `@chimera/simulation` is the only `@chimera/*` dependency (Invariant #1);
 *     `@chimera/ai` / `@chimera/networking` / `@chimera/electron` are NOT
 *     dependencies;
 *   - React / React-DOM / Three / `@react-three/fiber` / Next are peers so the
 *     consumer app owns a single copy; renderer-internal runtime libs (zustand)
 *     are direct dependencies.
 *
 * Reading the manifest directly guards the contract against drift.
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
    exports?: Record<string, { types?: string; default?: string } | string>;
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

    it('exposes the component barrels, the game seam, the engine shell, and the design-token styles, pointing at dist/', () => {
        const exportsMap = manifest.exports ?? {};
        expect(Object.keys(exportsMap).sort()).toEqual([
            './components/chat',
            './components/ui',
            './game',
            './shell/*',
            './styles/*.css',
        ]);

        // #773: both `types` and `default` now resolve to the built dist/ artifact.
        expect(exportsMap['./components/ui']).toEqual({
            types: './dist/components/ui/index.d.ts',
            default: './dist/components/ui/index.js',
        });
        expect(exportsMap['./components/chat']).toEqual({
            types: './dist/components/chat/index.d.ts',
            default: './dist/components/chat/index.js',
        });

        // #784: the game-registration seam resolves to the built dist/ registry.
        expect(exportsMap['./game']).toEqual({
            types: './dist/game/rendererGameRegistry.d.ts',
            default: './dist/game/rendererGameRegistry.js',
        });

        // F65 Phase 2c: the engine GUI shell (every route under app/) ships from dist
        // so a consumer app's thin per-app Next host re-exports each route from
        // `@chimera/renderer/shell/<route>` (resolving every shared singleton through
        // one package dist copy).
        expect(exportsMap['./shell/*']).toEqual({
            types: './dist/app/*.d.ts',
            default: './dist/app/*.js',
        });

        // The styles subpath ships the design-token stylesheet from dist/.
        expect(exportsMap['./styles/*.css']).toBe('./dist/styles/*.css');

        // No `.` barrel and no deep internal component subpath leaks internals;
        // the only non-component entry points are the game seam, the shell route
        // wildcard, and the curated styles asset wildcard.
        expect(exportsMap['.']).toBeUndefined();
        for (const key of Object.keys(exportsMap)) {
            expect(
                key === './components/ui' ||
                    key === './components/chat' ||
                    key === './game' ||
                    key === './shell/*' ||
                    key === './styles/*.css',
            ).toBe(true);
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
