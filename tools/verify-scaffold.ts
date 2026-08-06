/**
 * tools/verify-scaffold.ts
 *
 * `verify:scaffold` — the scaffold-and-smoke gate.
 *
 * `verify:pack` proves the packed `@chimera-engine/*` surfaces resolve. This gate proves the
 * NEXT link in the chain: that `create-chimera-game` token-substitutes those packages
 * into a genuinely BOOTABLE app — not just files that look right. It generates a game
 * OUTSIDE the workspace and runs the generated app's own unit smoke + e2e boot-smoke
 * against it, so a broken token map, a missing public `@chimera-engine/*` export, or a renderer
 * barrel regression surfaces here as a scaffold boot failure. It doubles as an
 * end-to-end regression net for the `@chimera-engine/*` packages.
 *
 *   1. `pnpm build:packages`          — emit every `@chimera-engine/*` `dist/`
 *   2. `pnpm pack` per package        — one tarball per engine package
 *   3. `create-chimera-game <probe> --out <tmp>` — the CLI EMITS the whole standalone project into
 *      the temp dir: the app at `<tmp>/apps/<kebab>` PLUS the project root it ships (a toolchain
 *      `package.json`, `pnpm-workspace.yaml`, a `node_modules`-resolving `vitest.config.mts`, and
 *      a `tsconfig.json` carrying the frozen root `compilerOptions`). The gate verifies the EXACT
 *      bytes the published CLI emits — it no longer synthesizes the root itself.
 *   4. layer the gate's `pnpm.overrides` onto the CLI-emitted root + rewrite the app's `@chimera-engine/*`
 *      deps onto the packed tarballs, so the whole DAG resolves through the locally-built
 *      artifacts instead of the (unpublished) npm ranges the CLI emitted
 *   5. `pnpm install`                 — install the tarballs + toolchain into `<tmp>`
 *   6. `pnpm --filter <app> test`     — the generated app's UNIT smoke (manifest + screen render)
 *   7. `pnpm --filter <app> test:e2e` — the generated app's Electron BOOT-smoke
 *   8. `pnpm --filter <app> build` + `build:app` — the PRODUCTION build: `tsc -p tsconfig.build.json`
 *      (proves the standalone refs rewrite resolves the engine from `node_modules`) + the esbuild
 *      main/preload bundles. This is the arm that fails out-of-repo. Then the generated app's own
 *      `verify:packaged-bundle` gate (Invariant #27) — the template's thin driver over the
 *      engine-exported packaged-bundle guard — so a broken template guard fails engine CI here.
 *      Then the five dev-surface arms: the dev-harness dry run (§4.32, `chimera-dev-mp --dry-run`
 *      spawn-plan shape-check); the fonts arm (§4.37, Invariant #97 — `chimera-fetch-fonts`
 *      fetches through a localhost fixture and must land the `.woff2` in the app's OWN
 *      `assets/fonts`, killing the cwd path-doubling regression and any silent-no-op bin entry);
 *      the validate-assets arm (§4.10, Invariants #22/#52 — `chimera-validate-assets ../..`
 *      passes clean AND fails once a broken ref is planted, the non-vacuity proof); the
 *      generate-icons arm (§4.32 — the bin reachable through the app's `.bin` shim with
 *      neither optional codec installed, failing with the actionable message); and the lint
 *      arm (§4.32 — `pnpm lint` from the project root, green on the untouched scaffold and
 *      reporting every curated rule by id once violations are planted).
 *   9. `next build` the renderer + an UNSIGNED `electron-builder --dir` — proves the tokenised
 *      packaging config produces a branded local app bundle from the standalone-emitted project.
 *
 * `--self-test` proves the gate bites: it drops the required renderer registration from
 * the freshly-scaffolded app (in the temp dir only — never the template) and asserts the
 * smoke run then FAILS. If the broken scaffold still passes, the self-test exits non-zero.
 *
 * Mirrors `verify:pack`'s philosophy; the local gate is authoritative (CI Actions billing
 * is blocked). Kept out of `test`/`lint` (it spawns a full scaffold + Electron run) and
 * invoked explicitly via `pnpm verify:scaffold` / `pnpm verify:scaffold:selftest`.
 *
 * Invariants upheld:
 *   #1  — a GENERATED consumer composes the acyclic, inward `@chimera-engine/*` DAG end-to-end.
 *   #2  — lives in `tools/`; imports node builtins + the side-effect-free `verify-shared` and the
 *         sibling `create-chimera-game/standalone` pure synthesizers (no `@chimera-engine/*`).
 *   #47 — the generated app resolves `@chimera-engine/*` ONLY through public `exports` (tarballs +
 *         a node_modules-resolving vitest config), never an internal subpath.
 *   #96 — a dropped public renderer barrel/export surfaces as a scaffold smoke failure.
 */

import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import {
    CHIMERA_PACKAGES,
    parsePackTarballPath,
    type FsLike,
    type RunFn,
    type RunResult,
} from './verify-shared';
// The standalone-root synthesizers are owned by create-chimera-game (the single author of the
// shape the published CLI emits). The gate consumes them and layers tarball overrides on top
// (applyTarballOverrides below), so it verifies the exact bytes the CLI ships.
import { type StandaloneRootManifest } from './create-chimera-game/standalone';

// Re-export the injected I/O surfaces so the gate's own test imports them from one place.
export { type FsLike, type RunFn, type RunOptions, type RunResult } from './verify-shared';

// ── Deps + result types ──────────────────────────────────────────────────────

/** A running localhost font fixture (the fonts arm's stand-in for Google Fonts). */
export interface FontFixture {
    readonly port: number;
    close(): void;
}

/**
 * {@link FsLike} plus symlink resolution, which only this gate needs.
 *
 * The lint arm compares a path it CONSTRUCTED from the temp root against one a
 * child process REPORTED. On macOS a temp dir is `/var/folders/…` and its
 * resolved form is `/private/var/folders/…` — the same file under two names
 * that never compare equal.
 */
export interface VerifyScaffoldFs extends FsLike {
    realpath(p: string): Promise<string>;
}

export interface VerifyScaffoldDeps {
    readonly run: RunFn;
    readonly fs: VerifyScaffoldFs;
    readonly log: (message: string) => void;
    /**
     * Absolute repo root — build/pack run from each package dir under it, and the
     * `create-chimera-game` CLI is invoked from here. (The CLI resolves its bundled templates
     * package-relative to its own code, not from this root — see {@link resolveTemplatesRoot}.)
     */
    readonly repoRoot: string;
    /**
     * Starts the localhost Google-Fonts-shaped fixture for the fonts arm. The real
     * implementation spawns an OUT-OF-PROCESS node server: the sync {@link RunFn}
     * blocks this process's event loop while the bin runs, so an in-process server
     * could never answer it. Injected so unit tests serve nothing.
     */
    readonly startFontFixture: () => Promise<FontFixture>;
}

export type VerifyScaffoldStep =
    | 'build'
    | 'pack'
    | 'scaffold'
    | 'install'
    | 'unit'
    | 'e2e'
    | 'prod-build'
    | 'packaged-bundle'
    | 'dev-harness'
    | 'fonts'
    | 'validate-assets'
    | 'generate-icons'
    | 'lint'
    | 'package';

export interface VerifyScaffoldResult {
    readonly ok: boolean;
    readonly failedStep?: VerifyScaffoldStep;
}

export interface VerifyScaffoldOptions {
    /** Skip the (slow, Electron-spawning) e2e arm — used to exercise the gate cheaply. */
    readonly skipE2e?: boolean;
}

/** The throwaway game the gate scaffolds. A fixed, clearly-disposable identity. */
export const PROBE_GAME = {
    name: 'Verify Scaffold Probe',
    kebab: 'verify-scaffold-probe',
    pkg: '@chimera-engine/verify-scaffold-probe',
} as const;

/**
 * The file the fonts arm expects the bin to land: the fixture serves one
 * `VerifyProbe` 400/normal face, and the tool's deterministic naming maps that
 * to `<family>-Regular.woff2` (pinned by the tool's own unit tests).
 */
export const PROBE_FONT_FILE = 'VerifyProbe-Regular.woff2';

/**
 * The content file the validate-assets arm plants to prove the check bites.
 * Written into the temp scaffold only, and removed again in a `finally` — the
 * template must never carry it.
 */
export const PROBE_BROKEN_REF_FILE = 'verify-scaffold-broken-ref.json';

