import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';
import { createPreferTypeScriptSourceResolver } from './tools/vitest-resolver-plugin';

const workspaceRoot = import.meta.dirname;

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
        createPreferTypeScriptSourceResolver(workspaceRoot),
        tsconfigPaths(),
    ],
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
