/**
 * `verify:changeset-policy` — the bump-policy cascade gate.
 *
 * Changesets drives independent per-package semver for the `@chimera-engine/*` hierarchy,
 * but it cannot encode our one non-negotiable rule: `@chimera-engine/simulation` is the
 * zero-dependency leaf, so a breaking change to it is genuinely MAJOR and must
 * propagate a major to every inward consumer (Appendix C.4 / Invariant #1). Left to
 * its defaults, Changesets would only PATCH-bump dependents to keep their pinned
 * `workspace:*` ranges valid — silently weakening the semver promise a published
 * consumer relies on.
 *
 * This gate reads the pending `.changeset/*.md`, merges their declared releases
 * (strongest bump wins), and asserts the cascade: if a PUBLISHABLE package is given a
 * `major`, every publishable package that depends on it — directly or transitively —
 * must also be `major`. Private packages (the `@chimera-engine/tactics` reference app) are
 * exempt: Changesets auto-bumps them and they publish nothing, so they make no semver
 * promise to protect.
 *
 *   tsx tools/changeset-policy.ts             # positive gate (over real .changeset/*.md)
 *   tsx tools/changeset-policy.ts --self-test # negative gate (must detect a synthetic violation)
 *
 * Invariants upheld:
 *   #1  — the cascade keeps the inward `@chimera-engine/*` DAG's semver honest: a simulation
 *         break forces a major on every consumer, never a masked patch.
 *   #2  — lives in `tools/`; the pure surface imports only node builtins; the CLI entry
 *         lazy-imports `node:fs`/`node:path` — never a package or app.
 */

// ── Types ────────────────────────────────────────────────────────────────────────

export type BumpType = 'patch' | 'minor' | 'major';

/** Ordinal strength of each bump; the strongest wins when changesets are merged. */
export const BUMP_RANK: Readonly<Record<BumpType, number>> = { patch: 0, minor: 1, major: 2 };

/** The dependency-bearing slice of a package.json the graph needs. */
export interface ChangesetManifest {
    readonly name: string;
    readonly private?: boolean;
    readonly dependencies?: Record<string, string>;
    readonly peerDependencies?: Record<string, string>;
    readonly optionalDependencies?: Record<string, string>;
}

/** The internal `@chimera-engine/*` dependency graph (external deps dropped). */
export interface DepGraph {
    /** Every `@chimera-engine/*` package the graph knows about. */
    readonly packages: readonly string[];
    /** Packages marked `private: true` (exempt from the major-cascade requirement). */
    readonly privatePackages: ReadonlySet<string>;
    /** pkg → the set of `@chimera-engine/*` packages it directly depends on. */
    readonly dependsOn: ReadonlyMap<string, ReadonlySet<string>>;
}

/** One parsed changeset: the bumps it declares plus its human summary. */
export interface ParsedChangeset {
    readonly releases: Record<string, BumpType>;
    readonly summary: string;
}

/** A publishable dependent that should be `major` (per the cascade) but is not. */
export interface CascadeViolation {
    /** The dependent missing the required major bump. */
    readonly pkg: string;
    /** The majored dependency whose break requires `pkg` to major. */
    readonly requiredBy: string;
    readonly expected: 'major';
    /** The bump actually declared for `pkg`, or `'none'`. */
    readonly actual: BumpType | 'none';
}

const SCOPE_PREFIX = '@chimera-engine/';

function isBumpType(value: string): value is BumpType {
    return value === 'patch' || value === 'minor' || value === 'major';
}

// ── Pure helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a changeset markdown file: a YAML-ish frontmatter block fenced by `---`
 * lines (`'<pkg>': <bump>` entries, quotes optional) followed by the free-text
 * summary. Unrecognized or blank frontmatter lines are ignored; only `patch|minor|
 * major` values are kept.
 */
