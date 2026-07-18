/**
 * tools/create-chimera-game/standalone.ts
 *
 * Pure synthesizers for a STANDALONE (out-of-monorepo) game project ROOT — the small set of
 * files a generated `apps/<kebab>` needs around it to install + boot WITHOUT the Chimera
 * monorepo: a root `package.json` (declaring the toolchain the app inherits, stubbing the
 * engine's `build:packages` to a no-op, and allowing electron/esbuild install scripts), a
 * `pnpm-workspace.yaml` (the app is the lone member), and a self-contained unit-arm
 * `vitest.config.mts`.
 *
 * This module is the SINGLE author of the standalone root shape, consumed by two callers:
 *   - the published `create-chimera-game` CLI (emits the root with `@chimera-engine/*` resolved from
 *     npm — i.e. NO `pnpm.overrides`); and
 *   - the `verify:scaffold` gate, which emits the SAME root then layers `pnpm.overrides` onto
 *     locally-packed tarballs (see `applyTarballOverrides` in `tools/verify-scaffold.ts`) so it
 *     can verify the exact bytes the CLI ships against unpublished artifacts.
 *
 * Keeping one synthesizer avoids two divergent root shapes. It is PURE (no `fs`, no `process`,
 * not even `node:path`) and tarball-agnostic — the tarball/override concern lives entirely
 * gate-side. Zero imports keeps it consumable by both the boundary-constrained tool (`node:*` +
 * siblings only) and the gate.
 */

/**
 * Merge the root `dependencies` + `devDependencies` and drop every `@chimera-engine/*` entry. The
 * remainder — the repo's toolchain + renderer peers at the exact versions the engine packages
 * were built against — is declared at the standalone root so the generated app (which declares
 * only `@chimera-engine/*`) resolves react / vitest / playwright / electron / next by walking up to the
 * project's `node_modules`, exactly as it would by walking up to the monorepo root.
 */
export function buildStandaloneToolchainDeps(rootPkg: {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}): Record<string, string> {
    const merged: Record<string, string> = {
        ...(rootPkg.devDependencies ?? {}),
        ...(rootPkg.dependencies ?? {}),
    };
    const out: Record<string, string> = {};
    for (const [name, range] of Object.entries(merged)) {
        if (!name.startsWith('@chimera-engine/')) out[name] = range;
    }
    return out;
}

export interface StandaloneRootManifest {
    readonly name: string;
    readonly version: string;
    readonly private: true;
    readonly devDependencies: Record<string, string>;
    readonly scripts: Record<string, string>;
    readonly pnpm: {
        /**
         * Present only in the gate's tarball-resolved variant (layered on by
         * `applyTarballOverrides`); the published CLI emits no overrides because the app's
         * `@chimera-engine/* : ^x.y.z` ranges resolve from npm directly.
         */
        readonly overrides?: Record<string, string>;
        readonly onlyBuiltDependencies: readonly string[];
        /**
         * Dependencies whose install scripts are intentionally NOT run — acknowledged so pnpm 10
         * does not print the "Ignored build scripts … run pnpm approve-builds" warning on a fresh
         * install. `sharp` (a transitive Next.js dep) ships prebuilt binaries and is unused by the
         * static-export renderer, so its build script is never needed.
         */
        readonly ignoredBuiltDependencies: readonly string[];
    };
}

export interface BuildStandaloneRootManifestParams {
    /** The root package name (the gate uses a fixed disposable id; the CLI a game-derived id). */
    readonly name: string;
    /** Toolchain ranges from {@link buildStandaloneToolchainDeps}. */
    readonly toolchainDeps: Readonly<Record<string, string>>;
    /**
     * Optional `pnpm.overrides` map. Omitted by the published CLI (npm resolution); supplied by
     * the gate to force every `@chimera-engine/*` edge onto a packed `file:<tarball>`.
     */
    readonly overrides?: Readonly<Record<string, string>>;
}

/**
 * The standalone workspace-root `package.json`. Declares the toolchain, optionally forces
 * `@chimera-engine/*` onto the gate's tarballs, stubs `build:packages` to a no-op — the generated
 * app's e2e `global-setup` runs `pnpm build:packages` from this root, but the engine packages
 * arrive prebuilt (npm or tarball), so it must not (and cannot) run the engine's real `tsc`
 * build here — and carries a `package` script: the standalone twin of the monorepo's
 * `package:<game>` distributable flow (build the Next renderer + app bundle, then run the app's
 * electron-builder). It omits `build:packages` (the engine is prebuilt) and drives the app by
 * filter; `electron-builder` rides along from the app's own devDependencies. The
 * `onlyBuiltDependencies` allowlist lets pnpm run electron's + esbuild's install scripts so the
 * e2e arm has a usable Electron binary + esbuild platform binary; `ignoredBuiltDependencies`
 * acknowledges `sharp` (a transitive, unused Next.js dep with prebuilt binaries) so a fresh
 * `pnpm install` prints no "ignored build scripts" warning.
 */
