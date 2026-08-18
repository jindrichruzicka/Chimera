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
 *
 * A NAME says as little on its own. Names are therefore resolved innermost scope
 * outwards — see {@link statementsOf} for the scoping that walk models and what it
 * leaves to the handlers that own it — and what the launch counter must satisfy is
 * stated about the BINDING the name reaches rather than about the spelling: the read
 * must reach a declaration that outlives a call (see {@link persistentBindingOf}), and
 * the advance must move that same declaration. Spelling alone would accept a
 * function-local `let` shadowing the module counter, which mints one directory name
 * for every launch. The two entry points that look a name up cold — `userDataDir`, and
 * the root binding in a `user-data-root` module — are still first-match over the file.
 *
 * Where the reading stops, stated rather than left to be discovered: it establishes
 * that a value REACHES the name, never what the value is once it gets there.
 * `(userDataLaunchCounter * 0).toString()` reads the counter, in the right scope, from
 * a counter that advances correctly — and yields the same segment every launch. Closing
 * that would mean evaluating the expression, and enumerating the arithmetic that
 * annihilates a value instead is a list with no end. Nothing here rejects it.
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

/** Every name a binding name introduces — an identifier, or each leaf of a pattern. */
function namesBound(name: ts.BindingName): string[] {
    if (ts.isIdentifier(name)) return [name.text];
    return name.elements.flatMap((element) =>
        ts.isBindingElement(element) ? namesBound(element.name) : [],
    );
}

/**
 * "Bound here, but with no single initializer this name's value comes from" — a
 * destructured element, a function or class declaration, an import. What matters is not
 * what those forms initialise to; it is that they BIND, and so must stop a search rather
 * than let it continue outward.
 */
const OPAQUE = 'opaque';
type Binding = ts.VariableDeclaration | typeof OPAQUE;

/**
 * The statements `scope` holds directly, or none if it holds no scope of its own.
 *
 * `ts.isBlock` is not the test: a switch's `CaseBlock` and a namespace's `ModuleBlock`
 * both answer false to it, so keying on `isBlock` alone reports "nothing bound here"
 * for a `const` declared in either and lets the search walk out to a same-named
 * declaration further up. `CaseBlock` carries `clauses` rather than statements, and a
 * switch's clauses share ONE scope — `case 1: const a = …` is visible from `case 2:` —
 * so they are flattened here rather than read as scopes of their own.
 *
 * The walk is an approximation of JavaScript scoping, not an implementation of it. See
 * `name resolution — the scopes a search stops at` for the answers it is held to. One
 * divergence is named here because it is the class the two arms above close: a `var`
 * belongs to the function around it, is not hoisted here, and so a `var` in a nested
 * block reads as bound in that block while a read elsewhere in the same function walks
 * past it. Parameters and a `catch` clause's variable are not statements and are
 * handled where they sit, by {@link bindingFor} and by the caller below.
 */
function statementsOf(scope: ts.Node): readonly ts.Statement[] {
    if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)) {
        return scope.statements;
    }
    if (ts.isCaseBlock(scope)) return scope.clauses.flatMap((clause) => [...clause.statements]);
    return [];
}

