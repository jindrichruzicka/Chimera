/**
 * electron/dev-tools/eslint/rules/no-game-renderer-internals.ts
 *
 * ESLint rule: `chimera/no-game-renderer-internals`
 *
 * Allows game-owned renderer surfaces to consume the public renderer barrels
 * while blocking all other renderer internals from games packages. Which
 * barrels those are is decided by the disjunction in `checkImport` and the
 * per-barrel predicates it ORs; Invariant #96 is the prose authority. Game
 * renderer surfaces are the React screen, component and shell
 * modules (`apps/<name>/{screens,components,shell}/*.{jsx,tsx}`) and the
 * renderer composition root (`apps/<name>/renderer/*.{ts,tsx}`), which
 * registers the game's renderer contribution into the host through the seam.
 *
 * Four specifier positions carry the same permissions: `import`,
 * `export … from`, `export * from`, and dynamic `import('…')`. The dynamic one
 * matters most here: code-splitting a heavy screen is the ordinary reason a
 * game reaches for `import()`.
 *
 * Architecture reference: §3 Module Boundaries, §4.35 UI Design System
 */

import type { Rule } from 'eslint';
import { dynamicSpecifier, type DynamicSource } from '../dynamic-specifier.js';

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

// Game apps live under apps/<name>/.
function isGameFile(filename: string): boolean {
    return /(?:^|\/)apps\/[^/]+\//u.test(normalizePath(filename));
}

function isGameRendererSurface(filename: string): boolean {
    const normalized = normalizePath(filename);
    // A game's renderer-facing surfaces: the React screen, component and shell
    // modules (.jsx/.tsx) and the renderer composition root under
    // apps/<name>/renderer/ (.ts/.tsx — register.ts/loaders.ts), which wires the
    // game's renderer contribution into the @chimera-engine/renderer host through
    // the public game seam. `components/` is a surface for the same reason
    // `screens/` is: it holds the game's reusable React — DOM components, the
    // in-Canvas r3f primitives, and the hooks two screens share — and a
    // component that plays a cue or reads a model needs the audio/assets
    // barrels exactly as a screen does. The extension gate is what keeps a
    // plain-.ts helper in any of the three out (translations/ excepted below).
    return /(?:^|\/)apps\/[^/]+\/(?:(?:screens|components|shell)\/.*\.(?:jsx|tsx)|renderer\/.*\.(?:ts|tsx))$/u.test(
        normalized,
    );
}