export function buildStandaloneRootManifest(
    params: BuildStandaloneRootManifestParams,
): StandaloneRootManifest {
    const { name, toolchainDeps, overrides } = params;
    return {
        name,
        version: '0.0.0',
        private: true,
        devDependencies: { ...toolchainDeps },
        scripts: {
            'build:packages': 'node -e ""',
            // `pnpm start` launches the built app. It goes through `scripts/launch.mjs`
            // ({@link buildStandaloneLauncherScript}) rather than a bare `electron apps/<game>`
            // so ELECTRON_RUN_AS_NODE — leaked by some IDE/agent terminals + CI — is stripped
            // before Electron spawns; otherwise the binary runs as plain Node and the app
            // crashes at startup with a cryptic undefined-deref.
            start: 'node scripts/launch.mjs',
            // `pnpm start:debug` runs the SAME launcher with --debug: developer mode
            // (windowed + DevTools) plus the F9 Debug Inspector. The launcher's --debug
            // branch sets CHIMERA_ENV/NODE_ENV=development + CHIMERA_DEBUG=1.
            'start:debug': 'node scripts/launch.mjs --debug',
            package:
                `next build apps/${name}/renderer && ` +
                `pnpm --filter @chimera-engine/${name} build:app && ` +
                `pnpm --filter @chimera-engine/${name} run package`,
            // `pnpm dev:mp <N> [--scenario <name>]` — the dev multiplayer harness (§4.32):
            // mirrors `package`'s build chain (fresh renderer + app bundle), then delegates
            // to the app's dev:mp script (the `chimera-dev-mp` bin from
            // @chimera-engine/electron). pnpm appends trailing args to the LAST command in
            // the chain, so `pnpm dev:mp 3 --scenario skirmish` reaches the harness intact.
            'dev:mp':
                `next build apps/${name}/renderer && ` +
                `pnpm --filter @chimera-engine/${name} build:app && ` +
                `pnpm --filter @chimera-engine/${name} dev:mp`,
        },
        pnpm: {
            ...(overrides !== undefined ? { overrides: { ...overrides } } : {}),
            onlyBuiltDependencies: ['electron', 'esbuild'],
            ignoredBuiltDependencies: ['sharp'],
        },
    };
}

/** The `pnpm-workspace.yaml` for the standalone root: the scaffolded app is the lone member. */
export function buildStandaloneWorkspaceYaml(): string {
    return 'packages:\n  - apps/*\n';
}

/**
 * The standalone root's `.gitignore`. Synthesized (not shipped as a template
 * file) because npm strips `.gitignore` from published tarballs — a template
 * copy would silently vanish from the packed CLI. Covers install/build output
 * plus the dev multiplayer harness's per-instance `.dev-userdata/` dirs
 * (§4.32, Invariant #78), which are wiped and recreated on every run.
 */
export function buildStandaloneGitignore(): string {
    return ['node_modules/', 'dist/', 'out/', '.next/', '.e2e-build/', '.dev-userdata/', ''].join(
        '\n',
    );
}

/**
 * The `scripts/launch.mjs` the standalone root's `start` script runs (`pnpm start`).
 *
 * It spawns the game's Electron app with `ELECTRON_RUN_AS_NODE` REMOVED from the child
 * environment. When that variable is set in the parent shell — some IDE terminals, CI runners,
 * and agent sandboxes export it globally — the `electron` binary boots as plain Node.js, so
 * `require('electron')` yields the executable PATH instead of the API object and the app dies at
 * startup with a cryptic `TypeError: Cannot read properties of undefined` (the "electron
 * apps/<game> crashes the terminal" report). Deleting it unconditionally makes `pnpm start` work
 * from any terminal. `cross-env` can only SET a var, never delete one, and `electron`'s Node-mode
 * decision is made from the var's mere presence — so a tiny launcher that spawns a clean child is
 * the portable fix.
 *
 * Emitted as `.mjs` so Node treats it as ESM regardless of the (module-type-free) root
 * package.json — same rationale as the published CLI bin. `createRequire(import.meta.url)` gives
 * the `require('electron')` that, run as plain Node here, resolves to the Electron binary path.
 * Pure: a string template over the kebab, mirroring the other synthesizers.
 */
