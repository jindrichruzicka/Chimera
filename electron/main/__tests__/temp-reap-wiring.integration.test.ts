/**
 * electron/main/__tests__/temp-reap-wiring.integration.test.ts
 *
 * Pins the RECEIVER of every `reapOrphanTempFiles()` call in the composition
 * root: for saves, replays and perspective replays alike, the repository the
 * manager is built on, not another instance.
 *
 * Parsed, not grepped: a needle in a comment or in dead code would satisfy a
 * text search, and the identity of the receiver is not something a regex can
 * see at all.
 *
 * What a source parse cannot see is whether `main()` reaches the calls — a reap
 * moved behind a condition still parses. That half is measured at runtime by
 * the `running main() reaps …` cases in `electron/main/index.test.ts`.
 *
 * Architecture: §4.11 / §4.28 — save and replay persistence, composition root
 * wiring.
 *
 * Invariants verified:
 *   #37 — the concrete repository is chosen once, in `electron/main/index.ts`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const INDEX = path.join(import.meta.dirname, '..', 'index.ts');

const source = ts.createSourceFile(
    INDEX,
    readFileSync(INDEX, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
);

function collect<T extends ts.Node>(predicate: (node: ts.Node) => node is T): T[] {
    const found: T[] = [];
    const visit = (node: ts.Node): void => {
        if (predicate(node)) found.push(node);
        ts.forEachChild(node, visit);
    };
    visit(source);
    return found;
}

/** Every `new <Name>(...)` expression in the file. */
function constructionsOf(className: string): ts.NewExpression[] {
    return collect((node): node is ts.NewExpression => ts.isNewExpression(node)).filter(
        (node) => ts.isIdentifier(node.expression) && node.expression.text === className,
    );
}

/**
 * The name of the `const` whose initialiser is `new <className>(...)`.
 * Fails if the construction is not bound to a name at all — an inline
 * `new FileSaveRepository(...)` argument has no identity to reap on.
 */
function boundNameOf(className: string): string {
    const declarations = collect((node): node is ts.VariableDeclaration =>
        ts.isVariableDeclaration(node),
    ).filter(
        (declaration) =>
            declaration.initializer !== undefined &&
            ts.isNewExpression(declaration.initializer) &&
            ts.isIdentifier(declaration.initializer.expression) &&
            declaration.initializer.expression.text === className,
    );

    expect(declarations, className).toHaveLength(1);
    const name = declarations[0]?.name;
    expect(name && ts.isIdentifier(name), className).toBe(true);
    return (name as ts.Identifier).text;
}

/** The identifier `new <managerClass>(...)` is given as its first argument. */
function repositoryInjectedInto(managerClass: string): string {
    const managers = constructionsOf(managerClass);
    expect(managers, managerClass).toHaveLength(1);
    const injected = managers[0]?.arguments?.[0];
    expect(injected !== undefined && ts.isIdentifier(injected), managerClass).toBe(true);
    return (injected as ts.Identifier).text;
}

/** Every `<receiver>.<method>(...)` call in the file, by receiver identifier. */
function receiversCalling(method: string): string[] {
    return collect((node): node is ts.CallExpression => ts.isCallExpression(node))
        .filter(
            (call) =>
                ts.isPropertyAccessExpression(call.expression) &&
                call.expression.name.text === method &&
                ts.isIdentifier(call.expression.expression),
        )
        .map(
            (call) =>
                ((call.expression as ts.PropertyAccessExpression).expression as ts.Identifier).text,
        );
}

/** Each repository whose temp artefacts are reaped, and the manager built on it. */
const REAPED = [
    { repository: 'FileSaveRepository', manager: 'SaveManager' },
    { repository: 'FileReplayRepository', manager: 'ReplayManager' },
    { repository: 'FilePerspectiveReplayRepository', manager: 'PerspectiveReplayManager' },
] as const;

describe('temp reap — composition root wiring', () => {
    it.each(REAPED)('constructs exactly one $repository, bound to a name', ({ repository }) => {
        expect(constructionsOf(repository)).toHaveLength(1);
        expect(boundNameOf(repository)).not.toHaveLength(0);
    });

    it.each(REAPED)(
        'builds the $manager on the bound $repository instance',
        ({ repository, manager }) => {
            expect(repositoryInjectedInto(manager)).toBe(boundNameOf(repository));
        },
    );

    // One call per repository, each on that repository's own binding: a reap
    // on a second instance, a repeated one, or one on any other receiver all
    // change this list.
    it('reaps on exactly those instances, once each', () => {
        const expected = REAPED.map(({ repository }) => boundNameOf(repository)).sort();

        expect([...receiversCalling('reapOrphanTempFiles')].sort()).toStrictEqual(expected);
    });
});