/**
 * The manifest-read plant (arm step (c2)) — a DECLARED entry the clean scaffold
 * does not have.
 *
 * A blank template declares no assets, so the clean run reports `Checked 0`,
 * which is byte-identical to what a tree with NO manifest reports: the tool
 * discovers manifests by basename and simply finds none. Every assertion about
 * the shipped `asset-manifest.ts` would therefore stay green if the file were
 * renamed, emptied of its export, or dropped from the copy plan entirely.
 *
 * Planting one valid entry and requiring the count to move off zero is what
 * makes the arm read the file: it proves discovery at the exact basename, that
 * `entries` is a literal the tool can walk, and that the ref's first segment
 * resolves to the app's own `assets/` dir. Restored in a `finally`, like the
 * broken-ref plant below.
 *
 * The planted file's CONTENT is deliberately a text placeholder, not a real PNG:
 * the tool resolves each declared ref to a path and calls `access(F_OK)` on it,
 * and never opens an asset (Invariant #52 is membership-only). Writing decoded
 * PNG bytes would additionally be unsound here — the injected `writeFile` takes a
 * string and encodes UTF-8, which mangles every byte above 0x7f.
 */
export const PROBE_MANIFEST_ENTRY_REL = path.join('textures', 'verify-scaffold-probe.png');

/** Stand-in bytes for the planted ref — see {@link PROBE_MANIFEST_ENTRY_REL}. */
export const PROBE_MANIFEST_ASSET_CONTENT =
    'verify-scaffold manifest-read probe; validate-assets checks membership, never pixels.\n';

/** The empty `entries: []` literal the plant rewrites, and the arm requires to exist. */
export const PROBE_EMPTY_ENTRIES_PATTERN = /entries:\s*\[[\s\S]*?\],/u;

/** The exact app-level script the blank template must ship. */
export const PROBE_VALIDATE_ASSETS_SCRIPT = 'chimera-validate-assets ../..';

/**
 * The exact app-level icon-regeneration script the blank template must ship.
 * Both flags are the mechanism — see the arm's step (a).
 */
export const PROBE_ICONS_GENERATE_SCRIPT =
    'chimera-generate-icons --source assets/icons/icon.png --out assets/icons';

/**
 * The violations the lint arm plants, one per curated rule and one per arm of
 * the rule that has two. Each names the file it goes in, the source that trips
 * the rule, and the rule id that must come back — so a rule that is configured,
 * resolvable and guards nothing fails here rather than looking green.
 *
 * Every path is a throwaway removed in a `finally`, except the token override,
 * which is a real scaffolded file appended to and restored.
 */
export const PROBE_LINT_PLANTS = [
    {
        rel: 'simulation/verify-scaffold-probe-rule.ts',
        ruleId: 'chimera/no-fromfloat-in-simulation',
        source: [
            "import { fromFloat } from '@chimera-engine/simulation/engine/FixedPoint.js';",
            'export const probe = fromFloat(1.5);',
            '',
        ].join('\n'),
    },
    {
        rel: 'screens/VerifyScaffoldProbe.tsx',
        ruleId: 'chimera/no-hardcoded-design-values',
        source: [
            'export function VerifyScaffoldProbe() {',
            "    return <div style={{ padding: '12px' }} />;",
            '}',
            '',
        ].join('\n'),
    },
    {
        // The SECOND arm of the same rule. It fires through the @eslint/css
        // language rather than the TS parser, and every way that arm fails —
        // an unhandled CSS block aborting the run, a language that never
        // resolved — leaves the .tsx plant above still reporting.
        rel: 'screens/VerifyScaffoldProbe.module.css',
        ruleId: 'chimera/no-hardcoded-design-values',
        source: ['.probe {', '    padding: 12px;', '}', ''].join('\n'),
    },
    {
        rel: 'screens/VerifyScaffoldProbeDeep.tsx',
        ruleId: 'chimera/no-game-renderer-internals',
        source: [
            "import { Button } from '@chimera-engine/renderer/components/ui/Button';",
            'export const probe = Button;',
            '',
        ].join('\n'),
    },
    {
        rel: 'screens/VerifyScaffoldProbeCanvas.tsx',
        ruleId: 'chimera/no-raw-r3f-canvas',
        source: [
            "import { Canvas } from '@react-three/fiber';",
            'export const probe = Canvas;',
            '',
        ].join('\n'),
    },
] as const;

/**
 * Compile-only asset-seam probe, planted into the generated app immediately
 * before the production `tsc` build and removed in a `finally`. It proves a
 * standalone install can NAME the public asset barrels from a real game
 * screen: a dropped barrel re-export or a renamed symbol fails the build step
 * naming the symbol, and a missing `./assets` exports entry fails it naming
 * the module. It lives under `screens/` (any app-tsc-covered path outside
 * `e2e/**` works; the shape test pins this one) — the e2e tsconfig maps
 * `@chimera-engine/renderer/*` straight onto `dist/`, bypassing the exports
 * map, so an e2e file can type-resolve an import game source can never
 * write. Nothing mounts it, and no model or Canvas enters the blank template.
 * (An asset MANIFEST does — an empty one, wired through the renderer loaders —
 * but it declares no asset and mounts nothing.)
 */
export const PROBE_SEAM_PLANT = {
    rel: path.join('screens', 'VerifyScaffoldSeamProbe.tsx'),
    source: [
        "'use client';",
        '',
        'import {',
        '    AssetManagerProvider,',
        '    useAsset,',
        '    useAssetManager,',
        '    useModelInstance,',
        '    type ModelInstance,',
        "} from '@chimera-engine/renderer/assets';",
        "import { useModelAnimation } from '@chimera-engine/renderer/components/r3f';",
        "import type { TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';",
        '',
        '// Compile-only: verify:scaffold plants this file around the production',
        '// tsc step and removes it again; nothing ever mounts it.',
        'export const SeamProbeProvider = AssetManagerProvider;',
        '',
        'export function VerifyScaffoldSeamProbe(): { readonly ready: boolean } {',
        '    const manager = useAssetManager();',
        '    const { asset, loading, error } = useAsset<TextureAsset>(null);',
        '    const { instance } = useModelInstance(null);',
        '    const mixer = useModelAnimation(instance);',
        '    const held: ModelInstance | null = instance;',
        '    return {',
        '        ready:',
        '            manager !== null &&',
        '            asset === null &&',
        '            !loading &&',
        '            error === null &&',
        '            mixer === null &&',
        '            held === null,',
        '    };',
        '}',
        '',
    ].join('\n'),
} as const;

/** The undeclared token appended to the scaffolded override stylesheet. */
export const PROBE_UNKNOWN_TOKEN = '--ch-verify-scaffold-not-a-token';

/** The rule that undeclared token must trip. */
export const PROBE_UNKNOWN_TOKEN_RULE = 'chimera/no-unknown-token-overrides';

/** The image codec that must stay ABSENT from a base scaffold install. */
export const PROBE_ICON_CODECS = ['sharp'] as const;

/**
 * The pnpm config the probe installs under, written beside its manifest so the
 * tree the gate grades is a property of the SCAFFOLD rather than of whoever runs
 * it. Every line is a measured no-op on a default machine; each was checked
 * against a real install with the opposing setting in an ambient `~/.npmrc`:
 *
 *   - `shamefully-hoist=false` — the one that bites hardest. pnpm merges config
 *     and THEN applies `if (shamefullyHoist) publicHoistPattern = ['*']`, so an
 *     ambient truthy value overwrites whatever pattern the project set; writing
 *     the pattern alone does not neutralise it (measured).
 *   - `public-hoist-pattern=` — belt-and-braces. `shamefully-hoist=false`
 *     already forces the pattern empty today, so this covers no lever of its
 *     own; stating it directly means the pin does not rest on that coupling.
 *   - `node-linker=isolated` — the only line covering an ambient
 *     `node-linker=hoisted`, which flattens the tree by itself and would also
 *     remove the `.pnpm` layer the arm's reasoning describes.
 *
 * Without them, a contributor or CI runner with hoisting enabled globally gets
 * Next's `sharp` linked into the project root, and the generate-icons arm reads
 * it as a declaration the scaffold never made.
 */
export const PROBE_NPMRC = 'shamefully-hoist=false\npublic-hoist-pattern=\nnode-linker=isolated\n';

/** Thrown by a step runner on a non-zero exit so the orchestrator can report which step failed. */
class VerifyScaffoldStepError extends Error {
    constructor(
        readonly step: VerifyScaffoldStep,
        message: string,
    ) {
        super(message);
        this.name = 'VerifyScaffoldStepError';
    }
}

function assertStepOk(step: VerifyScaffoldStep, result: RunResult): void {
    if (result.status !== 0) {
        throw new VerifyScaffoldStepError(
            step,
            `verify:scaffold: step "${step}" failed (exit ${result.status})`,
        );
    }
}

// ── Pure helpers (gate-owned: tarball/override concerns) ─────────────────────────

/**
 * `pnpm pack` rewrites each tarball's internal `workspace:*` edges to a concrete version,
 * which is unpublished — so force every `@chimera-engine/*` resolution onto its `file:<tarball>`
 * via `pnpm.overrides`. This guarantees the DAG resolves ONLY through the packed `exports`.
 */