export function buildStandaloneLauncherScript(kebab: string): string {
    return `#!/usr/bin/env node
// scripts/launch.mjs — launch this game's Electron app with a clean runtime env.
// Generated by create-chimera-game; run via \`pnpm start\`.
//
// Strips ELECTRON_RUN_AS_NODE before spawning Electron. When that variable is set in the parent
// environment — some IDE terminals, CI runners, and agent sandboxes export it globally — the
// \`electron\` binary boots as plain Node.js, so \`require('electron')\` yields the executable PATH
// instead of the API object and the app dies at startup with a cryptic "Cannot read properties of
// undefined". Removing it unconditionally makes this work from any terminal.
//
// Build the app first (once, and after UI/main changes):
//   pnpm exec next build apps/${kebab}/renderer
//   pnpm --filter @chimera-engine/${kebab} build:app
//
// \`pnpm start\` runs production-default (fullscreen). \`pnpm start:debug\` passes --debug for a
// developer run: windowed with DevTools + the F9 Debug Inspector.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

// Running as plain Node here, so \`require('electron')\` resolves to the Electron binary PATH
// (its documented Node-side export) rather than the API object.
const require = createRequire(import.meta.url);
const electronBinary = require('electron');

const env = { ...process.env };
delete env['ELECTRON_RUN_AS_NODE'];

// --debug (\`pnpm start:debug\`): launch in the engine's developer mode. CHIMERA_ENV=development
// boots windowed (not fullscreen) with Chromium DevTools; CHIMERA_DEBUG=1 plus a non-production
// NODE_ENV flips IS_DEBUG_MODE on so the Runtime Debug Layer + F9 Inspector load. The production
// debug guard only fires when NODE_ENV==='production', so setting it to 'development' keeps quiet.
if (process.argv.includes('--debug')) {
    env['NODE_ENV'] = 'development';
    env['CHIMERA_ENV'] = 'development';
    env['CHIMERA_DEBUG'] = '1';
}

const child = spawn(electronBinary, ['apps/${kebab}'], { stdio: 'inherit', env });
child.on('exit', (code, signal) => {
    process.exit(signal !== null ? 1 : code ?? 0);
});
`;
}

/**
 * The standalone project's `.vscode/launch.json`: a "Run <Game>" config and a source-map-bound
 * "Debug <Game>" config, both launching the built Electron app through the `node` debugger — which
 * auto-injects the V8 inspector into the spawned `electron` binary, so no `--inspect` flag is
 * needed. The Debug config's `outFiles` + `sourceMaps` bind MAIN-process breakpoints against the
 * app's own source inlined into `dist/electron/main.js` (relies on esbuild `sourcemap: true` in
 * build-main). Renderer/UI code is debugged in the Chromium DevTools window instead.
 *
 * Standalone-only + root-placed: the generated project root IS the workspace VS Code opens, so
 * `${workspaceFolder}` resolves `node_modules/.bin/electron` at the root and `apps/<kebab>`
 * relative to it. Pure string over kebab + title, mirroring the other synthesizers.
 */
export function buildStandaloneVscodeLaunchJson(kebab: string, title: string): string {
    const shared = {
        type: 'node',
        request: 'launch',
        cwd: '${workspaceFolder}',
        runtimeExecutable: '${workspaceFolder}/node_modules/.bin/electron',
        args: [`apps/${kebab}`],
        env: { NODE_ENV: 'development', CHIMERA_ENV: 'development', CHIMERA_DEBUG: '1' },
        console: 'integratedTerminal',
        preLaunchTask: `Build ${title} (renderer + bundle)`,
        skipFiles: ['<node_internals>/**', '**/node_modules/**'],
    };
    const config = {
        version: '0.2.0',
        configurations: [
            { name: `Run ${title}`, ...shared },
            {
                name: `Debug ${title}`,
                ...shared,
                outFiles: [`\${workspaceFolder}/apps/${kebab}/dist/electron/**/*.js`],
                sourceMaps: true,
                smartStep: true,
            },
        ],
    };
    return `${JSON.stringify(config, null, 4)}\n`;
}

/**
 * The standalone `.vscode/tasks.json`: the `preLaunchTask` both launch configs run before starting
 * the app. Rebuilds the renderer static export (with CHIMERA_DEBUG=1 so browser source maps emit
 * for DevTools) and re-bundles the Electron main/preload, so a launch always reflects current
 * source. Drops the monorepo's `build:packages` step (a no-op stub in a standalone project). Pure.
 */
