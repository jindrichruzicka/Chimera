import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { createPreferTypeScriptSourceResolver } from './tools/vitest-resolver-plugin';

const workspaceRoot = import.meta.dirname;

// Vitest defaults to `availableParallelism() - 1` forks, all of which pull
// module transforms from the single main-thread Vite pipeline. On high-core
// machines that saturates the main thread for >60s, tripping birpc's
// `onTaskUpdate` timeout on the heavy renderer suite (and starving slow async
// tests waiting on transforms). Bounding the pool keeps the main thread
// responsive; by avoiding redundant cold transforms it is also *faster* on the
// renderer suite. The bottleneck is one main thread, so the cap is a small
// constant rather than core-scaled.
const availableParallelism = os.availableParallelism?.() ?? os.cpus().length;
const MAX_TEST_FORKS = Math.max(2, Math.min(4, availableParallelism - 1));

const VIRTUAL_PREFIX = '\0chimera-raw-css:';
const VIRTUAL_PREFIX_STRIPPED = 'chimera-raw-css:';
const VIRTUAL_SUFFIX = '.js'; // prevents vite:css from re-transforming the virtual module

export default defineConfig({
    plugins: [
        {
            name: 'chimera-css-raw',
            enforce: 'pre',
            resolveId(source: string, importer: string | undefined): string | null {
                if (!source.endsWith('.css?raw')) {
                    return null;
                }
                const cssPath = source.slice(0, -'?raw'.length);
                const resolved = importer
                    ? path.resolve(path.dirname(importer.split('?')[0] ?? ''), cssPath)
                    : cssPath;
                return `${VIRTUAL_PREFIX}${resolved}${VIRTUAL_SUFFIX}`;
            },
            load(id: string): string | null {
                const isVirtual =
                    id.startsWith(VIRTUAL_PREFIX) || id.startsWith(VIRTUAL_PREFIX_STRIPPED);
                if (!isVirtual || !id.endsWith(VIRTUAL_SUFFIX)) {
                    return null;
                }
                const filePath = id.startsWith(VIRTUAL_PREFIX)
                    ? id.slice(VIRTUAL_PREFIX.length, -VIRTUAL_SUFFIX.length)
                    : id.slice(VIRTUAL_PREFIX_STRIPPED.length, -VIRTUAL_SUFFIX.length);
                const content = readFileSync(filePath, 'utf8');
                return `export default ${JSON.stringify(content)}`;
            },
        },
        // Resolves both relative `.js`→`.ts` specifiers and bare `@chimera/*`
        // workspace packages onto in-tree TypeScript source. Replaces
        // vite-tsconfig-paths, which read the `@chimera/*` tsconfig `paths`
        // aliases removed in F57 (#752).
        createPreferTypeScriptSourceResolver(workspaceRoot),
    ],
    test: {
        name: 'chimera',
        environment: 'node',
        pool: 'forks',
        poolOptions: {
            forks: {
                minForks: 1,
                maxForks: MAX_TEST_FORKS,
            },
        },
        testTimeout: 60_000,
        include: ['**/*.test.ts', '**/*.test.tsx'],
        exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**'],
        globals: false,
        restoreMocks: true,
        clearMocks: true,
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html', 'lcov'],
            include: [
                'app/**/*.ts',
                'electron/**/*.ts',
                'simulation/**/*.ts',
                'ai/**/*.ts',
                'renderer/**/*.ts',
                'games/**/*.ts',
                'networking/**/*.ts',
                'tools/**/*.ts',
            ],
            exclude: ['**/*.test.ts', '**/*.test.tsx', '**/node_modules/**', '**/out/**'],
        },
    },
});