// A game's i18n token-catalogue module: apps/<name>/{screens,shell}/translations/*.ts.
// These plain-.ts catalogues build the game's TranslationKey constants and so
// legitimately need the runtime brand factory (`translationKey`), which lives in
// the public i18n barrel — unlike a generic shell/screens .ts helper (a
// non-surface), which stays blocked. The permission is narrow: only the i18n
// barrel is allowed here (enforced by isPublicI18nBarrelImport at the call site),
// keeping every other renderer internal off-limits.
function isGameI18nCatalogue(filename: string): boolean {
    return /(?:^|\/)apps\/[^/]+\/(?:screens|shell)\/translations\/.*\.ts$/u.test(
        normalizePath(filename),
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

// The R3F engine barrel (Invariant #96): the GameCanvas root (role="main" |
// "overlay") plus its Canvas-bound hooks and the curated types (the barrel's
// own test pins the exact set).
function isPublicR3fBarrelImport(source: string): boolean {
    return (
        source === '@chimera-engine/renderer/components/r3f' ||
        source === '@chimera-engine/renderer/components/r3f/index' ||
        source === '@chimera-engine/renderer/components/r3f/index.ts' ||
        source === '@chimera-engine/renderer/components/r3f/index.js'
    );
}

// The renderer game-registration seam: the public `@chimera-engine/renderer/game`
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

// The engine i18n runtime barrel (F71): `I18nProvider`, `useTranslate`, and the
// engine token catalogue a game mounts/uses to localise its UI and to override
// engine tokens. Side-effect-free (Invariant #96).
function isPublicI18nBarrelImport(source: string): boolean {
    return (
        source === '@chimera-engine/renderer/i18n' ||
        source === '@chimera-engine/renderer/i18n/index' ||
        source === '@chimera-engine/renderer/i18n/index.ts' ||
        source === '@chimera-engine/renderer/i18n/index.js'
    );
}

// The engine audio barrel (§4.25): `useSound`, `useMusicTrack`,
// `useAudioManager`, and the cue/fade option types a game needs to start a voice
// and to act on one already playing.
function isPublicAudioBarrelImport(source: string): boolean {
    return (
        source === '@chimera-engine/renderer/audio' ||
        source === '@chimera-engine/renderer/audio/index' ||
        source === '@chimera-engine/renderer/audio/index.ts' ||
        source === '@chimera-engine/renderer/audio/index.js'
    );
}

// The engine asset barrel (§4.10) — the hooks, provider and types a game needs
// to read declared assets; `renderer/assets/index.ts` is the enumeration.
// Curated: every individual file behind it (e.g. `assets/AssetManager.js`)
// stays internal.
function isPublicAssetsBarrelImport(source: string): boolean {
    return (
        source === '@chimera-engine/renderer/assets' ||
        source === '@chimera-engine/renderer/assets/index' ||
        source === '@chimera-engine/renderer/assets/index.ts' ||
        source === '@chimera-engine/renderer/assets/index.js'
    );
}

// The engine input barrel (§4.26): `useInputAction`, `useInputManager`, the
// `InputManagerProvider`, and the action/event types a game needs to SUBSCRIBE
// to the rebindable actions it declares. Curated: the manager factory, the
// action registry and the key-binding repository stay internal, so
// `input/InputManager.js` is a violation exactly as `assets/AssetManager.js` is.
function isPublicInputBarrelImport(source: string): boolean {
    return (
        source === '@chimera-engine/renderer/input' ||
        source === '@chimera-engine/renderer/input/index' ||
        source === '@chimera-engine/renderer/input/index.ts' ||
        source === '@chimera-engine/renderer/input/index.js'
    );
}

// The engine GUI shell surface: the public `@chimera-engine/renderer/shell/*`
// route + layout exports a consumer app's OWN Next host re-exports so the app owns its
// renderer GUI while the game-agnostic shell ships from the package, plus the shell
// composition modules such a route may compose rather than re-export (e.g.
// `shell/gameAssetSession`). The check is on the importing FILE, not on what the import
// is used for: allowed ONLY from the app's Next host route tree
// (apps/<name>/renderer/app/**), never from game logic (screens/shell) or the
// composition root (register.ts/loaders.ts).
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
                'Allow games to import only the public renderer barrels (components/ui, components/chat, components/r3f, game, i18n, audio, assets, input) from renderer code.',
        },
        messages: {
            gameRendererImportOutsideSurface:
                'Only game renderer surfaces under apps/<name>/screens/*.tsx, apps/<name>/components/*.tsx, apps/<name>/shell/*.tsx, or apps/<name>/renderer/*.{ts,tsx} may import from the renderer package.',
            gameRendererInternalImport:
                'Game renderer surfaces may import only the public @chimera-engine/renderer/components/ui, @chimera-engine/renderer/components/chat, @chimera-engine/renderer/components/r3f, @chimera-engine/renderer/game, @chimera-engine/renderer/i18n, @chimera-engine/renderer/audio, @chimera-engine/renderer/assets, or @chimera-engine/renderer/input barrels from renderer code. Renderer internals are forbidden in game-app packages.',
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

            // A game i18n token-catalogue (translations/*.ts) may import ONLY the
            // public i18n barrel — the sole renderer dependency a catalogue needs
            // (the `translationKey` brand factory) — and nothing else.
            if (isGameI18nCatalogue(context.filename)) {
                if (isPublicI18nBarrelImport(source)) {
                    return;
                }
                context.report({ node, messageId: 'gameRendererInternalImport' });
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
                isPublicGameSeamImport(source) ||
                isPublicI18nBarrelImport(source) ||
                isPublicAudioBarrelImport(source) ||
                isPublicAssetsBarrelImport(source) ||
                isPublicInputBarrelImport(source)
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

            ImportExpression(node: Rule.Node) {
                const expression = node as Rule.Node & { source: DynamicSource };
                const source = dynamicSpecifier(expression.source);
                if (typeof source === 'string') checkImport(node, source);
            },
        };
    },
};

export default rule;