export function parseChangeset(content: string): ParsedChangeset {
    const lines = content.split('\n');
    const releases: Record<string, BumpType> = {};

    // Locate the frontmatter fence: the first `---`, then the next `---`.
    let start = -1;
    let end = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i]?.trim() === '---') {
            if (start === -1) start = i;
            else {
                end = i;
                break;
            }
        }
    }

    if (start !== -1 && end !== -1) {
        for (let i = start + 1; i < end; i++) {
            const line = lines[i]?.trim() ?? '';
            if (line.length === 0) continue;
            const match = /^['"]?(.+?)['"]?\s*:\s*([A-Za-z]+)\s*$/.exec(line);
            if (match === null) continue;
            const [, key, value] = match;
            if (key !== undefined && value !== undefined && isBumpType(value)) {
                releases[key] = value;
            }
        }
    }

    const summary =
        end !== -1
            ? lines
                  .slice(end + 1)
                  .join('\n')
                  .trim()
            : content.trim();
    return { releases, summary };
}

/**
 * Build the internal `@chimera-engine/*` dependency graph from a set of manifests. Only
 * edges to other `@chimera-engine/*` packages in the same set are kept (external deps like
 * `zod`/`react` are dropped); `dependencies`, `peerDependencies`, and
 * `optionalDependencies` all count, since each makes a consumer break when the
 * dependency breaks.
 */
export function buildDepGraph(manifests: readonly ChangesetManifest[]): DepGraph {
    const names = new Set(manifests.map((m) => m.name));
    const dependsOn = new Map<string, ReadonlySet<string>>();
    const privatePackages = new Set<string>();

    for (const manifest of manifests) {
        if (manifest.private === true) privatePackages.add(manifest.name);
        const edges = new Set<string>();
        const specifiers = [
            ...Object.keys(manifest.dependencies ?? {}),
            ...Object.keys(manifest.peerDependencies ?? {}),
            ...Object.keys(manifest.optionalDependencies ?? {}),
        ];
        for (const specifier of specifiers) {
            if (specifier.startsWith(SCOPE_PREFIX) && names.has(specifier)) edges.add(specifier);
        }
        dependsOn.set(manifest.name, edges);
    }

    return { packages: manifests.map((m) => m.name), privatePackages, dependsOn };
}

/** Every package that depends on `pkg`, directly or transitively (reverse reachability). */
export function transitiveDependents(graph: DepGraph, pkg: string): Set<string> {
    const dependents = new Set<string>();
    const queue: string[] = [pkg];
    while (queue.length > 0) {
        const current = queue.shift()!;
        for (const [candidate, deps] of graph.dependsOn) {
            if (deps.has(current) && !dependents.has(candidate)) {
                dependents.add(candidate);
                queue.push(candidate);
            }
        }
    }
    return dependents;
}

/** Merge several changesets into one `pkg → bump` map, keeping the strongest bump per package. */
export function mergeReleases(changesets: readonly ParsedChangeset[]): Record<string, BumpType> {
    const merged: Record<string, BumpType> = {};
    for (const changeset of changesets) {
        for (const [pkg, bump] of Object.entries(changeset.releases)) {
            const current = merged[pkg];
            if (current === undefined || BUMP_RANK[bump] > BUMP_RANK[current]) merged[pkg] = bump;
        }
    }
    return merged;
}

/**
 * The cascade rule, PURE: for every PUBLISHABLE package declared `major`, assert each
 * of its publishable dependents (transitively) is also `major`. Returns one finding
 * per under-bumped dependent. Private dependents are exempt — they publish nothing.
 */
export function cascadeViolations(
    declared: Readonly<Record<string, BumpType>>,
    graph: DepGraph,
): CascadeViolation[] {
    const violations: CascadeViolation[] = [];
    const seen = new Set<string>();

    for (const [pkg, bump] of Object.entries(declared)) {
        if (bump !== 'major') continue;
        for (const dependent of transitiveDependents(graph, pkg)) {
            if (graph.privatePackages.has(dependent)) continue;
            const actual = declared[dependent] ?? 'none';
            if (actual === 'major') continue;
            const key = `${dependent}::${pkg}`;
            if (seen.has(key)) continue;
            seen.add(key);
            violations.push({ pkg: dependent, requiredBy: pkg, expected: 'major', actual });
        }
    }
    return violations;
}

// ── Orchestration ────────────────────────────────────────────────────────────────

export interface VerifyChangesetPolicyDeps {
    /** Absolute paths of the pending `.changeset/*.md` files (README excluded). */
    readonly listChangesetFiles: () => Promise<readonly string[]>;
    readonly readFile: (file: string) => Promise<string>;
    /** The manifests of every `@chimera-engine/*` package (publishable + private). */
    readonly readManifests: () => Promise<readonly ChangesetManifest[]>;
    readonly log: (message: string) => void;
}

