import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

/**
 * tools/tsconfig-build-graph.test.ts
 *
 * Structural guard for the `tsc -b` project-reference graph (issue #756).
 *
 * `tsc --build` drives dependency-ordered incremental compilation of the composite
 * @chimera/* packages off the root solution config `tsconfig.build.json`. The reference
 * graph MUST mirror the acyclic, inward `workspace:*` dependency graph (Invariant #1):
 * the core points inward toward `@chimera/simulation` and never back out to a sibling or
 * the app layer (electron/tactics). This test pins that shape so a stray `references`
 * entry — or a per-package build config drifting from its real workspace deps — fails
 * here instead of silently corrupting the build order.
 *
 * Mirrors the invariant-guard culture of the per-package eslint-import-boundary tests
 * (#759/#764/#768) and the standalone `tools/vitest-config-filename-guard.test.ts`.
 */

const repoRoot = path.resolve(import.meta.dirname, '..');

/** Packages with a composite `tsconfig.build.json` that join the `tsc -b` solution. */
const COMPOSITE_PACKAGE_DIRS = ['simulation', 'ai', 'networking', 'renderer', 'electron'] as const;

/**
 * Source-only app-layer packages that must NEVER be a project reference (Invariant #1).
 * `@chimera/electron` graduated to a composite build in F62 (#777); `games/tactics`
 * becomes a built consumer app in F63 (until then it stays source-only).
 */
const APP_LAYER_PACKAGE_DIRS = ['games/tactics'] as const;

/**
 * Layer rank for the inward/acyclic check: a reference is only legal when it points to a
 * STRICTLY lower rank (simulation leaf ← mid-tier ← app layer). Same-rank (sibling) or
 * higher-rank (back-edge) references would form a cycle or escape the core.
 */
const PACKAGE_LAYER: Readonly<Record<string, number>> = {
    simulation: 0,
    ai: 1,
    networking: 1,
    renderer: 1,
    electron: 2,
    'games/tactics': 2,
};

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
    const layer = PACKAGE_LAYER[packageDir];
    if (layer === undefined) {
        throw new Error(`Unknown package dir '${packageDir}' — add it to PACKAGE_LAYER`);
    }
    return layer;
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

/** Composite @chimera/* runtime dependencies of a package, expressed as package dirs. */
function compositeDependencyDirs(packageDir: string): string[] {
    // @chimera-review: intentional filesystem read — structural guard; mocking defeats the purpose
    const pkg = JSON.parse(
        readFileSync(path.join(repoRoot, packageDir, 'package.json'), 'utf8'),
    ) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
    };
    const declared = { ...pkg.dependencies, ...pkg.peerDependencies };
    return Object.keys(declared)
        .map((name) => CHIMERA_NAME_TO_DIR.get(name))
        .filter(
            (dir): dir is string =>
                dir !== undefined && (COMPOSITE_PACKAGE_DIRS as readonly string[]).includes(dir),
        )
        .sort();
}

/** Map every workspace `@chimera/*` package name to its directory (relative to repo root). */
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