export function buildStandaloneVscodeTasksJson(kebab: string, title: string): string {
    const config = {
        version: '2.0.0',
        tasks: [
            {
                label: `Build ${title} (renderer + bundle)`,
                type: 'shell',
                command:
                    `pnpm exec cross-env CHIMERA_DEBUG=1 next build apps/${kebab}/renderer && ` +
                    `pnpm --filter @chimera-engine/${kebab} build:app`,
                options: { cwd: '${workspaceFolder}' },
                problemMatcher: [],
                presentation: { reveal: 'always', focus: false, panel: 'shared', clear: true },
            },
        ],
    };
    return `${JSON.stringify(config, null, 4)}\n`;
}

/**
 * The standalone-root `tsconfig.json`: just the frozen root `compilerOptions`. The scaffolded
 * app's `tsconfig.json` / `tsconfig.build.json` / `e2e/tsconfig.json` all `extends` this root two/
 * three levels up; `extends` only merges `compilerOptions`, so emitting them here is exactly what
 * those configs need to resolve outside the monorepo. Plain JSON (no comments) so any tool can
 * parse it.
 */
export function buildStandaloneRootTsconfig(
    compilerOptions: Readonly<Record<string, unknown>>,
): string {
    return `${JSON.stringify({ compilerOptions }, null, 4)}\n`;
}

export interface StandaloneAppRewriteParams {
    /** `@chimera-engine/* : ^x.y.z` ranges (the published engine versions) from the toolchain snapshot. */
    readonly engineRanges: Readonly<Record<string, string>>;
    /**
     * The value injected as `CHIMERA_VERIFY_PACK_NODE_MODULES` into the app's `build:app` and
     * `test:e2e` scripts (via `cross-env`). Outside the monorepo there is no `electron/` SOURCE for
     * the app's Electron bundler to alias `@chimera-engine/electron/main` onto, so this env makes
     * build-main resolve the host + preload from the installed `@chimera-engine/electron` instead. Default
     * `node_modules` resolves relative to the app dir (pnpm runs the script with cwd = app dir).
     */
    readonly nodeModulesEnv: string;
}

/**
 * Transform a scaffolded app's `package.json` for a STANDALONE (out-of-monorepo) install:
 *
 *   1. rewrite every `@chimera-engine/*` dependency (a `workspace:*` spec inside the monorepo) onto its
 *      published `^x.y.z` range, so a plain `pnpm/npm install` resolves them from the registry —
 *      across BOTH `dependencies` and `devDependencies`. The blank template carries the engine
 *      packages under `devDependencies` (they are esbuild-inlined at build time and kept out of
 *      electron-builder's prod tree), so a section-blind rewrite would leave a `workspace:*`
 *      spec that a standalone `npm install` rejects; and
 *   2. prefix `build:app` + `test:e2e` with `cross-env CHIMERA_VERIFY_PACK_NODE_MODULES=<value>` so
 *      the app's Electron bundler resolves `@chimera-engine/electron`'s host/preload from `node_modules`
 *      (there is no monorepo `electron/` source to alias). The script's semantics are unchanged
 *      otherwise; build-main.ts itself is NOT modified (it is byte-shared with apps/tactics).
 *
 * Pure: parses + reserializes the manifest; idempotent on the env injection (skips if already set).
 */
export function rewriteAppPackageForStandalone(
    rawAppPkg: string,
    params: StandaloneAppRewriteParams,
): string {
    const pkg = JSON.parse(rawAppPkg) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        scripts?: Record<string, string>;
        [key: string]: unknown;
    };

    const rewriteSection = (section: Record<string, string> | undefined): void => {
        if (section === undefined) return;
        for (const name of Object.keys(section)) {
            if (name.startsWith('@chimera-engine/')) {
                const range = params.engineRanges[name];
                if (range !== undefined) section[name] = range;
            }
        }
    };
    rewriteSection(pkg.dependencies);
    rewriteSection(pkg.devDependencies);

    const scripts = pkg.scripts ?? {};
    for (const key of ['build:app', 'test:e2e']) {
        const command = scripts[key];
        if (command !== undefined && !command.includes('CHIMERA_VERIFY_PACK_NODE_MODULES')) {
            scripts[key] =
                `cross-env CHIMERA_VERIFY_PACK_NODE_MODULES=${params.nodeModulesEnv} ${command}`;
        }
    }
    pkg.scripts = scripts;

    return `${JSON.stringify(pkg, null, 4)}\n`;
}

