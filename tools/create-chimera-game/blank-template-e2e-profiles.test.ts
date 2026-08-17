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
 * them: the template tree is tokenised and excluded from this repo's Vitest collection.
 * Wherever the claim is about which argument a call receives, the file is inspected
 * through the TypeScript AST — `rmSync` reaching the root as a bare substring says
 * nothing about the position it reaches it in.
 */
const repoRoot = path.resolve(import.meta.dirname, '../..');
const templateE2eDir = path.join(repoRoot, 'tools/create-chimera-game/templates/blank/e2e');
const templateFixturesDir = path.join(templateE2eDir, 'fixtures');
const engineRootModule = path.join(repoRoot, 'apps/tactics/e2e/fixtures/user-data-root.ts');

/** The exported binding both sides of the contract must agree on. */
const ROOT_BINDING = 'E2E_USER_DATA_ROOT';

/** What makes one launch's profile directory name differ from the next one's. */
const LAUNCH_COUNTER_BINDING = 'userDataLaunchCounter';

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

/** The initializer of the first declaration of `name` in the file, whatever its kind. */
function initializerOf(source: ts.SourceFile, name: string): ts.Expression | undefined {
    let found: ts.Expression | undefined;
    const walk = (node: ts.Node): void => {
        if (
            found === undefined &&
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.name.text === name
        ) {
            found = node.initializer;
        }
        ts.forEachChild(node, walk);
    };
    walk(source);
    return found;
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

/** Whether the file ever advances `name` — `name++`, `++name` or `name += …`. */
function advances(source: ts.SourceFile, name: string): boolean {
    let found = false;
    const walk = (node: ts.Node): void => {
        const bumps =
            (ts.isPostfixUnaryExpression(node) || ts.isPrefixUnaryExpression(node)) &&
            node.operator === ts.SyntaxKind.PlusPlusToken &&
            node.operand.getText() === name;
        const adds =
            ts.isBinaryExpression(node) &&
            node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
            node.left.getText() === name;
        if (bumps || adds) found = true;
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
        // directory and the same wipe hits a live app. The launch counter is what makes
        // it differ, so the segment is required to be derived from it.
        const perLaunch = segments.slice(1);
        expect(perLaunch).not.toContain(ROOT_BINDING);
        const derivations = perLaunch.map((segment) =>
            (initializerOf(fixture, segment)?.getText() ?? segment).includes(
                LAUNCH_COUNTER_BINDING,
            ),
        );
        expect(derivations).toContain(true);
        // …and the counter has to actually move. Frozen, it names one directory for
        // every launch in the process, and the wipe below lands on a live app's profile.
        expect(advances(fixture, LAUNCH_COUNTER_BINDING)).toBe(true);
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
