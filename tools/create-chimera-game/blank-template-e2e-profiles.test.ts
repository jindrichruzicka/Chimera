import { readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { GAME_TOKENS } from './tokens.js';

/**
 * Guards the blank template's throwaway-Chromium-profile discipline.
 *
 * A scaffolded app mints one whole Chromium user directory per LAUNCH, and nothing
 * removes it when that app closes. That makes the per-RUN reap the only bound on
 * growth, and the reap only works while the minting side and the reaping side name
 * ONE root.
 *
 * These assertions read the REAL `templates/blank/e2e/` sources rather than running
 * them, and reading is the ceiling here rather than a shortcut: the template's
 * `e2e/tsconfig.json` extends `../../../tsconfig.json`, which is the root of the
 * SCAFFOLDED app and exists in no checkout of this repo, so Vitest cannot transform
 * these modules at all.
 *
 * `verify:scaffold` does emit the template and run its suite, but that suite —
 * `templates/blank/e2e/tests/boot-smoke.spec.ts` — is a single spec asserting the
 * preload bridge, and makes no assertion about a profile directory's name. So a green
 * scaffold run says nothing about what is checked here.
 *
 * Which is why the reading goes through the TypeScript AST rather than the text. A
 * bare substring says nothing about the position it is found in: `rmSync` reaching the
 * root, a counter incremented by zero or under an `if`, and a comment naming a value
 * all read the same as the thing itself.
 */
const repoRoot = path.resolve(import.meta.dirname, '../..');
const templateE2eDir = path.join(repoRoot, 'tools/create-chimera-game/templates/blank/e2e');
const templateFixturesDir = path.join(templateE2eDir, 'fixtures');
const engineRootModule = path.join(repoRoot, 'apps/tactics/e2e/fixtures/user-data-root.ts');

/** The exported binding both sides of the contract must agree on. */
const ROOT_BINDING = 'E2E_USER_DATA_ROOT';

/** What separates two launches inside ONE worker process. */
const LAUNCH_COUNTER_BINDING = 'userDataLaunchCounter';

/**
 * What separates two launches in DIFFERENT worker processes.
 *
 * The counter cannot do this job: it restarts at zero in each worker, so two workers'
 * first launches carry the same count. The template's config runs more than one worker.
 */
const PROCESS_DIFFERENTIATOR = 'process.pid';

async function parseFile(file: string): Promise<ts.SourceFile> {
    const source = await readFile(file, 'utf8');
    // setParentNodes: true — `getText()` below needs the parent chain and source text.
    return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

/** Absolute, extension-less path `binding` is imported from, or undefined if it is not. */
function importedFrom(source: ts.SourceFile, binding: string, fromDir: string): string | undefined {
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue;
        const named = statement.importClause?.namedBindings;
        if (named === undefined || !ts.isNamedImports(named)) continue;
        if (!named.elements.some((element) => element.name.text === binding)) continue;
        const specifier = statement.moduleSpecifier;
        if (!ts.isStringLiteral(specifier)) continue;
        return path.resolve(fromDir, specifier.text);
    }
    return undefined;
}

/** Every `<callee>(...)` in the file, as the source text of its arguments. */
function callsTo(source: ts.SourceFile, callee: string): string[][] {
    const found: string[][] = [];
    const walk = (node: ts.Node): void => {
        if (ts.isCallExpression(node) && node.expression.getText() === callee) {
            found.push(node.arguments.map((argument) => argument.getText()));
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    return found;
}

/** The first declaration of `name` in the file, whatever its kind. */
function declarationOf(source: ts.SourceFile, name: string): ts.VariableDeclaration | undefined {
    let found: ts.VariableDeclaration | undefined;
    const walk = (node: ts.Node): void => {
        if (
            found === undefined &&
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === name
        ) {
            found = node;
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    return found;
}

/** The initializer of the first declaration of `name` in the file, whatever its kind. */
function initializerOf(source: ts.SourceFile, name: string): ts.Expression | undefined {
    return declarationOf(source, name)?.initializer;
}

/** Whether `node` sits anywhere inside `ancestor`. */
function isInside(node: ts.Node, ancestor: ts.Node): boolean {
    for (let at = node.parent as ts.Node | undefined; at !== undefined; at = at.parent) {
        if (at === ancestor) return true;
    }
    return false;
}

/**
 * The path segments a `user-data-root` module joins BELOW the machine's temp dir —
 * i.e. where the root sits, independent of which machine is running it. Undefined
 * unless the module roots itself at `os.tmpdir()` and names the rest in literals,
 * which is what makes two roots comparable segment by segment at all.
 */
function rootSegmentsBelowTmp(source: ts.SourceFile): string[] | undefined {
    const initializer = initializerOf(source, ROOT_BINDING);
    if (initializer === undefined || !ts.isCallExpression(initializer)) return undefined;
    const [temp, ...rest] = initializer.arguments;
    if (temp?.getText() !== 'os.tmpdir()') return undefined;
    const segments = rest.filter(ts.isStringLiteral).flatMap((literal) => literal.text.split('/'));
    return rest.every(ts.isStringLiteral) && segments.length > 0 ? segments : undefined;
}

/** Whether `outer` IS `inner` or contains it — i.e. removing `outer` removes `inner`. */
function contains(outer: readonly string[], inner: readonly string[]): boolean {
    return outer.length <= inner.length && outer.every((segment, i) => segment === inner[i]);
}

/** `a.b.c` rebuilt from the node's own names, or undefined if it is not a plain access. */
function accessPath(node: ts.Node): string | undefined {
    if (ts.isIdentifier(node)) return node.text;
    if (!ts.isPropertyAccessExpression(node)) return undefined;
    const base = accessPath(node.expression);
    return base === undefined ? undefined : `${base}.${node.name.text}`;
}

/**
 * The bindings `node` reads, each property access also yielding its prefixes — so a
 * `process.pid.toString()` call reports `process.pid` and `process`.
 *
 * Rebuilt from names rather than taken with `getText()`, because `getText()` spans the
 * trivia inside a node: a `// process.pid goes here` left where the read used to be
 * satisfies any search over that text while contributing nothing to the value.
 *
 * The KEY half of an access is deliberately not walked. `options.port` reads `options`;
 * `port` there is a property name, and reporting it as a binding would let an unrelated
 * `const port` elsewhere in the file answer for a value this expression never touches.
 */
function valuesRead(node: ts.Node): string[] {
    const found: string[] = [];
    const walk = (child: ts.Node): void => {
        const access = accessPath(child);
        if (access !== undefined) found.push(access);
        if (ts.isPropertyAccessExpression(child)) {
            walk(child.expression); // the object, never `child.name`
            return;
        }
        ts.forEachChild(child, walk);
    };
    walk(node);
    return found;
}

/**
 * {@link valuesRead}, following each local name to what it was declared from.
 *
 * Without the follow, the check would pin one shape of the expression rather than what
 * it is built out of: hoisting a read into a `const` above is the same derivation and
 * would look like the value having disappeared.
 *
 * `within` bounds which declarations may be followed, and the bound is the difference
 * between the two things this file asks about. A value that CHANGES has to be sampled
 * where it is used: `const tag = counter.toString()` at module scope runs once, at
 * import, so following it out of the function would report a counter that is read
 * per-launch when it is read once ever. A value that is fixed for the life of the
 * process does not care where it was read, so its follow is unbounded.
 */
function readsBehind(source: ts.SourceFile, node: ts.Node, within?: ts.Node): string[] {
    const seen = new Set<string>();
    const expand = (from: ts.Node): void => {
        for (const value of valuesRead(from)) {
            if (seen.has(value)) continue;
            seen.add(value);
            const declared = declarationOf(source, value);
            if (declared?.initializer === undefined) continue;
            if (within !== undefined && !isInside(declared, within)) continue;
            expand(declared.initializer);
        }
    };
    expand(node);
    return [...seen];
}

/** The nearest function `node` sits inside, or undefined at the top level. */
function enclosingFunction(node: ts.Node): ts.Node | undefined {
    for (let at = node.parent as ts.Node | undefined; at !== undefined; at = at.parent) {
        if (ts.isFunctionLike(at)) return at;
    }
    return undefined;
}

/** Whether anything between `node` and `scope` decides whether `node` runs at all. */
function branchesAbove(node: ts.Node, scope: ts.Node): boolean {
    for (
        let at = node.parent as ts.Node | undefined;
        at !== undefined && at !== scope;
        at = at.parent
    ) {
        if (
            ts.isIfStatement(at) ||
            ts.isConditionalExpression(at) ||
            ts.isSwitchStatement(at) ||
            ts.isTryStatement(at) ||
            ts.isIterationStatement(at, true) ||
            // Short-circuits only: in `cond && (name += 1)` the right operand runs some
            // of the time. An `=` or a comma decides nothing and must not read as a
            // branch, or a rewrite that preserves the behaviour would red this.
            (ts.isBinaryExpression(at) &&
                [
                    ts.SyntaxKind.AmpersandAmpersandToken,
                    ts.SyntaxKind.BarBarToken,
                    ts.SyntaxKind.QuestionQuestionToken,
                ].includes(at.operatorToken.kind))
        ) {
            return true;
        }
    }
    return false;
}

/**
 * Whether `name` is moved in the same function that builds `target`, ahead of it, and
 * not inside a branch.
 *
 * Each conjunct answers a way the counter stays put while still reading as a counter,
 * and each was reachable on its own:
 *
 *   - the operator has to move it (`name++`, `++name`, `name += n`);
 *   - the amount has to be non-zero — `name += 0` is an increment by inspection;
 *   - it has to be in the function that builds the name, not a sibling nobody calls;
 *   - it has to come before the name is built, so the name samples the advanced value.
 *     This is deliberately stricter than uniqueness needs — advancing afterwards still
 *     yields distinct names — because it is what separates an increment that precedes
 *     the read from one parked below the `return`;
 *   - it must not sit under an `if`, a ternary, a loop or a short-circuit, which decide
 *     whether it runs.
 *
 * What this does NOT establish is that the statement is reached on every call — an
 * early `return` above it would still freeze the counter.
 */
function advancesBefore(source: ts.SourceFile, name: string, target: ts.Node): boolean {
    const scope = enclosingFunction(target);
    let found = false;
    const walk = (node: ts.Node): void => {
        const bumps =
            (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
            node.operator === ts.SyntaxKind.PlusPlusToken &&
            node.operand.getText() === name;
        const adds =
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
            node.left.getText() === name &&
            ts.isNumericLiteral(node.right) &&
            Number(node.right.text) !== 0;
        if (
            (bumps || adds) &&
            scope !== undefined &&
            enclosingFunction(node) === scope &&
            node.getStart() < target.getStart() &&
            !branchesAbove(node, scope)
        ) {
            found = true;
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    return found;
}

describe('blank template — throwaway Chromium profiles', () => {
    it('mints and reaps through ONE root module, so the two sides cannot drift', async () => {
        const fixture = await parseFile(path.join(templateFixturesDir, 'electron.fixture.ts'));
        const setup = await parseFile(path.join(templateE2eDir, 'global-setup.ts'));

        const mintingSide = importedFrom(fixture, ROOT_BINDING, templateFixturesDir);
        const reapingSide = importedFrom(setup, ROOT_BINDING, templateE2eDir);

        expect(mintingSide).toBe(path.join(templateFixturesDir, 'user-data-root'));
        expect(reapingSide).toBe(mintingSide);
    });

    it('removes the whole root once per run in global-setup', async () => {
        const setup = await parseFile(path.join(templateE2eDir, 'global-setup.ts'));

        const reaps = callsTo(setup, 'rmSync').filter(([target]) => target === ROOT_BINDING);

        expect(reaps).toHaveLength(1);
        // force: true — the first run on a machine has no root to remove, and a reap
        // that throws there would fail the suite before a single test ran.
        expect(reaps[0]?.[1]).toMatch(/recursive:\s*true/u);
        expect(reaps[0]?.[1]).toMatch(/force:\s*true/u);
    });

    it('mints each launch profile in its OWN directory under that root', async () => {
        const fixture = await parseFile(path.join(templateFixturesDir, 'electron.fixture.ts'));

        const userDataDir = initializerOf(fixture, 'userDataDir');
        expect(userDataDir !== undefined && ts.isCallExpression(userDataDir)).toBe(true);
        const segments = (userDataDir as ts.CallExpression).arguments.map((argument) =>
            argument.getText(),
        );

        expect(segments[0]).toBe(ROOT_BINDING);
        // A profile must be a directory INSIDE the root, never the root itself: the
        // launch clears its own profile directory before creating it, so a launch that
        // minted the bare root would wipe every concurrently-running worker's profile.
        expect(segments.length).toBeGreaterThan(1);

        // …and that inner segment has to differ per launch, or two launches share one
        // directory and the same wipe hits a live app. Two launches can collide in two
        // independent ways, so the segment has to carry a differentiator for each.
        const perLaunch = segments.slice(1);
        expect(perLaunch).not.toContain(ROOT_BINDING);
        // One segment today. Asserted so the two arms below, which are measured against
        // it, cannot quietly start describing only part of the name.
        expect(perLaunch).toHaveLength(1);
        const nameNode = initializerOf(fixture, perLaunch[0] ?? '');
        expect(nameNode).toBeDefined();
        const nameScope = enclosingFunction(nameNode!);
        expect(nameScope).toBeDefined();

        // Same process, later launch: the counter separates them. It has to be read
        // INSIDE the function that builds the name — a read hoisted to module scope
        // runs once, at import, and would hand every launch the same count…
        expect(readsBehind(fixture, nameNode!, nameScope)).toContain(LAUNCH_COUNTER_BINDING);
        // …and it has to move where it can affect this name: same function, ahead of
        // it, outside any branch. Sitting still, it names one directory for every launch
        // in the process and the wipe below lands on a live app's profile.
        expect(advancesBefore(fixture, LAUNCH_COUNTER_BINDING, nameNode!)).toBe(true);

        // Different processes, same launch index: the counter cannot help, because it
        // restarts at zero in each worker. Something per-process has to reach the name —
        // and being fixed for the life of the process, it may be read from anywhere.
        expect(readsBehind(fixture, nameNode!)).toContain(PROCESS_DIFFERENTIATOR);
    });

    it('clears and creates only its own profile directory, never the shared root', async () => {
        const fixture = await parseFile(path.join(templateFixturesDir, 'electron.fixture.ts'));

        // The launch wipes its profile directory before creating it. Aimed at the root
        // instead, that wipe would delete every concurrently-running worker's live
        // profile on every launch — the config runs more than one worker.
        expect(callsTo(fixture, 'rmSync').map(([target]) => target)).toEqual(['userDataDir']);

        // recursive: true — the per-run reap removes the root, so every run's first
        // launch has to create the root along with its own directory beneath it.
        const creations = callsTo(fixture, 'mkdirSync');
        expect(creations.map(([target]) => target)).toEqual(['userDataDir']);
        expect(creations[0]?.[1]).toMatch(/recursive:\s*true/u);
    });

    it('spells no profile root of its own in the launch fixture', async () => {
        const source = await readFile(
            path.join(templateFixturesDir, 'electron.fixture.ts'),
            'utf8',
        );

        // A second spelling of the root here is one the per-run reap cannot reach,
        // because the reap only ever removes what the shared module names.
        expect(source).not.toContain('chimera-e2e-userdata');
        expect(source).not.toContain('tmpdir()');
    });

    it('puts the root where no engine run can reap it, and names it after the game', async () => {
        const template = await parseFile(path.join(templateFixturesDir, 'user-data-root.ts'));
        const engine = await parseFile(engineRootModule);

        // Undefined unless the module roots itself at `os.tmpdir()`: profiles are
        // throwaway, and a tree growing inside the adopter's checkout is one their
        // ignore lists never named.
        const templateRoot = rootSegmentsBelowTmp(template);
        const engineRoot = rootSegmentsBelowTmp(engine);
        expect(templateRoot).toBeDefined();
        expect(engineRoot).toBeDefined();

        // Both sides measured from source, and NEITHER may contain the other. Equality
        // is only the shallowest way to share: a root nested inside the engine's is
        // wiped whole by the engine's own per-run reap, live profiles and all. Disjoint
        // in both directions is the property; two spellings merely differing is not.
        expect(contains(engineRoot!, templateRoot!)).toBe(false);
        expect(contains(templateRoot!, engineRoot!)).toBe(false);

        // Tokenised, so two scaffolded games get two roots — and so the placeholder is
        // one the scaffolder actually substitutes rather than a literal shipped as-is.
        const token = Object.keys(GAME_TOKENS).find((candidate) =>
            templateRoot!.join('/').includes(candidate),
        );
        expect(token).toBeDefined();
    });
});