export function buildPnpmOverrides(
    tarballs: Readonly<Record<string, string>>,
): Record<string, string> {
    const overrides: Record<string, string> = {};
    for (const [name, tgz] of Object.entries(tarballs)) {
        overrides[name] = `file:${tgz}`;
    }
    return overrides;
}

/**
 * Layer the gate's tarball overrides onto the published-form standalone root manifest. The
 * create-chimera-game CLI emits a root whose `@chimera-engine/*` edges resolve from npm (no overrides);
 * the gate re-resolves every edge onto its packed `file:<tarball>` so it verifies the EXACT bytes
 * the CLI ships against the locally-built (unpublished) artifacts. Pure; `overrides` is placed
 * first to mirror the historical key order. The input is always the published (override-free)
 * form, so the spread of the rest of `pnpm` never clobbers the tarball overrides.
 */
export function applyTarballOverrides(
    manifest: StandaloneRootManifest,
    tarballs: Readonly<Record<string, string>>,
): StandaloneRootManifest {
    return {
        ...manifest,
        pnpm: {
            overrides: buildPnpmOverrides(tarballs),
            ...manifest.pnpm,
        },
    };
}

/**
 * Rewrite the generated app's `@chimera-engine/*` `workspace:*` deps onto `file:<tarball>`. The
 * standalone root has no `@chimera-engine/*` workspace members, so a surviving `workspace:*` spec
 * would make `pnpm install` reject the app; pointing each at its tarball resolves it through
 * the packed `exports`. Rewrites BOTH `dependencies` and `devDependencies`: the blank template
 * carries the engine packages under `devDependencies` (esbuild-inlined, kept out of
 * electron-builder's prod tree), so a section-blind rewrite would leave a `workspace:*` the
 * gate's `pnpm install` then rejects. The root `pnpm.overrides` may already mask this, but this
 * function's own contract must hold regardless.
 */
export function rewriteAppChimeraDeps(
    rawAppPkg: string,
    tarballs: Readonly<Record<string, string>>,
): string {
    const pkg = JSON.parse(rawAppPkg) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
    };
    const rewriteSection = (section: Record<string, string> | undefined): void => {
        if (section === undefined) return;
        for (const name of Object.keys(section)) {
            const tgz = tarballs[name];
            if (name.startsWith('@chimera-engine/') && tgz !== undefined) {
                section[name] = `file:${tgz}`;
            }
        }
    };
    rewriteSection(pkg.dependencies);
    rewriteSection(pkg.devDependencies);
    return `${JSON.stringify(pkg, null, 4)}\n`;
}

// ── Step runners ─────────────────────────────────────────────────────────────

/** Pack every engine package into `destDir`; returns a `{ name -> tarball path }` map. */
function packAll(deps: VerifyScaffoldDeps, destDir: string): Record<string, string> {
    const tarballs: Record<string, string> = {};
    for (const pkg of CHIMERA_PACKAGES) {
        deps.log(`packing ${pkg.name}…`);
        const result = deps.run('pnpm', ['pack', '--pack-destination', destDir], {
            cwd: path.join(deps.repoRoot, pkg.dir),
            capture: true,
        });
        assertStepOk('pack', result);
        tarballs[pkg.name] = parsePackTarballPath(result.stdout, destDir);
    }
    return tarballs;
}

/** Drive the real `create-chimera-game` CLI to scaffold the probe app into `<tmp>/apps/<kebab>`. */
function scaffoldProbe(deps: VerifyScaffoldDeps, tmp: string): RunResult {
    const cli = path.join(deps.repoRoot, 'tools', 'create-chimera-game', 'index.ts');
    deps.log(`scaffolding ${PROBE_GAME.pkg} into ${tmp} via the create-chimera-game CLI…`);
    return deps.run('tsx', [cli, PROBE_GAME.name, '--out', tmp], { cwd: deps.repoRoot });
}

/**
 * Extract + shape-check the `chimera-dev-mp --dry-run` spawn plan from captured
 * stdout (pnpm prefixes script output with its banner, so the JSON is sliced
 * between the first `{` and the last `}`). Throws a {@link VerifyScaffoldStepError}
 * for the `dev-harness` step on any parse/shape failure.
 */
function assertDryRunReport(stdout: string): void {
    const fail = (reason: string): never => {
        throw new VerifyScaffoldStepError(
            'dev-harness',
            `verify:scaffold: step "dev-harness" ${reason}`,
        );
    };
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start === -1 || end <= start) {
        fail('printed no spawn-plan JSON');
    }
    let report: { players?: unknown; entry?: unknown; instances?: unknown };
    try {
        report = JSON.parse(stdout.slice(start, end + 1)) as typeof report;
    } catch {
        return fail('printed unparseable spawn-plan JSON');
    }
    if (report.players !== 2) {
        fail(`planned ${String(report.players)} players instead of 2`);
    }
    if (typeof report.entry !== 'string' || !report.entry.endsWith('.js')) {
        fail('resolved no built app entry');
    }
    const instances = report.instances;
    if (!Array.isArray(instances) || instances.length !== 2) {
        fail('planned the wrong instance count');
    }
    const host = (instances as { args?: readonly string[] }[])[0];
    if (!(host?.args ?? []).includes('--dev-auto-host')) {
        fail('planned no auto-hosting first instance');
    }
}

/**
 * The fonts arm (§4.37, Invariant #97): prove the published `chimera-fetch-fonts`
 * bin is reachable from the installed standalone app AND that the scaffolded
 * `--out-dir assets/fonts` shape lands the download in the app's own asset dir —
 * never the doubled `apps/<kebab>/apps/<kebab>/…` phantom path (the tool's
 * README explains the cwd mechanics). The fetch runs against a localhost
 * fixture; no live Google network is touched.
 *
 * The fetch is driven the way a DEVELOPER drives it — `pnpm fetch:fonts --url …`
 * from the project ROOT — rather than by invoking the bin with a hand-built
 * argv. An arm that builds its own argv proves only that the bin works; it says
 * nothing about the script that ships, and that gap is not hypothetical. The
 * shipped script once read `--url <google-css-url>`, whose unquoted angle
 * brackets `sh` consumes as a REDIRECTION: the command died with
 * `sh: google-css-url: No such file or directory` before `chimera-fetch-fonts`
 * was ever looked up, and the error named neither the script nor the tool. This
 * arm was fully green throughout. Driving the real script from the real
 * directory now covers the whole chain at once — the root forward exists, the
 * app script survives `sh`, pnpm's trailing-arg append carries `--url` through
 * both hops, and the bare bin name resolves.
 */
async function runFontsArm(
    deps: VerifyScaffoldDeps,
    projectRoot: string,
    appDir: string,
): Promise<void> {
    const fail = (reason: string): never => {
        throw new VerifyScaffoldStepError('fonts', `verify:scaffold: step "fonts" ${reason}`);
    };

    // (a) The scaffolded script names the bare bin and carries the
    //     anti-path-doubling --out-dir.
    const appPkg = JSON.parse(await deps.fs.readFile(path.join(appDir, 'package.json'))) as {
        scripts?: Record<string, string>;
    };
    const script = appPkg.scripts?.['fetch:fonts'] ?? '';
    if (!script.includes('chimera-fetch-fonts')) {
        fail('found no fetch:fonts script naming the chimera-fetch-fonts bin');
    }
    if (!script.includes('--out-dir assets/fonts')) {
        fail('found a fetch:fonts script without --out-dir assets/fonts');
    }
    // A package script is handed to `sh`, which reads `<` and `>` as REDIRECTIONS.
    // The script once documented its argument inline as `--url <google-css-url>`;
    // sh opened a file named `google-css-url`, failed, and reported
    // `sh: google-css-url: No such file or directory` — a message naming neither
    // the script nor the bin, which reads as the tool being absent from the
    // scaffold. Step (c) below would now catch this by running the real script,
    // but only as an opaque non-zero exit; refusing here names the actual cause.
    if (/[<>]/u.test(script)) {
        fail(
            'found a fetch:fonts script containing a shell redirection character (< or >) — ' +
                `sh consumes it before the bin is looked up: ${script}`,
        );
    }

    // (b) The bin resolves from the installed app (how pnpm resolves the bare
    //     name when it runs the script).
    if (!(await deps.fs.exists(path.join(appDir, 'node_modules', '.bin', 'chimera-fetch-fonts')))) {
        fail('resolved no chimera-fetch-fonts under the app node_modules/.bin');
    }

    // (c) A real fetch through the localhost fixture, driven as `pnpm fetch:fonts
    //     --url …` from the PROJECT ROOT — the documented invocation, exercising
    //     the root forward, the shipped app script, and pnpm's trailing-arg
    //     append in one command. The script supplies `--game` and `--out-dir`
    //     itself; only the URL is a caller argument. pnpm runs the delegated
    //     script with cwd = the app package, so `--out-dir assets/fonts` still
    //     resolves app-relative and check (d) below stays exact.
    let fixture: FontFixture;
    try {
        fixture = await deps.startFontFixture();
    } catch (error) {
        return fail(
            `could not start the font fixture server (${error instanceof Error ? error.message : String(error)})`,
        );
    }
    try {
        assertStepOk(
            'fonts',
            deps.run(
                'pnpm',
                ['run', 'fetch:fonts', '--url', `http://127.0.0.1:${fixture.port}/css`],
                { cwd: projectRoot },
            ),
        );
    } finally {
        fixture.close();
    }

    // (d) The landed-font proof: the woff2 sits in the app's own assets/fonts,
    //     and the doubled phantom path was never created.
    if (!(await deps.fs.exists(path.join(appDir, 'assets', 'fonts', PROBE_FONT_FILE)))) {
        fail(`landed no ${PROBE_FONT_FILE} under the app assets/fonts`);
    }
    const doubled = path.join(appDir, 'apps', PROBE_GAME.kebab, 'assets', 'fonts', PROBE_FONT_FILE);
    if (await deps.fs.exists(doubled)) {
        fail('landed the download under the doubled apps/<kebab>/apps/… path');
    }
}

