/**
 * electron/dev-tools/eslint/rules/no-raw-r3f-canvas.ts
 *
 * ESLint rule: `chimera/no-raw-r3f-canvas` — Invariant #127's ESLint arm.
 *
 * A game surface must not obtain the `Canvas` binding from
 * `@react-three/fiber`: `GameCanvas` (`role="main" | "overlay"`) is the only
 * canvas root a game mounts. The canvas root is the seam where engine-wide
 * display settings apply (the `display.targetFps` cap today), and the
 * undetectable `frameloop="never"`-with-no-driver black canvas exists only
 * when a game owns the root.
 *
 * Deliberately NAME-based where `no-game-renderer-internals` is
 * specifier-based: `useFrame`, `useThree`, and `type ThreeEvent` from the
 * SAME specifier are legitimate on game scene components, so banning the
 * specifier would flag every scene file. A core `no-restricted-imports`
 * entry is ruled out twice over: it cannot ride the F78 standalone preset
 * (which carries only curated `chimera/*` rules), and it flags an entire
 * `import * as fiber` even when only `fiber.useFrame` is used. This rule
 * catches the named import, the aliased import (`Canvas as Root`), the
 * string-named forms (`import { 'Canvas' as C }`), the re-export forms
 * (`export { Canvas } from …`, `export * from …` — an export-all
 * unavoidably re-exports Canvas), and the namespace-shaped reaches —
 * `fiber.Canvas`, `fiber['Canvas']`, JSX `<fiber.Canvas>`, and the static
 * destructure `const { Canvas } = fiber` — while a namespace import used
 * only for other members passes. Namespace reaches are collected during
 * traversal and resolved against the namespace set at Program:exit, so a
 * reach textually above the import (valid ESM — import bindings are
 * hoisted) is caught like any other.
 *
 * Verdicts recorded:
 * - Type-only imports and re-exports (`import type { Canvas }`,
 *   `import { type Canvas }`, `export type { Canvas } from …`,
 *   `export { type Canvas } from …`) PASS: a type cannot mount a canvas.
 * - Dynamic `import('@react-three/fiber')` destructuring and `require()`
 *   are not caught: neither carries a statically named binding this rule
 *   can see without data-flow analysis.
 * - Namespace names are tracked per file without scope analysis: a local
 *   variable shadowing the namespace identifier AND carrying a `.Canvas`
 *   member would false-positive, which errs on the loud side.
 *
 * Architecture reference: §4.22 Camera System; Invariant #127
 */

import type { Rule } from 'eslint';

function normalizePath(value: string): string {
    return value.replace(/\\/gu, '/');
}

// Game apps live under apps/<name>/ — the same predicate as
// no-game-renderer-internals, satisfied by both the monorepo and the
// scaffolded apps/<kebab> standalone layout, on relative and absolute
// filenames alike.
function isGameFile(filename: string): boolean {
    return /(?:^|\/)apps\/[^/]+\//u.test(normalizePath(filename));
}

const FIBER_SPECIFIER = '@react-three/fiber';

interface ImportKindNode {
    importKind?: string;
}

