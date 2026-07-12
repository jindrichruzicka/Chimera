/**
 * tools/version-alignment.ts
 *
 * `verify:version-alignment` — the locked `1.X.Y` release gate.
 *
 * From `1.0.0` Chimera adopts a lock-step versioning scheme: every first-party
 * PUBLISHED package — the five `@chimera-engine/*` engine packages AND the
 * `create-chimera-game` initializer — shares one version, `1.X.Y`. A milestone advances
 * the middle `X`; any between-milestone package update advances the patch `Y`; and the
 * whole set always re-publishes together at the same version. The full policy lives in
 * `docs/versioning-policy.md`.
 *
 * Changesets' `fixed` group (`.changeset/config.json`) keeps bumps in lock-step, but a
 * hand-edit, a bad merge, or a stray `npm version` could still drift one package. This
 * gate is the belt-and-braces check: it reads every first-party `package.json` and FAILS
 * unless (1) all versions are byte-identical and (2) the shared version is a valid `1.X.Y`
 * (major >= 1). It runs in the pre-release gate and in `release.yml` before publish, so a
 * misaligned set can never reach the registry.
 *
 *   tsx tools/version-alignment.ts             # positive gate (over real package.json files)
 *   tsx tools/version-alignment.ts --self-test # negative gate (must detect synthetic drift)
 *
 * Invariants upheld:
 *   #1  — the whole inward `@chimera-engine/*` DAG (+ the initializer) ships one compatible
 *         version; a matching `1.X.*` is the compatibility promise, never a masked skew.
 *   #2  — lives in `tools/`; the pure surface imports only node builtins; the CLI entry
 *         lazy-imports `node:fs`/`node:path` — never a package or app.
 */

// ── Types ────────────────────────────────────────────────────────────────────────

/** One first-party published package the lock-step group covers. */
export interface VersionedPackage {
    /** npm package name, e.g. `@chimera-engine/simulation` or `create-chimera-game`. */
    readonly name: string;
    /** The `version` field read from its `package.json`. */
    readonly version: string;
}

/** Why an alignment check failed (empty `reasons` ⇒ aligned). */
export interface AlignmentResult {
    readonly ok: boolean;
    /** The single shared version, when the set IS aligned to a valid `1.X.Y`; else undefined. */
    readonly version?: string;
    /** Human-readable failure reasons (misalignment and/or non-`1.X.Y`). */
    readonly reasons: readonly string[];
}

/**
 * The first-party published set that must stay lock-stepped: the five engine packages
 * (inward dependency order, `simulation` is the zero-dep leaf) plus the initializer.
 * The private `@chimera-engine/tactics` reference app and the `templates/blank` scaffolding
 * source publish nothing and are deliberately absent. Kept in sync with the `fixed` group
 * in `.changeset/config.json`.
 */
export const LOCKSTEP_PACKAGE_DIRS = [
    'simulation',
    'ai',
    'networking',
    'renderer',
    'electron',
    'tools/create-chimera-game',
] as const;

// ── Pure helpers ───────────────────────────────────────────────────────────────

/** A strict `1.X.Y` release version: major >= 1, all three parts non-negative integers, no pre-release/build suffix. */
const LOCKSTEP_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

/** True when `version` is a plain `MAJOR.MINOR.PATCH` with `MAJOR >= 1` (the `1.X.Y` shape). */
export function isLockstepVersion(version: string): boolean {
    const match = LOCKSTEP_VERSION_RE.exec(version.trim());
    if (match === null) return false;
    const major = Number(match[1]);
    return Number.isInteger(major) && major >= 1;
}

/**
 * The pure gate: given every first-party package's `{name, version}`, assert they are all
 * on the identical version AND that shared version is a valid `1.X.Y`. Returns one or more
 * reasons on failure; on success returns `ok: true` and the shared `version`.
 */
