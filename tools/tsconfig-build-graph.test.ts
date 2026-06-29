import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/**
 * tools/tsconfig-build-graph.test.ts
 *
 * Structural guard for the `tsc -b` project-reference graph (issue #756).
 *
 * `tsc --build` drives dependency-ordered incremental compilation of the composite
 * @chimera-engine/* packages off the root solution config `tsconfig.build.json`. The reference
 * graph MUST mirror the acyclic, inward `workspace:*` dependency graph (Invariant #1):
 * the core points inward toward `@chimera-engine/simulation` and never back out to a sibling or
 * the app layer (electron/tactics). This test pins that shape so a stray `references`
 * entry — or a per-package build config drifting from its real workspace deps — fails
 * here instead of silently corrupting the build order.
 *
 * Mirrors the invariant-guard culture of the per-package eslint-import-boundary tests
 * (#759/#764/#768) and the standalone `tools/vitest-config-filename-guard.test.ts`.
 */

const repoRoot = path.resolve(import.meta.dirname, '..');

/** The fixed engine packages with a composite `tsconfig.build.json` (layers 0–2). */
const ENGINE_PACKAGE_DIRS = ['simulation', 'ai', 'networking', 'renderer', 'electron'] as const;

/**
 * Consumer apps are DISCOVERED, not enumerated: every `apps/<game>` carrying a composite
 * `tsconfig.build.json` is a layer-3 app that joins the `tsc -b` solution (F65 — a
 * scaffolded app is first-class without editing this guard). Today that is just
 * `apps/tactics`, but a `create-chimera-game` output is picked up automatically.
 */
function discoverAppDirs(): string[] {
    const appsRoot = path.join(repoRoot, 'apps');
    if (!existsSync(appsRoot)) return [];
    return readdirSync(appsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `apps/${entry.name}`)
        .filter((dir) => existsSync(path.join(repoRoot, dir, 'tsconfig.build.json')))
        .sort();
}

const APP_PACKAGE_DIRS = discoverAppDirs();

/** Packages with a composite `tsconfig.build.json` that join the `tsc -b` solution. */
const COMPOSITE_PACKAGE_DIRS = [...ENGINE_PACKAGE_DIRS, ...APP_PACKAGE_DIRS] as const;

/**
 * Source-only app-layer packages that must NEVER be a project reference (Invariant #1).
 * `@chimera-engine/electron` graduated to a composite build in F62 (#777); the tactics consumer
 * app (`apps/tactics`) graduated in F63 (#782). None remain source-only today.
 */
const APP_LAYER_PACKAGE_DIRS = [] as const;

/**
 * Layer rank for the inward/acyclic check: a reference is only legal when it points to a
 * STRICTLY lower rank (simulation leaf ← engine mid-tier ← electron host ← consumer app).
 * Same-rank (sibling) or higher-rank (back-edge) references would form a cycle or escape
 * the core.
 *
 * `apps/tactics` is the LAYER-3 consumer app (#791): it sits ABOVE `@chimera-engine/electron`
 * (layer 2) and may reference it. This is sound because, since the game-agnosticism work
 * (#784/#788/#789), no engine package statically imports a game — electron and renderer
 * reach the game only by runtime registration — so `apps/tactics` is a pure sink (depends
 * on everything, nothing depends on it). Engine packages stay ≤ layer 2 and never
 * reference the app layer.
 */
const ENGINE_PACKAGE_LAYER: Readonly<Record<string, number>> = {
    simulation: 0,
    ai: 1,
    networking: 1,
    renderer: 1,
    electron: 2,
};

/** Every discovered `apps/<game>` is a layer-3 consumer app. */
const APP_PACKAGE_LAYER = 3;

interface ProjectReference {
    readonly path: string;
}

interface TsconfigShape {
    readonly files?: readonly string[];
    readonly references?: readonly ProjectReference[];
    readonly compilerOptions?: Record<string, unknown>;
}

/** Parse a JSONC tsconfig (comments stripped by the TypeScript host). */
function readTsconfig(absPath: string): TsconfigShape {
    const { config, error } = ts.readConfigFile(absPath, ts.sys.readFile);
    if (error) {
        throw new Error(
            `Failed to parse ${path.relative(repoRoot, absPath)}: ${ts.flattenDiagnosticMessageText(
                error.messageText,
                '\n',
            )}`,
        );
    }
    return config as TsconfigShape;
}

/** Layer rank of a known package dir; throws for an unrecognized dir (Invariant #1 guard). */
function layerOf(packageDir: string): number {
    const engineLayer = ENGINE_PACKAGE_LAYER[packageDir];
    if (engineLayer !== undefined) return engineLayer;
    if ((APP_PACKAGE_DIRS as readonly string[]).includes(packageDir)) return APP_PACKAGE_LAYER;
    throw new Error(
        `Unknown package dir '${packageDir}' — add it to ENGINE_PACKAGE_LAYER or place it under apps/<game>/`,
    );
}

