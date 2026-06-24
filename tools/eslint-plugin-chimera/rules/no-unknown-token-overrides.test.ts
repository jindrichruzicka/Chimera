/**
 * tools/eslint-plugin-chimera/rules/no-unknown-token-overrides.test.ts
 *
 * Unit tests for the `chimera/no-unknown-token-overrides` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * Architecture reference: §4.35 — UI Design System
 * Invariant #85: game token override files may only redefine tokens declared
 * in renderer/styles/tokens.css.
 *
 * Issue: #556
 */

import css from '@eslint/css';
import { RuleTester } from 'eslint';
import type { ESLint } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-unknown-token-overrides.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    language: 'css/css',
    plugins: { css: css as unknown as ESLint.Plugin },
});

const ruleName = 'chimera/no-unknown-token-overrides';

ruleTester.run('chimera/no-unknown-token-overrides', rule, {
    valid: [
        {
            filename: 'apps/tactics/styles/tokens-override.css',
            code: `:root {
    --ch-color-surface: #1b1a17;
    --ch-color-accent: #c9a84c;
    --ch-radius-md: 2px;
}`,
        },
        {
            filename: 'renderer/styles/tokens.css',
            code: `:root {
    --ch-new-engine-token: 1px;
}`,
        },
        {
            filename: 'apps/tactics/screens/TacticsOverlay.module.css',
            code: `.overlay {
    --ch-local-test-token: 1px;
}`,
        },
    ],
    invalid: [
        {
            filename: 'apps/tactics/styles/tokens-override.css',
            code: `:root {
    --ch-color-surface: #1b1a17;
    --ch-new-game-token: 1px;
}`,
            errors: [
                {
                    messageId: 'unknownTokenOverride',
                    data: { ruleName, token: '--ch-new-game-token' },
                },
            ],
        },
        {
            filename: 'apps/tactics/styles/tokens-override.css',
            code: `:root {
    --ch-unknown-a: 1px;
    --ch-unknown-b: 2px;
}`,
            errors: [
                { messageId: 'unknownTokenOverride', data: { ruleName, token: '--ch-unknown-a' } },
                { messageId: 'unknownTokenOverride', data: { ruleName, token: '--ch-unknown-b' } },
            ],
        },
    ],
});
