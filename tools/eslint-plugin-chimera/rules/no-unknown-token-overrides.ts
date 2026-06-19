/**
 * tools/eslint-plugin-chimera/rules/no-unknown-token-overrides.ts
 *
 * ESLint rule: `chimera/no-unknown-token-overrides`
 *
 * Flags game token override custom properties that are not declared in the
 * canonical renderer/styles/tokens.css token set.
 *
 * Architecture reference: §4.35 — UI Design System
 * Invariant #85
 * Issue: #556
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Rule } from 'eslint';

interface SourceCodeLike {
    readonly text: string;
}

const RULE_NAME = 'chimera/no-unknown-token-overrides';
const TOKEN_DECLARATION_PATTERN = /(?:^|[\s{;])(--ch-[\w-]+)\s*:/gmu;

// Resolve the canonical token file relative to this rule's own location rather
// than process.cwd(), so the rule works when ESLint runs from any directory —
// e.g. `pnpm -r lint` runs `eslint .` with cwd set to each workspace package.
const TOKENS_CSS_PATH = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../renderer/styles/tokens.css',
);

let cachedDeclaredTokens: ReadonlySet<string> | undefined;

function normalizeFilename(filename: string): string {
    return filename.replace(/\\/gu, '/');
}

function isTokenOverrideFile(filename: string): boolean {
    return /(?:^|[/])games[/][^/]+[/]styles[/]tokens-override\.css$/u.test(
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

function loadDeclaredTokens(): ReadonlySet<string> {
    cachedDeclaredTokens ??= extractDeclaredTokens(readFileSync(TOKENS_CSS_PATH, 'utf8'));
    return cachedDeclaredTokens;
}

const rule: Rule.RuleModule = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Disallow game token override declarations that are absent from renderer/styles/tokens.css.',
            url: 'https://github.com/jindrichruzicka/Chimera/issues/556',
        },
        messages: {
            unknownTokenOverride:
                'Unknown design token override "{{token}}" is forbidden by {{ruleName}}. Game overrides may only redefine tokens declared in renderer/styles/tokens.css.',
        },
        schema: [],
    },

    create(context) {
        if (!isTokenOverrideFile(context.filename)) {
            return {};
        }

        return {
            StyleSheet(node: Rule.Node) {
                const declaredTokens = loadDeclaredTokens();
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
