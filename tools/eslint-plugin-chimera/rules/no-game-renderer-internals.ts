/**
 * tools/eslint-plugin-chimera/rules/no-game-renderer-internals.ts
 *
 * ESLint rule: `chimera/no-game-renderer-internals`
 *
 * Allows game-owned renderer surfaces to consume the public renderer surface —
 * the UI primitive barrel (`@chimera-engine/renderer/components/ui`), the chat barrel
 * (`@chimera-engine/renderer/components/chat`), the in-Canvas component barrel
 * (`@chimera-engine/renderer/components/r3f`), and the game-registration seam
 * (`@chimera-engine/renderer/game`, #784) — while blocking all other renderer internals
 * from games packages. Game renderer surfaces are the React screens/shell
 * components (`apps/<name>/{screens,shell}/*.{jsx,tsx}`) and the renderer
 * composition root (`apps/<name>/renderer/*.{ts,tsx}`), which registers the
 * game's renderer contribution into the host through the seam.
 *
 * Architecture reference: §3 Module Boundaries, §4.35 UI Design System
 */

import type { Rule } from 'eslint';

function normalizePath(value: string): string {
    return value.replace(/\\/gu, '/');
}

function dirname(filename: string): string {
    const normalized = normalizePath(filename);
    const slashIndex = normalized.lastIndexOf('/');
    return slashIndex === -1 ? '' : normalized.slice(0, slashIndex);
}

function normalizePathSegments(value: string): string {
    const segments: string[] = [];

    for (const segment of normalizePath(value).split('/')) {
        if (segment === '' || segment === '.') {
            continue;
        }

        if (segment === '..') {
            const previousSegment = segments.at(-1);
            if (previousSegment !== undefined && previousSegment !== '..') {
                segments.pop();
                continue;
            }
        }

        segments.push(segment);
    }

    return segments.join('/');
}

function resolveImportPath(filename: string, source: string): string {
    const normalizedSource = normalizePath(source);
    if (!normalizedSource.startsWith('.')) {
        return normalizedSource;
    }

    return normalizePathSegments(`${dirname(filename)}/${normalizedSource}`);
}

// Game apps live under apps/<name>/ (relocated from games/<name>/ in F63 #782).
function isGameFile(filename: string): boolean {
    return /(?:^|\/)apps\/[^/]+\//u.test(normalizePath(filename));
}

function isGameRendererSurface(filename: string): boolean {
    const normalized = normalizePath(filename);
    // A game's renderer-facing surfaces: the React screens/shell components
    // (.jsx/.tsx) and the renderer composition root under apps/<name>/renderer/
    // (.ts/.tsx — register.ts/loaders.ts, #784), which wires the game's renderer
    // contribution into the @chimera-engine/renderer host through the public game seam.
    return /(?:^|\/)apps\/[^/]+\/(?:(?:screens|shell)\/.*\.(?:jsx|tsx)|renderer\/.*\.(?:ts|tsx))$/u.test(
        normalized,
    );
}

function isRendererPath(value: string): boolean {
    const segments = normalizePath(value).split('/').filter(Boolean);

    return segments.some(
        (segment, index) => segment === 'renderer' && !segments.slice(0, index).includes('apps'),
    );
}

function isRendererImport(filename: string, source: string): boolean {
    const normalizedSource = normalizePath(source);
    if (
        normalizedSource === '@chimera-engine/renderer' ||
        normalizedSource.startsWith('@chimera-engine/renderer/')
    ) {
        return true;
    }

    if (normalizedSource === 'renderer' || normalizedSource.startsWith('renderer/')) {
        return true;
    }

    if (!normalizedSource.startsWith('.')) {
        return false;
    }

    const normalized = resolveImportPath(filename, source);
    return isRendererPath(normalized);
}

function isPublicUiBarrelImport(source: string): boolean {
    return (
        source === '@chimera-engine/renderer/components/ui' ||
        source === '@chimera-engine/renderer/components/ui/index' ||
        source === '@chimera-engine/renderer/components/ui/index.ts' ||
        source === '@chimera-engine/renderer/components/ui/index.js'
    );
}

function isPublicChatBarrelImport(source: string): boolean {
    return (
        source === '@chimera-engine/renderer/components/chat' ||
        source === '@chimera-engine/renderer/components/chat/index' ||
        source === '@chimera-engine/renderer/components/chat/index.ts' ||
        source === '@chimera-engine/renderer/components/chat/index.js'
    );
}

