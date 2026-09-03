import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { createPreferTypeScriptSourceResolver } from './tools/vitest-resolver-plugin';

const workspaceRoot = import.meta.dirname;

// Cap at 1: a single fork avoids redundant cold transforms and is *faster* on
// the renderer suite. The bottleneck is one main thread (Vite transforms run
// there), so the cap is a small constant rather than core-scaled.
//
// What the cap does NOT buy is immunity from birpc's `onTaskUpdate` timeout.
// That reply is read by the WORKER, and only when its event loop is free: a
// test file that holds the loop synchronously for a minute — a chain of
// `spawnSync` eslint runs, measured on the CI runner at this very cap — ends
// with every test green and one unhandled `[vitest-worker]: Timeout calling
// "onTaskUpdate"`, which fails the run. The cure lives in the test file, which
// must spawn asynchronously — `tools/eslint-dynamic-games-import-zone.test.ts`
// and its tactics sibling do.
const MAX_TEST_FORKS = 1;

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
        // Resolves both relative `.js`→`.ts` specifiers and bare `@chimera-engine/*`
        // workspace packages onto in-tree TypeScript source. Replaces
        // vite-tsconfig-paths, which read the `@chimera-engine/*` tsconfig `paths`
        // aliases removed in F57 (#752).
        createPreferTypeScriptSourceResolver(workspaceRoot),
    ],
    resolve: {
        alias: {
            // The synthetic game-registration specifier (#784): `renderer/**` names
            // no game and pulls the active game's renderer contribution in through
            // this build-selected alias (mirrors `renderer/next.config.ts`). The
            // test harness selects tactics, the same way the resolver plugin maps
            // `@chimera-engine/tactics` onto apps/tactics — so any test that mounts the
            // renderer's `AppShell`/`GameRegistrationBootstrap` resolves it.
            'chimera-game-registration': path.resolve(
                workspaceRoot,
                'apps/tactics/renderer/register.ts',
            ),
        },
    },
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
        // The bundled scaffolding skeletons hold tokenised game-app source (consumed only by
        // create-chimera-game, never built in place). Their co-located smoke tests carry raw
        // `__token__` placeholders and a tsconfig that `extends` the SCAFFOLDED app's root, so the
        // engine's own vitest must not collect them; a scaffolded app runs them from `apps/<name>/`
        // via `--dir .`. The `**/`-prefixed glob matches whether the run is workspace-rooted
        // (`vitest run`) or tools-rooted (`vitest run --dir tools`, the gate) — a bare
        // `tools/...` glob silently fails to match under `--dir tools`.
        exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/out/**',
            '**/build/**',
            '**/create-chimera-game/templates/**',
        ],
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
                'apps/tactics/**/*.ts',
                'apps/action/**/*.ts',
                'networking/**/*.ts',
                'tools/**/*.ts',
            ],
            exclude: [
                '**/*.test.ts',
                '**/*.test.tsx',
                '**/node_modules/**',
                '**/out/**',
                '**/dist/**',
                // Tokenised scaffolding skeletons — not real source, never imported in place.
                '**/create-chimera-game/templates/**',
            ],
        },
    },
});
