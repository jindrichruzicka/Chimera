import { existsSync } from 'node:fs';
import path from 'node:path';
import { type Plugin, defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

const workspaceRoot = import.meta.dirname;

const resolved = new Map<string, string | null>();

// Compile-time guard: keeps ResolverPlugin in sync with Vite's Plugin API.
// If Plugin's interface changes incompatibly, tsc will report an error on the
// `satisfies Plugin` expression inside preferTypeScriptSourceForJsSpecifiers.
interface ResolverPlugin {
    readonly name: string;
    readonly enforce: 'pre';
    readonly resolveId: (source: string, importer: string | undefined) => string | null;
}

function preferTypeScriptSourceForJsSpecifiers(): ResolverPlugin {
    // satisfies Plugin validates the object shape against the real Vite API at
    // compile time while preserving the narrow return type (no any propagation).
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

            if (resolved.has(tsSourcePath)) {
                const cachedResult = resolved.get(tsSourcePath) ?? null;
                // Re-validate positive cache entries: a file deleted during watch mode
                // must not remain redirected after deletion (WARN-4).
                if (cachedResult === null || existsSync(cachedResult)) {
                    return cachedResult;
                }
                resolved.delete(tsSourcePath);
            }

            const result = existsSync(tsSourcePath) ? tsSourcePath : null;
            resolved.set(tsSourcePath, result);
            return result;
        },
    } satisfies Plugin;
    return plugin;
}

export default defineConfig({
    plugins: [preferTypeScriptSourceForJsSpecifiers(), tsconfigPaths()],
    test: {
        name: 'chimera',
        environment: 'node',
        include: ['**/*.test.ts', '**/*.test.tsx'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**'],
        globals: false,
        restoreMocks: true,
        clearMocks: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: [
                'electron/**/*.ts',
                'simulation/**/*.ts',
                'ai/**/*.ts',
                'renderer/**/*.ts',
                'shared/**/*.ts',
                'games/**/*.ts',
                'networking/**/*.ts',
                'tools/**/*.ts',
            ],
            exclude: ['**/*.test.ts', '**/*.test.tsx', '**/node_modules/**', '**/out/**'],
        },
    },
});
