/**
 * ESLint rule: `chimera/no-unknown-token-overrides`
 *
 * Flags game token override custom properties that are not declared in the
 * canonical engine token set.
 *
 * Architecture reference: §4.35 — UI Design System
 * Invariant #85
 *
 * ## Where the base token set comes from
 *
 * Through the PACKAGE SPECIFIER `@chimera-engine/renderer/styles/tokens.css`,
 * never through a path relative to this module. The distinction is the whole
 * reason the rule can leave the monorepo: a module-relative reach resolves to
 * wherever this file happens to sit, so it silently re-aims when the rule moves
 * and points at nothing at all from inside a published `dist/`. The specifier
 * resolves identically in both worlds — onto the workspace symlink here, onto
 * the installed package in a standalone game.
 *
 * It resolves onto renderer's BUILT `dist/styles/tokens.css`, which the
 * renderer package's own build copies there. The monorepo's `lint` script runs
 * `build:packages` first, so it exists by the time ESLint loads; a lint run
 * against an unbuilt tree fails with the specifier named, which is the
 * actionable direction.
 *
 * That build dependency is also why the path is INJECTABLE: the rule's own unit
 * tests must not require a renderer build to run, so they pass a checked-in
 * fixture through the `tokensCssPath` option. Production callers pass nothing.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { Rule } from 'eslint';

interface SourceCodeLike {
    readonly text: string;
}

interface RuleOptions {
    /**
     * Absolute path to the stylesheet declaring the base `--ch-*` token set.
     * Test seam; omitted in production, where the renderer subpath is resolved.
     */
    readonly tokensCssPath?: string;
}

const RULE_NAME = 'chimera/no-unknown-token-overrides';
const TOKEN_DECLARATION_PATTERN = /(?:^|[\s{;])(--ch-[\w-]+)\s*:/gmu;
const TOKENS_CSS_SPECIFIER = '@chimera-engine/renderer/styles/tokens.css';

/**
 * Resolved through `createRequire`, not `import.meta.resolve`: the latter maps
 * the specifier without checking that anything is there, so a missing renderer
 * build surfaces later as an ENOENT on a path nobody wrote. This throws at the
 * specifier.
 */
const requireFromHere = createRequire(import.meta.url);

/**
 * Declared-token sets, keyed by the file they came from. A single unkeyed memo
 * would be correct in production (one path, one process) and wrong the moment
 * the path is injectable — the first fixture read would answer for every later
 * one.
 */
const declaredTokensByPath = new Map<string, ReadonlySet<string>>();

function normalizeFilename(filename: string): string {
    return filename.replace(/\\/gu, '/');
}

// Game apps live under apps/<name>/.
function isTokenOverrideFile(filename: string): boolean {
    return /(?:^|[/])apps[/][^/]+[/]styles[/]tokens-override\.css$/u.test(
        normalizeFilename(filename),
    );
}

function extractDeclaredTokens(css: string): ReadonlySet<string> {
    return new Set(
        Array.from(css.matchAll(TOKEN_DECLARATION_PATTERN), (match) => match[1]).filter(
            (token): token is string => typeof token === 'string',
        ),
    );
}

function resolveTokensCssPath(options: RuleOptions | undefined): string {
    return options?.tokensCssPath ?? requireFromHere.resolve(TOKENS_CSS_SPECIFIER);
}

function loadDeclaredTokens(tokensCssPath: string): ReadonlySet<string> {
    const cached = declaredTokensByPath.get(tokensCssPath);
    if (cached !== undefined) return cached;

    const tokens = extractDeclaredTokens(readFileSync(tokensCssPath, 'utf8'));
    declaredTokensByPath.set(tokensCssPath, tokens);
    return tokens;
}

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow game token override declarations that are absent from the engine token set.',
            url: 'https://github.com/jindrichruzicka/Chimera/issues/556',
        },
        messages: {
            unknownTokenOverride:
                'Unknown design token override "{{token}}" is forbidden by {{ruleName}}. Game overrides may only redefine tokens declared in the engine token set (@chimera-engine/renderer/styles/tokens.css).',
        },
        schema: [
            {
                type: 'object',
                properties: {
                    tokensCssPath: { type: 'string' },
                },
                additionalProperties: false,
            },
        ],
    },

    create(context) {
        if (!isTokenOverrideFile(context.filename)) {
            return {};
        }

        const tokensCssPath = resolveTokensCssPath(context.options[0] as RuleOptions | undefined);

        return {
            StyleSheet(node: Rule.Node) {
                const declaredTokens = loadDeclaredTokens(tokensCssPath);
                const sourceCode = context.sourceCode as SourceCodeLike;

                for (const match of sourceCode.text.matchAll(TOKEN_DECLARATION_PATTERN)) {
                    const token = match[1];
                    if (!token || declaredTokens.has(token)) continue;

                    context.report({
                        node,
                        messageId: 'unknownTokenOverride',
                        data: { ruleName: RULE_NAME, token },
                    });
                }
            },
        };
    },
};

export default rule;
