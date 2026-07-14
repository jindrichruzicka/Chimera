/**
 * tools/eslint-plugin-chimera/rules/no-hardcoded-design-values.ts
 *
 * ESLint rule: `chimera/no-hardcoded-design-values`
 *
 * Flags hardcoded colour and size literals in renderer UI surfaces. Design
 * values must flow through `var(--ch-*)` tokens from renderer/styles/tokens.css.
 *
 * Architecture reference: §4.35 — UI Design System
 * Invariants #86 and #91
 */

import type { Rule } from 'eslint';

type LiteralKind = 'colour' | 'size';

interface NodeLike {
    readonly type?: string;
    readonly parent?: NodeLike;
    readonly id?: unknown;
    readonly key?: unknown;
    readonly name?: unknown;
    readonly quasis?: unknown;
    readonly raw?: unknown;
    readonly unit?: unknown;
    readonly value?: unknown;
    readonly [key: string]: unknown;
}

const RULE_NAME = 'chimera/no-hardcoded-design-values';

const HARDCODED_PATTERNS: readonly {
    readonly kind: LiteralKind;
    readonly pattern: RegExp;
}[] = [
    { kind: 'colour', pattern: /#[0-9a-f]{3,8}\b/iu },
    { kind: 'colour', pattern: /\brgba?\s*\(/iu },
    { kind: 'colour', pattern: /\bhsla?\s*\(/iu },
    { kind: 'size', pattern: /(?:^|[^\w.-])-?\d+(?:\.\d+)?(?:px|rem)\b/iu },
];

function asNode(value: unknown): NodeLike | undefined {
    if (typeof value !== 'object' || value === null) return undefined;
    return value as NodeLike;
}

function getName(value: unknown): string | undefined {
    const node = asNode(value);
    if (!node) return undefined;

    if (typeof node.name === 'string') return node.name;
    if (typeof node.value === 'string') return node.value;

    return undefined;
}

function normalizeFilename(filename: string): string {
    return filename.replace(/\\/gu, '/');
}

function isTokenDefinitionFile(filename: string): boolean {
    const normalized = normalizeFilename(filename);
    return (
        normalized === 'renderer/styles/tokens.css' ||
        normalized.endsWith('/renderer/styles/tokens.css')
    );
}

function isCssModuleFile(filename: string): boolean {
    return normalizeFilename(filename).endsWith('.module.css');
}

function classifyHardcodedValue(value: string): LiteralKind | undefined {
    for (const { kind, pattern } of HARDCODED_PATTERNS) {
        if (pattern.test(value)) return kind;
    }

    return undefined;
}

function isStyleVariableName(name: string): boolean {
    return /styles?/iu.test(name);
}

function isDesignPropertyName(name: string): boolean {
    return /(?:color|colour|background|border|radius|shadow|padding|margin|gap|width|height|inset|top|right|bottom|left|font|space)/iu.test(
        name,
    );
}

function isPropertyKey(node: NodeLike): boolean {
    const parent = asNode(node.parent);
    return parent?.type === 'Property' && parent.key === node;
}

function isInStyleContext(node: NodeLike): boolean {
    let current: NodeLike | undefined = node;

    while (current) {
        const parent = asNode(current.parent);
        if (!parent) return false;

        if (parent.type === 'JSXAttribute' && getName(parent.name) === 'style') {
            return true;
        }

        if (parent.type === 'VariableDeclarator') {
            const declaratorName = getName(parent.id);
            if (declaratorName && isStyleVariableName(declaratorName)) return true;
        }

        if (parent.type === 'Property') {
            const propertyName = getName(parent.key);
            if (propertyName && isDesignPropertyName(propertyName)) return true;
        }

        current = parent;
    }

    return false;
}

function shouldReportStringNode(node: NodeLike, value: string): boolean {
    if (isPropertyKey(node)) return false;
    if (!classifyHardcodedValue(value)) return false;
    return isInStyleContext(node);
}

/**
 * Media and container query conditions are environment predicates, not
 * themable design values — and `var()`/`calc(var())` never resolves inside a
 * query prelude, so px literals are the only working form there.
 */
function isEnvironmentPredicateAtrule(node: NodeLike | undefined): boolean {
    return typeof node?.name === 'string' && /^(?:media|container)$/iu.test(node.name);
}

function getCssDimensionValue(node: NodeLike): string | undefined {
    if (typeof node.value !== 'string' && typeof node.value !== 'number') return undefined;
    if (typeof node.unit !== 'string') return undefined;
    return `${node.value}${node.unit}`;
}

function getCssFunctionValue(node: NodeLike): string | undefined {
    if (typeof node.name !== 'string') return undefined;
    if (!/^(?:rgb|rgba|hsl|hsla)$/iu.test(node.name)) return undefined;
    return `${node.name}(...)`;
}

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow hardcoded colour and size literals in renderer UI surfaces; use `var(--ch-*)` tokens instead.',
            url: 'https://github.com/jindrichruzicka/Chimera/issues/560',
        },
        messages: {
            hardcodedDesignValue:
                'Hardcoded design {{kind}} "{{value}}" is forbidden by {{ruleName}}. Use a var(--ch-*) design token instead.',
        },
        schema: [],
    },

    create(context) {
        if (isTokenDefinitionFile(context.filename)) {
            return {};
        }

        if (isCssModuleFile(context.filename)) {
            // Dimensions sit inside a query prelude exactly when we are within a
            // media/container at-rule but not within any declaration (rule bodies
            // nest their sizes under Declaration nodes; preludes never do).
            let environmentAtruleDepth = 0;
            let declarationDepth = 0;

            function reportCssValue(node: NodeLike, kind: LiteralKind, value: string): void {
                context.report({
                    node: node as Rule.Node,
                    messageId: 'hardcodedDesignValue',
                    data: { kind, ruleName: RULE_NAME, value },
                });
            }

            return {
                Atrule(node: Rule.Node) {
                    if (isEnvironmentPredicateAtrule(asNode(node))) environmentAtruleDepth += 1;
                },

                'Atrule:exit'(node: Rule.Node) {
                    if (isEnvironmentPredicateAtrule(asNode(node))) environmentAtruleDepth -= 1;
                },

                Declaration() {
                    declarationDepth += 1;
                },

                'Declaration:exit'() {
                    declarationDepth -= 1;
                },

                Dimension(node: Rule.Node) {
                    if (environmentAtruleDepth > 0 && declarationDepth === 0) return;

                    const nodeLike = asNode(node);
                    if (!nodeLike) return;

                    const value = getCssDimensionValue(nodeLike);
                    if (!value || !/^-?\d+(?:\.\d+)?(?:px|rem)$/iu.test(value)) return;
                    reportCssValue(nodeLike, 'size', value);
                },

                Function(node: Rule.Node) {
                    const nodeLike = asNode(node);
                    if (!nodeLike) return;

                    const value = getCssFunctionValue(nodeLike);
                    if (!value) return;
                    reportCssValue(nodeLike, 'colour', value);
                },

                Hash(node: Rule.Node) {
                    const nodeLike = asNode(node);
                    if (typeof nodeLike?.value !== 'string') return;
                    reportCssValue(nodeLike, 'colour', `#${nodeLike.value}`);
                },
            };
        }

        function reportStringLiteral(node: NodeLike, value: string): void {
            const kind = classifyHardcodedValue(value);
            if (!kind || !shouldReportStringNode(node, value)) return;

            context.report({
                node: node as Rule.Node,
                messageId: 'hardcodedDesignValue',
                data: { kind, ruleName: RULE_NAME, value },
            });
        }

        return {
            Literal(node: Rule.Node) {
                const nodeLike = asNode(node);
                if (!nodeLike || typeof nodeLike.value !== 'string') return;
                reportStringLiteral(nodeLike, nodeLike.value);
            },

            TemplateLiteral(node: Rule.Node) {
                const nodeLike = asNode(node);
                if (!nodeLike) return;

                const quasis = Array.isArray(nodeLike.quasis) ? nodeLike.quasis : [];
                const raw = quasis
                    .map((quasi) => asNode(quasi))
                    .map((quasi) => asNode(quasi?.value)?.raw)
                    .filter((value): value is string => typeof value === 'string')
                    .join('${...}');

                reportStringLiteral(nodeLike, raw);
            },
        };
    },
};

export default rule;
