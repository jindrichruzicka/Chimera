// tools/packaged-build-flag.test.ts
//
// Drift ratchet for the packaged-build marker (Invariant #27, §4.12).
//
// `build:app` is the SAME script an everyday dev launch and a distributable
// build both run, so "this is a packaged build" cannot be inferred — every
// packaging script must DECLARE it with `CHIMERA_PACKAGED_BUILD=1`, which makes
// build-main bake the production define so the shipped bundle carries the
// literal `IS_DEBUG_MODE = false` and the debug bridge sits behind a
// permanently-dead gate.
//
// The define is also what lets the debug module graph LEAVE the bundle: the
// gate in electron/main/index.ts inlines the same expression so esbuild can fold
// it locally and prune the dynamic imports behind it. That inlining is a
// deliberate duplication of `IS_DEBUG_MODE`, ratcheted below.
//
// A forgotten flag is invisible: the bundle keeps a LIVE debug gate, and only
// the startup guard stands between a shipped binary and the Inspector. These
// tests make that omission fail loudly instead.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, it, expect } from 'vitest';

import { buildStandaloneRootManifest } from './create-chimera-game/standalone.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The marker, duplicated as a LITERAL rather than imported from
 * `apps/tactics/electron/build-main.ts` — matching the convention its sibling
 * `VERIFY_PACK_NODE_MODULES_ENV` documents ("duplicated as a literal (not
 * imported) to keep the app off the `tools/` import boundary; both sides assert
 * it in tests").
 *
 * The distinction is IMPORT boundary, not file access: this suite still READS
 * both build-main copies below to assert parity, which creates no module-graph
 * edge from `tools/` into an app. The parity block asserts both copies declare
 * exactly this value, so the duplication cannot drift.
 */
const PACKAGED_BUILD_ENV = 'CHIMERA_PACKAGED_BUILD';

const APP_BUILD_MAIN = path.join(ROOT, 'apps/tactics/electron/build-main.ts');
const TEMPLATE_BUILD_MAIN = path.join(
    ROOT,
    'tools/create-chimera-game/templates/blank/electron/build-main.ts',
);

const read = (file: string): string => readFileSync(file, 'utf8');

function rootScripts(): Record<string, string> {
    const pkg = JSON.parse(read(path.join(ROOT, 'package.json'))) as {
        scripts?: Record<string, string>;
    };
    return pkg.scripts ?? {};
}

/** Scripts that bundle the Electron app (the only ones the marker is about). */
function scriptsRunningBuildApp(scripts: Record<string, string>): [string, string][] {
    return Object.entries(scripts).filter(([, command]) => command.includes('build:app'));
}

/**
 * True when the marker rides on the `build:app` SEGMENT specifically.
 *
 * Asserting on the whole script string is not enough: `cross-env` scopes an env
 * var to the ONE command it wraps, so a marker parked on the `next build`
 * segment (where `NEXT_PUBLIC_CHIMERA_PACKAGED` legitimately lives) never
 * reaches the app bundler — the script reads as flagged while the emitted
 * bundle keeps a live debug gate. Match the pairing, not the presence.
 *
 * The separator class covers every shell command separator, not just `&&`/`||`:
 * `;` and a newline end a command too, so omitting them would let
 * `cross-env FLAG=1 next build ; pnpm … build:app` pass.
 */
const setsFlag = (command: string): boolean =>
    new RegExp(`cross-env[^&|;\\n]*\\b${PACKAGED_BUILD_ENV}=1\\b[^&|;\\n]*\\bbuild:app\\b`).test(
        command,
    );

/** Marker present anywhere in the script, regardless of which segment. */
const mentionsFlag = (command: string): boolean => command.includes(`${PACKAGED_BUILD_ENV}=1`);