// The in-Canvas engine component barrel (Invariant #96): headless/visual R3F
// components (e.g. PerfProbe) a game mounts inside its own <Canvas>.
function isPublicR3fBarrelImport(source: string): boolean {
    return (
        source === '@chimera-engine/renderer/components/r3f' ||
        source === '@chimera-engine/renderer/components/r3f/index' ||
        source === '@chimera-engine/renderer/components/r3f/index.ts' ||
        source === '@chimera-engine/renderer/components/r3f/index.js'
    );
}

// The renderer game-registration seam (#784): the public `@chimera-engine/renderer/game`
// export a consumer app's renderer composition root uses to register its game's
// renderer contribution (`registerRendererGame`, `RendererGameContribution`).
function isPublicGameSeamImport(source: string): boolean {
    return (
        source === '@chimera-engine/renderer/game' ||
        source === '@chimera-engine/renderer/game/index' ||
        source === '@chimera-engine/renderer/game/index.ts' ||
        source === '@chimera-engine/renderer/game/index.js'
    );
}

// The engine GUI shell surface (F65 Phase 2c): the public `@chimera-engine/renderer/shell/*`
// route + layout exports a consumer app's OWN Next host re-exports so the app owns its
// renderer GUI while the game-agnostic shell ships from the package. Allowed ONLY from
// the app's Next host route tree (apps/<name>/renderer/app/**), never from game logic
// (screens/shell) or the composition root (register.ts/loaders.ts).
function isPublicShellImport(source: string): boolean {
    return source.startsWith('@chimera-engine/renderer/shell/');
}

function isAppNextHostRoute(filename: string): boolean {
    return /(?:^|\/)apps\/[^/]+\/renderer\/app\/.*\.(?:ts|tsx)$/u.test(normalizePath(filename));
}

function isUiDeepImport(filename: string, source: string): boolean {
    const normalized = resolveImportPath(filename, source);
    return (
        normalized.startsWith('@chimera-engine/renderer/components/ui/') ||
        /(?:^|\/)renderer\/components\/ui\//u.test(normalized)
    );
}

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Allow games to import only the public renderer component-library barrels (ui, chat, r3f) from renderer code.',
        },
        messages: {
            gameRendererImportOutsideSurface:
                'Only game renderer surfaces under apps/<name>/screens/*.tsx, apps/<name>/shell/*.tsx, or apps/<name>/renderer/*.{ts,tsx} may import from the renderer package.',
            gameRendererInternalImport:
                'Game renderer surfaces may import only the public @chimera-engine/renderer/components/ui, @chimera-engine/renderer/components/chat, @chimera-engine/renderer/components/r3f, or @chimera-engine/renderer/game barrels from renderer code. Renderer internals are forbidden in game-app packages.',
            gameRendererUiDeepImport:
                'Game renderer surfaces must import UI primitives from the public @chimera-engine/renderer/components/ui barrel, not individual renderer component files.',
        },
        schema: [],
    },

    create(context) {
        if (!isGameFile(context.filename)) {
            return {};
        }

        function checkImport(node: Rule.Node, source: string): void {
            if (!isRendererImport(context.filename, source)) {
                return;
            }

            if (!isGameRendererSurface(context.filename)) {
                context.report({ node, messageId: 'gameRendererImportOutsideSurface' });
                return;
            }

            if (
                isPublicUiBarrelImport(source) ||
                isPublicChatBarrelImport(source) ||
                isPublicR3fBarrelImport(source) ||
                isPublicGameSeamImport(source)
            ) {
                return;
            }

            // The engine shell surface is allowed ONLY from the app's Next host route tree.
            if (isPublicShellImport(source) && isAppNextHostRoute(context.filename)) {
                return;
            }

            context.report({
                node,
                messageId: isUiDeepImport(context.filename, source)
                    ? 'gameRendererUiDeepImport'
                    : 'gameRendererInternalImport',
            });
        }

        return {
            ExportAllDeclaration(node: Rule.Node) {
                const declaration = node as Rule.Node & { source?: { value?: string } };
                const source = declaration.source?.value;
                if (typeof source === 'string') checkImport(node, source);
            },

            ExportNamedDeclaration(node: Rule.Node) {
                const declaration = node as Rule.Node & { source?: { value?: string } };
                const source = declaration.source?.value;
                if (typeof source === 'string') checkImport(node, source);
            },

            ImportDeclaration(node: Rule.Node) {
                const declaration = node as Rule.Node & { source: { value: string } };
                checkImport(node, declaration.source.value);
            },
        };
    },
};

export default rule;
