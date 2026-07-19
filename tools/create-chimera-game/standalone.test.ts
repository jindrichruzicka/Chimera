import { describe, expect, it } from 'vitest';
import {
    buildStandaloneGitignore,
    buildStandaloneLauncherScript,
    buildStandaloneRootManifest,
    buildStandaloneRootTsconfig,
    buildStandaloneToolchainDeps,
    buildStandaloneVitestConfig,
    buildStandaloneVscodeLaunchJson,
    buildStandaloneVscodeTasksJson,
    buildStandaloneWorkspaceYaml,
    rewriteAppPackageForStandalone,
    rewriteAppTsconfigBuildForStandalone,
    rewriteE2eTsconfigForStandalone,
} from './standalone';

/**
 * Unit tests for the pure standalone-root synthesizers shared by the published
 * create-chimera-game CLI and the verify:scaffold gate. They assert the toolchain-deps
 * derivation, the root manifest shape in BOTH the npm-resolved (no overrides) and the
 * gate's tarball-resolved (overrides supplied) forms, the workspace yaml, and the
 * self-contained unit-arm vitest config.
 */

describe('buildStandaloneToolchainDeps', () => {
    it('merges root deps + devDeps and strips every @chimera-engine/* workspace entry', () => {
        const deps = buildStandaloneToolchainDeps({
            dependencies: { three: '^0.184', '@chimera-engine/renderer': 'workspace:*' },
            devDependencies: {
                vitest: '^3',
                '@chimera-engine/tactics': 'workspace:*',
                next: '^15',
            },
        });
        expect(deps).toEqual({ three: '^0.184', vitest: '^3', next: '^15' });
        expect(Object.keys(deps).some((k) => k.startsWith('@chimera-engine/'))).toBe(false);
    });
});