/** What a scope binds, as `name → the declaration to follow, or {@link OPAQUE}`. */
function bindingsIn(scope: ts.Node): Map<string, Binding> {
    const bound = new Map<string, Binding>();
    const add = (name: string, binding: Binding): void => {
        if (!bound.has(name)) bound.set(name, binding);
    };
    const addDeclarations = (list: ts.VariableDeclarationList): void => {
        for (const declaration of list.declarations) {
            for (const name of namesBound(declaration.name)) {
                add(name, ts.isIdentifier(declaration.name) ? declaration : OPAQUE);
            }
        }
    };

    for (const statement of statementsOf(scope)) {
        if (ts.isVariableStatement(statement)) addDeclarations(statement.declarationList);
        else if (
            ts.isForStatement(statement) ||
            ts.isForOfStatement(statement) ||
            ts.isForInStatement(statement)
        ) {
            const initializer = statement.initializer;
            if (initializer !== undefined && ts.isVariableDeclarationList(initializer)) {
                addDeclarations(initializer);
            }
        } else if (
            (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
            statement.name !== undefined
        ) {
            add(statement.name.text, OPAQUE);
        } else if (
            (ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) &&
            ts.isIdentifier(statement.name)
        ) {
            // Filed as bindings the search must stop at, exactly as a function or class
            // declaration is. Refusing is the conservative direction: a name reaching
            // one of these reds rather than answering with a declaration further up.
            add(statement.name.text, OPAQUE);
        } else if (ts.isImportEqualsDeclaration(statement)) {
            add(statement.name.text, OPAQUE);
        } else if (ts.isImportDeclaration(statement)) {
            const clause = statement.importClause;
            if (clause?.name !== undefined) add(clause.name.text, OPAQUE);
            const named = clause?.namedBindings;
            if (named !== undefined && ts.isNamedImports(named)) {
                for (const element of named.elements) add(element.name.text, OPAQUE);
            }
            if (named !== undefined && ts.isNamespaceImport(named)) add(named.name.text, OPAQUE);
        }
    }
    if (ts.isCatchClause(scope) && scope.variableDeclaration !== undefined) {
        for (const name of namesBound(scope.variableDeclaration.name)) add(name, OPAQUE);
    }
    return bound;
}

/**
 * What `name` refers to at `at`, resolved innermost scope outwards.
 *
 * `'parameter'` and OPAQUE are distinct answers from "not found", and that is the whole
 * point: answering "not found" for a name that IS bound here lets the search continue
 * outward and pick up a module-level `const` of the same name. That is not hypothetical
 * — the launch fixture reads `options.port`, `options` is a parameter, and a module
 * `const options` planted beside it would otherwise answer for it. A destructured
 * `const { port } = options` is the same hazard in a different spelling.
 */
function bindingFor(name: string, at: ts.Node): Binding | 'parameter' | undefined {
    for (let scope = at.parent as ts.Node | undefined; scope !== undefined; scope = scope.parent) {
        if (ts.isFunctionLike(scope)) {
            const bound = scope.parameters.some((parameter) =>
                namesBound(parameter.name).includes(name),
            );
            if (bound) return 'parameter';
        }
        const declared = bindingsIn(scope).get(name);
        if (declared !== undefined) return declared;
    }
    return undefined;
}

/**
 * The declaration `name` resolves to at `at`, when that declaration outlives a call of
 * `minting` — the function whose every invocation must land on a different directory.
 * Undefined otherwise.
 *
 * A counter has to survive between launches, and every binding introduced INSIDE the
 * function that mints the name is created afresh on each call: a `let` in its body, a
 * `let` in a block within it, its own parameter. Each of those mints the same segment
 * every launch, so the launch's wipe of its own profile directory lands on the previous
 * launch's LIVE profile — the hazard this file exists to prevent.
 *
 * Outliving the call is the property, and MODULE scope is only one way to have it: a
 * closure factory holding the counter in an enclosing function keeps it across calls
 * just as well, so requiring module scope specifically would pin a spelling rather than
 * the rule. Anything with no single declaration behind it — a parameter, an import, a
 * function name — is refused rather than assumed, so an unfamiliar spelling reds
 * instead of passing.
 *
 * What this establishes is the declaration's POSITION, never that the frame holding it
 * is shared between launches. A factory whose result is used once — `makeMinter()(…)`
 * per launch — puts the counter outside the minting function and still restarts it
 * every time. That sits alongside the other gap the header records rather than closing
 * it: nothing here evaluates what a value becomes at run time.
 */
function persistentBindingOf(
    name: string,
    at: ts.Node,
    minting: ts.Node,
): ts.VariableDeclaration | undefined {
    const binding = bindingFor(name, at);
    if (binding === undefined || binding === 'parameter' || binding === OPAQUE) return undefined;
    return isInside(binding, minting) ? undefined : binding;
}

/**
 * Every read `from` reaches, following each name to the declaration it resolves to.
 *
 * The visited set holds NODES, not source positions. A property access and the
 * identifier it starts with begin at the same offset — `n.toString` and its `n` both
 * report the position of the `n` — so keying on position lets the outer path claim the
 * slot and cancel the follow of the very name it is built from.
 *
 * `within` bounds which declarations may be followed; see the callers for why the two
 * arms want different bounds.
 */
function derivationReads(from: ts.Node, within?: ts.Node): { path: string; at: ts.Node }[] {
    const reads: { path: string; at: ts.Node }[] = [];
    const expanded = new Set<ts.Node>();
    const expand = (node: ts.Node): void => {
        for (const read of valuesRead(node)) {
            reads.push(read);
            if (expanded.has(read.at)) continue;
            expanded.add(read.at);
            const declaration = declarationToFollow(read.path, read.at);
            if (declaration?.initializer === undefined) continue;
            if (within !== undefined && !isInside(declaration, within)) continue;
            expand(declaration.initializer);
        }
    };
    expand(from);
    return reads;
}

/**
 * The earliest place `name` is read while building `from`.
 *
 * This is the point the value is SAMPLED, which is what an advance has to precede — and
 * it is not the same node as the expression that uses it. With the segment built into a
 * `const` above, the sample is up there; inlined, it is at the argument. Measuring
 * against the argument either way would accept an advance that runs after the value was
 * already taken.
 */
function earliestReadOf(name: string, from: ts.Node, within?: ts.Node): ts.Node | undefined {
    return derivationReads(from, within)
        .filter((read) => read.path === name)
        .reduce<ts.Node | undefined>(
            (earliest, read) =>
                earliest === undefined || read.at.getStart() < earliest.getStart()
                    ? read.at
                    : earliest,
            undefined,
        );
}

/**
 * The declaration to follow for `name` at `at` — undefined when the name is unbound, is
 * a parameter, or is bound by a form with no single initializer behind it.
 */
function declarationToFollow(name: string, at: ts.Node): ts.VariableDeclaration | undefined {
    const binding = bindingFor(name, at);
    return binding === undefined || binding === 'parameter' || binding === OPAQUE
        ? undefined
        : binding;
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
function valuesRead(node: ts.Node): { path: string; at: ts.Node }[] {
    const found: { path: string; at: ts.Node }[] = [];
    const walk = (child: ts.Node): void => {
        const access = accessPath(child);
        // The site travels with the name: the same spelling means different things in
        // different scopes, so resolving it later needs to know where it was read.
        if (access !== undefined) found.push({ path: access, at: child });
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
function readsBehind(node: ts.Node, within?: ts.Node): string[] {
    return [...new Set(derivationReads(node, within).map((read) => read.path))];
}

/**
 * Whether `amount` is a non-zero numeric literal, or a name that resolves to one.
 *
 * The step is often spelled as a named constant, which is the same step by another
 * name; refusing that would be the guard pinning one spelling. Anything it cannot
 * resolve to a literal — a computed step, a call — is refused rather than assumed, so
 * the failure direction is a red on an unfamiliar spelling, never a green on a
 * standstill.
 */
function nonZeroAmount(amount: ts.Expression): boolean {
    const resolve = (value: ts.Expression, seen: Set<number>): boolean => {
        if (ts.isNumericLiteral(value)) return Number(value.text) !== 0;
        if (!ts.isIdentifier(value)) return false;
        // `const A = B; const B = A;` would otherwise recurse until the stack gives out.
        if (seen.has(value.getStart())) return false;
        seen.add(value.getStart());
        const declaration = declarationToFollow(value.text, value);
        return declaration?.initializer !== undefined && resolve(declaration.initializer, seen);
    };
    return resolve(amount, new Set<number>());
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
 * Whether `binding` is moved in the same function that builds `target`, ahead of it,
 * and not inside a branch.
 *
 * Each conjunct answers a way the counter stays put while still reading as a counter,
 * and each was reachable on its own:
 *
 *   - the operator has to move it (`name++`, `++name`, `name += n`);
 *   - the amount has to be non-zero — `name += 0` is an increment by inspection;
 *   - the moved name has to RESOLVE to that binding, not merely be spelled like it: a
 *     `let` of the same name in a block alongside soaks up the advance while the name
 *     is still built from the counter that never moved;
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
function advancesBefore(
    source: ts.SourceFile,
    binding: ts.VariableDeclaration,
    target: ts.Node,
): boolean {
    const scope = enclosingFunction(target);
    // `bindingsIn` files a destructured declaration as OPAQUE, so a binding reaching
    // here always names a plain identifier; the fallback refuses rather than assumes.
    const name = ts.isIdentifier(binding.name) ? binding.name.text : undefined;
    /** The identifier a `++` or a `+=` writes to, or undefined for anything else. */
    const movedIdentifier = (node: ts.Node): ts.Identifier | undefined => {
        const written =
            (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
            node.operator === ts.SyntaxKind.PlusPlusToken
                ? node.operand
                : ts.isBinaryExpression(node) &&
                    node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken
                  ? node.left
                  : undefined;
        return written !== undefined && ts.isIdentifier(written) ? written : undefined;
    };
    let found = false;
    const walk = (node: ts.Node): void => {
        // The identifier itself rather than its `getText()`: it is resolved below, and
        // a resolution needs the node the name was read at. The amount is resolved only
        // once the name matches — `nonZeroAmount` follows declarations, and every `+=`
        // in the file would otherwise pay for that.
        const moved = movedIdentifier(node);
        const bumps =
            moved !== undefined &&
            moved.text === name &&
            bindingFor(moved.text, moved) === binding &&
            (!ts.isBinaryExpression(node) || nonZeroAmount(node.right));
        if (
            bumps &&
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

/**
 * The first thing wrong with how the per-launch counter reaches the name, as an exact
 * string so a fixture asserts which one rather than a count. Empty is the pass.
 *
 * Reporting stops at the first conjunct that fails, because each one is what makes the
 * next question askable: there is no binding to check until the counter is read, and no
 * advance to attribute until the binding is known.
 *
 * Passing here does not mean two launches get two names — see the header for what this
 * file reads and where the reading stops.
 *
 * `nameNode` is the expression that becomes the per-launch path segment and `nameScope`
 * the function that builds it — the call whose every invocation must land on a
 * different directory.
 */
function counterProblems(source: ts.SourceFile, nameNode: ts.Node, nameScope: ts.Node): string[] {
    // It has to be read INSIDE the function that builds the name — a read hoisted to
    // module scope runs once, at import, and would hand every launch the same count.
    const sampledAt = earliestReadOf(LAUNCH_COUNTER_BINDING, nameNode, nameScope);
    if (sampledAt === undefined) {
        return ['the launch counter is never read while the name is built'];
    }

    // …and the name it is read under has to reach a binding that survives between
    // launches, not one minted afresh on every call.
    const counter = persistentBindingOf(LAUNCH_COUNTER_BINDING, sampledAt, nameScope);
    if (counter === undefined) {
        return ['the launch counter resolves to no binding that outlives a call'];
    }

    // …and THAT binding has to move where it can affect this name: same function, ahead
    // of the point the value is SAMPLED, outside any branch. Sitting still, it names one
    // directory for every launch in the process and the launch's own wipe lands on a
    // live app's profile.
    return advancesBefore(source, counter, sampledAt)
        ? []
        : ['the launch counter is not advanced through that binding before it is read'];
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
        const args = [...(userDataDir as ts.CallExpression).arguments];
        const segments = args.map((argument) => argument.getText());

        expect(segments[0]).toBe(ROOT_BINDING);
        // A profile must be a directory INSIDE the root, never the root itself: the
        // launch clears its own profile directory before creating it, so a launch that
        // minted the bare root would wipe every concurrently-running worker's profile.
        expect(segments.length).toBeGreaterThan(1);

        // …and that inner segment has to differ per launch, or two launches share one
        // directory and the same wipe hits a live app. Two launches can collide in two
        // independent ways, so the segment has to carry a differentiator for each.
        const perLaunch = args.slice(1);
        expect(perLaunch.map((argument) => argument.getText())).not.toContain(ROOT_BINDING);
        // One segment today. Asserted so the two arms below, which are measured against
        // it, cannot quietly start describing only part of the name.
        expect(perLaunch).toHaveLength(1);
        // The ARGUMENT node, not a name looked back up: the segment is usually a `const`
        // built above, but inlining that expression here is the same name and must not
        // read as the segment having vanished.
        const nameNode = perLaunch[0]!;
        const nameScope = enclosingFunction(nameNode);
        expect(nameScope).toBeDefined();

        // Same process, later launch: the counter separates them.
        expect(counterProblems(fixture, nameNode, nameScope!)).toEqual([]);

        // Different processes, same launch index: the counter cannot help, because it
        // restarts at zero in each worker. Something per-process has to reach the name —
        // and being fixed for the life of the process, it may be read from anywhere.
        expect(readsBehind(nameNode)).toContain(PROCESS_DIFFERENTIATOR);
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

/** A synthetic source, parsed the same way the template's files are. */
const parse = (source: string): ts.SourceFile =>
    ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true);

/**
 * The LAST identifier spelled `name` in the file — the read site a scope fixture asks
 * about, placed last so the declarations it must resolve against precede it.
 */
function lastReadOf(source: ts.SourceFile, name: string): ts.Identifier {
    let found: ts.Identifier | undefined;
    const walk = (node: ts.Node): void => {
        if (ts.isIdentifier(node) && node.text === name) found = node;
        ts.forEachChild(node, walk);
    };
    walk(source);
    if (found === undefined) throw new Error(`no read of ${name} in the probe`);
    return found;
}

describe('name resolution — the scopes a search stops at', () => {
    it('resolves a name to the declaration in the nearest enclosing block', () => {
        // Positive control: without it, a resolver that always answered with the
        // innermost thing it saw would satisfy the fixtures below.
        const source = parse(
            [
                'const target = 1;',
                'function f() {',
                '    const target = 2;',
                '    return target;',
                '}',
            ].join('\n'),
        );
        const resolved = bindingFor('target', lastReadOf(source, 'target'));
        expect(resolved).not.toBe(OPAQUE);
        expect((resolved as ts.VariableDeclaration).initializer?.getText()).toBe('2');
    });

    it('resolves a const declared in an unbraced switch case, not one outside it', () => {
        // A `switch`'s clauses share ONE scope, and it is a `CaseBlock` rather than a
        // `Block` — so a resolver keyed on `Block` answers "not found" here and walks
        // out to the module declaration of the same name. Declared in the SECOND
        // clause and read from the third, so what is pinned is the shared scope and
        // not a clause happening to hold its own — a walk that read only the first
        // clause would answer with the module declaration here.
        const source = parse(
            [
                'const target = 1;',
                'function f(a) {',
                '    switch (a) {',
                '        case 1:',
                '            break;',
                '        case 2:',
                '            const target = 2;',
                '            break;',
                '        case 3:',
                '            return target;',
                '    }',
                '}',
            ].join('\n'),
        );
        const resolved = bindingFor('target', lastReadOf(source, 'target'));
        expect(resolved).not.toBe(OPAQUE);
        expect((resolved as ts.VariableDeclaration).initializer?.getText()).toBe('2');
    });

    it('resolves a const declared in a namespace body, not one outside it', () => {
        // The same defect in the other spelling: a `ModuleBlock` is not a `Block`.
        const source = parse(
            [
                'const target = 1;',
                'namespace N {',
                '    const target = 2;',
                '    export const used = target;',
                '}',
            ].join('\n'),
        );
        const resolved = bindingFor('target', lastReadOf(source, 'target'));
        expect(resolved).not.toBe(OPAQUE);
        expect((resolved as ts.VariableDeclaration).initializer?.getText()).toBe('2');
    });

    it('stops at an enum that binds the name rather than reaching past it', () => {
        // An enum binds a value name. Not stopping here lets the module `const` answer
        // for a name the function has already taken — the hazard OPAQUE exists for.
        const source = parse(
            [
                'const target = 1;',
                'function f() {',
                '    enum target { A }',
                '    return target;',
                '}',
            ].join('\n'),
        );
        expect(bindingFor('target', lastReadOf(source, 'target'))).toBe(OPAQUE);
    });

    it('stops at a namespace that binds the name rather than reaching past it', () => {
        const source = parse(
            [
                'const target = 1;',
                'function f() {',
                '    namespace target { export const x = 1; }',
                '    return target;',
                '}',
            ].join('\n'),
        );
        expect(bindingFor('target', lastReadOf(source, 'target'))).toBe(OPAQUE);
    });

    it('stops at an import-equals binding', () => {
        // The one import form the named/default/namespace arms do not cover.
        const source = parse(['import target = require("x");'].join('\n'));
        expect(bindingsIn(source).get('target')).toBe(OPAQUE);
    });
});

describe('the launch counter — the checker', () => {
    /** A probe in the launch fixture's shape; `body` is the function that builds the name. */
    const probe = (body: string): ts.SourceFile =>
        parse(
            [
                'let userDataLaunchCounter = 0;',
                'function createFreshE2eUserDataDir(options) {',
                body,
                '    const userDataDir = path.join(E2E_USER_DATA_ROOT, dirName);',
                '    return userDataDir;',
                '}',
            ].join('\n'),
        );

    const BUILDS_THE_NAME =
        "    const dirName = [process.pid.toString(), userDataLaunchCounter.toString()].join('-');";

    const problemsIn = (source: ts.SourceFile): string[] => {
        const userDataDir = initializerOf(source, 'userDataDir') as ts.CallExpression;
        const nameNode = userDataDir.arguments[1]!;
        return counterProblems(source, nameNode, enclosingFunction(nameNode)!);
    };

    it('reports nothing for a module counter advanced before the name is built', () => {
        // Positive control, and the template's own shape.
        expect(
            problemsIn(probe(['    userDataLaunchCounter += 1;', BUILDS_THE_NAME].join('\n'))),
        ).toEqual([]);
    });

    it('catches a counter that is never read while the name is built', () => {
        expect(
            problemsIn(
                probe(
                    [
                        '    userDataLaunchCounter += 1;',
                        "    const dirName = [process.pid.toString()].join('-');",
                    ].join('\n'),
                ),
            ),
        ).toEqual(['the launch counter is never read while the name is built']);
    });

    it('catches a counter that is read but never advanced', () => {
        expect(problemsIn(probe(BUILDS_THE_NAME))).toEqual([
            'the launch counter is not advanced through that binding before it is read',
        ]);
    });

    it('catches a function-local counter that shadows the module one', () => {
        // Every launch mints the same segment, so launch 2's wipe of its own profile
        // directory deletes launch 1's LIVE profile. Both arms match on the spelling
        // alone, so both accept this: the read is inside the function, the advance is
        // ahead of it, and neither asks which binding either one reached.
        expect(
            problemsIn(
                probe(
                    [
                        '    let userDataLaunchCounter = 0;',
                        '    userDataLaunchCounter += 1;',
                        BUILDS_THE_NAME,
                    ].join('\n'),
                ),
            ),
        ).toEqual(['the launch counter resolves to no binding that outlives a call']);
    });

    it('catches a counter read once at module scope rather than per launch', () => {
        // A read hoisted above the function runs once, at import, so every launch
        // carries the count the module had then. The follow is bounded to the minting
        // function precisely so this reads as the counter not being sampled here.
        const source = parse(
            [
                'let userDataLaunchCounter = 0;',
                'const launchTag = userDataLaunchCounter.toString();',
                'function createFreshE2eUserDataDir(options) {',
                '    userDataLaunchCounter += 1;',
                "    const dirName = [process.pid.toString(), launchTag].join('-');",
                '    const userDataDir = path.join(E2E_USER_DATA_ROOT, dirName);',
                '    return userDataDir;',
                '}',
            ].join('\n'),
        );
        expect(problemsIn(source)).toEqual([
            'the launch counter is never read while the name is built',
        ]);
    });

    it('catches a counter handed in as a parameter', () => {
        // A parameter is minted afresh on every call exactly as a local `let` is, and
        // it is a binding the resolver answers 'parameter' for rather than "not found".
        const source = parse(
            [
                'let userDataLaunchCounter = 0;',
                'function createFreshE2eUserDataDir(options, userDataLaunchCounter) {',
                '    userDataLaunchCounter += 1;',
                BUILDS_THE_NAME,
                '    const userDataDir = path.join(E2E_USER_DATA_ROOT, dirName);',
                '    return userDataDir;',
                '}',
            ].join('\n'),
        );
        expect(problemsIn(source)).toEqual([
            'the launch counter resolves to no binding that outlives a call',
        ]);
    });

    it('catches a plain assignment in place of an advance', () => {
        // `= 1` sets the counter to the same value on every call, so every launch mints
        // one directory name. Only the operator conjunct can see it: the name resolves
        // to the counter, ahead of the read, in the minting function, under no branch.
        expect(
            problemsIn(probe(['    userDataLaunchCounter = 1;', BUILDS_THE_NAME].join('\n'))),
        ).toEqual(['the launch counter is not advanced through that binding before it is read']);
    });

    it('catches an advance by zero', () => {
        // An increment by inspection only. Resolving the amount is what separates it
        // from a real one.
        expect(
            problemsIn(probe(['    userDataLaunchCounter += 0;', BUILDS_THE_NAME].join('\n'))),
        ).toEqual(['the launch counter is not advanced through that binding before it is read']);
    });

    it('catches an advance parked below the point the value is sampled', () => {
        // Distinct names would still come out, but the first launch would carry the
        // count the module started at — and this is what separates an advance that
        // precedes the read from one parked below the return.
        expect(
            problemsIn(probe([BUILDS_THE_NAME, '    userDataLaunchCounter += 1;'].join('\n'))),
        ).toEqual(['the launch counter is not advanced through that binding before it is read']);
    });

    it('catches an advance that only runs some of the time', () => {
        // Under an `if`, two launches taking the false branch mint one directory name.
        expect(
            problemsIn(
                probe(
                    ['    if (options.port) userDataLaunchCounter += 1;', BUILDS_THE_NAME].join(
                        '\n',
                    ),
                ),
            ),
        ).toEqual(['the launch counter is not advanced through that binding before it is read']);
    });

    it('catches an advance sitting in a function nobody on this path calls', () => {
        // Same module binding, moved somewhere the minting call never reaches.
        const source = parse(
            [
                'let userDataLaunchCounter = 0;',
                'function unrelated() { userDataLaunchCounter += 1; }',
                'function createFreshE2eUserDataDir(options) {',
                BUILDS_THE_NAME,
                '    const userDataDir = path.join(E2E_USER_DATA_ROOT, dirName);',
                '    return userDataDir;',
                '}',
            ].join('\n'),
        );
        expect(problemsIn(source)).toEqual([
            'the launch counter is not advanced through that binding before it is read',
        ]);
    });

    it('catches an advance that moves a different binding of the same name', () => {
        // The read reaches the module counter and the advance moves a block-local one,
        // so the counter the name is built from never moves. Requiring the binding to
        // outlive a call cannot see this: the READ resolves correctly.
        expect(
            problemsIn(
                probe(
                    [
                        '    { let userDataLaunchCounter = 0; userDataLaunchCounter += 1; }',
                        BUILDS_THE_NAME,
                    ].join('\n'),
                ),
            ),
        ).toEqual(['the launch counter is not advanced through that binding before it is read']);
    });

    it('accepts a counter held by an enclosing function rather than the module', () => {
        // The property is that the binding OUTLIVES a call, not that it sits at module
        // scope: a closure factory keeps the counter across calls just as well, and
        // refusing it would pin one spelling of the rule.
        const source = parse(
            [
                'function makeMinter() {',
                '    let userDataLaunchCounter = 0;',
                '    return function createFreshE2eUserDataDir(options) {',
                '        userDataLaunchCounter += 1;',
                BUILDS_THE_NAME,
                '        const userDataDir = path.join(E2E_USER_DATA_ROOT, dirName);',
                '        return userDataDir;',
                '    };',
                '}',
            ].join('\n'),
        );
        expect(problemsIn(source)).toEqual([]);
    });
});