/**
 * The generate-icons arm (§4.32): prove the published `chimera-generate-icons`
 * bin is reachable and RUNS from the installed standalone app, and that nothing
 * in the scaffold hands it the codec it is designed to do without.
 *
 * What "does without" means precisely, because the loose version is wrong: a
 * Next-based scaffold installs `sharp` regardless — Next declares it as an
 * `optionalDependency`, and pnpm's `.pnpm/node_modules` hoisted layer is on the
 * resolution path for a package living in the store, so the tool can load it
 * (at Next's version, not the declared peer range). What this design saves is
 * the SECOND copy, and what this arm checks is that no direct declaration puts
 * the codec in a project that never asked for one.
 *
 * The run below therefore has TWO legitimate outcomes, and asserting either one
 * alone would be asserting against another package's dependency graph: with the
 * hoisted `sharp` reachable it generates the set, and without it it refuses with
 * the actionable install message. Both are graded, because the defect this arm
 * exists for is neither — it is an exit 0 that wrote NOTHING, which is what a
 * bare-path entry guard produces through a pnpm shim. "Exited 0" and "exited 0
 * having actually written the set" are the same observation to a status check
 * and opposite observations to this one.
 *
 * Load-bearing detail: the bin runs THROUGH `node_modules/.bin`, never a
 * resolved real path. pnpm's shim execs node with the symlinked path while
 * node's loader reports the real one, so an entry guard comparing them raw is
 * false and the bin exits 0 having done nothing. Against a bare path compare
 * this arm sees an exit 0 with no message and fails — which is the whole reason
 * it invokes the script rather than the file.
 */
