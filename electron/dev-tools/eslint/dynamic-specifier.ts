/**
 * electron/dev-tools/eslint/dynamic-specifier.ts
 *
 * The module a dynamic `import()` names, read off ESLint's untyped
 * `ImportExpression` node. Shared by the rules that import it, so those see the
 * same set of specifier shapes as each other: a rule that reads only `Literal`
 * lets one swapped quote character walk a forbidden module past it.
 *
 * Lives beside the plugin index rather than under `rules/`; `index.test.ts`
 * records why and enforces it.
 */

/** The `source` of a dynamic `import()`, as ESLint's untyped AST exposes it. */
export interface DynamicSource {
    type: string;
    value?: unknown;
    quasis?: readonly { value: { cooked?: string | null } }[];
    expressions?: readonly unknown[];
}

/**
 * The single module a dynamic `import()` specifier names, when it names one: a
 * string literal, or a template with no substitutions — which is exactly as
 * resolvable, so leaving it out would let `import(\`…\`)` bypass a guard that
 * catches `import('…')`. A specifier assembled at runtime resolves to no one
 * module and yields `undefined`; there is nothing to classify.
 */
export function dynamicSpecifier(source: DynamicSource): unknown {
    if (source.type === 'Literal') {
        return source.value;
    }
    if (source.type === 'TemplateLiteral' && source.expressions?.length === 0) {
        return source.quasis?.[0]?.value.cooked ?? undefined;
    }
    return undefined;
}