describe('buildStandaloneRootManifest', () => {
    it('declares the toolchain, stubs build:packages, and emits NO overrides for the npm-resolved form', () => {
        const manifest = buildStandaloneRootManifest({
            name: 'my-game',
            toolchainDeps: { next: '^15', electron: '^33' },
            packageManager: 'pnpm@10.33.0',
            engines: { node: '>=20.0.0' },
        });
        expect(manifest.private).toBe(true);
        expect(manifest.name).toBe('my-game');
        expect(manifest.devDependencies['next']).toBe('^15');
        // The pnpm + Node envelope the monorepo tests is frozen into the scaffold: pnpm 10
        // self-switches to the pinned packageManager, and engines documents the Node floor.
        expect(manifest.packageManager).toBe('pnpm@10.33.0');
        expect(manifest.engines).toEqual({ node: '>=20.0.0' });
        // No @chimera-engine/* leaks into the declared deps (the app declares them, resolved from npm).
        expect(
            Object.keys(manifest.devDependencies).some((k) => k.startsWith('@chimera-engine/')),
        ).toBe(false);
        // The published form has no pnpm.overrides — npm resolution, not tarballs.
        expect(manifest.pnpm.overrides).toBeUndefined();
        // electron + esbuild install scripts are allowed (e2e needs the binaries).
        expect(manifest.pnpm.onlyBuiltDependencies).toEqual(['electron', 'esbuild']);
        // sharp's script is intentionally ignored (unused prebuilt Next.js dep) so a fresh
        // install prints no "ignored build scripts" warning.
        expect(manifest.pnpm.ignoredBuiltDependencies).toEqual(['sharp']);
        // global-setup runs `pnpm build:packages` from this root: it must be a no-op (packages
        // arrive prebuilt), never the engine's real build.
        expect(manifest.scripts['build:packages']).toBeDefined();
        expect(manifest.scripts['build:packages']).not.toContain('tsc');
        // The standalone root carries the per-game packaging flow (the standalone twin of the
        // monorepo's `package:<game>`): build the renderer + app bundle, then electron-builder.
        // It omits `build:packages` (the engine arrives prebuilt) and drives the app by filter.
        expect(manifest.scripts['package']).toContain('next build apps/my-game/renderer');
        expect(manifest.scripts['package']).toContain('@chimera-engine/my-game build:app');
        expect(manifest.scripts['package']).toContain('@chimera-engine/my-game run package');
        expect(manifest.scripts['package']).not.toContain('build:packages');
        // `pnpm start` runs the launcher, which strips ELECTRON_RUN_AS_NODE before spawning
        // Electron — otherwise a raw `electron apps/<game>` in a leaked env crashes at startup.
        expect(manifest.scripts['start']).toBe('node scripts/launch.mjs');
        // `pnpm start:debug` runs the same launcher with --debug: developer mode + the F9
        // Debug Inspector (CHIMERA_ENV/NODE_ENV=development + CHIMERA_DEBUG=1, set in the launcher).
        expect(manifest.scripts['start:debug']).toBe('node scripts/launch.mjs --debug');
        // `pnpm dev:mp` mirrors `package`'s build chain (renderer + app bundle) and then
        // delegates to the app's dev:mp (the chimera-dev-mp bin, §4.32) — trailing args
        // (`pnpm dev:mp 3 --scenario x`) land on the delegated script.
        expect(manifest.scripts['dev:mp']).toContain('next build apps/my-game/renderer');
        expect(manifest.scripts['dev:mp']).toContain('@chimera-engine/my-game build:app');
        expect(manifest.scripts['dev:mp']?.endsWith('@chimera-engine/my-game dev:mp')).toBe(true);
        // Per-platform packaging scripts (the standalone twin of the monorepo's
        // `package:<game>:<platform>`), driven by the .vscode Package launch configs. Each
        // mirrors `package`'s build chain then runs electron-builder with the platform flag.
        const platforms: Readonly<Record<string, string>> = {
            'package:my-game:mac-dir': '--mac dir',
            'package:my-game:mac-dmg': '--mac dmg',
            'package:my-game:win': '--win nsis',
            'package:my-game:linux-appimage': '--linux AppImage',
            'package:my-game:linux-dir': '--linux dir',
        };
        for (const [script, flag] of Object.entries(platforms)) {
            const command = manifest.scripts[script];
            expect(command, `${script} must exist`).toBeDefined();
            expect(command).toContain('next build apps/my-game/renderer');
            expect(command).toContain('@chimera-engine/my-game build:app');
            expect(command).toContain(`exec electron-builder ${flag}`);
            expect(command).not.toContain('build:packages');
        }
    });

    it('carries the supplied pnpm.overrides for the gate tarball-resolved form', () => {
        const overrides = { '@chimera-engine/renderer': 'file:/tmp/chimera-renderer-0.9.0.tgz' };
        const manifest = buildStandaloneRootManifest({
            name: 'chimera-verify-scaffold-root',
            toolchainDeps: { next: '^15' },
            packageManager: 'pnpm@10.33.0',
            engines: { node: '>=20.0.0' },
            overrides,
        });
        expect(manifest.pnpm.overrides).toEqual(overrides);
        // overrides is a copy, not the caller's object.
        expect(manifest.pnpm.overrides).not.toBe(overrides);
    });
});

describe('buildStandaloneGitignore', () => {
    it('ignores install/build/runtime artefacts including the dev-harness userData dirs', () => {
        const gitignore = buildStandaloneGitignore();
        for (const entry of [
            'node_modules/',
            'dist/',
            'out/',
            '.next/',
            '.e2e-build/',
            '.dev-userdata/',
        ]) {
            expect(gitignore).toContain(entry);
        }
        expect(gitignore.endsWith('\n')).toBe(true);
    });
});