describe('packaged-build marker — monorepo root scripts', () => {
    it('has packaging scripts that bundle the app (guards the filter itself)', () => {
        // If this ever goes empty the assertions below become vacuous.
        const packaging = scriptsRunningBuildApp(rootScripts()).filter(([name]) =>
            name.startsWith('package:'),
        );
        expect(packaging.length).toBeGreaterThan(0);
    });

    it('every package:* script carries the marker ON the build:app segment', () => {
        const missing = scriptsRunningBuildApp(rootScripts())
            .filter(([name]) => name.startsWith('package:'))
            .filter(([, command]) => !setsFlag(command))
            .map(([name]) => name);

        expect(missing).toEqual([]);
    });

    it('non-packaging scripts that bundle the app do NOT mention it (dev builds stay debug-capable)', () => {
        // dev:mp and friends share build:app; baking production there would kill
        // the F9 Inspector with no error message. Checked as a bare MENTION, not
        // a segment match — the marker has no business anywhere in a dev script.
        const leaked = scriptsRunningBuildApp(rootScripts())
            .filter(([name]) => !name.startsWith('package:'))
            .filter(([, command]) => mentionsFlag(command))
            .map(([name]) => name);

        expect(leaked).toEqual([]);
    });

    it('the segment matcher rejects a marker parked on the wrong command', () => {
        // Guards the guard: proves setsFlag is not satisfied by mere presence.
        const misplaced =
            'cross-env CHIMERA_PACKAGED_BUILD=1 NEXT_PUBLIC_CHIMERA_PACKAGED=1 next build apps/x/renderer && pnpm --filter @chimera-engine/x build:app';
        expect(mentionsFlag(misplaced)).toBe(true);
        expect(setsFlag(misplaced)).toBe(false);

        // `;` and newline end a command just as `&&` does.
        const semicolonSeparated =
            'cross-env CHIMERA_PACKAGED_BUILD=1 next build apps/x/renderer ; pnpm --filter @chimera-engine/x build:app';
        expect(setsFlag(semicolonSeparated)).toBe(false);
        const newlineSeparated =
            'cross-env CHIMERA_PACKAGED_BUILD=1 next build apps/x/renderer\npnpm --filter @chimera-engine/x build:app';
        expect(setsFlag(newlineSeparated)).toBe(false);

        const correct =
            'cross-env NEXT_PUBLIC_CHIMERA_PACKAGED=1 next build apps/x/renderer && cross-env CHIMERA_PACKAGED_BUILD=1 pnpm --filter @chimera-engine/x build:app';
        expect(setsFlag(correct)).toBe(true);
    });
});

describe('packaged-build marker — scaffolded standalone scripts', () => {
    const manifest = buildStandaloneRootManifest({
        name: 'my-game',
        toolchainDeps: { 'cross-env': '^7.0.3' },
        packageManager: 'pnpm@10.33.0',
        engines: { node: '>=20' },
    });
    const scripts = manifest.scripts;

    it('emits packaging scripts that bundle the app (guards the filter itself)', () => {
        const packaging = scriptsRunningBuildApp(scripts).filter(
            ([name]) => name === 'package' || name.startsWith('package:'),
        );
        expect(packaging.length).toBeGreaterThan(0);
    });

    it('every emitted packaging script declares the packaged-build marker', () => {
        const missing = scriptsRunningBuildApp(scripts)
            .filter(([name]) => name === 'package' || name.startsWith('package:'))
            .filter(([, command]) => !setsFlag(command))
            .map(([name]) => name);

        expect(missing).toEqual([]);
    });

    it('the emitted dev:mp harness script does NOT mention it', () => {
        // Bare MENTION, symmetric with the root-scripts leak test: the marker has
        // no business anywhere in a dev script, including on a `next build`
        // segment that the segment matcher would happily ignore.
        const devMp = scripts['dev:mp'];
        expect(devMp).toBeDefined();
        expect(mentionsFlag(devMp ?? '')).toBe(false);
    });
});

describe('renderer packaged flag — both bundlers must be declared', () => {
    // A distributable has TWO bundlers and each reads its own flag, because
    // `cross-env` scopes a var to the one command it wraps:
    //   NEXT_PUBLIC_CHIMERA_PACKAGED → Next renderer build (gates dev-only routes)
    //   CHIMERA_PACKAGED_BUILD       → Electron app bundle (folds IS_DEBUG_MODE)
    // Declaring only one ships a half-production artifact, which is silent.
    const RENDERER_FLAG = 'NEXT_PUBLIC_CHIMERA_PACKAGED=1';

    it('root package:* scripts declare the renderer flag on the next build segment', () => {
        const missing = scriptsRunningBuildApp(rootScripts())
            .filter(([name]) => name.startsWith('package:'))
            .filter(
                ([, command]) => !new RegExp(`cross-env[^&|;\\n]*${RENDERER_FLAG}`).test(command),
            )
            .map(([name]) => name);

        expect(missing).toEqual([]);
    });

    it('the scaffolded standalone packaging chain declares it too', () => {
        const manifest = buildStandaloneRootManifest({
            name: 'my-game',
            toolchainDeps: { 'cross-env': '^7.0.3' },
            packageManager: 'pnpm@10.33.0',
            engines: { node: '>=20' },
        });
        const missing = scriptsRunningBuildApp(manifest.scripts)
            .filter(([name]) => name === 'package' || name.startsWith('package:'))
            .filter(([, command]) => !command.includes(RENDERER_FLAG))
            .map(([name]) => name);

        expect(missing).toEqual([]);
    });

    it('the scaffolded WORKSPACE emitter declares it too', () => {
        const source = read(path.join(ROOT, 'tools/create-chimera-game/index.ts'));
        expect(source).toContain(`cross-env ${RENDERER_FLAG} next build apps/\${kebab}/renderer`);
    });
});

