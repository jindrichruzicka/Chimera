/**
 * Generator + drift gate for the create-chimera-game TOOLCHAIN SNAPSHOT.
 *
 * The published `create-chimera-game` CLI emits a standalone game project whose root declares the
 * toolchain (react / three / next / vitest / playwright / electron / typescript / …) and whose app
 * declares `@chimera-engine/* : ^x.y.z`. At `npm create` time there is no monorepo to read those versions
 * from, so they are FROZEN into `tools/create-chimera-game/toolchain.generated.ts` — a committed,
 * gate-checked constants module derived here from the live monorepo:
 *
 *   - TOOLCHAIN_DEPS      — root devDeps+deps minus `@chimera-engine/*` (the toolchain the app inherits),
 *                           pinned to the EXACT versions installed in the monorepo (read from each dep's
 *                           `node_modules/<name>/package.json`, i.e. the lockfile-resolved versions the
 *                           engine dists are actually built and tested against). Freezing the root's
 *                           caret RANGES instead lets a fresh `npm create` resolve newer patch versions
 *                           the engine has never seen — next@15.5.20 broke the scaffold's static export
 *                           exactly this way while `^15.5.15` was frozen.
 *   - ENGINE_DEP_RANGES   — `^<version>` per engine package, read from each package's own version,
 *                           so the snapshot tracks future Changeset bumps on regeneration.
 *   - ROOT_COMPILER_OPTIONS — the root tsconfig `compilerOptions`, frozen so the standalone app's
 *                           tsconfig can inline them instead of `extends`-ing the monorepo root.
 *
 * Run modes (CLI):
 *   `tsx tools/gen-toolchain.ts`           — (re)write the snapshot module from the live inputs.
 *   `tsx tools/gen-toolchain.ts --check`   — fail (exit 1) if the committed module has DRIFTED
 *                                            from the live inputs (a dep/engine/tsconfig change
 *                                            without a regenerate). This is `verify:toolchain-snapshot`.
 *
 * The pure core ({@link buildSnapshot}, {@link renderToolchainModule}, {@link checkSnapshotDrift})
 * is unit-tested in gen-toolchain.test.ts; only the file I/O lives in the VITEST-excluded CLI entry
 * (an async IIFE — tsx transforms `tools/*.ts` as CommonJS, so no top-level await).
 *
 * The generated module is committed but prettier/eslint-ignored (it is a machine artifact); the
 * gate compares the committed bytes to a freshly rendered string, so the generator's own output IS
 * the canonical formatting.
 */

import { buildStandaloneToolchainDeps } from './create-chimera-game/standalone';

/**
 * The publishable engine packages whose versions are frozen into the snapshot. A small, stable
 * list kept LOCAL to the generator on purpose: create-chimera-game must not import the gate's
 * `verify-shared` (it is about to become a published, dependency-free package), and this dev-only
 * generator must not couple the two. (Mirrors `CHIMERA_PACKAGES` / changeset-policy's PACKAGE_DIRS;
 * the `verify:toolchain-snapshot` gate keeps all three honest by failing on drift.)
 */
export const ENGINE_PACKAGES = [
    { name: '@chimera-engine/simulation', dir: 'simulation' },
    { name: '@chimera-engine/ai', dir: 'ai' },
    { name: '@chimera-engine/networking', dir: 'networking' },
    { name: '@chimera-engine/renderer', dir: 'renderer' },
    { name: '@chimera-engine/electron', dir: 'electron' },
] as const;

export interface ToolchainSnapshot {
    readonly toolchainDeps: Record<string, string>;
    readonly engineRanges: Record<string, string>;
    readonly compilerOptions: Record<string, unknown>;
    /** The root's `packageManager` pin (pnpm 10 self-switches to it in the scaffold). */
    readonly packageManager: string;
    /** The root's `engines` constraint (the tested Node floor). */
    readonly engines: Record<string, string>;
}

/**
 * Map each engine package's exact version to a caret range, keyed by package name. Only the known
 * {@link ENGINE_PACKAGES} are included — a stray `@chimera-engine/<game>` workspace version is ignored.
 */