describe('buildStandaloneLauncherScript', () => {
    it('spawns the game app with ELECTRON_RUN_AS_NODE stripped from the child env', () => {
        const script = buildStandaloneLauncherScript('my-game');
        // Launches THIS game's app dir.
        expect(script).toContain("'apps/my-game'");
        // Resolves the electron BINARY path (the Node-side export) and spawns it as a child.
        expect(script).toContain("require('electron')");
        expect(script).toContain('spawn');
        // Removes the Node-mode flag so the `electron` binary runs as Electron, not plain Node —
        // the root cause of the "electron apps/<game> crashes the terminal" report.
        expect(script).toContain('ELECTRON_RUN_AS_NODE');
        expect(script).toMatch(/delete\s+env\['ELECTRON_RUN_AS_NODE'\]/);
        // ESM (.mjs forces module mode; the standalone root has no "type":"module").
        expect(script).toContain('import { spawn }');
        expect(script).toContain('createRequire(import.meta.url)');
    });

    it('bakes the given kebab into both the app path and the build hint', () => {
        const script = buildStandaloneLauncherScript('space-armada');
        expect(script).toContain("'apps/space-armada'");
        expect(script).toContain('@chimera-engine/space-armada build:app');
    });

    it('sets developer + debug env ONLY under a --debug flag (pnpm start:debug)', () => {
        const script = buildStandaloneLauncherScript('my-game');
        // The dev+debug env is gated behind the flag, not unconditional — a bare
        // `pnpm start` must stay production-default (fullscreen, no debug bridge).
        expect(script).toMatch(/process\.argv\.includes\('--debug'\)/);
        expect(script).toContain("env['NODE_ENV'] = 'development'");
        expect(script).toContain("env['CHIMERA_ENV'] = 'development'");
        expect(script).toContain("env['CHIMERA_DEBUG'] = '1'");
        // Every debug env assignment sits AFTER the --debug guard (inside the branch),
        // so it never runs for the plain `start` path.
        const guardIdx = script.indexOf("includes('--debug')");
        expect(guardIdx).toBeGreaterThan(-1);
        expect(script.indexOf("env['NODE_ENV'] = 'development'")).toBeGreaterThan(guardIdx);
        expect(script.indexOf("env['CHIMERA_DEBUG'] = '1'")).toBeGreaterThan(guardIdx);
    });
});

