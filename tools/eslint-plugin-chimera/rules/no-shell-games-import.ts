/**
 * ESLint rule: chimera/no-shell-games-import
 *
 * Flags forbidden game imports on the engine's game-agnostic renderer surfaces:
 *
 *   1. Any import of a games-package tokens-override.css file from a shell
 *      page component (Invariant #93). Token overrides must enter the cascade
 *      exclusively as side-effects of game registry initialisation.
 *
 *   2. Any import from a games package path in a shell page component
 *      (Invariant #94). Shell pages must be game-agnostic; game/page delegates
 *      game registry resolution to renderer-owned loader helpers.
 *
 *   3. Any import from a games package path in `GameShell.tsx` /
 *      `InGameMenuHost.tsx` (Invariant #80). These engine↔game-React coupling
 *      surfaces stay game-agnostic — the `GameScreenRegistry` prop is the sole
 *      coupling point. Mirrors the bash invariants Check 7 across the
 *      @chimera-engine/renderer package boundary.
 *
 * Architecture reference: section 4.35 UI Design System, 4.37 Shell Pages UI Contract
 * Invariants #80, #93 and #94
 */

import type { Rule } from 'eslint';

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeFilename(filename: string): string {
    return filename.replace(/\\/gu, '/');
}

/**
 * Returns true if the file is one of the engine shell pages that must not
 * import from `games/*` directly.
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
 * they must never import a `games/*` path. Scoped to exactly the two files the
 * invariant names (mirrors the bash invariants Check 7), not the whole shell/ dir.
 */
function isGameShellHost(filename: string): boolean {
    const n = normalizeFilename(filename);
    return /(?:^|\/)renderer\/components\/shell\/(?:GameShell|InGameMenuHost)\.(?:ts|tsx|js|jsx|mjs)$/u.test(
        n,
    );
}

/**
 * Engine packages — game-agnostic, importable by shell pages. Every other
 * `@chimera-engine/*` package is a game (e.g. `@chimera-engine/tactics`) and is forbidden.
 */
const ENGINE_PACKAGES: ReadonlySet<string> = new Set([
    'simulation',
    'ai',
    'networking',
    'renderer',
    'electron',
]);

/**
 * Returns true if `source` is an import from a game (rather than an engine
 * package):
 *   - a relative/bare `games/*` path (`games/…`, `…/games/…`), or
 *   - a `@chimera-engine/<pkg>` package whose `<pkg>` is NOT an engine package
 *     (e.g. `@chimera-engine/tactics`).
 *
 * Detecting games by the engine allowlist — rather than a `/games/` directory
 * substring — keeps the guard correct now that games are first-class
 * `@chimera-engine/<game>` packages that live outside `games/`.
 */
function isGamesImport(source: string): boolean {
    const n = source.replace(/\\/gu, '/');
    if (n.startsWith('games/') || n.includes('/games/')) {
        return true;
    }
    const scoped = /^@chimera-engine\/([^/]+)/u.exec(n);
    if (scoped === null) {
        return false;
    }
    const pkg = scoped[1];
    return pkg !== undefined && !ENGINE_PACKAGES.has(pkg);
}

/**
 * Returns true if `source` references a game's `styles/tokens-override.css` —
 * via either a relative/bare `games/*` path or a `@chimera-engine/<game>` package
 * specifier.
 */
function isTokensOverrideImport(source: string): boolean {
    const n = source.replace(/\\/gu, '/');
    return /(?:^|\/)styles\/tokens-override\.css$/u.test(n) && isGamesImport(n);
}

// ── Rule ─────────────────────────────────────────────────────────────────────

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Forbid shell page components from importing game token override CSS files (#93) or any games/* path (#94), and forbid GameShell.tsx/InGameMenuHost.tsx from importing any games/* path (#80).',
            url: 'https://github.com/jindrichruzicka/Chimera/issues/561',
        },
        messages: {
            shellGamesTokenOverrideImport:
                'Shell page components must not import game token override CSS directly (Invariant #93). Token overrides enter the cascade as a side-effect of game registry initialisation.',
            shellGamesImport:
                'Shell page components must not import from any games/* path (Invariant #94). Shell pages are game-agnostic; load game registries through renderer-owned loader helpers.',
            shellHostGamesImport:
                'GameShell.tsx and InGameMenuHost.tsx must not import from any games/* path (Invariant #80). The GameScreenRegistry prop is the sole coupling point between the engine renderer and a game’s React code.',
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
            // A game's tokens-override.css is itself a games/* import, so for the
            // shell hosts it is reported under #80; only shell pages distinguish
            // the #93 token-override case from the broader #94 games import.
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
            // Dynamic `import('…')` — flag only string-literal specifiers; a
            // computed specifier cannot be statically resolved to a games path.
            ImportExpression(node: Rule.Node) {
                const n = node as Rule.Node & { source: { type: string; value?: unknown } };
                if (n.source.type === 'Literal') {
                    checkImport(node, n.source.value);
                }
            },
        };
    },
};

export default rule;
