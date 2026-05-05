import { existsSync as nodeExistsSync } from 'node:fs';
import path from 'node:path';
import { type Plugin } from 'vitest/config';

export type ResolverPlugin = Readonly<{
    readonly name: string;
    readonly enforce: 'pre';
    readonly resolveId: (source: string, importer: string | undefined) => string | null;
}>;

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