export function buildEngineRanges(
    versions: Readonly<Record<string, string>>,
): Record<string, string> {
    const ranges: Record<string, string> = {};
    for (const { name } of ENGINE_PACKAGES) {
        const version = versions[name];
        if (version !== undefined) ranges[name] = `^${version}`;
    }
    return ranges;
}

/**
 * Pin every toolchain dep to its exact installed version. The root package.json declares caret
 * RANGES; the snapshot must freeze the lockfile-resolved versions the engine was built against,
 * or a fresh out-of-repo install resolves newer patches the monorepo has never tested. A dep with
 * no known installed version is a hard error — silently keeping the range would re-open the drift.
 */
export function pinToolchainDeps(
    ranges: Readonly<Record<string, string>>,
    installedVersions: Readonly<Record<string, string>>,
): Record<string, string> {
    const pinned: Record<string, string> = {};
    for (const name of Object.keys(ranges)) {
        const version = installedVersions[name];
        if (version === undefined) {
            throw new Error(
                `no installed version found for toolchain dep "${name}" — ` +
                    'run `pnpm install` so node_modules matches the lockfile, then regenerate.',
            );
        }
        pinned[name] = version;
    }
    return pinned;
}

export interface BuildSnapshotParams {
    readonly rootPkg: {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        packageManager?: string;
        engines?: Record<string, string>;
    };
    /** Exact installed version per toolchain dep name (from `node_modules/<name>/package.json`). */
    readonly installedVersions: Readonly<Record<string, string>>;
    readonly engineVersions: Readonly<Record<string, string>>;
    readonly compilerOptions: Record<string, unknown>;
}

/** Assemble the frozen snapshot from the live monorepo inputs. */
export function buildSnapshot(params: BuildSnapshotParams): ToolchainSnapshot {
    const { packageManager, engines } = params.rootPkg;
    if (packageManager === undefined) {
        throw new Error(
            'root package.json declares no "packageManager" — the scaffold must freeze the tested pnpm.',
        );
    }
    if (engines === undefined) {
        throw new Error(
            'root package.json declares no "engines" — the scaffold must freeze the tested Node floor.',
        );
    }
    return {
        toolchainDeps: pinToolchainDeps(
            buildStandaloneToolchainDeps(params.rootPkg),
            params.installedVersions,
        ),
        engineRanges: buildEngineRanges(params.engineVersions),
        compilerOptions: params.compilerOptions,
        packageManager,
        engines,
    };
}

/** Stable JSON: top-level keys sorted so regeneration is byte-deterministic (4-space indent). */
function stableStringify(obj: Record<string, unknown>): string {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) sorted[key] = obj[key];
    return JSON.stringify(sorted, null, 4);
}

/** Render the committed `toolchain.generated.ts` module source from a snapshot. */
export function renderToolchainModule(snapshot: ToolchainSnapshot): string {
    return `// AUTO-GENERATED by tools/gen-toolchain.ts — DO NOT EDIT BY HAND.
//
// Regenerate with \`pnpm gen:toolchain\`; \`pnpm verify:toolchain-snapshot\` fails if this drifts
// from the live root package.json toolchain, the engine package versions, or the root tsconfig.
//
// Frozen so the published create-chimera-game CLI can emit a standalone project with the exact
// toolchain + engine versions the monorepo builds against, without reading the monorepo at
// \`npm create\` time. This file is prettier/eslint-ignored: it is a machine artifact.

/**
 * Root devDependencies + dependencies, minus every \`@chimera-engine/*\` workspace edge, pinned to
 * the EXACT installed versions the monorepo builds against (never ranges — a range lets a fresh
 * \`npm create\` install resolve untested upstream patches; next@15.5.20 broke the scaffold that way).
 */
export const TOOLCHAIN_DEPS: Readonly<Record<string, string>> = ${stableStringify(
        snapshot.toolchainDeps,
    )};

/** \`^<version>\` per publishable engine package, from each package's own version field. */
export const ENGINE_DEP_RANGES: Readonly<Record<string, string>> = ${stableStringify(
        snapshot.engineRanges,
    )};

/** The root tsconfig \`compilerOptions\`, frozen for the standalone app's inlined tsconfig. */
export const ROOT_COMPILER_OPTIONS = ${stableStringify(snapshot.compilerOptions)} as const;

/** The root's \`packageManager\` pin — pnpm 10 self-switches to it in the emitted scaffold. */
export const ROOT_PACKAGE_MANAGER = ${JSON.stringify(snapshot.packageManager)};

/** The root's \`engines\` constraint (the tested Node floor), frozen verbatim. */
export const ROOT_ENGINES: Readonly<Record<string, string>> = ${stableStringify(snapshot.engines)};
`;
}