export interface VerifyChangesetPolicyResult {
    readonly ok: boolean;
    readonly violations: readonly CascadeViolation[];
}

/** The positive gate: parse pending changesets, merge, and assert the major cascade holds. */
export async function verifyChangesetPolicy(
    deps: VerifyChangesetPolicyDeps,
): Promise<VerifyChangesetPolicyResult> {
    const files = await deps.listChangesetFiles();
    if (files.length === 0) {
        deps.log('verify:changeset-policy — no pending changesets; nothing to check.');
        return { ok: true, violations: [] };
    }

    const parsed: ParsedChangeset[] = [];
    for (const file of files) parsed.push(parseChangeset(await deps.readFile(file)));

    const graph = buildDepGraph(await deps.readManifests());
    const declared = mergeReleases(parsed);
    const violations = cascadeViolations(declared, graph);

    if (violations.length > 0) {
        for (const v of violations) {
            deps.log(
                `cascade violation: "${v.requiredBy}" is major, so dependent "${v.pkg}" must be ` +
                    `major too (declared: ${v.actual}). Add a major changeset for "${v.pkg}".`,
            );
        }
        return { ok: false, violations };
    }

    deps.log('verify:changeset-policy — the major-bump cascade is honored.');
    return { ok: true, violations: [] };
}

/**
 * The negative gate: prove `cascadeViolations` FLAGS a deliberately under-bumped
 * dependent. `ok: true` only when the synthetic violation is detected.
 */
export function verifyChangesetPolicySelfTest(deps: {
    log: (message: string) => void;
}): Promise<VerifyChangesetPolicyResult> {
    const graph = buildDepGraph([
        { name: '@chimera-engine/simulation' },
        {
            name: '@chimera-engine/ai',
            dependencies: { '@chimera-engine/simulation': 'workspace:*' },
        },
    ]);
    // simulation majored, dependent ai left un-bumped — the cascade MUST catch this.
    const violations = cascadeViolations({ '@chimera-engine/simulation': 'major' }, graph);
    const detected = violations.some((v) => v.pkg === '@chimera-engine/ai');
    deps.log(
        detected
            ? 'verify:changeset-policy --self-test — PASS: the cascade detected the under-bumped dependent.'
            : 'verify:changeset-policy --self-test — FAIL: an under-bumped dependent slipped through.',
    );
    return Promise.resolve({ ok: detected, violations });
}

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────────
//
// Runs only when executed directly via `tsx tools/changeset-policy.ts`. The `VITEST`
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
        const log = (message: string): void => console.log(`[verify:changeset-policy] ${message}`);

        // Every @chimera-engine/* package: the 5 publishable engine packages plus the private
        // tactics app, so the graph is complete and tactics is correctly exempted.
        const PACKAGE_DIRS = [
            'simulation',
            'ai',
            'networking',
            'renderer',
            'electron',
            'apps/tactics',
        ];

        const deps: VerifyChangesetPolicyDeps = {
            listChangesetFiles: async () => {
                const dir = path.join(repoRoot, '.changeset');
                const entries = await fsp.readdir(dir).catch(() => [] as string[]);
                return entries
                    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
                    .map((f) => path.join(dir, f));
            },
            readFile: (file) => fsp.readFile(file, 'utf8'),
            readManifests: async () => {
                const manifests: ChangesetManifest[] = [];
                for (const dir of PACKAGE_DIRS) {
                    const raw = await fsp.readFile(
                        path.join(repoRoot, dir, 'package.json'),
                        'utf8',
                    );
                    manifests.push(JSON.parse(raw) as ChangesetManifest);
                }
                return manifests;
            },
            log,
        };

        const selfTest = process.argv.includes('--self-test');
        const result = selfTest
            ? await verifyChangesetPolicySelfTest({ log })
            : await verifyChangesetPolicy(deps);

        if (!result.ok) {
            console.error(
                selfTest
                    ? '[verify:changeset-policy] self-test FAILED — the gate did not detect a cascade violation.'
                    : '[verify:changeset-policy] FAILED — the major-bump cascade is not honored.',
            );
            process.exitCode = 1;
        }
    })();
}