/**
 * Neutralise the scaffolded app's `tsconfig.build.json` `references` for a STANDALONE build.
 *
 * In the monorepo the app's composite build references its engine deps as sibling projects
 * (`../../simulation/tsconfig.build.json`, …) so `tsc -b` orders the graph (Invariant #1). OUTSIDE
 * the monorepo those directories do not exist — `tsc -p tsconfig.build.json` would error TS6053
 * ("file not found") / TS6306 on every reference. The installed `@chimera-engine/*` packages ship
 * their own built `.d.ts`, so the app's production typecheck resolves the engine through ordinary
 * `node_modules` resolution with NO project references. This empties the `references` array to `[]`,
 * leaving every comment + the composite `compilerOptions` (which are still valid with no references)
 * intact.
 *
 * Pure regex splice (the template is JSONC — comments — so it cannot be `JSON.parse`d). The
 * `references` value holds only `{ "path": … }` objects (no nested `[`), so a non-greedy match to
 * the first `]` is the array close. Idempotent: an already-emptied `[]` re-matches to `[]`, and a
 * config with no `references` key is left unchanged.
 */
export function rewriteAppTsconfigBuildForStandalone(rawTsconfig: string): string {
    return rawTsconfig.replace(/"references"\s*:\s*\[[\s\S]*?\]/, '"references": []');
}

/**
 * Neutralise the scaffolded app's `e2e/tsconfig.json` `paths` for a STANDALONE run.
 *
 * The Playwright runner resolves bare `@chimera-engine/*` specifiers via tsconfig `paths` (it has no
 * vite/webpack alias hook). In the monorepo those map onto each engine package's built `dist`
 * (`simulation/dist/*`, …) — repo-root directories that do not exist standalone. Installed
 * standalone, the engine packages live in the app's own `node_modules`, so the runner resolves them
 * by ordinary node-resolution from `apps/<game>/e2e/`; the monorepo dist mappings must go. The
 * game's OWN path (`@chimera-engine/<game>` glob → `apps/<game>` glob) is already standalone-valid
 * (the app source lives at the standalone root's `apps/` dir) and is kept, alongside `baseUrl` +
 * comments.
 *
 * Pure regex splice. Each engine entry's target is a monorepo `dist` path, so we drop every
 * `@chimera-engine` line whose target array contains `dist`; the game entry's target (`apps/<game>`)
 * carries no `dist`, so it survives — and it is the last entry (no trailing comma), so the object
 * stays valid JSONC. Idempotent: once the `dist` entries are gone, a re-run matches nothing.
 */
export function rewriteE2eTsconfigForStandalone(rawTsconfig: string): string {
    return rawTsconfig.replace(
        /^[ \t]*"@chimera-engine\/[^"]*"\s*:\s*\[[^\]]*dist[^\]]*\],?\n/gm,
        '',
    );
}

/**
 * The unit-arm vitest config the generated app's `test` script loads via
 * `--config ../../vitest.config.mts`. It maps the app's OWN relative `.js` smoke imports onto
 * co-located TS source (never node_modules), and deliberately does NOT remap bare `@chimera-engine/*`
 * specifiers — those resolve through the installed packages' published `exports` (the public
 * surface), never workspace source. `@chimera-engine/*` is INLINED (transformed by vite, not
 * externalized to Node ESM) so the packed dist's extensionless relative re-exports load — exactly
 * how the engine's own tests consume the symlinked renderer; resolution still flows through
 * `exports`, so a missing barrel still fails (Invariant #96). The one alias wires the synthetic
 * `chimera-game-registration` seam onto the app's own register.
 */
export function buildStandaloneVitestConfig(kebab: string): string {
    return `// Generated by create-chimera-game — standalone unit-smoke vitest config.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
    plugins: [
        {
            name: 'scaffold-prefer-ts-source',
            enforce: 'pre',
            resolveId(source, importer) {
                if (importer === undefined || !source.startsWith('.') || !source.endsWith('.js')) {
                    return null;
                }
                const importerPath = importer.split('?')[0];
                if (importerPath === undefined || !importerPath.startsWith(root)) return null;
                // Only the app's own source maps .js -> .ts/.tsx; packed deps keep their .js.
                if (importerPath.includes('node_modules')) return null;
                const base = path.resolve(path.dirname(importerPath), source).slice(0, -3);
                for (const ext of ['.ts', '.tsx']) {
                    if (existsSync(base + ext)) return base + ext;
                }
                return null;
            },
        },
    ],
    resolve: {
        alias: {
            'chimera-game-registration': path.resolve(root, 'apps/${kebab}/renderer/register.ts'),
        },
    },
    test: {
        environment: 'node',
        include: ['**/*.test.ts', '**/*.test.tsx'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.e2e-build/**'],
        server: { deps: { inline: [/@chimera-engine\\//] } },
        globals: false,
        restoreMocks: true,
        clearMocks: true,
        testTimeout: 60_000,
    },
});
`;
}