describe('buildStandaloneVscodeLaunchJson', () => {
    type LaunchConfig = Record<string, unknown>;
    interface Launch {
        version: string;
        configurations: LaunchConfig[];
        compounds: LaunchConfig[];
    }
    const parse = (): Launch => JSON.parse(buildStandaloneVscodeLaunchJson('my-game', 'My Game'));

    it('mirrors the tactics config set (Run / Clean / Debug compound / Vitest / Playwright / Package)', () => {
        const parsed = parse();
        expect(parsed.version).toBe('0.2.0');
        const names = parsed.configurations.map((c) => c['name']);
        // Electron launches: plain run, clean run, and the compound's main-process member.
        expect(names).toContain('Run My Game');
        expect(names).toContain('Run My Game (Clean)');
        expect(names).toContain('Debug My Game: Main process');
        expect(names).toContain('Attach My Game Renderer');
        // Test-runner + packaging parity with tactics.
        expect(names).toContain('Vitest: run all tests');
        expect(names).toContain('Vitest: debug all tests');
        expect(names).toContain('Vitest: debug current test file');
        expect(names).toContain('Playwright: run all tests');
        expect(names).toContain('Playwright: debug all tests');
        expect(names).toContain('Package: My Game — macOS (folder)');
        expect(names).toContain('Package: My Game — macOS (.dmg)');
        expect(names).toContain('Package: My Game — Windows (.exe / nsis)');
        expect(names).toContain('Package: My Game — Linux (AppImage)');
        expect(names).toContain('Package: My Game — Linux (folder)');
        // No ESLint configs: a standalone scaffold ships no eslint flat config, so an
        // `eslint .` launch would be broken out of the box.
        expect(names.some((n) => String(n).startsWith('ESLint'))).toBe(false);
    });

    it('makes "Debug My Game" a compound of the main-process launch + the renderer attach', () => {
        const parsed = parse();
        const compound = parsed.compounds.find((c) => c['name'] === 'Debug My Game');
        expect(compound).toBeDefined();
        expect(compound?.['configurations']).toEqual([
            'Debug My Game: Main process',
            'Attach My Game Renderer',
        ]);
        expect(compound?.['stopAll']).toBe(true);
    });

    it('binds MAIN-process breakpoints and opens the CDP port the renderer attach uses', () => {
        const main = parse().configurations.find(
            (c) => c['name'] === 'Debug My Game: Main process',
        );
        expect(main?.['type']).toBe('node');
        // --remote-debugging-port must precede the app path so Chromium consumes it as a switch.
        expect(main?.['args']).toEqual(['--remote-debugging-port=9222', 'apps/my-game']);
        expect(String(main?.['runtimeExecutable'])).toContain('node_modules/.bin/electron');
        expect(main?.['sourceMaps']).toBe(true);
        expect(main?.['outFiles']).toEqual([
            '${workspaceFolder}/apps/my-game/dist/electron/**/*.js',
        ]);
        expect(main?.['preLaunchTask']).toBe('Build My Game (renderer + bundle)');
        expect(main?.['env']).toMatchObject({ CHIMERA_DEBUG: '1' });
    });

    it('attaches to the Chromium renderer and maps app-relative webpack sources back to source', () => {
        const attach = parse().configurations.find((c) => c['name'] === 'Attach My Game Renderer');
        expect(attach?.['type']).toBe('chrome');
        expect(attach?.['request']).toBe('attach');
        expect(attach?.['port']).toBe(9222);
        // webpack://_N_E/../screens/X.tsx (context = apps/<game>/renderer) -> apps/my-game/screens/X.tsx.
        expect(attach?.['sourceMapPathOverrides']).toMatchObject({
            'webpack://_N_E/../*': '${workspaceFolder}/apps/my-game/*',
            'webpack://_N_E/./*': '${workspaceFolder}/apps/my-game/renderer/*',
        });
        // A compound member takes NO preLaunchTask (the main-process launch runs the build).
        expect(attach?.['preLaunchTask']).toBeUndefined();
    });

    it('runs the clean launch through the clean build task', () => {
        const clean = parse().configurations.find((c) => c['name'] === 'Run My Game (Clean)');
        expect(clean?.['preLaunchTask']).toBe('Build My Game (clean renderer + bundle)');
        expect(clean?.['args']).toEqual(['apps/my-game']);
    });

    it('wires Vitest + Playwright + Package configs to the standalone binaries/scripts', () => {
        const parsed = parse();
        const byName = (name: string): LaunchConfig | undefined =>
            parsed.configurations.find((c) => c['name'] === name);
        expect(String(byName('Vitest: run all tests')?.['runtimeExecutable'])).toContain(
            'node_modules/.bin/vitest',
        );
        expect(byName('Vitest: debug current test file')?.['runtimeArgs']).toEqual([
            'run',
            '--no-file-parallelism',
            '${relativeFile}',
        ]);
        // Playwright targets THIS game's e2e config + its single electron project.
        expect(byName('Playwright: run all tests')?.['runtimeArgs']).toEqual([
            'test',
            '--config',
            'apps/my-game/e2e/playwright.config.ts',
            '--project=electron-e2e',
        ]);
        // Package configs drive the per-platform root scripts (buildStandaloneRootManifest).
        expect(byName('Package: My Game — macOS (folder)')?.['runtimeExecutable']).toBe('pnpm');
        expect(byName('Package: My Game — macOS (folder)')?.['runtimeArgs']).toEqual([
            'run',
            'package:my-game:mac-dir',
        ]);
        expect(byName('Package: My Game — Windows (.exe / nsis)')?.['runtimeArgs']).toEqual([
            'run',
            'package:my-game:win',
        ]);
    });

    it('references only Package scripts + compound members + task labels that actually exist', () => {
        const kebab = 'my-game';
        const title = 'My Game';
        const launch = parse();
        const manifest = buildStandaloneRootManifest({
            name: kebab,
            toolchainDeps: { next: '^15' },
            packageManager: 'pnpm@10.33.0',
            engines: { node: '>=20.0.0' },
        });
        const tasks = JSON.parse(buildStandaloneVscodeTasksJson(kebab, title)) as {
            tasks: { label: string }[];
        };

        // Every Package config drives a root script that is actually declared.
        const packageCfgs = launch.configurations.filter((c) =>
            String(c['name']).startsWith('Package'),
        );
        expect(packageCfgs).toHaveLength(5);
        for (const cfg of packageCfgs) {
            const [verb, script] = cfg['runtimeArgs'] as [string, string];
            expect(verb).toBe('run');
            expect(manifest.scripts, `${String(cfg['name'])} → ${script}`).toHaveProperty(script);
        }

        // Every compound member names a real configuration.
        const configNames = new Set(launch.configurations.map((c) => c['name']));
        for (const compound of launch.compounds) {
            for (const member of compound['configurations'] as string[]) {
                expect(configNames, `compound member ${member}`).toContain(member);
            }
        }

        // Every preLaunchTask names a real task.
        const taskLabels = new Set(tasks.tasks.map((t) => t.label));
        for (const cfg of launch.configurations) {
            if (cfg['preLaunchTask'] !== undefined) {
                expect(taskLabels, `preLaunchTask of ${String(cfg['name'])}`).toContain(
                    cfg['preLaunchTask'],
                );
            }
        }
    });

    it('orders the dropdown via presentation.order — the compound directly above its main member', () => {
        const parsed = parse();
        const entries = [
            ...parsed.configurations.map((c) => ({
                name: String(c['name']),
                order: (c['presentation'] as { order?: number } | undefined)?.order,
            })),
            ...parsed.compounds.map((c) => ({
                name: String(c['name']),
                order: (c['presentation'] as { order?: number } | undefined)?.order,
            })),
        ];
        // Every entry carries an order (configs render before compounds otherwise).
        for (const e of entries) expect(typeof e.order, `${e.name} needs an order`).toBe('number');
        const orders = entries.map((e) => e.order);
        expect(new Set(orders).size, 'orders must be unique').toBe(orders.length);
        entries.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const sortedNames = entries.map((e) => e.name);
        expect(sortedNames[0]).toBe('Run My Game');
        const compoundIdx = sortedNames.indexOf('Debug My Game');
        expect(sortedNames[compoundIdx + 1]).toBe('Debug My Game: Main process');
    });
});