async function runGenerateIconsArm(
    deps: VerifyScaffoldDeps,
    tmp: string,
    appDir: string,
): Promise<void> {
    const fail = (reason: string): never => {
        throw new VerifyScaffoldStepError(
            'generate-icons',
            `verify:scaffold: step "generate-icons" ${reason}`,
        );
    };

    // (a) The scaffolded script, whole-string. Both flags are the mechanism, and
    //     only one of the two omissions is loud — §4.32 has the reasoning.
    const appPkg = JSON.parse(await deps.fs.readFile(path.join(appDir, 'package.json'))) as {
        scripts?: Record<string, string>;
    };
    const script = appPkg.scripts?.['icons:generate'];
    if (script !== PROBE_ICONS_GENERATE_SCRIPT) {
        fail(
            `found no app icons:generate script equal to "${PROBE_ICONS_GENERATE_SCRIPT}" (got ${JSON.stringify(script)})`,
        );
    }

    // (b) The bin resolves from the installed app — how pnpm resolves the bare
    //     name when it runs that script.
    if (
        !(await deps.fs.exists(path.join(appDir, 'node_modules', '.bin', 'chimera-generate-icons')))
    ) {
        fail('resolved no chimera-generate-icons under the app node_modules/.bin');
    }

    // (c) Neither codec is a DIRECT dependency of the scaffold. What keeps a
    //     project's own `node_modules` to exactly what it declared is
    //     `public-hoist-pattern` being empty, not the isolated linker — pinned
    //     for this probe in the `.npmrc` written beside its manifest, since a
    //     developer or runner with `shamefully-hoist=true` set globally would
    //     otherwise get Next's `sharp` linked here and red this check against a
    //     declaration that does not exist.
    //
    //     A codec in either tree therefore means something in the emitted
    //     project asked for it — the defect this arm found on its first run: the
    //     frozen toolchain snapshot inherited both from the monorepo's root
    //     devDeps, so every scaffold declared them.
    //
    //     What this does NOT prove is that the codec is unresolvable. It can
    //     still reach the tool from pnpm's `.pnpm/node_modules` hoisted layer —
    //     Next brings `sharp` that way — and proving otherwise would mean
    //     asserting against another package's dependency graph. The claim here
    //     is the one the scaffold controls.
    for (const codec of PROBE_ICON_CODECS) {
        for (const [label, root] of [
            ['app', appDir],
            ['project root', tmp],
        ] as const) {
            if (await deps.fs.exists(path.join(root, 'node_modules', codec))) {
                fail(
                    `declared ${codec} into the ${label} node_modules — the codec is an OPTIONAL peer precisely so a project that never regenerates its icons does not ask for it`,
                );
            }
        }
    }

    // (d) The run, through the `.bin` shim. Graded on WORK DONE, not on status —
    //     see the header for why both outcomes are legitimate here.
    const run = deps.run('pnpm', ['--filter', PROBE_GAME.pkg, 'icons:generate'], {
        cwd: tmp,
        capture: true,
    });
    const output = `${run.stdout}${run.stderr}`;
    if (run.status === 0) {
        // The set, on disk, not the "Wrote N files" line — a bin that printed
        // its own success message would satisfy a log check while having written
        // nothing, which is precisely the failure being ruled out.
        const generated = path.join(appDir, 'assets', 'icons', 'chimera.png');
        if (!(await deps.fs.exists(generated))) {
            fail(
                'exited 0 without writing assets/icons/chimera.png — the likeliest cause is the entry guard no-opping through the .bin symlink, which exits 0 having done nothing at all',
            );
        }
    } else {
        // Non-zero alone is also what a bin that failed to load at all produces,
        // so the failure has to be the ACTIONABLE one — the refusal a game author
        // hits before they have opted into the codec.
        const installCommand = `pnpm add -D ${PROBE_ICON_CODECS.join(' ')}`;
        if (!output.includes(installCommand)) {
            fail(
                `failed without naming "${installCommand}" — a non-zero exit is also what a bin that could not load at all produces, so the message is what separates them`,
            );
        }
    }

    // (e) The declaration, read off the INSTALLED manifest rather than inferred
    //     from (c). An absence proves only that nothing declared them HERE; a
    //     consumer on npm reads this manifest, and `optional` is what keeps the
    //     peer from being auto-installed for them too — the one guard on this
    //     branch that observes that flag at all.
    const installedPkg = JSON.parse(
        await deps.fs.readFile(
            path.join(readInstalledElectronDir(deps, tmp, appDir, fail), 'package.json'),
        ),
    ) as {
        dependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
        peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    for (const codec of PROBE_ICON_CODECS) {
        if (installedPkg.dependencies?.[codec] !== undefined) {
            fail(`installed @chimera-engine/electron declares ${codec} as a runtime dependency`);
        }
        if (installedPkg.peerDependencies?.[codec] === undefined) {
            fail(
                `installed @chimera-engine/electron declares no ${codec} peer — the bin would fail with an unexplained module-not-found`,
            );
        }
        if (installedPkg.peerDependenciesMeta?.[codec]?.optional !== true) {
            fail(
                `installed @chimera-engine/electron declares ${codec} as a NON-optional peer — package managers auto-install those, so every game would carry it`,
            );
        }
    }
}

/**
 * The real directory the installed `@chimera-engine/electron` lives in.
 *
 * Followed through the symlink pnpm installs the package as, because the two
 * arms that read its manifest need the file a consumer's `npm install` would
 * actually consult, and the closure only exists on the far side of the link.
 * `fail` is the caller's, so the failure is reported as that caller's step.
 */
function readInstalledElectronDir(
    deps: VerifyScaffoldDeps,
    tmp: string,
    appDir: string,
    fail: (reason: string) => never,
): string {
    const electronDir = path.join(appDir, 'node_modules', '@chimera-engine', 'electron');
    const resolved = deps.run(
        'node',
        ['-e', `process.stdout.write(require('fs').realpathSync(${JSON.stringify(electronDir)}))`],
        { cwd: tmp, capture: true },
    );
    // Both halves matter and neither is loud on its own: a non-zero status is a
    // resolution that failed, while an empty stdout is one that "succeeded" and
    // returned nothing — which would make the manifest path `package.json`,
    // relative to the gate's own cwd, and the read either throws an unnamed
    // error or silently grades the WRONG manifest.
    if (resolved.status !== 0 || resolved.stdout.trim() === '') {
        fail('could not resolve the installed @chimera-engine/electron directory');
    }
    return resolved.stdout.trim();
}

/**
 * The validate-assets arm (§4.10, Invariants #22/#52): prove the published
 * `chimera-validate-assets` bin is reachable from the installed standalone app,
 * that the scaffolded `../..` points discovery at the PROJECT ROOT, and — the
 * part no exit code can show on its own — that the check actually BITES there.
 *
 * A run that discovered nothing would pass a clean-scaffold assertion exactly
 * as happily as a correct one, so the arm plants a broken ref and requires the
 * next run to fail. It also reads the INSTALLED package's `typescript`
 * declaration, which is what a consumer gets and what no resolution can
 * establish (see the comment at that step).
 */
async function runValidateAssetsArm(
    deps: VerifyScaffoldDeps,
    tmp: string,
    appDir: string,
): Promise<void> {
    const fail = (reason: string): never => {
        throw new VerifyScaffoldStepError(
            'validate-assets',
            `verify:scaffold: step "validate-assets" ${reason}`,
        );
    };
    const validate = (): RunResult =>
        deps.run('pnpm', ['--filter', PROBE_GAME.pkg, 'validate:assets'], {
            cwd: tmp,
            capture: true,
        });

    // (a) The scaffolded script, whole-string: the DEPTH is the mechanism. Run
    //     app-level, `../..` is the project root; one segment more resolves
    //     above the project entirely.
    const appPkg = JSON.parse(await deps.fs.readFile(path.join(appDir, 'package.json'))) as {
        scripts?: Record<string, string>;
    };
    const script = appPkg.scripts?.['validate:assets'];
    if (script !== PROBE_VALIDATE_ASSETS_SCRIPT) {
        fail(
            `found no app validate:assets script equal to "${PROBE_VALIDATE_ASSETS_SCRIPT}" (got ${JSON.stringify(script)})`,
        );
    }

    // (b) The bin resolves from the installed app — how pnpm resolves the bare
    //     name when it runs that script.
    if (
        !(await deps.fs.exists(
            path.join(appDir, 'node_modules', '.bin', 'chimera-validate-assets'),
        ))
    ) {
        fail('resolved no chimera-validate-assets under the app node_modules/.bin');
    }

    // (c) The clean scaffold passes, and reports a count.
    const clean = validate();
    const cleanOutput = `${clean.stdout}${clean.stderr}`;
    // Checked BEFORE the exit code: a standalone root has no
    // `renderer/public/assets`, so that check scans an empty set — an empty set
    // is a no-op, not a finding. The tool only prints this heading inside a
    // failing report, so asserting it after `assertStepOk` could never fire.
    if (cleanOutput.includes('Renderer-public game assets are forbidden')) {
        fail('flagged renderer-public game assets on a root that has no renderer/public/assets');
    }
    assertStepOk('validate-assets', clean);
    // `Checked N` is what separates "read the workspace and found nothing
    // wrong" from "never reached it at all" — a bin that printed nothing and
    // happened to exit 0 clears the assertion above but not this one. Zero is
    // accepted deliberately: a blank template declares no assets yet, so the
    // clean scaffold genuinely reports 0.
    if (!/Checked \d+ asset refs/u.test(cleanOutput)) {
        fail('ran on the clean scaffold without reporting a checked-ref count');
    }

    // (c2) The manifest-read half. `Checked 0` above is exactly what a tree with
    //      NO manifest reports, so nothing so far distinguishes "read the
    //      shipped asset-manifest.ts and it was empty" from "never found it".
    //      Plant ONE valid entry and require the count to move. See
    //      PROBE_MANIFEST_ENTRY_REL for what each half of that proves.
    deps.log('planting a valid manifest entry — this run must PASS with a non-zero checked count…');
    const manifestPath = path.join(appDir, 'asset-manifest.ts');
    if (!(await deps.fs.exists(manifestPath))) {
        fail(
            'scaffolded no asset-manifest.ts — chimera-validate-assets discovers it by that exact basename',
        );
    }
    const manifestSource = await deps.fs.readFile(manifestPath);
    if (!PROBE_EMPTY_ENTRIES_PATTERN.test(manifestSource)) {
        fail(
            'the scaffolded asset-manifest.ts no longer exposes an entries array this gate can plant into — if the shape changed deliberately, update PROBE_EMPTY_ENTRIES_PATTERN',
        );
    }
    const probeRef = `${PROBE_GAME.kebab}/${PROBE_MANIFEST_ENTRY_REL.split(path.sep).join('/')}`;
    const probePngPath = path.join(appDir, 'assets', PROBE_MANIFEST_ENTRY_REL);
    await deps.fs.mkdir(path.dirname(probePngPath));
    await deps.fs.writeFile(probePngPath, PROBE_MANIFEST_ASSET_CONTENT);
    await deps.fs.writeFile(
        manifestPath,
        manifestSource.replace(
            PROBE_EMPTY_ENTRIES_PATTERN,
            `entries: [{ ref: '${probeRef}', kind: 'texture', priority: 'deferred' }],`,
        ),
    );
    let plantedManifest: RunResult;
    try {
        plantedManifest = validate();
    } finally {
        await deps.fs.writeFile(manifestPath, manifestSource);
        await deps.fs.rm(probePngPath);
    }
    assertStepOk('validate-assets', plantedManifest);
    const plantedOutput = `${plantedManifest.stdout}${plantedManifest.stderr}`;
    if (!/Checked [1-9]\d* asset refs/u.test(plantedOutput)) {
        fail(
            `reported no checked refs with a valid entry planted in ${manifestPath} — the shipped manifest is not the one the tool reads`,
        );
    }

    // (d) Non-vacuity. Plant a content ref to an asset that does not exist and
    //     require the very next run to fail. Temp dir only — removed in the
    //     `finally` so a failure here cannot leave the probe dirty.
    deps.log(
        'planting a broken asset ref — the validation failure printed next is the EXPECTED one…',
    );
    const brokenRefPath = path.join(appDir, 'data', PROBE_BROKEN_REF_FILE);
    await deps.fs.mkdir(path.join(appDir, 'data'));
    await deps.fs.writeFile(
        brokenRefPath,
        `${JSON.stringify({ portrait: `${PROBE_GAME.kebab}/textures/__missing__.png` }, null, 4)}\n`,
    );
    let planted: RunResult;
    try {
        planted = validate();
    } finally {
        await deps.fs.rm(brokenRefPath);
    }
    if (planted.status === 0) {
        fail('passed with a broken asset ref planted under the app data/ — the check is vacuous');
    }
    // Non-zero alone would also be satisfied by the planted JSON crashing the
    // tool. The failure has to be ABOUT the ref.
    if (
        !`${planted.stdout}${planted.stderr}`.includes(
            `${PROBE_GAME.kebab}/textures/__missing__.png`,
        )
    ) {
        fail('failed on the planted ref without naming it — the non-zero exit may be unrelated');
    }

    // (e) The under-declaration half. The bin imports `typescript` as runtime
    //     VALUES for its AST crawl, and two separate things have to be true of
    //     that: it must RESOLVE here, and it must be DECLARED so it resolves
    //     for everyone else too.
    //
    //     Resolution is already proven above — the bin loaded and produced two
    //     reports, which it could not have done with an unresolvable top-level
    //     import. What that does NOT establish is *why* it resolved: this probe
    //     is a pnpm workspace whose own root declares `typescript`, so a
    //     hoisted copy would satisfy the import here and fail the consumer who
    //     has no such root. Nor can a resolution tell the two apart —
    //     `require.resolve` returns a realpath, and every route lands on the
    //     same store directory.
    //
    //     So the declaration is read off the INSTALLED manifest, which is what
    //     `npm install @chimera-engine/electron` actually consults — see
    //     {@link readInstalledElectronDir}.
    const installedPkg = JSON.parse(
        await deps.fs.readFile(
            path.join(readInstalledElectronDir(deps, tmp, appDir, fail), 'package.json'),
        ),
    ) as { dependencies?: Record<string, string> };
    if (installedPkg.dependencies?.['typescript'] === undefined) {
        fail(
            "installed @chimera-engine/electron without typescript in its dependencies — the bin's AST crawl imports it as values, so a consumer without a hoisted copy would get 'Cannot find module'",
        );
    }
}

/** Run one of the generated app's smoke scripts (`test` or `test:e2e`) from the standalone root. */
function runAppScript(
    deps: VerifyScaffoldDeps,
    tmp: string,
    script: 'test' | 'test:e2e',
): RunResult {
    deps.log(`running the generated app's "${script}" smoke…`);
    return deps.run('pnpm', ['--filter', PROBE_GAME.pkg, script], { cwd: tmp });
}

/**
 * Drop the required renderer registration from the freshly-scaffolded app (temp dir only).
 * The blank template's `renderer/register.ts` ends with a `registerRendererGame(...)` call;
 * removing it leaves the game unregistered so the smoke run must fail. Returns false (and the
 * self-test fails loudly downstream) when there was no registration call to drop.
 */
async function dropRegistration(deps: VerifyScaffoldDeps, appDir: string): Promise<boolean> {
    const registerPath = path.join(appDir, 'renderer', 'register.ts');
    try {
        const raw = await deps.fs.readFile(registerPath);
        const broken = raw.replace(
            /^[ \t]*registerRendererGame\([^;]*\);[ \t]*$/m,
            '// registration removed by verify:scaffold --self-test',
        );
        if (broken === raw) {
            deps.log('self-test: no registerRendererGame(...) call found to drop');
            return false;
        }
        await deps.fs.writeFile(registerPath, broken);
        deps.log('self-test: dropped the renderer registration from the scaffolded app');
        return true;
    } catch {
        deps.log(`self-test: could not read ${registerPath} to break it`);
        return false;
    }
}

// ── Shared pipeline: build → pack → synthesize → scaffold → install → smoke ─────

interface PipelineHooks {
    /** Runs after the app is scaffolded + dep-rewritten, before install (used by the self-test). */
    readonly mutate?: (deps: VerifyScaffoldDeps, appDir: string) => Promise<void>;
}

/**
 * The full pipeline inside an already-created throwaway `tmp` (the caller owns `tmp` so it
 * can always clean up). Throws {@link VerifyScaffoldStepError} on the first failed step.
 */
async function scaffoldPipeline(
    deps: VerifyScaffoldDeps,
    tmp: string,
    options: VerifyScaffoldOptions,
    hooks: PipelineHooks = {},
): Promise<void> {
    const tarballsDir = path.join(tmp, 'tarballs');
    const appDir = path.join(tmp, 'apps', PROBE_GAME.kebab);
    await deps.fs.mkdir(tarballsDir);

    // 1. build
    deps.log('building @chimera-engine/* packages…');
    assertStepOk('build', deps.run('pnpm', ['build:packages'], { cwd: deps.repoRoot }));

    // 2. pack
    const tarballs = packAll(deps, tarballsDir);

    // 3. scaffold via the real CLI in standalone `--out` mode: it EMITS the whole project root
    //    (package.json toolchain manifest, pnpm-workspace.yaml, vitest.config.mts, tsconfig.json)
    //    AND the app. The gate verifies the EXACT bytes the CLI ships — it no longer synthesizes
    //    the root itself.
    assertStepOk('scaffold', scaffoldProbe(deps, tmp));

    // 4. layer tarball overrides onto the CLI-emitted root, and rewrite the app's @chimera-engine/* deps
    //    onto the packed tarballs, so the whole DAG resolves through the locally-built artifacts
    //    instead of the (unpublished) npm ranges the CLI emitted.
    const rootPkgPath = path.join(tmp, 'package.json');
    const emittedRoot = JSON.parse(await deps.fs.readFile(rootPkgPath)) as StandaloneRootManifest;
    await deps.fs.writeFile(
        rootPkgPath,
        `${JSON.stringify(applyTarballOverrides(emittedRoot, tarballs), null, 4)}\n`,
    );
    const appPkgPath = path.join(appDir, 'package.json');
    await deps.fs.writeFile(
        appPkgPath,
        rewriteAppChimeraDeps(await deps.fs.readFile(appPkgPath), tarballs),
    );

    // 4b. Pin the probe's hoisting BEFORE the install — see {@link PROBE_NPMRC}
    //     for what each line covers and why all three are needed. Written after
    //     the manifest rewrites and before step 5, because an `.npmrc` that
    //     lands after `pnpm install` has no effect at all.
    await deps.fs.writeFile(path.join(tmp, '.npmrc'), PROBE_NPMRC);

    if (hooks.mutate !== undefined) await hooks.mutate(deps, appDir);

    // 5. install
    deps.log('installing the standalone workspace (tarballs + toolchain)…');
    assertStepOk('install', deps.run('pnpm', ['install'], { cwd: tmp }));

    // 6. unit smoke
    assertStepOk('unit', runAppScript(deps, tmp, 'test'));

    // 7. e2e boot-smoke. The EMITTED app's `test:e2e` script self-sets
    //    `CHIMERA_VERIFY_PACK_NODE_MODULES=node_modules` (via cross-env), so build-main bundles the
    //    Electron host + preload from the app's own installed `@chimera-engine/electron` (no monorepo
    //    `electron/` source exists here). The gate passes no env of its own — it validates exactly
    //    the shipped script behaviour.
    if (options.skipE2e !== true) {
        assertStepOk('e2e', runAppScript(deps, tmp, 'test:e2e'));
    }

    // 8. production build. `build` runs `tsc -p tsconfig.build.json`: out-of-repo it only
    //    succeeds because the standalone emit neutralised the template's monorepo `references` (the
    //    engine now resolves from `node_modules`). `build:app` esbuild-bundles main/preload — the
    //    EMITTED script self-sets `CHIMERA_VERIFY_PACK_NODE_MODULES`, so the host resolves from the
    //    installed `@chimera-engine/electron`, not absent monorepo source.
    deps.log('production-building the generated app (tsc + app bundle)…');
    //    The asset-seam probe (see {@link PROBE_SEAM_PLANT}) is in place for
    //    exactly this tsc run and removed in a `finally`, so no failure can
    //    leave the generated app dirty.
    const seamProbePath = path.join(appDir, PROBE_SEAM_PLANT.rel);
    try {
        await deps.fs.writeFile(seamProbePath, PROBE_SEAM_PLANT.source);
        assertStepOk(
            'prod-build',
            deps.run('pnpm', ['--filter', PROBE_GAME.pkg, 'build'], { cwd: tmp }),
        );
    } finally {
        await deps.fs.rm(seamProbePath);
    }
    assertStepOk(
        'prod-build',
        deps.run('pnpm', ['--filter', PROBE_GAME.pkg, 'build:app'], { cwd: tmp }),
    );

    // 8a. the generated app's own Invariant #27 gate: the blank template ships a
    //    `verify:packaged-bundle` script driving the engine-exported packaged-bundle guard
    //    (@chimera-engine/electron/packaged-bundle), protecting the adopter-editable
    //    `build-main.ts` + `electron-builder.yml`. Running it here means a broken TEMPLATE
    //    gate fails the engine's own CI, not a downstream adopter's packaging run. It rebuilds
    //    the app's dist twice (packaged, then the dev restore that doubles as its negative
    //    control), so it sits between build:app and the arms that read `dist/` — it exits with
    //    the DEV bundle restored, exactly the shape the dev-harness dry run and the package arm
    //    expect.
    deps.log("running the generated app's verify:packaged-bundle gate (Invariant #27)…");
    assertStepOk(
        'packaged-bundle',
        deps.run('pnpm', ['--filter', PROBE_GAME.pkg, 'verify:packaged-bundle'], { cwd: tmp }),
    );

    // 8b. dev-harness dry run (§4.32): the packaged `chimera-dev-mp` bin must resolve from
    //    the standalone install (via the app's `dev:mp` script) and produce a valid spawn
    //    plan against the just-built app entry. `--dry-run` spawns no Electron — the gate
    //    stays CI-cheap; the plan JSON is extracted from under pnpm's script banner and
    //    shape-checked so a bin that "succeeds" without planning still fails the step.
    deps.log('dry-running the dev multiplayer harness (chimera-dev-mp --dry-run)…');
    const devHarnessDryRun = deps.run(
        'pnpm',
        ['--filter', PROBE_GAME.pkg, 'dev:mp', '2', '--dry-run'],
        { cwd: tmp, capture: true },
    );
    assertStepOk('dev-harness', devHarnessDryRun);
    assertDryRunReport(devHarnessDryRun.stdout);

    // 8c. fonts (§4.37): the packaged `chimera-fetch-fonts` bin + the scaffolded
    //     `--out-dir assets/fonts` shape, proven end-to-end against a localhost
    //     fixture — see {@link runFontsArm}.
    deps.log('fetching a font through the packaged chimera-fetch-fonts bin (localhost fixture)…');
    await runFontsArm(deps, tmp, appDir);

    // 8d. validate-assets (§4.10, Invariants #22/#52): the packaged
    //     `chimera-validate-assets` bin + the scaffolded `../..` invocation,
    //     proven to pass clean AND to fail on a planted broken ref — see
    //     {@link runValidateAssetsArm}.
    deps.log('validating the scaffolded assets through the packaged chimera-validate-assets bin…');
    await runValidateAssetsArm(deps, tmp, appDir);

    // 8e. generate-icons (§4.32): the packaged `chimera-generate-icons` bin,
    //     reachable and RUNNING through the app's `.bin` shim while neither
    //     optional codec is installed — reachability without install weight, and
    //     the actionable message that makes an absent codec explainable. See
    //     {@link runGenerateIconsArm}.
    deps.log(
        'running the packaged chimera-generate-icons bin from the scaffold — it either ' +
            'writes the set or refuses with the missing-codec message, and a refusal ' +
            'printed next is EXPECTED…',
    );
    await runGenerateIconsArm(deps, tmp, appDir);

    // 8f. lint (§4.32): the architecture guardrails, run from the project root
    //     on the untouched scaffold and then against one planted violation per
    //     curated rule — see {@link runLintArm}. Positioned before `package`
    //     deliberately: the tree here already holds `renderer/.next`,
    //     `renderer/out` and `dist` from the earlier build steps, which is the
    //     state a game author lints in.
    deps.log("running the generated app's lint gate through the project-root forward…");
    await runLintArm(deps, tmp, appDir);

    // 9. package. Export the Next renderer (populates `renderer/out`), then build an UNSIGNED
    //    `electron-builder --dir` bundle from the standalone-emitted project. electron-builder
    //    validates + consumes the per-game top-level `icon`, so a missing/invalid icon fails here.
    //    `--dir` skips dmg/nsis/AppImage (no python, CI-feasible — signing stays out of scope).
    deps.log('packaging the generated app (electron-builder --dir, unsigned)…');
    assertStepOk(
        'package',
        deps.run('pnpm', ['exec', 'next', 'build', `apps/${PROBE_GAME.kebab}/renderer`], {
            cwd: tmp,
        }),
    );
    // `exec electron-builder --dir` (NOT `run package -- --dir`): pnpm's `--` separator is forwarded
    // to the script verbatim, so `run package -- --dir` becomes `electron-builder -- --dir` — yargs
    // then treats `--dir` as a positional and electron-builder builds the DEFAULT targets (incl. the
    // dmg, which shells out to python). `exec` passes `--dir` as a real flag → dir-only, python-free.
    // It reads the same app `electron-builder.yml`; the app's `package` script stays the real
    // distributable flow.
    assertStepOk(
        'package',
        deps.run('pnpm', ['--filter', PROBE_GAME.pkg, 'exec', 'electron-builder', '--dir'], {
            cwd: tmp,
        }),
    );
    if (!(await deps.fs.exists(path.join(appDir, 'release')))) {
        throw new VerifyScaffoldStepError(
            'package',
            'verify:scaffold: step "package" produced no <app>/release bundle',
        );
    }
}

/**
 * The architecture-lint arm (§4.32): the guardrails a game keeps after leaving
 * the monorepo, proven where they have to hold — an INSTALLED project, from the
 * command a game author runs.
 *
 * What it proves and why that shape, in
 * `electron/dev-tools/eslint/README.md` ("How this is proven").
 */
async function runLintArm(deps: VerifyScaffoldDeps, tmp: string, appDir: string): Promise<void> {
    const fail = (reason: string): never => {
        throw new VerifyScaffoldStepError('lint', `verify:scaffold: step "lint" ${reason}`);
    };
    // From the PROJECT ROOT, which is what a game author has open and what the
    // forwarded script exists for — not `--filter`, which would prove the app
    // script while leaving the forward untested.
    const lint = (): RunResult => deps.run('pnpm', ['lint'], { cwd: tmp, capture: true });

    // (a) The published subpath resolves in the installed project — through the
    //     package's `exports` map, which is the thing that makes it public.
    //     Statting the dist file behind it would stay green with `"./eslint"`
    //     deleted from the map, and a subpath has no `.bin` symlink to check
    //     the way the sibling bins do. Everything below depends on this, so its
    //     absence is named here rather than surfacing as an opaque config-load
    //     failure three lines later.
    const resolved = deps.run(
        'node',
        ['-e', "require.resolve('@chimera-engine/electron/eslint')"],
        { cwd: appDir, capture: true },
    );
    if (resolved.status !== 0) {
        fail(
            `could not resolve @chimera-engine/electron/eslint from the installed app: ${`${resolved.stdout}${resolved.stderr}`.slice(0, 400)}`,
        );
    }

    // (b) The clean scaffold. A game nobody has touched must lint green, or the
    //     guardrails are noise the first author turns off.
    const clean = lint();
    if (clean.status !== 0) {
        fail(
            `reported on an untouched scaffold: ${`${clean.stdout}${clean.stderr}`.slice(0, 1500)}`,
        );
    }

    // (c) Non-vacuity, one plant per curated rule — plus the second arm of the
    //     rule that has two. A clean pass is equally produced by a config that
    //     matched no files at all.
    deps.log('planting lint violations — the rule reports printed next are the EXPECTED ones…');
    const tokenOverridePath = path.join(appDir, 'styles', 'tokens-override.css');
    const tokenOverrideBefore = await deps.fs.readFile(tokenOverridePath);
    const plantedPaths = PROBE_LINT_PLANTS.map((plant) => path.join(appDir, plant.rel));

    let planted: RunResult;
    try {
        for (const [index, plant] of PROBE_LINT_PLANTS.entries()) {
            await deps.fs.writeFile(plantedPaths[index] ?? '', plant.source);
        }
        await deps.fs.writeFile(
            tokenOverridePath,
            `${tokenOverrideBefore}\n:root {\n    ${PROBE_UNKNOWN_TOKEN}: 1px;\n}\n`,
        );
        // `-f json`, not the default stylish output — the report is read
        // structurally below. pnpm appends trailing args to the delegated
        // script, so the flag reaches `eslint .` through both forwards.
        planted = deps.run('pnpm', ['lint', '-f', 'json'], { cwd: tmp, capture: true });
    } finally {
        for (const plantedPath of plantedPaths) await deps.fs.rm(plantedPath);
        await deps.fs.writeFile(tokenOverridePath, tokenOverrideBefore);
    }

    const report = `${planted.stdout}${planted.stderr}`;
    // The run is captured, and `run` echoes only stderr — ESLint writes its
    // findings to stdout, so without this the operator is promised a report and
    // shown pnpm's exit banner.
    deps.log(report.trim());
    if (planted.status === 0) {
        fail(
            `passed with a planted violation of every curated rule — the gate is vacuous. Report: ${report.slice(0, 800)}`,
        );
    }

    // Findings BY FILE. `ruleId` and `filePath` come off the same message
    // object, so a rule that fired somewhere else cannot stand in for one that
    // never fired here — and this is the only check on the report's content,
    // because a rule id missing from its own file's findings is the same
    // failure as a rule id missing from the report entirely.
    // STDOUT alone, not the combined capture above. Node writes deprecation
    // warnings to stderr, and a bracketed one landing after the JSON moves
    // `lastIndexOf(']')` past the array — which would fail this step on a
    // correct scaffold, on some runners and not others.
    const rulesByFile = parseEslintJsonReport(planted.stdout, () => report.slice(0, 800), fail);
    // ESLint reports the RESOLVED path. `appDir` is built from the temp root
    // this process created, which on macOS is the `/var/folders/…` symlink to
    // the `/private/var/folders/…` ESLint prints — the same file under two names
    // that never compare equal, so every lookup below missed and the arm failed
    // claiming no rule fired while the report named all five.
    const realAppDir = await deps.fs.realpath(appDir);
    for (const [file, ruleId] of [
        ...PROBE_LINT_PLANTS.map((plant) => [plant.rel, plant.ruleId] as const),
        ['styles/tokens-override.css', PROBE_UNKNOWN_TOKEN_RULE] as const,
    ]) {
        const reported = rulesByFile.get(path.join(realAppDir, file)) ?? new Set<string>();
        if (!reported.has(ruleId)) {
            fail(
                `planted ${ruleId} in ${file} and got ${reported.size === 0 ? 'no finding there at all' : `only ${[...reported].join(', ')}`}`,
            );
        }
    }
}

/**
 * ESLint's `-f json` output, as `filePath -> {ruleId}`.
 *
 * The array is sliced out from under pnpm's script banner — pnpm prints its `>`
 * lines to the same stream before the delegated command's own output.
 *
 * `output` is stdout; `excerpt` is what a failure quotes. They differ on
 * purpose: a crash writes its explanation to STDERR, so the excerpt has to carry
 * both streams, while the slice must not — a bracketed stderr line landing after
 * the JSON moves the closing bracket past the array.
 */
function parseEslintJsonReport(
    output: string,
    excerpt: () => string,
    fail: (reason: string) => never,
): Map<string, Set<string>> {
    const start = output.indexOf('[');
    const end = output.lastIndexOf(']');
    if (start === -1 || end <= start) {
        fail(`printed no JSON report: ${excerpt()}`);
    }

    let results: { filePath?: unknown; messages?: { ruleId?: unknown }[] }[];
    try {
        results = JSON.parse(output.slice(start, end + 1)) as typeof results;
    } catch {
        return fail(`printed an unparseable JSON report: ${excerpt()}`);
    }

    const byFile = new Map<string, Set<string>>();
    for (const result of results) {
        if (typeof result.filePath !== 'string') continue;
        const rules = new Set<string>();
        for (const message of result.messages ?? []) {
            // ESLint's fatal-parse marker, not a rule.
            if (typeof message.ruleId === 'string') rules.add(message.ruleId);
        }
        if (rules.size > 0) byFile.set(result.filePath, rules);
    }
    return byFile;
}

// ── Orchestration ──────────────────────────────────────────────────────────────

/**
 * The positive gate: scaffold a game out-of-workspace from the packed `@chimera-engine/*` and run
 * its unit + e2e smoke. Cleans up the throwaway in `finally`, even on failure.
 */
export async function verifyScaffold(
    deps: VerifyScaffoldDeps,
    options: VerifyScaffoldOptions = {},
): Promise<VerifyScaffoldResult> {
    const tmp = await deps.fs.mkdtemp(path.join(tmpdir(), 'chimera-verify-scaffold-'));
    try {
        await scaffoldPipeline(deps, tmp, options);
        deps.log('verify:scaffold — the generated app scaffolded, installed, and booted clean.');
        return { ok: true };
    } catch (error) {
        if (error instanceof VerifyScaffoldStepError) {
            deps.log(error.message);
            return { ok: false, failedStep: error.step };
        }
        throw error;
    } finally {
        await deps.fs.rm(tmp);
    }
}

/**
 * The negative gate: prove the smoke run FAILS when the scaffold is broken (the required
 * renderer registration is dropped). Returns `ok: true` only when the break was detected (the
 * pipeline failed); `ok: false` means the broken scaffold still passed — the gate is not
 * biting — or a prerequisite step failed before the break could be exercised.
 */
export async function verifyScaffoldSelfTest(
    deps: VerifyScaffoldDeps,
    options: VerifyScaffoldOptions = {},
): Promise<VerifyScaffoldResult> {
    const tmp = await deps.fs.mkdtemp(path.join(tmpdir(), 'chimera-verify-scaffold-'));
    let dropped = false;
    try {
        await scaffoldPipeline(deps, tmp, options, {
            mutate: async (d, appDir) => {
                dropped = await dropRegistration(d, appDir);
            },
        });
        // The broken scaffold passed every smoke check — the gate is not guarding boot.
        deps.log(
            'verify:scaffold --self-test — FAIL: the broken scaffold still passed; the gate is not biting.',
        );
        return { ok: false };
    } catch (error) {
        if (error instanceof VerifyScaffoldStepError) {
            if (!dropped) {
                deps.log(
                    `verify:scaffold --self-test — could not run: step "${error.step}" failed before the break was applied.`,
                );
                return { ok: false, failedStep: error.step };
            }
            deps.log(
                `verify:scaffold --self-test — PASS: the gate detected the broken scaffold (step "${error.step}" failed).`,
            );
            return { ok: true };
        }
        throw error;
    } finally {
        await deps.fs.rm(tmp);
    }
}

// ── CLI entry (not exercised by unit tests) ───────────────────────────────────
//
// Runs only when executed directly via `tsx tools/verify-scaffold.ts` (the
// `verify:scaffold` / `verify:scaffold:selftest` scripts). The `VITEST` guard keeps the real
// spawnSync / disk I/O out of the unit-test surface, matching the sibling tools. The body is
// an async IIFE rather than top-level await: tsx transforms `tools/*.ts` as CommonJS (the root
// package.json has no `"type": "module"`), and esbuild rejects top-level await in CJS output.

if (process.env['VITEST'] === undefined) {
    void (async (): Promise<void> => {
        const { spawn, spawnSync } = await import('node:child_process');
        const fsp = await import('node:fs/promises');

        const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

        // Scrub ELECTRON_RUN_AS_NODE from the gate's own spawn env: when a shell / CI runner /
        // agent sandbox exports it, the e2e arm's Electron binary boots as plain Node and rejects
        // Playwright's Chromium flags. (The generated fixture also strips it; belt and suspenders.)
        const baseEnv: Record<string, string | undefined> = { ...process.env };
        delete baseEnv['ELECTRON_RUN_AS_NODE'];

        const run: RunFn = (cmd, args, opts) => {
            const result = spawnSync(cmd, [...args], {
                cwd: opts?.cwd,
                env: { ...baseEnv, ...(opts?.env ?? {}) },
                encoding: 'utf8',
                shell: false,
                stdio: opts?.capture === true ? ['ignore', 'pipe', 'pipe'] : 'inherit',
            });
            if (opts?.capture === true && result.stderr) process.stderr.write(result.stderr);
            return {
                status: result.status ?? 1,
                stdout: result.stdout ?? '',
                stderr: result.stderr ?? '',
            };
        };

        const fs: VerifyScaffoldFs = {
            mkdtemp: (prefix) => fsp.mkdtemp(prefix),
            mkdir: (dir) => fsp.mkdir(dir, { recursive: true }).then(() => undefined),
            rm: (dir) => fsp.rm(dir, { recursive: true, force: true }),
            writeFile: (file, data) => fsp.writeFile(file, data, 'utf8'),
            readFile: (file) => fsp.readFile(file, 'utf8'),
            exists: (p) =>
                fsp.access(p).then(
                    () => true,
                    () => false,
                ),
            realpath: (p) => fsp.realpath(p),
        };

        // The Google-Fonts-shaped fixture: one @font-face whose src points back at
        // the same server. Runs OUT-OF-PROCESS (node -e): the gate's RunFn is
        // spawnSync-shaped, so this process's event loop is blocked while the bin
        // runs — an in-process server could never answer it. The child prints
        // `PORT <n>` once listening; close() kills it.
        const fixtureServerScript = [
            "const http = require('node:http');",
            'const server = http.createServer((req, res) => {',
            '    const port = server.address().port;',
            "    if (req.url === '/css') {",
            "        res.setHeader('content-type', 'text/css');",
            '        res.end(',
            '            "@font-face { font-family: \'VerifyProbe\'; font-style: normal; font-weight: 400; font-display: swap; src: url(http://127.0.0.1:" +',
            '                port +',
            '                "/VerifyProbe.woff2) format(\'woff2\'); }",',
            '        );',
            '        return;',
            '    }',
            "    if (req.url === '/VerifyProbe.woff2') {",
            "        res.setHeader('content-type', 'font/woff2');",
            "        res.end(Buffer.from('wOF2-verify-scaffold-fixture'));",
            '        return;',
            '    }',
            '    res.statusCode = 404;',
            "    res.end('not found');",
            '});',
            "server.listen(0, '127.0.0.1', () => { console.log('PORT ' + server.address().port); });",
        ].join('\n');

        const startFontFixture = (): Promise<FontFixture> =>
            new Promise((resolveFixture, rejectFixture) => {
                const child = spawn(process.execPath, ['-e', fixtureServerScript], {
                    stdio: ['ignore', 'pipe', 'inherit'],
                });
                const timer = setTimeout(() => {
                    child.kill();
                    rejectFixture(new Error('font fixture server never reported its port'));
                }, 10_000);
                let banner = '';
                child.stdout.on('data', (chunk: Buffer) => {
                    banner += chunk.toString('utf8');
                    const match = /PORT (\d+)/u.exec(banner);
                    if (match !== null) {
                        clearTimeout(timer);
                        resolveFixture({
                            port: Number(match[1]),
                            close: () => {
                                child.kill();
                            },
                        });
                    }
                });
                child.on('error', (error) => {
                    clearTimeout(timer);
                    rejectFixture(error);
                });
            });

        const deps: VerifyScaffoldDeps = {
            run,
            fs,
            log: (message) => console.log(`[verify:scaffold] ${message}`),
            repoRoot,
            startFontFixture,
        };

        const selfTest = process.argv.includes('--self-test');
        const result = selfTest ? await verifyScaffoldSelfTest(deps) : await verifyScaffold(deps);

        if (!result.ok) {
            console.error(
                selfTest
                    ? '[verify:scaffold] self-test FAILED — the gate did not detect a broken scaffold.'
                    : `[verify:scaffold] FAILED at step "${result.failedStep ?? 'unknown'}".`,
            );
            process.exitCode = 1;
        }
    })();
}