describe('packaged-build marker — scaffolded WORKSPACE script', () => {
    // The workspace-mode emitter (`wireRootPackageJson` in create-chimera-game)
    // is a private function that mutates a real root package.json, so it is
    // exercised end-to-end in create-chimera-game/index.test.ts. Ratchet the
    // marker on its SOURCE here so removing it cannot pass silently — without
    // this the workspace half of the emitter had no marker assertion at all.
    it('the CLI source emits the marker on the build:app segment', () => {
        const source = read(path.join(ROOT, 'tools/create-chimera-game/index.ts'));
        expect(source).toContain(
            `cross-env ${PACKAGED_BUILD_ENV}=1 pnpm --filter @chimera-engine/\${kebab} build:app`,
        );
    });
});

describe('build-main.ts app/template parity', () => {
    // The app's bundler is copied near-verbatim into the scaffolding template.
    // They differ ONLY in comments (the template names no game), so the CODE
    // must stay identical — a divergence would silently disarm the define for
    // every scaffolded game while this repo's own suite stayed green.
    const stripComments = (source: string): string =>
        source
            .split('\n')
            .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
            .map((line) => line.replace(/\s+$/, ''))
            .filter((line) => line.length > 0)
            .join('\n');

    it('both copies declare the same marker literal', () => {
        for (const file of [APP_BUILD_MAIN, TEMPLATE_BUILD_MAIN]) {
            expect(read(file)).toContain(`PACKAGED_BUILD_ENV = '${PACKAGED_BUILD_ENV}'`);
        }
    });

    it('both copies define BOTH IS_DEBUG_MODE reads', () => {
        // Defining only NODE_ENV leaves `process.env.CHIMERA_DEBUG === '1' && false`,
        // which esbuild cannot fold to a literal — so the gate would stay LIVE.
        for (const file of [APP_BUILD_MAIN, TEMPLATE_BUILD_MAIN]) {
            const source = read(file);
            expect(source).toContain(`'process.env.NODE_ENV': '"production"'`);
            expect(source).toContain(`'process.env.CHIMERA_DEBUG': '""'`);
        }
    });

    it('the two files are code-identical once comments are stripped', () => {
        expect(stripComments(read(TEMPLATE_BUILD_MAIN))).toBe(stripComments(read(APP_BUILD_MAIN)));
    });
});

