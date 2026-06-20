/**
 * tools/eslint-plugin-chimera/rules/no-main-games-import.ts
 *
 * ESLint rule: chimera/no-main-games-import
 *
 * Forbids `electron/main` modules from importing any `games/*` path so the host
 * (main process) stays agnostic of which games exist — required for packaged,
 * multi-game builds (F18). The three designated composition points are the sole
 * coupling points and are exempt:
 *
 *   - electron/main/game/mainGameRegistry.ts        (actions, settings, visibility, …)
 *   - electron/main/content/gameContentRegistry.ts  (content schemas)
 *   - electron/main/lobby/lobbySetupRegistry.ts     (lobby setup builders)
 *
 * Test files are exempt — they legitimately import game modules as fixtures
 * (e.g. index.test.ts, loadGameContent.test.ts, mainGameRegistry.test.ts).
 *
 * Mirrors `chimera/no-shell-games-import` on the renderer side (Invariant #94)
 * and the renderer's single-composition-point pattern (rendererGameRegistry.ts).
 *
 * Glob-based `no-restricted-imports` is unreliable for deep `games/*` paths, so
 * this rule classifies the import source directly (as no-shell-games-import
 * does): any relative/bare `games/*` path, or any `@chimera/<pkg>` package that
 * is not on the engine allowlist (i.e. a game such as `@chimera/tactics`). It
 * covers every static and dynamic form that can pull in a module:
 * `import`, `export … from`, `export * from`, and dynamic `import('…')` with a
 * string-literal specifier — so the boundary cannot be bypassed by a lazy load.
 */

import type { Rule } from 'eslint';

function normalize(filename: string): string {
    return filename.replace(/\\/gu, '/');
}

/** Composition points permitted to import `games/*` (the sole coupling points). */
const ALLOWLISTED_SUFFIXES = [
    'electron/main/game/mainGameRegistry.ts',
    'electron/main/content/gameContentRegistry.ts',
    'electron/main/lobby/lobbySetupRegistry.ts',
];

/**
 * True for an `electron/main` source file that must stay game-agnostic — i.e.
 * not a test file and not one of the allowlisted composition registries.
 */
function isGuardedMainFile(filename: string): boolean {
    const n = normalize(filename);
    if (!n.includes('electron/main/')) {
        return false;
    }
    if (/\.test\.tsx?$/u.test(n)) {
        return false;
    }
    return !ALLOWLISTED_SUFFIXES.some((suffix) => n.endsWith(suffix));
}

/**
 * Engine packages — game-agnostic, always importable by the host. Every other
 * `@chimera/*` package is a game (e.g. `@chimera/tactics`) and is forbidden.
 */
const ENGINE_PACKAGES: ReadonlySet<string> = new Set([
    'simulation',
    'ai',
    'networking',
    'renderer',
    'electron',
]);

/**
 * True if `source` imports from a game (rather than an engine package):
 *   - a relative/bare `games/*` path (`games/…`, `…/games/…`), or
 *   - a `@chimera/<pkg>` package whose `<pkg>` is NOT an engine package
 *     (e.g. `@chimera/tactics`).
 *
 * Detecting games by the engine allowlist — rather than the legacy `/games/`
 * directory substring — keeps the guard correct now that games are first-class
 * `@chimera/<game>` packages (F57) and once they move out of `games/` (F63).
 */
function isGamesImport(source: string): boolean {
    const n = source.replace(/\\/gu, '/');
    if (n.startsWith('games/') || n.includes('/games/')) {
        return true;
    }
    const scoped = /^@chimera\/([^/]+)/u.exec(n);
    if (scoped === null) {
        return false;
    }
    const pkg = scoped[1];
    return pkg !== undefined && !ENGINE_PACKAGES.has(pkg);
}

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Forbid electron/main modules (outside the composition registries) from importing any games/* path.',
        },
        messages: {
            mainGamesImport:
                'electron/main must not import from games/* (multi-game packaging). Register the game in electron/main/game/mainGameRegistry.ts (or the content/lobby registries) — the sole composition points. Mirrors renderer/game/rendererGameRegistry.ts.',
        },
        schema: [],
    },

    create(context) {
        if (!isGuardedMainFile(context.filename)) {
            return {};
        }

        function check(node: Rule.Node, source: unknown): void {
            if (typeof source === 'string' && isGamesImport(source)) {
                context.report({ node, messageId: 'mainGamesImport' });
            }
        }

        // `import …`, `export … from`, and `export * from` all carry a string
        // `source` (null for re-export-less `export { x }`, hence the guard).
        function checkStaticSource(node: Rule.Node): void {
            const n = node as Rule.Node & { source: { value: unknown } | null };
            if (n.source !== null) {
                check(node, n.source.value);
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
                    check(node, n.source.value);
                }
            },
        };
    },
};

export default rule;