describe('buildStandaloneVscodeTasksJson', () => {
    it('emits the incremental + clean preLaunch build tasks (both with source maps)', () => {
        const out = buildStandaloneVscodeTasksJson('my-game', 'My Game');
        const parsed = JSON.parse(out) as {
            version: string;
            tasks: Record<string, unknown>[];
        };
        expect(parsed.version).toBe('2.0.0');
        const labels = parsed.tasks.map((t) => t['label']);
        // Labels MUST match the launch configs' preLaunchTask values.
        expect(labels).toContain('Build My Game (renderer + bundle)');
        expect(labels).toContain('Build My Game (clean renderer + bundle)');

        const incremental = parsed.tasks.find(
            (t) => t['label'] === 'Build My Game (renderer + bundle)',
        );
        const command = String(incremental?.['command']);
        // CHIMERA_DEBUG=1 on the next build so browser source maps emit for DevTools + the attach.
        expect(command).toContain('CHIMERA_DEBUG=1');
        expect(command).toContain('next build apps/my-game/renderer');
        expect(command).toContain('@chimera-engine/my-game build:app');

        const clean = parsed.tasks.find(
            (t) => t['label'] === 'Build My Game (clean renderer + bundle)',
        );
        const cleanCommand = String(clean?.['command']);
        // Wipes the renderer caches + export + bundle before the same debug build.
        expect(cleanCommand).toContain(
            'rm -rf apps/my-game/renderer/.next apps/my-game/renderer/out apps/my-game/dist',
        );
        expect(cleanCommand).toContain('CHIMERA_DEBUG=1');
        expect(cleanCommand).toContain('next build apps/my-game/renderer');
    });
});

