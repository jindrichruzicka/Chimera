/**
 * tools/eslint-plugin-chimera/rules/no-shell-games-import.ts
 *
 * ESLint rule: chimera/no-shell-games-import
 *
 * Flags two categories of forbidden imports on engine shell pages:
 *
 *   1. Any import of a games-package tokens-override.css file from a shell
 *      page component (Invariant #93). Token overrides must enter the cascade
 *      exclusively as side-effects of game registry initialisation.
 *
 *   2. Any import from a games package path in a shell page component
 *      (Invariant #94). Shell pages must be game-agnostic. The one exception
 *      is renderer/app/match/page.tsx which loads the GameScreenRegistry
 *      by design (see Architecture section 4.33).
 *
 * Architecture reference: section 4.35 UI Design System, 4.37 Shell Pages UI Contract
 * Invariants #93 and #94
 * Issue: #561
 */

import type { Rule } from 'eslint';

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeFilename(filename: string): string {
    return filename.replace(/\\/gu, '/');
}

/**
 * Returns true if the file is one of the engine shell pages that must not
 * import from `games/*`. The `match/page.tsx` route is intentionally excluded
 * because it is responsible for loading the `GameScreenRegistry`.
 */
function isShellPage(filename: string): boolean {
    const n = normalizeFilename(filename);
    const SHELL_DIRS = ['main-menu', 'lobby', 'settings', 'saves'];
    return SHELL_DIRS.some(
        (dir) => n.includes(`/app/${dir}/`) || n.includes(`renderer/app/${dir}/`),
    );
}

/**
 * Returns true if `source` references a `tokens-override.css` file from any
 * `games/*` package (both bare module specifiers and relative paths).
 */
function isTokensOverrideImport(source: string): boolean {
    return /(?:^|[\\/])games[\\/][^/\\]+[\\/]styles[\\/]tokens-override\.css$/.test(
        source.replace(/\\/gu, '/'),
    );
}

/**
 * Returns true if `source` is an import from any `games/*` path (bare module
 * specifiers and relative paths that navigate into a `games/` directory).
 */
function isGamesImport(source: string): boolean {
    const n = source.replace(/\\/gu, '/');
    return n.startsWith('games/') || n.includes('/games/');
}

// ── Rule ─────────────────────────────────────────────────────────────────────

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Forbid shell page components from importing game token override CSS files (#93) or any games/* path (#94).',
            url: 'https://github.com/jindrichruzicka/Chimera/issues/561',
        },
        messages: {
            shellGamesTokenOverrideImport:
                'Shell page components must not import game token override CSS directly (Invariant #93). Token overrides enter the cascade as a side-effect of game registry initialisation.',
            shellGamesImport:
                'Shell page components must not import from any games/* path (Invariant #94). Shell pages are game-agnostic; the match page is the only valid entry point for game registry loading.',
        },
        schema: [],
    },

    create(context) {
        if (!isShellPage(context.filename)) {
            return {};
        }

        function checkImport(node: Rule.Node, source: string): void {
            if (isTokensOverrideImport(source)) {
                context.report({ node, messageId: 'shellGamesTokenOverrideImport' });
            } else if (isGamesImport(source)) {
                context.report({ node, messageId: 'shellGamesImport' });
            }
        }

        return {
            ImportDeclaration(node: Rule.Node) {
                const n = node as Rule.Node & { source: { value: string } };
                checkImport(node, n.source.value);
            },

            // Side-effect imports: import 'path'
            // These are also ImportDeclaration nodes but with no specifiers.
            // The ImportDeclaration handler above already covers them.
        };
    },
};

export default rule;
