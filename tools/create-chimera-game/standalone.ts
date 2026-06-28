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
 * `@chimera-engine/*` onto the gate's tarballs, and stubs `build:packages` to a no-op — the generated
 * app's e2e `global-setup` runs `pnpm build:packages` from this root, but the engine packages
 * arrive prebuilt (npm or tarball), so it must not (and cannot) run the engine's real `tsc`
 * build here. The `onlyBuiltDependencies` allowlist lets pnpm run electron's + esbuild's install
 * scripts so the e2e arm has a usable Electron binary + esbuild platform binary.
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
        scripts: { 'build:packages': 'node -e ""' },
        pnpm: {
            ...(overrides !== undefined ? { overrides: { ...overrides } } : {}),
            onlyBuiltDependencies: ['electron', 'esbuild'],
        },
    };
}

/** The `pnpm-workspace.yaml` for the standalone root: the scaffolded app is the lone member. */
export function buildStandaloneWorkspaceYaml(): string {
    return 'packages:\n  - apps/*\n';
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
 *      published `^x.y.z` range, so a plain `pnpm/npm install` resolves them from the registry; and
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
        scripts?: Record<string, string>;
        [key: string]: unknown;
    };

    const deps = pkg.dependencies ?? {};
    for (const name of Object.keys(deps)) {
        if (name.startsWith('@chimera-engine/')) {
            const range = params.engineRanges[name];
            if (range !== undefined) deps[name] = range;
        }
    }
    pkg.dependencies = deps;

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
