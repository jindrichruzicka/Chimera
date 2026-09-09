/**
 * electron/main/__tests__/save-temp-reap-wiring.integration.test.ts
 *
 * Pins the RECEIVER of `FileSaveRepository.reapOrphanTempFiles()` in the
 * composition root: the repository the `SaveManager` is built on, not another
 * instance.
 *
 * Parsed, not grepped: a needle in a comment or in dead code would satisfy a
 * text search, and the identity of the receiver is not something a regex can
 * see at all.
 *
 * What a source parse cannot see is whether `main()` reaches the call — a reap
 * moved behind a condition still parses. That half is measured at runtime by
 * `running main() reaps an abandoned save temp file under its own userData`
 * in `electron/main/index.test.ts`, which plants an aged artefact and requires
 * it to be gone.
 *
 * Architecture: §4.11 — save/load persistence, composition root wiring.
 * Issue: #1269
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

    expect(declarations).toHaveLength(1);
    const name = declarations[0]?.name;
    expect(name && ts.isIdentifier(name)).toBe(true);
    return (name as ts.Identifier).text;
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

describe('save temp reap — composition root wiring', () => {
    it('constructs exactly one FileSaveRepository, bound to a name', () => {
        expect(constructionsOf('FileSaveRepository')).toHaveLength(1);
        expect(boundNameOf('FileSaveRepository')).not.toHaveLength(0);
    });

    it('names the SAME repository instance the SaveManager is built on as the reap receiver', () => {
        const repository = boundNameOf('FileSaveRepository');

        const managers = constructionsOf('SaveManager');
        expect(managers).toHaveLength(1);
        const injected = managers[0]?.arguments?.[0];
        expect(injected !== undefined && ts.isIdentifier(injected)).toBe(true);
        expect((injected as ts.Identifier).text).toBe(repository);

        expect(receiversCalling('reapOrphanTempFiles')).toStrictEqual([repository]);
    });
});