/** True when the committed module text differs from the freshly rendered one (drift). */
export function checkSnapshotDrift(committed: string, expected: string): boolean {
    return committed !== expected;
}

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────
//
// Runs only via `tsx tools/gen-toolchain.ts [--check]`. The VITEST guard keeps the disk I/O out of
// the unit surface; the body is an async IIFE because tsx transforms `tools/*.ts` as CommonJS (the
// root package.json has no `"type":"module"`), and esbuild rejects top-level await in CJS output.

if (process.env['VITEST'] === undefined) {
    void (async (): Promise<void> => {
        const path = await import('node:path');
        const { readFile, writeFile } = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');
        const ts = (await import('typescript')).default;

        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const generatedPath = path.join(
            repoRoot,
            'tools',
            'create-chimera-game',
            'toolchain.generated.ts',
        );

        try {
            // 1. root package.json toolchain.
            const rootPkg = JSON.parse(
                await readFile(path.join(repoRoot, 'package.json'), 'utf8'),
            ) as BuildSnapshotParams['rootPkg'];

            // 2. exact installed toolchain versions, each read from the workspace-root
            //    node_modules — i.e. the lockfile-resolved versions the engine builds against.
            const installedVersions: Record<string, string> = {};
            for (const name of Object.keys(buildStandaloneToolchainDeps(rootPkg))) {
                const pkg = JSON.parse(
                    await readFile(
                        path.join(repoRoot, 'node_modules', ...name.split('/'), 'package.json'),
                        'utf8',
                    ),
                ) as { version?: string };
                if (pkg.version !== undefined) installedVersions[name] = pkg.version;
            }

            // 3. engine versions, each from its own package.json.
            const engineVersions: Record<string, string> = {};
            for (const { name, dir } of ENGINE_PACKAGES) {
                const pkg = JSON.parse(
                    await readFile(path.join(repoRoot, dir, 'package.json'), 'utf8'),
                ) as { version?: string };
                if (pkg.version !== undefined) engineVersions[name] = pkg.version;
            }

            // 4. root tsconfig compilerOptions (JSONC — parsed via the TypeScript reader).
            const tsconfigText = await readFile(path.join(repoRoot, 'tsconfig.json'), 'utf8');
            const parsed = ts.parseConfigFileTextToJson('tsconfig.json', tsconfigText);
            const config = parsed.config as
                | { compilerOptions?: Record<string, unknown> }
                | undefined;
            const compilerOptions = config?.compilerOptions ?? {};

            const expected = renderToolchainModule(
                buildSnapshot({ rootPkg, installedVersions, engineVersions, compilerOptions }),
            );

            if (process.argv.includes('--check')) {
                let committed = '';
                try {
                    committed = await readFile(generatedPath, 'utf8');
                } catch {
                    committed = '';
                }
                if (checkSnapshotDrift(committed, expected)) {
                    console.error(
                        '[verify:toolchain-snapshot] FAILED — toolchain.generated.ts is stale.\n' +
                            '  A root dep, an engine version, or the root tsconfig changed without a regenerate.\n' +
                            '  Run `pnpm gen:toolchain` and commit the result.',
                    );
                    process.exitCode = 1;
                    return;
                }
                console.log('[verify:toolchain-snapshot] OK — snapshot matches the live inputs.');
                return;
            }

            await writeFile(generatedPath, expected, 'utf8');
            console.log(`[gen:toolchain] Wrote ${generatedPath}.`);
        } catch (error) {
            console.error(
                `[gen:toolchain] ${error instanceof Error ? error.message : String(error)}`,
            );
            process.exitCode = 1;
        }
    })();
}
