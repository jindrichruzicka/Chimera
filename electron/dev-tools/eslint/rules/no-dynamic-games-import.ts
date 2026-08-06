/**
 * ESLint rule: chimera/no-dynamic-games-import
 *
 * Forbids a dynamic `import()` from naming a game — an `apps/` segment (a
 * game's on-disk home), a legacy `games/` segment, or a non-engine
 * `@chimera-engine/<pkg>` specifier.
 *
 * This rule exists because of a position, not a boundary: stock
 * `no-restricted-imports` never visits `ImportExpression` — see
 * `tools/eslint-dynamic-games-import-zone.test.ts`, which states that fact
 * where an assertion pins it. This rule covers that position, and classifies a
 * game through the shared `../game-path.ts`. It is NOT the dynamic mirror of any
 * particular zone's group; the same suite pins the non-subsumption both ways.
 *
 * It carries NO path predicate of its own, deliberately. Its siblings
 * `no-shell-games-import` / `no-main-games-import` guard a fixed set of files
 * and so must recognise them from inside; here the guarded set is exactly the
 * set of flat-config zones that ban the static form, and duplicating those
 * globs in a predicate would give one fact two homes. The zone declares where;
 * this rule decides what.
 *
 * Scope, stated rather than implied: it classifies the GAME specifiers only.
 * The zones that declare it also ban sibling-package specifiers (`renderer/*`,
 * `networking/*`, `electron/*`, `@chimera-engine/ai`, …), and those remain
 * static-only — `eslint.config.mjs`'s file header records why.
 *
 * Architecture reference: §3 Module Boundaries. Invariant #1 (enforcement
 * coverage; the invariant text does not change). The renderer zone that
 * declares it also cites #80/#94 for its own game ban. It has no part in
 * Invariant #47.
 */

import type { Rule } from 'eslint';
import { isGamesImport } from '../game-path.js';
import { dynamicSpecifier, type DynamicSource } from '../dynamic-specifier.js';

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Forbid a dynamic import() from naming a game — an apps/*|games/* path segment or a non-engine @chimera-engine/* package. Covers the import() specifier position, which stock no-restricted-imports does not visit.',
        },
        messages: {
            dynamicGamesImport:
                'A dynamic import() must not name a game either — apps/*, games/*, or a non-engine @chimera-engine/* package (Invariant #1). This zone bans the static form through no-restricted-imports, which never visits import(); lazily loading a game reaches the same dependency. Take the game through its runtime registration seam instead.',
        },
        schema: [],
    },

    create(context) {
        return {
            ImportExpression(node: Rule.Node) {
                const n = node as Rule.Node & { source: DynamicSource };
                const source = dynamicSpecifier(n.source);
                if (typeof source === 'string' && isGamesImport(source)) {
                    context.report({ node, messageId: 'dynamicGamesImport' });
                }
            },
        };
    },
};

export default rule;
