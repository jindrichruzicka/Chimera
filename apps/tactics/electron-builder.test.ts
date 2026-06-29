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