describe('buildStandaloneWorkspaceYaml', () => {
    it('declares apps/* as the sole workspace member', () => {
        expect(buildStandaloneWorkspaceYaml()).toBe('packages:\n  - apps/*\n');
    });
});

describe('buildStandaloneRootTsconfig', () => {
    it('emits a tsconfig.json wrapping the frozen compilerOptions for the app to extend', () => {
        const out = buildStandaloneRootTsconfig({ strict: true, target: 'ES2022' });
        const parsed = JSON.parse(out) as { compilerOptions: Record<string, unknown> };
        expect(parsed.compilerOptions).toEqual({ strict: true, target: 'ES2022' });
        // Plain JSON (no comments) so the app's `extends` chain + any parser can read it.
        expect(out).not.toContain('//');
    });
});

describe('rewriteAppPackageForStandalone', () => {
    const raw = JSON.stringify({
        name: '@chimera-engine/my-game',
        dependencies: {
            '@chimera-engine/simulation': 'workspace:*',
            '@chimera-engine/renderer': 'workspace:*',
        },
        scripts: {
            'build:app': 'tsx electron/build-main.ts',
            'test:e2e': 'playwright test --config=e2e/playwright.config.ts --project=electron-e2e',
            test: 'vitest run --config ../../vitest.config.mts --dir .',
        },
    });

    it('rewrites @chimera-engine/* workspace deps onto their published ^ranges', () => {
        const out = JSON.parse(
            rewriteAppPackageForStandalone(raw, {
                engineRanges: {
                    '@chimera-engine/simulation': '^0.9.0',
                    '@chimera-engine/renderer': '^0.9.0',
                },
                toolchainDeps: {},
                nodeModulesEnv: 'node_modules',
            }),
        );
        expect(out.dependencies['@chimera-engine/simulation']).toBe('^0.9.0');
        expect(out.dependencies['@chimera-engine/renderer']).toBe('^0.9.0');
        expect(JSON.stringify(out)).not.toContain('workspace:*');
    });

    it('rewrites @chimera-engine/* workspace deps declared in devDependencies (#817 template shape)', () => {
        // The blank template declares the engine packages under devDependencies (they are
        // esbuild-inlined at build time and must stay out of electron-builder's prod tree).
        // A surviving `workspace:*` in any section makes a standalone `npm install` reject the
        // app, so the rewrite must reach devDependencies too.
        const devOnly = JSON.stringify({
            name: '@chimera-engine/my-game',
            devDependencies: {
                '@chimera-engine/simulation': 'workspace:*',
                '@chimera-engine/renderer': 'workspace:*',
                electron: '^33.2.0',
            },
        });
        const out = JSON.parse(
            rewriteAppPackageForStandalone(devOnly, {
                engineRanges: {
                    '@chimera-engine/simulation': '^0.9.0',
                    '@chimera-engine/renderer': '^0.9.0',
                },
                toolchainDeps: { electron: '33.4.11' },
                nodeModulesEnv: 'node_modules',
            }),
        );
        expect(out.devDependencies['@chimera-engine/simulation']).toBe('^0.9.0');
        expect(out.devDependencies['@chimera-engine/renderer']).toBe('^0.9.0');
        // Non-engine devDeps are pinned exact; no workspace:* spec survives in any section.
        expect(out.devDependencies.electron).toBe('33.4.11');
        expect(JSON.stringify(out)).not.toContain('workspace:*');
    });

    it('pins the app-level non-engine deps (electron / electron-builder) to the exact toolchain versions — a caret here re-opens the next@15.5.20 drift class for the packaging path', () => {
        const appPkg = JSON.stringify({
            name: '@chimera-engine/my-game',
            devDependencies: {
                '@chimera-engine/renderer': 'workspace:*',
                electron: '^33.2.0',
                'electron-builder': '^25.1.8',
            },
        });
        const out = JSON.parse(
            rewriteAppPackageForStandalone(appPkg, {
                engineRanges: { '@chimera-engine/renderer': '^1.0.0-rc.3' },
                toolchainDeps: { electron: '33.4.11', 'electron-builder': '25.1.8' },
                nodeModulesEnv: 'node_modules',
            }),
        );
        expect(out.devDependencies.electron).toBe('33.4.11');
        expect(out.devDependencies['electron-builder']).toBe('25.1.8');
        expect(out.devDependencies['@chimera-engine/renderer']).toBe('^1.0.0-rc.3');
    });

    it('throws when an app dep has no pinned toolchain version — template/snapshot parity is a hard gate, never a silent floating range', () => {
        const appPkg = JSON.stringify({
            devDependencies: { 'electron-builder': '^25.1.8' },
        });
        expect(() =>
            rewriteAppPackageForStandalone(appPkg, {
                engineRanges: {},
                toolchainDeps: {},
                nodeModulesEnv: 'node_modules',
            }),
        ).toThrow(/electron-builder/);
    });

    it('injects CHIMERA_VERIFY_PACK_NODE_MODULES into build:app + test:e2e only, leaving test untouched', () => {
        const out = JSON.parse(
            rewriteAppPackageForStandalone(raw, {
                engineRanges: {},
                toolchainDeps: {},
                nodeModulesEnv: 'node_modules',
            }),
        );
        expect(out.scripts['build:app']).toBe(
            'cross-env CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules tsx electron/build-main.ts',
        );
        expect(out.scripts['test:e2e']).toContain(
            'cross-env CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules playwright test',
        );
        // The unit `test` script does not bundle Electron, so it is left alone.
        expect(out.scripts.test).toBe('vitest run --config ../../vitest.config.mts --dir .');
    });

    it('is idempotent — re-running does not double-inject the env', () => {
        const once = rewriteAppPackageForStandalone(raw, {
            engineRanges: {},
            toolchainDeps: {},
            nodeModulesEnv: 'node_modules',
        });
        const twice = rewriteAppPackageForStandalone(once, {
            engineRanges: {},
            toolchainDeps: {},
            nodeModulesEnv: 'node_modules',
        });
        expect(twice).toBe(once);
    });
});

