/**
 * ESLint rule: chimera/no-shell-games-import
 *
 * Flags forbidden game imports on the engine's game-agnostic renderer surfaces:
 *
 *   1. Any import of a game's tokens-override.css file from a shell
 *      page component (Invariant #93). Token overrides must enter the cascade
 *      exclusively as side-effects of game registry initialisation.
 *
 *   2. Any import from a game path in a shell page component
 *      (Invariant #94). Shell pages must be game-agnostic; game/page delegates
 *      game registry resolution to renderer-owned loader helpers.
 *
 *   3. Any import from a game path in `GameShell.tsx` /
 *      `InGameMenuHost.tsx` (Invariant #80). These engine↔game-React coupling
 *      surfaces stay game-agnostic — the `GameScreenRegistry` prop is the sole
 *      coupling point. Mirrors the bash invariants Check 7 across the
 *      @chimera-engine/renderer package boundary.
 *
 * A "game path" is any of the three ways a game can be named: an `apps/`
 * segment (its on-disk home), a legacy `games/` segment, or a non-engine
 * `@chimera-engine/<pkg>` specifier — the classification shared with its
 * siblings in `../game-path.ts`. Each is matched in four specifier positions:
 * `import`, `export … from`, `export * from`, and dynamic `import('…')`. The
 * rule visits `ImportExpression` itself rather than leaning on the stock
 * `no-restricted-imports` zones, which do not inspect dynamic `import()` at all
 * — that is what makes a lazy game load reachable here.
 * `import x = require('…')` is not visited; it is banned repo-wide by
 * `@typescript-eslint/no-require-imports`.
 *
 * Architecture reference: section 4.35 UI Design System, 4.37 Shell Pages UI Contract
 * Invariants #80, #93 and #94
 */

import type { Rule } from 'eslint';
import { isGamesImport, isTokensOverrideImport } from '../game-path.js';
import { dynamicSpecifier, type DynamicSource } from '../dynamic-specifier.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeFilename(filename: string): string {
    return filename.replace(/\\/gu, '/');
}

/**
 * Returns true if the file is one of the engine shell pages that must not
 * import a game directly.
 */
function isShellPage(filename: string): boolean {
    const n = normalizeFilename(filename);
    const SHELL_DIRS = ['main-menu', 'lobby', 'game', 'settings', 'saves', 'component-gallery'];
    return SHELL_DIRS.some(
        (dir) => n.includes(`/app/${dir}/`) || n.includes(`renderer/app/${dir}/`),
    );
}

/**
 * Returns true if the file is one of the engine↔game-React coupling surfaces
 * named by Invariant #80 — `GameShell.tsx` or `InGameMenuHost.tsx`. These stay
 * game-agnostic: the `GameScreenRegistry` prop is the sole coupling point, so
 * they must never import a game path. Scoped to exactly the two files the
 * invariant names (mirrors the bash invariants Check 7), not the whole shell/ dir.
 */
function isGameShellHost(filename: string): boolean {
    const n = normalizeFilename(filename);
    return /(?:^|\/)renderer\/components\/shell\/(?:GameShell|InGameMenuHost)\.(?:ts|tsx|js|jsx|mjs)$/u.test(
        n,
    );
}

// ── Rule ─────────────────────────────────────────────────────────────────────

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Forbid shell page components from importing game token override CSS files (#93) or any game path (#94), and forbid GameShell.tsx/InGameMenuHost.tsx from importing any game path (#80). A game path is an apps/*|games/* segment or a non-engine @chimera-engine/* package.',
            url: 'https://github.com/jindrichruzicka/Chimera/issues/561',
        },
        messages: {
            shellGamesTokenOverrideImport:
                'Shell page components must not import game token override CSS directly (Invariant #93). Token overrides enter the cascade as a side-effect of game registry initialisation.',
            shellGamesImport:
                'Shell page components must not import from any game path — apps/*, games/*, or a non-engine @chimera-engine/* package (Invariant #94). Shell pages are game-agnostic; load game registries through renderer-owned loader helpers.',
            shellHostGamesImport:
                'GameShell.tsx and InGameMenuHost.tsx must not import from any game path — apps/*, games/*, or a non-engine @chimera-engine/* package (Invariant #80). The GameScreenRegistry prop is the sole coupling point between the engine renderer and a game’s React code.',
        },
        schema: [],
    },

    create(context) {
        // `GameShell.tsx` / `InGameMenuHost.tsx` are guarded by Invariant #80;
        // the `renderer/app/*` shell pages by Invariants #93/#94. The two sets
        // are disjoint, so a single `host` flag selects the reported message.
        const host = isGameShellHost(context.filename);
        if (!host && !isShellPage(context.filename)) {
            return {};
        }

        function checkImport(node: Rule.Node, source: unknown): void {
            if (typeof source !== 'string') {
                return;
            }
            // A game's tokens-override.css is itself a game import, so for the
            // shell hosts it is reported under #80; only shell pages distinguish
            // the #93 token-override case from the broader #94 game import.
            if (host) {
                if (isGamesImport(source)) {
                    context.report({ node, messageId: 'shellHostGamesImport' });
                }
                return;
            }
            if (isTokensOverrideImport(source)) {
                context.report({ node, messageId: 'shellGamesTokenOverrideImport' });
            } else if (isGamesImport(source)) {
                context.report({ node, messageId: 'shellGamesImport' });
            }
        }

        // `import …` (incl. side-effect `import '…'`), `export … from`, and
        // `export * from` all carry a string `source` (null for a re-export-less
        // `export { x }`, hence the guard). Mirrors chimera/no-main-games-import
        // so the boundary cannot be bypassed by a re-export or a lazy load.
        function checkStaticSource(node: Rule.Node): void {
            const n = node as Rule.Node & { source: { value: unknown } | null };
            if (n.source !== null) {
                checkImport(node, n.source.value);
            }
        }

        return {
            ImportDeclaration: checkStaticSource,
            ExportNamedDeclaration: checkStaticSource,
            ExportAllDeclaration: checkStaticSource,
            ImportExpression(node: Rule.Node) {
                const n = node as Rule.Node & { source: DynamicSource };
                checkImport(node, dynamicSpecifier(n.source));
            },
        };
    },
};

export default rule;