/** The package dirs (relative to repo root) referenced by a tsconfig's `references`. */
function referencedPackageDirs(config: TsconfigShape, configDir: string): string[] {
    const references = config.references ?? [];
    return references
        .map((reference) => path.resolve(configDir, reference.path))
        .map((absRef) => path.relative(repoRoot, path.dirname(absRef)))
        .map((relDir) => relDir.split(path.sep).join('/'))
        .sort();
}

/**
 * Composite @chimera-engine/* dependencies of a package, expressed as package dirs.
 *
 * Reads ALL three dependency fields. Engine packages ship at runtime, so they declare
 * their workspace deps under `dependencies`/`peerDependencies`. The layer-3 consumer apps
 * (`apps/<game>`) instead declare them under `devDependencies`: electron-builder ships only
 * production `dependencies`, and the app esbuild-bundles the engine code into its main/preload,
 * so declaring the engine packages as production deps would dereference ~hundreds of MB of
 * already-bundled code into the package (#817). Either way the composite build IMPORTS those
 * packages, so the `tsc -b` references must mirror them — regardless of which field carries
 * the `workspace:*` spec.
 */
function compositeDependencyDirs(packageDir: string): string[] {
    // @chimera-review: intentional filesystem read — structural guard; mocking defeats the purpose
    const pkg = JSON.parse(
        readFileSync(path.join(repoRoot, packageDir, 'package.json'), 'utf8'),
    ) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };
    const declared = { ...pkg.dependencies, ...pkg.peerDependencies, ...pkg.devDependencies };
    return Object.keys(declared)
        .map((name) => CHIMERA_NAME_TO_DIR.get(name))
        .filter(
            (dir): dir is string =>
                dir !== undefined && (COMPOSITE_PACKAGE_DIRS as readonly string[]).includes(dir),
        )
        .sort();
}

/** Map every workspace `@chimera-engine/*` package name to its directory (relative to repo root). */
const CHIMERA_NAME_TO_DIR: ReadonlyMap<string, string> = new Map(
    [...COMPOSITE_PACKAGE_DIRS, ...APP_LAYER_PACKAGE_DIRS].map((dir) => {
        const pkg = JSON.parse(readFileSync(path.join(repoRoot, dir, 'package.json'), 'utf8')) as {
            name: string;
        };
        return [pkg.name, dir];
    }),
);

describe('tsc -b project-reference graph (Invariant #1)', () => {
    it('exposes a root solution config that references exactly the composite packages', () => {
        const solutionPath = path.join(repoRoot, 'tsconfig.build.json');
        expect(existsSync(solutionPath), 'root tsconfig.build.json must exist').toBe(true);

        const solution = readTsconfig(solutionPath);
        expect(solution.files, 'solution config is reference-only (files: [])').toEqual([]);
        expect(referencedPackageDirs(solution, repoRoot)).toEqual(
            [...COMPOSITE_PACKAGE_DIRS].sort(),
        );
    });

    it.each(COMPOSITE_PACKAGE_DIRS)(
        '%s/tsconfig.build.json references mirror its composite workspace deps',
        (packageDir) => {
            const buildConfigPath = path.join(repoRoot, packageDir, 'tsconfig.build.json');
            expect(
                existsSync(buildConfigPath),
                `${packageDir}/tsconfig.build.json must exist`,
            ).toBe(true);

            const buildConfig = readTsconfig(buildConfigPath);
            expect(buildConfig.compilerOptions).toMatchObject({ composite: true });
            expect(referencedPackageDirs(buildConfig, path.join(repoRoot, packageDir))).toEqual(
                compositeDependencyDirs(packageDir),
            );
        },
    );

    it.each(COMPOSITE_PACKAGE_DIRS)(
        '%s references point strictly inward (acyclic, no back-edges)',
        (packageDir) => {
            const buildConfig = readTsconfig(
                path.join(repoRoot, packageDir, 'tsconfig.build.json'),
            );
            const ownLayer = layerOf(packageDir);
            for (const referencedDir of referencedPackageDirs(
                buildConfig,
                path.join(repoRoot, packageDir),
            )) {
                expect(
                    APP_LAYER_PACKAGE_DIRS as readonly string[],
                    `${packageDir} must not reference the app layer`,
                ).not.toContain(referencedDir);
                expect(
                    layerOf(referencedDir),
                    `${packageDir} (layer ${ownLayer}) may only reference a strictly-lower layer, got ${referencedDir}`,
                ).toBeLessThan(ownLayer);
            }
        },
    );
});
