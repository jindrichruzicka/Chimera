import { existsSync as nodeExistsSync } from 'node:fs';
import path from 'node:path';
import { type Plugin } from 'vitest/config';

export type ResolverPlugin = Readonly<{
    readonly name: string;
    readonly enforce: 'pre';
    readonly resolveId: (source: string, importer: string | undefined) => string | null;
}>;

/**
 * Maps each `@chimera/<pkg>` workspace package onto its source directory
 * (relative to the workspace root). F57 removes the tsconfig `paths` aliases, so
 * this plugin — not vite-tsconfig-paths — is what lets vitest resolve bare
 * `@chimera/*` specifiers onto in-tree TypeScript source while no `dist/` build
 * exists yet. `@chimera/tactics` lives under `games/tactics`; the rest are
 * top-level. Mirrors the webpack aliases in `renderer/next.config.ts`.
 */
const CHIMERA_PACKAGE_DIRS: Readonly<Record<string, string>> = {
    // `@chimera/simulation`, `@chimera/ai`, and `@chimera/networking` are
    // intentionally absent: each is a built package consumed through its
    // `exports` map onto `<pkg>/dist`. Leaving them out lets Vite's default
    // resolver honour the exports map (build-before-consume), so other packages'
    // tests exercise the packaged artefact. Their own tests use relative imports
    // and therefore never hit this map.
    '@chimera/renderer': 'renderer',
    '@chimera/electron': 'electron',
    '@chimera/tactics': 'games/tactics',
};

/**
 * Resolve a bare `@chimera/<pkg>[/subpath]` specifier onto its TypeScript
 * source, preferring `.ts`/`.tsx` over the imported `.js` (TS-style extension
 * rewriting), falling back to `index.ts`/`index.tsx` for extensionless
 * subpaths, and passing non-TS assets (e.g. `.css`) through to their literal
 * mapped path. Returns the first candidate that exists, or `null` when the
 * specifier is not a known `@chimera/*` package or nothing exists on disk.
 */
function resolveChimeraPackageSource(
    source: string,
    workspaceRoot: string,
    existsSync: (path: string) => boolean,
): string | null {
    const match = /^(@chimera\/[^/]+)(\/.*)?$/u.exec(source);
    if (match === null) {
        return null;
    }
    const pkg = match[1];
    if (pkg === undefined) {
        return null;
    }
    const dir = CHIMERA_PACKAGE_DIRS[pkg];
    if (dir === undefined) {
        return null;
    }

    const subpath = match[2] ?? '';
    const base = path.join(workspaceRoot, dir, subpath);

    let candidates: readonly string[];
    if (subpath === '' || subpath === '/') {
        candidates = [path.join(base, 'index.ts'), path.join(base, 'index.tsx')];
    } else if (base.endsWith('.js')) {
        const noExt = base.slice(0, -'.js'.length);
        candidates = [`${noExt}.ts`, `${noExt}.tsx`, base];
    } else if (/\.(?:ts|tsx|css|json|mjs|cjs)$/u.test(base)) {
        candidates = [base];
    } else {
        candidates = [
            `${base}.ts`,
            `${base}.tsx`,
            path.join(base, 'index.ts'),
            path.join(base, 'index.tsx'),
        ];
    }

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    return null;
}

/**
 * Create a Vite resolver plugin that prefers TypeScript sources when importing .js specifiers.
 * Maintains a cache of resolution results with re-validation on each access to handle
 * watch mode file creation/deletion scenarios.
 *
 * @param workspaceRoot - Root directory for resolving imports
 * @param existsSync - Optional file existence checker (for testing); defaults to node:fs.existsSync
 */
export function createPreferTypeScriptSourceResolver(
    workspaceRoot: string,
    existsSync: (path: string) => boolean = nodeExistsSync,
): ResolverPlugin & {
    readonly resolveId: (source: string, importer: string | undefined) => string | null;
} {
    const resolved = new Map<string, string | null>();

    // Compile-time guard: keeps ResolverPlugin in sync with Vite's Plugin API.
    // If Plugin's interface changes incompatibly, tsc will report an error on the
    // `satisfies Plugin` expression inside createPreferTypeScriptSourceResolver.
    const plugin = {
        name: 'chimera-prefer-typescript-source-for-js-specifiers',
        enforce: 'pre',
        resolveId(source: string, importer: string | undefined): string | null {
            // Bare `@chimera/*` workspace-package specifiers resolve from the
            // workspace root (independent of the importer) onto TS source.
            if (source.startsWith('@chimera/')) {
                return resolveChimeraPackageSource(source, workspaceRoot, existsSync);
            }
            if (importer === undefined || !source.startsWith('.') || !source.endsWith('.js')) {
                return null;
            }

            const [importerPath] = importer.split('?');
            if (!importerPath?.startsWith(workspaceRoot)) {
                return null;
            }

            const resolvedPath = path.resolve(path.dirname(importerPath), source);
            const tsSourcePath = `${resolvedPath.slice(0, -'.js'.length)}.ts`;

            // Always check the current file state (required for both cache hits and misses).
            // This is called on every access to handle watch mode file creation/deletion.
            const fileCurrentlyExists = existsSync(tsSourcePath);

            if (resolved.has(tsSourcePath)) {
                const cachedResult = resolved.get(tsSourcePath) ?? null;

                // Check if the cached entry is still valid.
                // - Positive cache: file still exists after being resolved
                // - Negative cache: file still doesn't exist (hasn't been created)
                const cachedStateStillValid =
                    (cachedResult !== null && fileCurrentlyExists) || // Positive: file still exists
                    (cachedResult === null && !fileCurrentlyExists); // Negative: file still missing

                if (cachedStateStillValid) {
                    return cachedResult;
                }

                // Cache entry no longer valid (state changed); invalidate and recompute
                resolved.delete(tsSourcePath);
            }

            // Compute new result based on current file state
            const result = fileCurrentlyExists ? tsSourcePath : null;
            resolved.set(tsSourcePath, result);
            return result;
        },
    } satisfies Plugin;

    return plugin;
}
