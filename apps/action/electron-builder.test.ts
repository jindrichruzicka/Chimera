import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { ACTION_GAME_ID } from './simulation/constants.js';
import { actionShellAudioRefs } from './shell-asset-manifest.js';

// Locks the contract of the apps/action electron-builder packaging config. Like
// its apps/tactics sibling it reads the YAML as text and asserts shape rather
// than parsing it (the repo intentionally carries no YAML-parser dependency).
// This is the executable record of the packaging contract: the path-math layout
// the host's resolveRuntimePaths requires, the icon wiring, and the unsigned /
// out-of-scope guarantees.
const appRoot = path.resolve(import.meta.dirname);
const configPath = path.join(appRoot, 'electron-builder.yml');

describe('apps/action electron-builder.yml packaging config', () => {
    let content: string;

    beforeAll(() => {
        content = existsSync(configPath) ? readFileSync(configPath, 'utf-8') : '';
    });

    it('file exists at apps/action/electron-builder.yml', () => {
        expect(existsSync(configPath)).toBe(true);
    });

    it('declares its own app identity', () => {
        expect(content).toMatch(/^appId:\s*com\.chimera\.action$/m);
        expect(content).toMatch(/^productName:\s*Action$/m);
    });

    // Each platform references the engine's generated icon set inside the
    // installed @chimera-engine/electron package (no duplicated logo bytes), and
    // the referenced files actually exist on disk.
    const ICONS: readonly (readonly [string, string])[] = [
        ['mac', 'icns'],
        ['win', 'ico'],
        ['linux', 'png'],
    ];
    for (const [platform, ext] of ICONS) {
        it(`wires the ${platform} icon to the @chimera-engine/electron ${ext} asset`, () => {
            const pattern = new RegExp(
                `icon:\\s*(\\S*@chimera-engine/electron/assets/icons/chimera\\.${ext})`,
            );
            const iconRef = content.match(pattern)?.[1] ?? '';
            expect(iconRef, `${platform} icon (.${ext}) reference missing`).not.toBe('');
            expect(existsSync(path.resolve(appRoot, iconRef))).toBe(true);
        });
    }

    it('packages the main + preload bundles under dist/', () => {
        expect(content).toMatch(/dist\/electron\/main\.js/);
        expect(content).toMatch(/dist\/preload\/api\.js/);
    });

    it('packages the renderer static export at renderer/out', () => {
        expect(content).toMatch(/renderer\/out/);
    });

    // The `files` list under dist/ is an ALLOWLIST of two named files. A
    // `dist/**` glob would silently ship whatever the build emits — including a
    // debug preload — which is exactly what `pnpm verify:packaged-bundle`
    // rejects; this is the same property held statically.
    it('names dist files individually rather than globbing dist/**', () => {
        const distEntries = content
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('- dist/'));

        expect(distEntries).toEqual(['- dist/electron/main.js', '- dist/preload/api.js']);
        expect(content).not.toMatch(/dist\/\*\*/);
        expect(content).not.toMatch(/debug-api/);
    });

    it('excludes renderer source maps from the packaged renderer/out file set', () => {
        expect(content).toMatch(/from:\s*renderer\/out[\s\S]{0,200}?!\*\*\/\*\.map/);
    });

    // The path math the packaged host needs: resolveRuntimePaths resolves game
    // assets at <app>/apps/<gameId>/assets. Ship them anywhere else and the
    // shell's menu bed and select blip resolve to files that are not there.
    it('remaps the game assets into the apps/action/ subtree (gameAssetsRoot path math)', () => {
        expect(content).toMatch(/from:\s*assets\s*\n\s*to:\s*apps\/action\/assets\b/);
    });

    it('ships every committed game asset the shell manifest declares', () => {
        // The config names a DIRECTORY, so this is not a per-file allowlist to
        // keep in step — what it holds is that the directory it names is the one
        // the refs resolve into, and that the files are actually committed.
        for (const ref of Object.values(actionShellAudioRefs)) {
            const relative = String(ref).slice(`${ACTION_GAME_ID}/`.length);
            expect(existsSync(path.join(appRoot, 'assets', relative)), String(ref)).toBe(true);
        }
    });

    it('ships no data directory, because the app declares no content collections', () => {
        expect(content).not.toMatch(/to:\s*apps\/action\/data\b/);
    });

    // Runtime window-icon contract: the bundled host's resolveAppIcon loads the
    // default Chimera PNG from <app>/assets/icons/chimera.png. Ship it there or
    // window creation logs an unhandled rejection in the package.
    it('ships the engine icon set (incl. the default runtime PNG) at assets/icons', () => {
        expect(content).toMatch(/from:\s*\S*electron\/assets\/icons\s*\n\s*to:\s*assets\/icons\b/);
    });

    it('writes bundles to release/, never dist/', () => {
        expect(content).toMatch(/output:\s*release/);
    });

    it('is unsigned and documents signing / notarisation / CI as out of scope', () => {
        expect(content).toMatch(/identity:\s*null/);
        expect(content).toMatch(/out of scope/i);
        expect(content).toMatch(/sign|notaris/i);
    });

    // Invariant #27: no debug graph leaks into packaging config (the invariants
    // gate also scans electron-builder*.yml for this token).
    it('never embeds CHIMERA_DEBUG (Invariant #27)', () => {
        expect(content).not.toMatch(/CHIMERA_DEBUG/);
    });
});

// Bundle-trim contract, mirroring apps/tactics: electron-builder ALWAYS ships
// the production `dependencies` tree, but `build:app` esbuild-bundles the
// @chimera-engine/* engine code straight into dist/electron/main.js +
// dist/preload/api.js, so at runtime the packaged app needs none of those
// node_modules. Keeping them out of `dependencies` is what stops electron-builder
// dereferencing hundreds of megabytes of dead weight into the bundle.
describe('apps/action package.json — bundle-trim contract', () => {
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

    it.each(ENGINE_PACKAGES)('does NOT declare %s as a production dependency', (name) => {
        expect(pkg.dependencies ?? {}).not.toHaveProperty(name);
    });

    it.each(ENGINE_PACKAGES)('still declares %s as a devDependency (build-time only)', (name) => {
        expect(pkg.devDependencies ?? {}).toHaveProperty(name);
    });
});
