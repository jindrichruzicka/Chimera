/**
 * electron/dev-tools/eslint/rules/no-animation-derivation-in-reduce.ts
 *
 * ESLint rule: `chimera/no-animation-derivation-in-reduce`
 *
 * Flags a call to `compileAnimationWindows(...)` or `beatsForRealSeconds(...)`
 * made from inside a function NAMED `reduce` or `validate`. Both derive a beat
 * count from `tickRateMs`, the host's pacing knob; both belong at content-load,
 * where the derivation is compared against the game's authored beat window
 * once. Calling either at reduce time makes the length of a gameplay window a
 * function of the tick rate — raising it would silently widen or narrow every
 * window in the game, and two hosts on different rates would diverge.
 *
 * Feature F82 — Animation System, docs/roadmap-sections/m10-first-public-release-v1.0.0.md.
 * The verifier's own contract lives in `simulation/content/animationWindows.ts`.
 *
 * The rule is the lint leg of that discipline, beside the renderer's clip-sheet
 * parser and the `validate-assets` build gate; those two check what a game
 * AUTHORS, and this one checks where the engine RUNS it.
 *
 * ## Two halves, both name-based
 *
 * WHAT — the two guarded callees, matched by name at the CALL SITE, in either
 * the bare (`compileAnimationWindows(...)`) or the namespace-member
 * (`windows.compileAnimationWindows(...)`) position. No import binding is
 * tracked, and the limit that buys is measured rather than assumed: an
 * `import { compileAnimationWindows as compile }` and a local
 * `const compile = compileAnimationWindows` both go unreported — each has a
 * `valid` fixture beside the rule saying so. What it buys in return is that
 * the path a call arrives through is irrelevant, so a re-export chain, a
 * barrel, or a `@chimera-engine/simulation/content` specifier all read the
 * same. A computed callee (`ns[name](...)`) reads as no name rather than as a
 * guess.
 *
 * WHERE — lexical containment in a function named `reduce` or `validate`, at
 * any nesting depth, where a function's name is the identifier it is BOUND to:
 * its own declaration name, its variable, its object/class key, or its
 * assignment target. A callback merely handed to `Array#reduce` is bound to
 * nothing and is therefore not a `reduce` body — reading it as one is the false
 * positive this rule's name invites. This half has the same two limits as the
 * one above, and its own `valid` fixtures: a computed key it declines to guess
 * at, and a body declared under another name and only REFERENCED as `reduce`.
 *
 * ## Scope
 *
 * The rule carries no path predicate of its own: the flat-config zone that
 * declares it IS its scope, so the monorepo's `eslint.config.mjs` and the
 * games-facing preset each state where it looks. That is deliberate — every
 * path this guards is a `simulation/`-shaped one both configs already name, and
 * a second, internal copy of those globs is a thing to drift.
 *
 * One consequence of guarding a NAME rather than a call graph: the sanctioned
 * content-load site is inside the zone too, so a content-load helper that
 * happens to be named `validate` would be reported for doing the thing the
 * message asks for. No such helper exists under `simulation/content/` today.
 * The monorepo has an escape hatch — the `simulation/content/loaders/**`
 * carve-out at `eslint.config.mjs`, mirroring the one its fromFloat sibling
 * declares — and a standalone game has NONE: the preset emits two blocks for
 * this rule and no third, which `preset.test.ts` asserts. A game that hits this
 * writes its own `off` block, the same way it would for any other rule.
 */

import type { Rule } from 'eslint';

/**
 * The window-derivation functions. Both read `tickRateMs`, so both are
 * content-load-only; `compileAnimationWindows` calls the other, which is why
 * banning only the outer one would leave the sharper edge exposed.
 */
const DERIVATION_CALLEES: ReadonlySet<string> = new Set([
    'compileAnimationWindows',
    'beatsForRealSeconds',
]);

/** The two reduce-time entry points a simulation module exposes. */
const REDUCE_TIME_NAMES: ReadonlySet<string> = new Set(['reduce', 'validate']);

/** Node types that open a new function body. */
const FUNCTION_TYPES: ReadonlySet<string> = new Set([
    'FunctionDeclaration',
    'FunctionExpression',
    'ArrowFunctionExpression',
]);