describe('rewriteAppTsconfigBuildForStandalone', () => {
    // Mirrors the blank template's tsconfig.build.json: a leading comment block, the composite
    // compilerOptions, the monorepo-relative `references`, and an `exclude` after it.
    const raw = `{
    // Composite \`tsc -b\` build for this @chimera-engine/<game> consumer app.
    "extends": "../../tsconfig.json",
    "compilerOptions": {
        "composite": true,
        "outDir": "./dist"
    },
    "references": [
        { "path": "../../simulation/tsconfig.build.json" },
        { "path": "../../ai/tsconfig.build.json" },
        { "path": "../../renderer/tsconfig.build.json" },
        { "path": "../../electron/tsconfig.build.json" }
    ],
    "include": ["**/*.ts", "**/*.tsx"],
    "exclude": ["node_modules", "dist", "electron/**", "e2e/**"]
}
`;

    it('empties the monorepo references so tsc resolves the engine from node_modules', () => {
        const out = rewriteAppTsconfigBuildForStandalone(raw);
        // No monorepo-relative project references survive…
        expect(out).not.toContain('../../simulation/tsconfig.build.json');
        expect(out).not.toContain('../../electron/tsconfig.build.json');
        expect(out).not.toMatch(/"references":\s*\[\s*\{/);
        expect(out).toContain('"references": []');
    });

    it('preserves the surrounding compilerOptions, comments, include + exclude', () => {
        const out = rewriteAppTsconfigBuildForStandalone(raw);
        expect(out).toContain('// Composite `tsc -b` build');
        expect(out).toContain('"composite": true');
        expect(out).toContain('"outDir": "./dist"');
        expect(out).toContain('"include": ["**/*.ts", "**/*.tsx"]');
        expect(out).toContain('"exclude": ["node_modules", "dist", "electron/**", "e2e/**"]');
    });

    it('is idempotent — re-running leaves an already-emptied references untouched', () => {
        const once = rewriteAppTsconfigBuildForStandalone(raw);
        const twice = rewriteAppTsconfigBuildForStandalone(once);
        expect(twice).toBe(once);
    });
});

describe('rewriteE2eTsconfigForStandalone', () => {
    // Mirrors the blank template's e2e/tsconfig.json: a comment block, baseUrl, and the
    // monorepo-relative engine `paths` plus the standalone-valid game path (last, no comma).
    const raw = `{
    // Playwright-runner resolution shim ONLY.
    "extends": "../../../tsconfig.json",
    "compilerOptions": {
        "baseUrl": "../../..",
        "paths": {
            "@chimera-engine/simulation/*": ["simulation/dist/*"],
            "@chimera-engine/ai/*": ["ai/dist/*"],
            "@chimera-engine/networking": ["networking/dist/index.d.ts"],
            "@chimera-engine/networking/*": ["networking/dist/*"],
            "@chimera-engine/renderer/*": ["renderer/dist/*"],
            "@chimera-engine/electron/*": ["electron/dist/*"],
            "@chimera-engine/verify-scaffold-probe/*": ["apps/verify-scaffold-probe/*"]
        }
    }
}
`;

    it('drops the monorepo engine paths (the dist mappings)', () => {
        const out = rewriteE2eTsconfigForStandalone(raw);
        for (const pkg of ['simulation', 'ai', 'networking', 'renderer', 'electron']) {
            expect(out).not.toContain(`${pkg}/dist`);
        }
        // No monorepo `*/dist/*` path target survives.
        expect(out).not.toContain('dist/*');
    });

    it('keeps the standalone-valid game path + baseUrl + comments', () => {
        const out = rewriteE2eTsconfigForStandalone(raw);
        expect(out).toContain(
            '"@chimera-engine/verify-scaffold-probe/*": ["apps/verify-scaffold-probe/*"]',
        );
        expect(out).toContain('"baseUrl": "../../.."');
        expect(out).toContain('// Playwright-runner resolution shim');
        // The result must still parse as JSON once comments are stripped (no dangling comma).
        const stripped = out.replace(/^\s*\/\/.*$/gm, '');
        expect(() => JSON.parse(stripped) as unknown).not.toThrow();
    });

    it('is idempotent — re-running leaves the engine-stripped paths untouched', () => {
        const once = rewriteE2eTsconfigForStandalone(raw);
        const twice = rewriteE2eTsconfigForStandalone(once);
        expect(twice).toBe(once);
    });
});

describe('buildStandaloneVitestConfig', () => {
    it('aliases chimera-game-registration to the app register and resolves @chimera-engine via node_modules', () => {
        const config = buildStandaloneVitestConfig('my-game');
        expect(config).toContain('chimera-game-registration');
        expect(config).toContain('apps/my-game/renderer/register.ts');
        // The config must NOT pull @chimera-engine/* onto source — that is the reach-through the gate forbids.
        expect(config).not.toContain('createPreferTypeScriptSourceResolver');
        expect(config).not.toContain('@chimera-engine/renderer');
    });
});