describe('the shipped esbuild invocation is the one under assertion', () => {
    // `packaged-bundle-content.test.ts` proves the debug graph leaves the bundle
    // by EXECUTING the CLI's own `BuildFn` (via `createEsbuildBuild`) with esbuild
    // swapped for a capture. That proof transfers to the distributable only while
    // the CLI reaches esbuild through that same factory — and the CLI block itself
    // runs under no test, being guarded on a direct `tsx` run.
    //
    // So exactly one fact is checked here, and it is deliberately NOT a list of
    // option names. A denylist over the call's option literal cannot be
    // completed — the bypass is always one node kind, one argument or one
    // spread to the side. A second spread (`...{ define: {} }`) reinstates any
    // option past a scan of declared `PropertyAssignment`s, drops the packaging
    // define, and reships the whole debug graph while such a scan stays green.
    // Pinning the single esbuild reference instead leaves no option literal at
    // the call site to smuggle anything into.
    //
    // This check is NOT sufficient on its own and should not be read as if it
    // were: it constrains how the CLI reaches esbuild, not what it passes to
    // `buildAppBundles`. A wrapped `build:` argument defeats it and every other
    // unit-level guard here. `pnpm verify:packaged-bundle` covers the whole path,
    // by reading a real build's output instead of describing its source.

    /** Every `buildSync` identifier reference outside the import statement. */
    function buildSyncReferences(file: string): ts.Identifier[] {
        const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
        const found: ts.Identifier[] = [];

        const visit = (node: ts.Node): void => {
            if (ts.isImportDeclaration(node)) {
                return; // The import binding itself is not a use.
            }
            if (ts.isIdentifier(node) && node.text === 'buildSync') {
                found.push(node);
            }
            ts.forEachChild(node, visit);
        };
        visit(source);
        return found;
    }

    it.each([
        ['app', APP_BUILD_MAIN],
        ['template', TEMPLATE_BUILD_MAIN],
    ])('the %s CLI reaches esbuild only through the tested factory', (_label, file) => {
        const references = buildSyncReferences(file);

        expect(
            references,
            `${path.basename(file)} must mention buildSync exactly once outside its import`,
        ).toHaveLength(1);

        // The one reference must be passed as `runBuild:` to `createEsbuildBuild`
        // — a value, never invoked here. Any `buildSync(...)` call, any alias, or
        // any hand-rolled BuildFn needs a second reference or a different parent,
        // and fails above or below.
        const property = references[0]!.parent;
        expect(
            ts.isPropertyAssignment(property) && property.name.getText() === 'runBuild',
            'the buildSync reference must be the runBuild dependency, not a call',
        ).toBe(true);

        const call = property.parent.parent;
        expect(
            ts.isCallExpression(call) && call.expression.getText() === 'createEsbuildBuild',
            'runBuild: buildSync must be passed to createEsbuildBuild',
        ).toBe(true);
    });
});

