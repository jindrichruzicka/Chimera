/**
 * tools/eslint-plugin-chimera/rules/no-game-renderer-internals.ts
 *
 * ESLint rule: `chimera/no-game-renderer-internals`
 *
 * Allows game-owned renderer surfaces to consume the public UI primitive barrel
 * while blocking all other renderer internals from games packages.
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

function isGameFile(filename: string): boolean {
    return /(?:^|\/)games\/[^/]+\//u.test(normalizePath(filename));
}

function isGameRendererSurface(filename: string): boolean {
    const normalized = normalizePath(filename);
    return /(?:^|\/)games\/[^/]+\/(?:screens|shell)\/.*\.(?:jsx|tsx)$/u.test(normalized);
}

function isRendererPath(value: string): boolean {
    const segments = normalizePath(value).split('/').filter(Boolean);

    return segments.some(
        (segment, index) => segment === 'renderer' && !segments.slice(0, index).includes('games'),
    );
}

function isRendererImport(filename: string, source: string): boolean {
    const normalizedSource = normalizePath(source);
    if (
        normalizedSource === '@chimera/renderer' ||
        normalizedSource.startsWith('@chimera/renderer/')
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
        source === '@chimera/renderer/components/ui' ||
        source === '@chimera/renderer/components/ui/index' ||
        source === '@chimera/renderer/components/ui/index.ts' ||
        source === '@chimera/renderer/components/ui/index.js'
    );
}

function isUiDeepImport(filename: string, source: string): boolean {
    const normalized = resolveImportPath(filename, source);
    return (
        normalized.startsWith('@chimera/renderer/components/ui/') ||
        /(?:^|\/)renderer\/components\/ui\//u.test(normalized)
    );
}

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Allow games to import only the public renderer UI primitive barrel from renderer code.',
        },
        messages: {
            gameRendererImportOutsideSurface:
                'Only game renderer surfaces under games/<name>/screens/*.tsx or games/<name>/shell/*.tsx may import renderer UI primitives.',
            gameRendererInternalImport:
                'Game renderer surfaces may import only the public @chimera/renderer/components/ui barrel from renderer code. Renderer internals are forbidden in games packages.',
            gameRendererUiDeepImport:
                'Game renderer surfaces must import UI primitives from the public @chimera/renderer/components/ui barrel, not individual renderer component files.',
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

            if (isPublicUiBarrelImport(source)) {
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
