/**
 * renderer/components/r3f/__tests__/curated-renderer-config-surface.test.ts
 *
 * A game configures the renderer without naming `three` or `Canvas` (§4.22).
 *
 * Invariant #127 bans the `Canvas` binding from every game file, and the
 * curated `GameCanvas` props are what make that liveable: their values are
 * engine-owned names, so the whole of shadows, tone mapping, output colour
 * space and render scale is reachable from the r3f barrel alone.
 *
 * The claim is measured over a real fixture rather than argued in prose —
 * `__test-support__/CuratedRendererConfigGame.tsx` sets all four concerns and
 * typechecks with the rest of the package, so a prop that stopped being
 * settable reds `tsc` and a prop that started needing a `three` constant reds
 * the assertion below. Import declarations are PARSED, not grepped: a
 * specifier inside a comment or a string must not count, and a type-only
 * import of `three` counts exactly as much as a value one — the point is that
 * the game never names the symbol at all.
 *
 * The second half guards the OTHER copy of this surface.
 * `docs/core-components/camera-system.md` carries `GameCanvasProps` verbatim,
 * comments included, and nothing mechanical held the two together — the doc
 * copy went stale the moment a prop was added. It is compared here rather than
 * re-read by hand, modulo the one deliberate difference: the doc block spells
 * `React.ReactNode` where the source imports the type.
 *
 * Tests written first (TDD — red confirmed: the fixture did not compile before
 * `GameCanvasProps` carried the four concerns).
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

const fixturePath = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../__test-support__/CuratedRendererConfigGame.tsx',
);

/** Every module specifier the file imports, type-only declarations included. */
function importedSpecifiers(filePath: string): string[] {
    const source = ts.createSourceFile(
        filePath,
        readFileSync(filePath, 'utf8'),
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.TSX,
    );

    const specifiers: string[] = [];
    const visit = (node: ts.Node): void => {
        if (
            (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
            node.moduleSpecifier !== undefined &&
            ts.isStringLiteral(node.moduleSpecifier)
        ) {
            specifiers.push(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const [argument] = node.arguments;
            if (argument !== undefined && ts.isStringLiteral(argument)) {
                specifiers.push(argument.text);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);

    return specifiers;
}

/**
 * The `export type GameCanvasProps = Readonly<{ … }>;` declaration as written
 * in `filePath`, comments and all. Located by its own text so it reads the same
 * out of a TypeScript module and out of a fenced block in Markdown.
 */
function gameCanvasPropsBlock(filePath: string): string {
    const source = readFileSync(filePath, 'utf8');
    const start = source.indexOf('export type GameCanvasProps');
    const end = source.indexOf('}>;', start);
    if (start === -1 || end === -1) {
        throw new Error(`No GameCanvasProps declaration in ${filePath}`);
    }

    return source
        .slice(start, end + '}>;'.length)
        .split('\n')
        .map((line) => line.trimEnd())
        .join('\n');
}

describe('curated renderer configuration surface', () => {
    it('lets a game set all four renderer concerns from the r3f barrel alone', () => {
        // EXHAUSTIVE rather than a denylist: a game reaching `three` through a
        // re-exporting third module would pass a "no 'three' specifier" check
        // and fail this one.
        expect([...new Set(importedSpecifiers(fixturePath))].sort()).toEqual(['../index.js']);
    });

    it('names neither the r3f Canvas binding nor three in a game that configures the renderer', () => {
        const specifiers = importedSpecifiers(fixturePath);

        expect(specifiers).not.toContain('three');
        expect(specifiers).not.toContain('@react-three/fiber');
    });

    it("keeps camera-system.md's GameCanvasProps copy equal to the source", () => {
        const source = gameCanvasPropsBlock(
            resolve(repoRoot, 'renderer/components/r3f/GameCanvas.tsx'),
        );
        const documented = gameCanvasPropsBlock(
            resolve(repoRoot, 'docs/core-components/camera-system.md'),
        );

        // The one sanctioned difference: the doc block is read standalone, so
        // it spells the imported `ReactNode` as `React.ReactNode`.
        expect(documented).toBe(
            source.replace('children: ReactNode;', 'children: React.ReactNode;'),
        );
    });

    // The mutation guard for the two assertions above, and it drives the SAME
    // reader they do — a re-implementation here would pass while
    // `importedSpecifiers` was broken, which is the failure this case exists to
    // rule out. Both forms of the mutant are checked: a value import, and the
    // TYPE-ONLY import that a reader filtering `isTypeOnly` would miss. The
    // fixture cannot show the type-only half on its own — its type import
    // shares a specifier with its value import, so the `Set` hides it.
    it.each([
        { form: 'value', line: "import { ACESFilmicToneMapping } from 'three';" },
        { form: 'type-only', line: "import type { ToneMapping } from 'three';" },
    ])('reds when a fixture reaches for three through a $form import', ({ line }) => {
        const mutantPath = join(mkdtempSync(join(tmpdir(), 'curated-config-')), 'Mutant.tsx');
        writeFileSync(mutantPath, `${line}\n${readFileSync(fixturePath, 'utf8')}`);

        try {
            expect(importedSpecifiers(mutantPath)).toContain('three');
        } finally {
            rmSync(dirname(mutantPath), { recursive: true, force: true });
        }
    });
});