describe('debug-gate shape (what lets the graph leave the bundle)', () => {
    // `electron/main/index.ts` gates the debug bridge on the INLINED expression
    // instead of the imported `IS_DEBUG_MODE`, because esbuild does not
    // propagate a cross-module constant into a consuming module: written as
    // `if (IS_DEBUG_MODE)` the branch stayed live and the ~30 KB debug graph
    // shipped in every distributable. Inlined, the define folds it to
    // `if (false)` and the dynamic-import records are pruned with it.
    //
    // The cost of that inlining is a second copy of the expression, and drift
    // between the two is SILENT — the app keeps working, the packaged bundle
    // just quietly starts carrying the debug graph again. Hence this ratchet.
    const CONSTANTS = path.join(ROOT, 'simulation/foundation/constants.ts');
    const MAIN_INDEX = path.join(ROOT, 'electron/main/index.ts');

    const collapse = (source: string): string => source.replace(/\s+/g, ' ').trim();

    /**
     * Every module the gate must keep behind it. Each is a dynamic import inside
     * the gated block; hoisting ANY of them out bundles it unconditionally, no
     * matter how dead the condition folds.
     */
    const GATED_MODULES = ['./debug-bridge.js', './network-diagnostics.js'] as const;

    function parse(file: string): ts.SourceFile {
        return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true);
    }

    function walk(node: ts.Node, visit: (n: ts.Node) => void): void {
        visit(node);
        node.forEachChild((child) => walk(child, visit));
    }

    /** Specifier of `import('…')` when `node` is a dynamic import, else undefined. */
    function dynamicImportSpecifier(node: ts.Node): string | undefined {
        if (!ts.isCallExpression(node) || node.expression.kind !== ts.SyntaxKind.ImportKeyword) {
            return undefined;
        }
        const arg = node.arguments[0];
        return arg !== undefined && ts.isStringLiteralLike(arg) ? arg.text : undefined;
    }

    /**
     * Specifier of a top-level `import … from '…'` that BINDS A VALUE.
     *
     * Checking only DYNAMIC imports is not enough, and the gap is a single token
     * wide: `import type { DebugBridge } from './debug-bridge.js'` rewritten as
     * `import { type DebugBridge, startDebugBridge } from './debug-bridge.js'`
     * binds the module into the unconditional graph, which ships the whole debug
     * layer however dead the gate folds. A value-binding static import is ungated
     * by construction, so it must be rejected regardless of where the gate sits.
     *
     * `import type` and type-only named bindings are erased by the compiler and
     * bind nothing at runtime, so they stay allowed — that is exactly how the
     * `DebugBridge` type is legitimately referenced today.
     */
    function valueImportSpecifier(node: ts.Node): string | undefined {
        if (!ts.isImportDeclaration(node) || !ts.isStringLiteralLike(node.moduleSpecifier)) {
            return undefined;
        }
        const clause = node.importClause;
        // `import './x.js'` — no clause — is a side-effect import: it evaluates.
        if (clause === undefined) return node.moduleSpecifier.text;
        if (clause.isTypeOnly) return undefined;

        const bindsValue =
            clause.name !== undefined ||
            (clause.namedBindings !== undefined &&
                (ts.isNamespaceImport(clause.namedBindings) ||
                    clause.namedBindings.elements.some((element) => !element.isTypeOnly)));
        return bindsValue ? node.moduleSpecifier.text : undefined;
    }

    /** The nearest enclosing `if` for which `node` sits in the THEN branch. */
    function enclosingThenGate(node: ts.Node): ts.IfStatement | undefined {
        for (let cur: ts.Node | undefined = node; cur?.parent !== undefined; cur = cur.parent) {
            const parent: ts.Node = cur.parent;
            if (ts.isIfStatement(parent) && parent.thenStatement === cur) return parent;
        }
        return undefined;
    }

    /**
     * The right-hand side of the EXPORTED top-level `const IS_DEBUG_MODE = …;`.
     *
     * Restricted to the exported module-level binding, and required to be
     * unique. Taking the last match found anywhere would let a decoy — a local
     * `IS_DEBUG_MODE` inside some unrelated function later in the file — become
     * the comparison target, so the real export could regress to bracket access
     * (unfoldable, gate stays live in a packaged bundle) while the
     * character-identity assertion compares the gate against the decoy and
     * passes.
     */
    function constantExpression(): string {
        const found: string[] = [];
        walk(parse(CONSTANTS), (node) => {
            if (
                !ts.isVariableDeclaration(node) ||
                !ts.isIdentifier(node.name) ||
                node.name.text !== 'IS_DEBUG_MODE' ||
                node.initializer === undefined
            ) {
                return;
            }
            const statement = node.parent.parent;
            const isExportedTopLevel =
                ts.isVariableStatement(statement) &&
                ts.isSourceFile(statement.parent) &&
                statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) === true;
            if (isExportedTopLevel) found.push(collapse(node.initializer.getText()));
        });
        expect(
            found,
            'expected exactly one exported top-level IS_DEBUG_MODE — zero means the constant ' +
                'moved and this ratchet is comparing nothing; more than one is ambiguous',
        ).toHaveLength(1);
        return found[0] ?? '';
    }

    /**
     * The debug gate, read from the PARSED composition root.
     *
     * Deliberately an AST walk. Do not regress this to text scanning — every
     * property it needs is one a text scan gets wrong:
     *
     *  - A comment is not code. A commented-out `if (…) {` above an
     *    unconditional import supplies a fake anchor to any scan that reads raw
     *    source, and the check goes green on a shipped debug graph.
     *  - The ENCLOSING `if` is not the nearest preceding one. Anchoring on the
     *    closest `if (` accepts an import hoisted out of the gate, because some
     *    other gate still precedes it.
     *  - Formatting is not structure. A condition Prettier wraps across lines
     *    defeats a line-oriented pattern, which then reports drift for a pure
     *    reformat.
     *
     * The parser makes all three moot: comments and string literals are not
     * nodes, enclosure is a parent-chain fact, and whitespace is irrelevant.
     */
    interface DebugGate {
        readonly condition: string;
        readonly gatedSpecifiers: readonly string[];
        readonly ungatedSpecifiers: readonly string[];
    }

    function debugGate(): DebugGate {
        const source = parse(MAIN_INDEX);
        const gates: ts.IfStatement[] = [];
        const ungated: string[] = [];

        const isGated = (specifier: string): boolean =>
            (GATED_MODULES as readonly string[]).includes(specifier);

        walk(source, (node) => {
            // A value-binding static import is unconditional by construction —
            // there is no gate to be inside of.
            const staticSpecifier = valueImportSpecifier(node);
            if (staticSpecifier !== undefined && isGated(staticSpecifier)) {
                ungated.push(staticSpecifier);
                return;
            }
            const specifier = dynamicImportSpecifier(node);
            if (specifier === undefined || !isGated(specifier)) return;
            const gate = enclosingThenGate(node);
            if (gate === undefined) ungated.push(specifier);
            else gates.push(gate);
        });

        expect(
            gates.length + ungated.length,
            `no dynamic import of ${GATED_MODULES.join(' / ')} found in ${path.basename(MAIN_INDEX)} — ` +
                'did the debug bridge move? This ratchet cannot protect what it cannot find',
        ).toBeGreaterThan(0);

        // All gated imports must share ONE `if`, or "the gate" is ambiguous and
        // a second gate could fold differently from the one asserted below.
        const distinct = new Set(gates);
        expect(
            distinct.size,
            'the gated debug imports are spread across more than one `if` — they must share a ' +
                'single foldable gate, or only one of them is actually protected',
        ).toBeLessThanOrEqual(1);

        const gate = gates[0];
        const gatedSpecifiers = new Set<string>();
        if (gate !== undefined) {
            walk(gate.thenStatement, (node) => {
                const specifier = dynamicImportSpecifier(node);
                if (specifier !== undefined) gatedSpecifiers.add(specifier);
            });
        }

        return {
            condition: gate === undefined ? '' : collapse(gate.expression.getText()),
            gatedSpecifiers: [...gatedSpecifiers],
            ungatedSpecifiers: ungated,
        };
    }

    it('every debug module is imported from INSIDE the gate, never unconditionally', () => {
        // An unconditional `await import()` is bundled regardless of how dead
        // the condition folds, so the packaged bundle reships that module.
        //
        // Deliberately CONSERVATIVE about what counts as inside: the import must
        // be lexically within the gate's then-branch. Indirection through a
        // helper may well still fold, but this check cannot prove that — so if
        // this fires on a refactor that moved the imports into a helper, the
        // right response is to keep them inline, not to loosen the guard.
        const { ungatedSpecifiers, gatedSpecifiers } = debugGate();
        expect(
            ungatedSpecifiers,
            'these debug modules are reachable without passing the gate — a value-binding ' +
                'static import, or a dynamic import outside the gated block. Either ships the ' +
                'module in every distributable regardless of how dead the condition folds',
        ).toEqual([]);
        for (const specifier of GATED_MODULES) {
            expect(
                gatedSpecifiers,
                `${specifier} is no longer imported from inside the debug gate`,
            ).toContain(specifier);
        }
    });

    it('the gate inlines the IS_DEBUG_MODE expression verbatim, modulo whitespace', () => {
        // Equality with the constant's INITIALIZER also rules out the gate
        // testing the imported `IS_DEBUG_MODE` name itself — the initializer is
        // a multi-term expression, which esbuild can fold here where the
        // imported constant cannot be.
        expect(debugGate().condition).toBe(constantExpression());
    });

    it('the composition root and the startup guard do not mutate the two vars the gate re-reads', () => {
        // The startup guard consumes `IS_DEBUG_MODE`, a MODULE-INIT snapshot, while
        // the gate re-evaluates `process.env` when `main()` runs. Because the gate
        // inlines the expression, the two controls agree only so long as nothing
        // assigns to either var between module init and `main()`. A single
        // `process.env.NODE_ENV = …` before `main()` would let the guard pass while
        // the gate opens.
        //
        // AST-based, not a regex. A `=`-shaped pattern misses compound assignment
        // and cannot see indirect writes at all, so the walk must keep covering
        // every shape below: `??=` / `||=` / `&&=`, `Object.assign`, aliasing
        // (`const env = process.env; env.X = …`), `delete`, `Reflect.set`,
        // replacing `process.env` wholesale, and a destructuring assignment
        // target. Each has its own case; narrowing the walk re-opens one.
        //
        // Scope is the composition root and the guard — the two files most
        // likely to acquire such a write, NOT an exhaustive set: any module
        // evaluated before `main()` could do the same. Tests legitimately stub
        // the env via `vi.stubEnv`, so they are not scanned.
        const WATCHED = ['CHIMERA_DEBUG', 'NODE_ENV'];

        /** Locals aliased to `process.env`, so `const e = process.env` is tracked. */
        function envAliases(source: ts.SourceFile): Set<string> {
            const aliases = new Set<string>();
            walk(source, (node) => {
                if (
                    ts.isVariableDeclaration(node) &&
                    ts.isIdentifier(node.name) &&
                    node.initializer !== undefined &&
                    ts.isPropertyAccessExpression(node.initializer) &&
                    node.initializer.name.text === 'env'
                ) {
                    aliases.add(node.name.text);
                }
            });
            return aliases;
        }

        /** Is `node` a reference to `process.env` (directly or via an alias)? */
        function isEnvObject(node: ts.Node, aliases: ReadonlySet<string>): boolean {
            if (ts.isPropertyAccessExpression(node) && node.name.text === 'env') return true;
            return ts.isIdentifier(node) && aliases.has(node.text);
        }

        /** `process.env.X` / `env['X']` for a watched X, through any alias. */
        function isWatchedEnvRef(node: ts.Node, aliases: ReadonlySet<string>): boolean {
            const target = ts.isPropertyAccessExpression(node)
                ? node.name.text
                : ts.isElementAccessExpression(node) &&
                    ts.isStringLiteralLike(node.argumentExpression)
                  ? node.argumentExpression.text
                  : undefined;
            if (target === undefined || !WATCHED.includes(target)) return false;
            const base = (node as ts.PropertyAccessExpression | ts.ElementAccessExpression)
                .expression;
            return isEnvObject(base, aliases);
        }

        /**
         * `Object.assign(process.env, …)` and friends — an indirect write no
         * assignment-expression check can see.
         *
         * Deliberately keyed on `process.env` being the TARGET (first argument)
         * of a known mutator. Flagging any call that merely RECEIVES `process.env`
         * would condemn every legitimate read in the composition root, of which
         * `assertProductionDebugGuard(process.env, …)` is one.
         */
        const ENV_MUTATOR_METHODS: Readonly<Record<string, readonly string[]>> = {
            Object: ['assign', 'defineProperty', 'defineProperties'],
            Reflect: ['set', 'defineProperty', 'deleteProperty'],
        };

        function isEnvMutatingCall(node: ts.Node, aliases: ReadonlySet<string>): boolean {
            if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
                return false;
            }
            const callee = node.expression;
            if (!ts.isIdentifier(callee.expression)) return false;
            if (ENV_MUTATOR_METHODS[callee.expression.text]?.includes(callee.name.text) !== true) {
                return false;
            }

            const target = node.arguments[0];
            return target !== undefined && isEnvObject(target, aliases);
        }

        for (const file of [MAIN_INDEX, path.join(ROOT, 'electron/main/startup-guard.ts')]) {
            const offences: string[] = [];
            const source = parse(file);
            const aliases = envAliases(source);
            walk(source, (node) => {
                // `ts.isAssignmentOperator` is internal; the public
                // FirstAssignment..LastAssignment range is the documented
                // equivalent and spans `=`, the compound forms, and the logical
                // assignments `??=` / `||=` / `&&=` (verified against
                // SyntaxKind — 64..79, with `==` at 35 correctly outside).
                const isAssignment =
                    ts.isBinaryExpression(node) &&
                    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
                    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment;
                if (isAssignment && ts.isBinaryExpression(node)) {
                    // Direct target, `process.env` replaced wholesale, or a
                    // destructuring pattern with a watched ref among its targets.
                    const hitsWatched =
                        isWatchedEnvRef(node.left, aliases) ||
                        isEnvObject(node.left, aliases) ||
                        ((ts.isObjectLiteralExpression(node.left) ||
                            ts.isArrayLiteralExpression(node.left)) &&
                            (() => {
                                let hit = false;
                                walk(node.left, (inner) => {
                                    if (isWatchedEnvRef(inner, aliases)) hit = true;
                                });
                                return hit;
                            })());
                    if (hitsWatched) offences.push(collapse(node.getText()));
                }
                // `delete process.env.NODE_ENV` removes the read the gate makes.
                if (ts.isDeleteExpression(node) && isWatchedEnvRef(node.expression, aliases)) {
                    offences.push(collapse(node.getText()));
                }
                if (isEnvMutatingCall(node, aliases)) offences.push(collapse(node.getText()));
            });
            expect(
                offences,
                `${path.basename(file)} must not write to CHIMERA_DEBUG/NODE_ENV — the startup ` +
                    'guard reads a module-init snapshot while the debug gate re-reads process.env, ' +
                    'so a mutation between them desynchronises the two Invariant #27 controls',
            ).toEqual([]);
        }
    });

    it('both halves of the gate are dot-access, so the define can replace them', () => {
        // Bracket access (`process.env['CHIMERA_DEBUG']`) is invisible to
        // esbuild's define — the same shape Check 9 pins for the constant.
        const gate = debugGate().condition;
        expect(gate).toContain(`process.env.CHIMERA_DEBUG === '1'`);
        expect(gate).toContain(`process.env.NODE_ENV !== 'production'`);
    });
});