export function checkAlignment(packages: readonly VersionedPackage[]): AlignmentResult {
    const reasons: string[] = [];

    if (packages.length === 0) {
        return { ok: false, reasons: ['no first-party packages found to check'] };
    }

    // 1. All versions identical.
    const distinct = new Map<string, string[]>();
    for (const pkg of packages) {
        const bucket = distinct.get(pkg.version);
        if (bucket === undefined) distinct.set(pkg.version, [pkg.name]);
        else bucket.push(pkg.name);
    }

    if (distinct.size > 1) {
        const groups = [...distinct.entries()]
            .map(([version, names]) => `${version} (${names.sort().join(', ')})`)
            .sort();
        reasons.push(
            `versions are not aligned — the first-party set must all share one version, found: ${groups.join(' | ')}`,
        );
    }

    // 2. Every version is a valid 1.X.Y (report each offender so a fix is unambiguous).
    for (const pkg of packages) {
        if (!isLockstepVersion(pkg.version)) {
            reasons.push(
                `"${pkg.name}" version "${pkg.version}" is not a valid locked 1.X.Y release version (expected MAJOR.MINOR.PATCH with MAJOR >= 1)`,
            );
        }
    }

    if (reasons.length > 0) return { ok: false, reasons };

    // Aligned and valid — every entry has the same, 1.X.Y version.
    return { ok: true, version: packages[0]!.version, reasons: [] };
}

// ── Orchestration ────────────────────────────────────────────────────────────────

export interface VerifyVersionAlignmentDeps {
    /** Read every first-party package's `{name, version}` from disk. */
    readonly readPackages: () => Promise<readonly VersionedPackage[]>;
    readonly log: (message: string) => void;
}

/** The positive gate: read the real manifests and assert lock-step `1.X.Y` alignment. */
export async function verifyVersionAlignment(
    deps: VerifyVersionAlignmentDeps,
): Promise<AlignmentResult> {
    const packages = await deps.readPackages();
    const result = checkAlignment(packages);

    if (result.ok) {
        deps.log(
            `verify:version-alignment — all ${packages.length} first-party packages aligned at ${result.version}.`,
        );
    } else {
        for (const reason of result.reasons) deps.log(`misalignment: ${reason}`);
    }
    return result;
}

/**
 * The negative gate: prove `checkAlignment` FLAGS a deliberately drifted set. `ok: true`
 * only when the synthetic drift is detected.
 */
export function verifyVersionAlignmentSelfTest(deps: {
    log: (message: string) => void;
}): Promise<AlignmentResult> {
    // ai left behind at 1.0.0 while the rest moved to 1.0.1 — the gate MUST catch this.
    const drifted: VersionedPackage[] = [
        { name: '@chimera-engine/simulation', version: '1.0.1' },
        { name: '@chimera-engine/ai', version: '1.0.0' },
        { name: 'create-chimera-game', version: '1.0.1' },
    ];
    const result = checkAlignment(drifted);
    const detected = !result.ok;
    deps.log(
        detected
            ? 'verify:version-alignment --self-test — PASS: the gate detected the drifted package.'
            : 'verify:version-alignment --self-test — FAIL: a drifted package slipped through.',
    );
    return Promise.resolve({ ...result, ok: detected });
}

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────────
//
// Runs only when executed directly via `tsx tools/version-alignment.ts`. The `VITEST`
// guard keeps real disk I/O out of the unit-test surface; the body is an async IIFE
// rather than top-level `await` because tsx transforms `tools/*.ts` as CommonJS (the
// root package.json has no `"type": "module"`) and esbuild rejects top-level await in
// CommonJS output.

if (process.env['VITEST'] === undefined) {
    void (async (): Promise<void> => {
        const path = await import('node:path');
        const fsp = await import('node:fs/promises');
        const { fileURLToPath } = await import('node:url');

        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const log = (message: string): void => console.log(`[verify:version-alignment] ${message}`);

        const deps: VerifyVersionAlignmentDeps = {
            readPackages: async () => {
                const packages: VersionedPackage[] = [];
                for (const dir of LOCKSTEP_PACKAGE_DIRS) {
                    const raw = await fsp.readFile(
                        path.join(repoRoot, dir, 'package.json'),
                        'utf8',
                    );
                    const pkg = JSON.parse(raw) as { name?: string; version?: string };
                    packages.push({
                        name: pkg.name ?? dir,
                        version: pkg.version ?? '(missing)',
                    });
                }
                return packages;
            },
            log,
        };

        const selfTest = process.argv.includes('--self-test');
        const result = selfTest
            ? await verifyVersionAlignmentSelfTest({ log })
            : await verifyVersionAlignment(deps);

        if (!result.ok) {
            console.error(
                selfTest
                    ? '[verify:version-alignment] self-test FAILED — the gate did not detect a drifted package.'
                    : '[verify:version-alignment] FAILED — the first-party set is not aligned to one locked 1.X.Y version.\n' +
                          'Re-align every @chimera-engine/* package + create-chimera-game to the same 1.X.Y (see docs/versioning-policy.md).',
            );
            process.exitCode = 1;
        }
    })();
}