function importedName(specifier: {
    imported: { type: string; name?: string; value?: unknown };
}): string | undefined {
    return specifier.imported.type === 'Identifier'
        ? specifier.imported.name
        : typeof specifier.imported.value === 'string'
          ? specifier.imported.value
          : undefined;
}

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Forbid game surfaces from obtaining the raw @react-three/fiber Canvas binding — GameCanvas is the only canvas root a game mounts (Invariant #127).',
        },
        messages: {
            rawCanvasImport:
                'A game must not obtain the raw r3f Canvas root. Mount <GameCanvas role="main" | "overlay"> from @chimera-engine/renderer/components/r3f instead (Invariant #127).',
            rawCanvasMember:
                'A game must not reach the raw r3f Canvas root through a namespace import. Mount <GameCanvas role="main" | "overlay"> from @chimera-engine/renderer/components/r3f instead (Invariant #127).',
        },
        schema: [],
    },

    create(context) {
        if (!isGameFile(context.filename)) {
            return {};
        }

        // Namespace locals bound to the fiber module in THIS file, and every
        // namespace-shaped Canvas reach seen while traversing. The reaches are
        // resolved at Program:exit so their report cannot depend on where the
        // import sits in the file.
        const fiberNamespaces = new Set<string>();
        const canvasReaches: { node: Rule.Node; objectName: string }[] = [];

        return {
            ImportDeclaration(node: Rule.Node) {
                const declaration = node as Rule.Node &
                    ImportKindNode & {
                        source: { value: unknown };
                        specifiers: readonly {
                            type: string;
                            local: { name: string };
                            imported?: { type: string; name?: string; value?: unknown };
                        }[];
                    };
                if (declaration.source.value !== FIBER_SPECIFIER) {
                    return;
                }
                if (declaration.importKind === 'type') {
                    return;
                }
                for (const specifier of declaration.specifiers) {
                    if (specifier.type === 'ImportNamespaceSpecifier') {
                        fiberNamespaces.add(specifier.local.name);
                        continue;
                    }
                    if (specifier.type !== 'ImportSpecifier') {
                        continue; // default import: r3f ships none
                    }
                    if ((specifier as ImportKindNode).importKind === 'type') {
                        continue;
                    }
                    if (
                        importedName(specifier as { imported: { type: string; name?: string } }) ===
                        'Canvas'
                    ) {
                        context.report({
                            node: specifier as unknown as Rule.Node,
                            messageId: 'rawCanvasImport',
                        });
                    }
                }
            },

            ExportNamedDeclaration(node: Rule.Node) {
                const declaration = node as Rule.Node & {
                    source?: { value?: unknown } | null;
                    exportKind?: string;
                    specifiers: readonly {
                        type: string;
                        exportKind?: string;
                        local: { type: string; name?: string; value?: unknown };
                    }[];
                };
                if (declaration.source?.value !== FIBER_SPECIFIER) {
                    return;
                }
                if (declaration.exportKind === 'type') {
                    return;
                }
                for (const specifier of declaration.specifiers) {
                    if (specifier.exportKind === 'type') {
                        continue; // export { type Canvas } from …: type-only
                    }
                    const local =
                        specifier.local.type === 'Identifier'
                            ? specifier.local.name
                            : typeof specifier.local.value === 'string'
                              ? specifier.local.value
                              : undefined;
                    if (local === 'Canvas') {
                        context.report({
                            node: specifier as unknown as Rule.Node,
                            messageId: 'rawCanvasImport',
                        });
                    }
                }
            },

            ExportAllDeclaration(node: Rule.Node) {
                const declaration = node as Rule.Node & {
                    source?: { value?: unknown };
                    exportKind?: string;
                };
                if (declaration.source?.value !== FIBER_SPECIFIER) {
                    return;
                }
                if (declaration.exportKind === 'type') {
                    return;
                }
                // Canvas is among everything an export-all re-exports.
                context.report({ node, messageId: 'rawCanvasImport' });
            },

            MemberExpression(node: Rule.Node) {
                const expression = node as Rule.Node & {
                    object: { type: string; name?: string };
                    property: { type: string; name?: string; value?: unknown };
                    computed: boolean;
                };
                if (
                    expression.object.type !== 'Identifier' ||
                    expression.object.name === undefined
                ) {
                    return;
                }
                const named = expression.computed
                    ? expression.property.type === 'Literal' &&
                      expression.property.value === 'Canvas'
                    : expression.property.type === 'Identifier' &&
                      expression.property.name === 'Canvas';
                if (named) {
                    canvasReaches.push({ node, objectName: expression.object.name });
                }
            },

            JSXMemberExpression(node: Rule.Node) {
                // Fully severed cast: JSX node types are outside ESLint's own
                // Node union, so an intersection cast would leave `parent.type`
                // uncomparable to the JSX kinds.
                const expression = node as unknown as {
                    object: { type: string; name?: string };
                    property: { type: string; name?: string };
                    parent?: { type?: string };
                };
                // The closing tag repeats the opening tag's name node; one
                // report per element, not one per tag.
                if (expression.parent?.type === 'JSXClosingElement') {
                    return;
                }
                if (
                    expression.object.type === 'JSXIdentifier' &&
                    expression.object.name !== undefined &&
                    expression.property.type === 'JSXIdentifier' &&
                    expression.property.name === 'Canvas'
                ) {
                    canvasReaches.push({ node, objectName: expression.object.name });
                }
            },

            VariableDeclarator(node: Rule.Node) {
                // The static destructure: const { Canvas } = fiber;
                const declarator = node as Rule.Node & {
                    id: {
                        type: string;
                        properties?: readonly {
                            type: string;
                            computed?: boolean;
                            key?: { type: string; name?: string; value?: unknown };
                        }[];
                    };
                    init?: { type: string; name?: string } | null;
                };
                if (
                    declarator.id.type !== 'ObjectPattern' ||
                    declarator.init?.type !== 'Identifier' ||
                    declarator.init.name === undefined
                ) {
                    return;
                }
                const objectName = declarator.init.name;
                for (const property of declarator.id.properties ?? []) {
                    if (property.type !== 'Property' || property.key === undefined) {
                        continue;
                    }
                    const named = property.computed
                        ? property.key.type === 'Literal' && property.key.value === 'Canvas'
                        : (property.key.type === 'Identifier' && property.key.name === 'Canvas') ||
                          (property.key.type === 'Literal' && property.key.value === 'Canvas');
                    if (named) {
                        canvasReaches.push({ node: property as unknown as Rule.Node, objectName });
                    }
                }
            },

            'Program:exit'() {
                for (const reach of canvasReaches) {
                    if (fiberNamespaces.has(reach.objectName)) {
                        context.report({ node: reach.node, messageId: 'rawCanvasMember' });
                    }
                }
            },
        };
    },
};

export default rule;