// ── Name helpers ─────────────────────────────────────────────────────────────

/**
 * The called name, for the two positions a module-level function is reachable
 * through: `f(...)` and `ns.f(...)`. A computed member (`ns[name](...)`) reads
 * as no name rather than as a guess.
 */
function calleeName(node: Rule.Node & { type: 'CallExpression' }): string | undefined {
    const callee = node.callee;
    if (callee.type === 'Identifier') return callee.name;
    if (callee.type === 'MemberExpression' && !callee.computed) {
        return callee.property.type === 'Identifier' ? callee.property.name : undefined;
    }
    return undefined;
}

/**
 * The shape the two name-bearing key nodes have in common, read structurally so
 * this module needs no `estree` type import of its own — `@types/estree` is a
 * transitive type-only dependency here, and naming it directly would make this
 * rule the one module that pins it.
 */
interface KeyNode {
    readonly type: string;
    readonly name?: string;
    readonly value?: unknown;
}

/** A property/method key as a name, unwrapping the `['reduce']` computed form. */
function keyName(key: KeyNode, computed: boolean): string | undefined {
    if (key.type === 'Literal') return typeof key.value === 'string' ? key.value : undefined;
    if (computed) return undefined; // a computed identifier is a runtime value
    return key.type === 'Identifier' ? key.name : undefined;
}

/**
 * The identifier a function is BOUND to, or `undefined` when it is bound to
 * nothing — the case that keeps an `Array#reduce` callback out of scope.
 */
function boundName(fn: Rule.Node): string | undefined {
    if (
        (fn.type === 'FunctionDeclaration' || fn.type === 'FunctionExpression') &&
        fn.id !== null &&
        fn.id !== undefined
    ) {
        return fn.id.name;
    }

    const parent = fn.parent as Rule.Node | null | undefined;
    if (parent === null || parent === undefined) return undefined;

    switch (parent.type) {
        case 'VariableDeclarator':
            return parent.id.type === 'Identifier' ? parent.id.name : undefined;
        case 'Property':
        case 'MethodDefinition':
        case 'PropertyDefinition':
            return keyName(parent.key, parent.computed);
        case 'AssignmentExpression':
            if (parent.left.type === 'Identifier') return parent.left.name;
            if (parent.left.type === 'MemberExpression' && !parent.left.computed) {
                return parent.left.property.type === 'Identifier'
                    ? parent.left.property.name
                    : undefined;
            }
            return undefined;
        default:
            return undefined;
    }
}

/**
 * The name of the innermost guarded body `node` sits lexically inside, or
 * `undefined` when there is none. One walk answers both questions the report
 * needs — whether to fire, and which body to name in the message.
 */
function enclosingReduceTimeName(node: Rule.Node): string | undefined {
    for (
        let current = node.parent as Rule.Node | null | undefined;
        current !== null && current !== undefined;
        current = current.parent as Rule.Node | null | undefined
    ) {
        if (!FUNCTION_TYPES.has(current.type)) continue;

        const name = boundName(current);
        if (name !== undefined && REDUCE_TIME_NAMES.has(name)) return name;
    }
    return undefined;
}

// ── Rule ─────────────────────────────────────────────────────────────────────

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow compileAnimationWindows()/beatsForRealSeconds() inside a reduce() or validate() body. Beat windows are derived once at content-load, never from a host pacing knob at reduce time.',
            url: 'https://github.com/jindrichruzicka/Chimera/blob/main/electron/dev-tools/eslint/README.md',
        },
        messages: {
            noAnimationDerivation:
                '{{callee}}() derives beats from tickRateMs and must not be called inside {{body}}(). ' +
                'Compile animation windows once at content-load and read the compiled window at reduce time, ' +
                'or a change to the host tick rate silently resizes every gameplay window.',
        },
        schema: [],
    },

    create(context) {
        return {
            CallExpression(node) {
                const called = calleeName(node);
                if (called === undefined || !DERIVATION_CALLEES.has(called)) return;

                const body = enclosingReduceTimeName(node);
                if (body === undefined) return;

                context.report({
                    node,
                    messageId: 'noAnimationDerivation',
                    data: { callee: called, body },
                });
            },
        };
    },
};

export default rule;
