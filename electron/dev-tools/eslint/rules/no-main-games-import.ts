/**
 * ESLint rule: chimera/no-main-games-import
 *
 * Forbids `electron/main` modules from importing any game path — an `apps/`
 * segment (a game's on-disk home), a legacy `games/` segment, or a
 * non-engine `@chimera-engine/<pkg>` specifier — so the host
 * (main process) stays agnostic of which games exist — required for packaged,
 * multi-game builds. The game's wiring lives in the consumer app's composition
 * root (`apps/tactics/electron/main.ts`), a flat file under `electron/` rather
 * than `electron/main/`, so it is outside this rule's scope; it injects the
 * game's `MainGameContribution` at runtime. There are NO in-package composition
 * points: content schemas (`MainGameContribution.contentSchemas`) and lobby-setup
 * builders (`MainGameContribution.lobbySetup`) also arrive by injection, so every
 * non-test `electron/main` module is guarded.
 *
 * Test files are exempt — they legitimately import game modules as fixtures
 * (e.g. index.test.ts, loadGameContent.test.ts).
 *
 * Mirrors `chimera/no-shell-games-import` on the renderer side (Invariant #94)
 * and the renderer's single-composition-point pattern (rendererGameRegistry.ts).
 *
 * Glob-based `no-restricted-imports` is unreliable for deep game paths, so this
 * rule classifies the import source directly (as no-shell-games-import does):
 * any relative/bare `apps/*` or `games/*` path, or any `@chimera-engine/<pkg>`
 * package that is not on the engine allowlist (i.e. a game such as
 * `@chimera-engine/tactics`). It matches four specifier positions — `import`,
 * `export … from`, `export * from`, and dynamic `import('…')` — so the boundary
 * cannot be bypassed by a lazy load; no-shell-games-import's header records why
 * the dynamic one has to be visited here rather than delegated.
 */

import type { Rule } from 'eslint';

function normalize(filename: string): string {
    return filename.replace(/\\/gu, '/');
}

/**
 * True for an `electron/main` source file that must stay game-agnostic — i.e.
 * any non-test file under `electron/main/`. There are no allowlisted composition
 * registries: content schemas and lobby setup arrive by runtime injection, so
 * every `electron/main` module is guarded.
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
 * A path that enters the game-app tree by name: an `apps/` or `games/` path
 * SEGMENT, leading or embedded (`apps/…`, `../../apps/…`). `apps/` is a game's
 * on-disk home; `games/` is the legacy home, matched so the old form stays
 * rejected. Anchored at BOTH ends, so neither a prefix lookalike
 * (`…/webapps/…`) nor a suffix one (`…/gamestate.js`) is read as a game.
 */
const GAME_PATH_SEGMENT_RE = /(?:^|\/)(?:apps|games)\//u;

/**
 * True if `source` imports from a game (rather than an engine package):
 *   - a relative/bare `apps/*` or `games/*` path (`apps/…`, `…/apps/…`), or
 *   - a `@chimera-engine/<pkg>` package whose `<pkg>` is NOT an engine package
 *     (e.g. `@chimera-engine/tactics`).
 *
 * Detecting games by the engine allowlist — rather than a directory substring
 * alone — keeps the guard correct for games that are first-class
 * `@chimera-engine/<game>` packages; the path arm keeps it correct for the same
 * game reached by its on-disk `apps/<name>/` location, which carries no scoped
 * specifier at all.
 */
function isGamesImport(source: string): boolean {
    const n = source.replace(/\\/gu, '/');
    if (GAME_PATH_SEGMENT_RE.test(n)) {
        return true;
    }
    const scoped = /^@chimera-engine\/([^/]+)/u.exec(n);
    if (scoped === null) {
        return false;
    }
    const pkg = scoped[1];
    return pkg !== undefined && !ENGINE_PACKAGES.has(pkg);
}

/** The `source` of a dynamic `import()`, as ESLint's untyped AST exposes it. */
interface DynamicSource {
    type: string;
    value?: unknown;
    quasis?: readonly { value: { cooked?: string | null } }[];
    expressions?: readonly unknown[];
}

/**
 * The single module a dynamic `import()` specifier names, when it names one.
 * The reason each arm is here lives on the twin in `no-shell-games-import.ts`.
 */
function dynamicSpecifier(source: DynamicSource): unknown {
    if (source.type === 'Literal') {
        return source.value;
    }
    if (source.type === 'TemplateLiteral' && source.expressions?.length === 0) {
        return source.quasis?.[0]?.value.cooked ?? undefined;
    }
    return undefined;
}

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Forbid electron/main modules (outside the composition registries) from importing any game path — an apps/*|games/* segment or a non-engine @chimera-engine/* package.',
        },
        messages: {
            mainGamesImport:
                'electron/main must not import from a game — apps/*, games/*, or a non-engine @chimera-engine/* package (multi-game packaging). Inject the game at runtime via the consumer app composition root (apps/tactics/electron/main.ts), which constructs the MainGameContribution (including contentSchemas and lobbySetup) and calls main(contributions). Mirrors renderer/game/rendererGameRegistry.ts.',
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
            ImportExpression(node: Rule.Node) {
                const n = node as Rule.Node & { source: DynamicSource };
                check(node, dynamicSpecifier(n.source));
            },
        };
    },
};

export default rule;
