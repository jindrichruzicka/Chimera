import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

// Locks the contract of the apps/tactics electron-builder packaging config (issue #813,
// M9 / F67 — the repo's first distributable-app build config). Like the release/e2e
// workflow tests, it reads the YAML as text and asserts shape rather than parsing it
// (the repo intentionally carries no YAML-parser dependency). This is the executable
// record of the packaging contract: the path-math layout the host's resolveRuntimePaths
// requires, the F67 T3 icon wiring, the #814 tokenisation seam, and the unsigned /
// out-of-scope guarantees.
const appRoot = path.resolve(import.meta.dirname);
const configPath = path.join(appRoot, 'electron-builder.yml');

describe('apps/tactics electron-builder.yml packaging config', () => {
    let content: string;

    beforeAll(() => {
        content = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
    });

    it('file exists at apps/tactics/electron-builder.yml', () => {
        expect(existsSync(configPath)).toBe(true);
    });

    // #814 tokenisation seam: app-identity fields each on their own top-level line so the
    // blank-template mirror can swap them without touching the rest of the config.
    it('declares isolated appId and productName identity fields (tokenisation seam, #814)', () => {
        expect(content).toMatch(/^appId:\s*\S+/m);
        expect(content).toMatch(/^productName:\s*\S+/m);
    });

    // Icon AC: each platform references F67 T3's generated set inside the installed
    // @chimera-engine/electron package (no duplicated logo bytes), and the referenced
    // files actually exist on disk — the automated smoke for "bundle uses the Chimera icon".
    const ICONS: readonly (readonly [string, string])[] = [
        ['mac', 'icns'],
        ['win', 'ico'],
        ['linux', 'png'],
    ];
    for (const [platform, ext] of ICONS) {
        it(`wires the ${platform} icon to the @chimera-engine/electron ${ext} asset (F67 T3, no byte duplication)`, () => {
            const pattern = new RegExp(
                `icon:\\s*(\\S*@chimera-engine/electron/assets/icons/chimera\\.${ext})`,
            );
            const iconRef = content.match(pattern)?.[1] ?? '';
            expect(iconRef, `${platform} icon (.${ext}) reference missing`).not.toBe('');
            expect(existsSync(path.resolve(appRoot, iconRef))).toBe(true);
        });
    }

    // Path-math contract: the packaged layout must reproduce what resolveRuntimePaths
    // (electron/main/index.ts) walks to from the main bundle's __dirname — preload/main
    // under dist/, the renderer static export under renderer/out, and game content/assets
    // remapped into an apps/tactics/ subtree (gameAssetsRoot = ../../apps).
    it('packages the main + preload bundles under dist/', () => {
        expect(content).toMatch(/dist\/electron\/main\.js/);
        expect(content).toMatch(/dist\/preload\/api\.js/);
    });

    it('packages the renderer static export at renderer/out', () => {
        expect(content).toMatch(/renderer\/out/);
    });

    // Debug builds (the .vscode launch tasks, `pnpm start:debug`) leave browser source
    // maps with full TSX sourcesContent in renderer/out. The root package:tactics:*
    // chains re-run `next build` (which wipes out/ first), but the bare app-level
    // `package` script hands electron-builder whatever out/ currently holds — so the
    // file set itself must refuse *.map or a debug build's maps ship in the bundle.
    it('excludes renderer source maps from the packaged renderer/out file set', () => {
        expect(content).toMatch(/from:\s*renderer\/out[\s\S]{0,200}?!\*\*\/\*\.map/);
    });

    it('remaps game content + assets into the apps/tactics/ subtree (gameAssetsRoot path math)', () => {
        expect(content).toMatch(/to:\s*apps\/tactics\/data/);
        expect(content).toMatch(/to:\s*apps\/tactics\/assets/);
    });

    // Runtime window-icon contract: the bundled host's resolveAppIcon loads the default
    // Chimera PNG from <app>/assets/icons/chimera.png. Ship it there (from the installed
    // engine package) or window creation logs an unhandled rejection in the package.
    it('ships the engine icon set (incl. the default runtime PNG) at assets/icons', () => {
        // Dir file set (from is a directory): <engine>/assets/icons -> <app>/assets/icons,
        // so resolveAppIcon finds <app>/assets/icons/chimera.png.
        expect(content).toMatch(/from:\s*\S*electron\/assets\/icons\s*\n\s*to:\s*assets\/icons\b/);
    });

    // Output goes to release/, not dist/ — dist/ holds the bundled JS (and is gitignored
    // separately); writing installers there would clobber the build output.
    it('writes bundles to release/, never dist/', () => {
        expect(content).toMatch(/output:\s*release/);
    });

    // Out of scope (explicit per AC): unsigned bundle, no notarisation, no CI release.
    it('is unsigned and documents signing / notarisation / CI as out of scope', () => {
        expect(content).toMatch(/identity:\s*null/);
        expect(content).toMatch(/out of scope/i);
        expect(content).toMatch(/sign|notaris/i);
    });

    // Invariant #27: no debug graph leaks into packaging config (the invariants gate also
    // scans electron-builder*.yml for this token).
    it('never embeds CHIMERA_DEBUG (Invariant #27)', () => {
        expect(content).not.toMatch(/CHIMERA_DEBUG/);
    });
});

// Bundle-trim contract (issue #817): electron-builder ALWAYS ships the production
// `dependencies` tree (a `files: !node_modules/**` glob does NOT exclude it, as #813
// discovered). But `build:app` esbuild-bundles the `@chimera-engine/*` engine code straight
// into dist/electron/main.js + dist/preload/api.js, so at runtime the packaged app needs
// none of those `node_modules` — shipping them dereferenced cost ~477MB of dead weight.
// The fix keeps those engine packages out of `dependencies` (they are build-time-only here),
// so electron-builder collects nothing to copy. They stay in `devDependencies` so the pnpm
// workspace symlinks (esbuild resolution, `tsc -b` references, the build-time icon file set)
// still resolve. This guard locks the trim without running a multi-minute package.
describe('apps/tactics package.json — bundle-trim contract (#817)', () => {
    const ENGINE_PACKAGES = [
        '@chimera-engine/simulation',
        '@chimera-engine/ai',
        '@chimera-engine/renderer',
        '@chimera-engine/electron',
    ] as const;

    const pkg = JSON.parse(readFileSync(path.join(appRoot, 'package.json'), 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };

    // The whole point: electron-builder ships `dependencies`, so the app must declare none
    // of the bundled engine packages there (any production dep would be dereferenced into
    // the bundle's node_modules at ~hundreds of MB).
    it.each(ENGINE_PACKAGES)('does NOT declare %s as a production dependency', (name) => {
        expect(pkg.dependencies ?? {}).not.toHaveProperty(name);
    });

    // They are build-time-only, hence devDependencies — keeping the workspace symlink that
    // esbuild, `tsc -b`, and the electron-builder icon file set all read at build time.
    it.each(ENGINE_PACKAGES)('still declares %s as a devDependency (build-time only)', (name) => {
        expect(pkg.devDependencies ?? {}).toHaveProperty(name);
    });
});
