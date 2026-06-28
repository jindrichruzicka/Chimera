/**
 * tools/eslint-plugin-chimera/rules/no-main-games-import.ts
 *
 * ESLint rule: chimera/no-main-games-import
 *
 * Forbids `electron/main` modules from importing any `games/*` path so the host
 * (main process) stays agnostic of which games exist — required for packaged,
 * multi-game builds (F18). After F62 (#778) the main-side game registry became a
 * runtime injection seam (`mainGameRegistry.ts` is now a game-agnostic factory),
 * so the host's game wiring moved OUT of the package into the consumer app's
 * composition root `apps/tactics/electron/main.ts` (relocated from the top-level
 * `app/` in F63/#783) — a flat file under `electron/`, not `electron/main/`, so it
 * is outside this rule's scope (it injects the game's `MainGameContribution` at
 * runtime). Since #788/#789 there are NO in-package composition points left:
 * content schemas (`MainGameContribution.contentSchemas`) and lobby-setup
 * builders (`MainGameContribution.lobbySetup`) also arrive by injection, so the
 * former `gameContentRegistry.ts` / `lobbySetupRegistry.ts` exemptions are gone
 * and every non-test `electron/main` module is guarded.
 *
 * Test files are exempt — they legitimately import game modules as fixtures
 * (e.g. index.test.ts, loadGameContent.test.ts).
 *
 * Mirrors `chimera/no-shell-games-import` on the renderer side (Invariant #94)
 * and the renderer's single-composition-point pattern (rendererGameRegistry.ts).
 *
 * Glob-based `no-restricted-imports` is unreliable for deep `games/*` paths, so
 * this rule classifies the import source directly (as no-shell-games-import
 * does): any relative/bare `games/*` path, or any `@chimera-engine/<pkg>` package that
 * is not on the engine allowlist (i.e. a game such as `@chimera-engine/tactics`). It
 * covers every static and dynamic form that can pull in a module:
 * `import`, `export … from`, `export * from`, and dynamic `import('…')` with a
 * string-literal specifier — so the boundary cannot be bypassed by a lazy load.
 */

import type { Rule } from 'eslint';

function normalize(filename: string): string {
    return filename.replace(/\\/gu, '/');
}

/**
 * True for an `electron/main` source file that must stay game-agnostic — i.e.
 * any non-test file under `electron/main/`. Since #788/#789 there are no
 * allowlisted composition registries: content schemas and lobby setup arrive by
 * runtime injection, so every `electron/main` module is guarded.
 */
function isGuardedMainFile(filename: string): boolean {
    const n = normalize(filename);
    if (!n.includes('electron/main/')) {
        return false;
    }
    return !/\.test\.tsx?$/u.test(n);
}

/**
 * Engine packages — game-agnostic, always importable by the host. Every other
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
 * True if `source` imports from a game (rather than an engine package):
 *   - a relative/bare `games/*` path (`games/…`, `…/games/…`), or
 *   - a `@chimera-engine/<pkg>` package whose `<pkg>` is NOT an engine package
 *     (e.g. `@chimera-engine/tactics`).
 *
 * Detecting games by the engine allowlist — rather than the legacy `/games/`
 * directory substring — keeps the guard correct now that games are first-class
 * `@chimera-engine/<game>` packages (F57) and once they move out of `games/` (F63).
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

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Forbid electron/main modules (outside the composition registries) from importing any games/* path.',
        },
        messages: {
            mainGamesImport:
                'electron/main must not import from games/* (multi-game packaging). Inject the game at runtime via the consumer app composition root (apps/tactics/electron/main.ts), which constructs the MainGameContribution (including contentSchemas and lobbySetup) and calls main(contributions). Mirrors renderer/game/rendererGameRegistry.ts.',
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
