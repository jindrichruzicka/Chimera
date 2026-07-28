/**
 * electron/dev-tools/eslint/rules/no-unknown-token-overrides.test.ts
 *
 * Unit tests for the `chimera/no-unknown-token-overrides` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * Architecture reference: §4.35 — UI Design System
 * Invariant #85: game token override files may only redefine tokens declared
 * in the engine token set.
 *
 * Every case injects `tokensCssPath` at a checked-in fixture. The rule's
 * production default resolves `@chimera-engine/renderer/styles/tokens.css`,
 * which lands on renderer's BUILT dist — and this suite runs without building
 * the packages, so depending on that resolution would red on a clean tree and
 * would re-red whenever the design system gained or lost a token. The default
 * resolution is graded separately, against the compiled artifact.
 *
 * The fixture is not a subset of the engine's token set in either direction —
 * see its own header. That is what makes the injection observable: with a
 * mirrored fixture, honouring the injected path and ignoring it produce
 * identical results, and every case below would pass against a rule that
 * silently read the engine's tokens instead.
 */

import css from '@eslint/css';
import { Linter, RuleTester } from 'eslint';
import type { ESLint } from 'eslint';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import rule from './no-unknown-token-overrides.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    language: 'css/css',
    plugins: { css: css as unknown as ESLint.Plugin },
});

const ruleName = 'chimera/no-unknown-token-overrides';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureTokensCss = resolve(__dirname, '../__test-support__/tokens.css');
const altTokensCss = resolve(__dirname, '../__test-support__/tokens-alt.css');
const options = [{ tokensCssPath: fixtureTokensCss }];

const OVERRIDE_FILE = 'apps/tactics/styles/tokens-override.css';

ruleTester.run('chimera/no-unknown-token-overrides', rule, {
    valid: [
        {
            filename: OVERRIDE_FILE,
            options,
            code: `:root {
    --ch-color-surface: #1b1a17;
    --ch-color-accent: #c9a84c;
    --ch-radius-md: 2px;
}`,
        },
        {
            // Declared by the FIXTURE and by no engine stylesheet. A rule that
            // ignored the injected path would report this.
            filename: OVERRIDE_FILE,
            options,
            code: `:root {
    --ch-fixture-only-token: 3px;
}`,
        },
        {
            filename: 'renderer/styles/tokens.css',
            options,
            code: `:root {
    --ch-new-engine-token: 1px;
}`,
        },
        {
            filename: 'apps/tactics/screens/TacticsOverlay.module.css',
            options,
            code: `.overlay {
    --ch-local-test-token: 1px;
}`,
        },
    ],
    invalid: [
        {
            filename: OVERRIDE_FILE,
            options,
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
            // A real ENGINE token the fixture deliberately omits. A rule that
            // ignored the injected path would fall silent here.
            filename: OVERRIDE_FILE,
            options,
            code: `:root {
    --ch-color-surface-raised: #1b1a17;
}`,
            errors: [
                {
                    messageId: 'unknownTokenOverride',
                    data: { ruleName, token: '--ch-color-surface-raised' },
                },
            ],
        },
        {
            filename: OVERRIDE_FILE,
            options,
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

describe('base token set resolution', () => {
    it('answers from the injected stylesheet, independently per path', () => {
        // Two fixtures with disjoint token sets, linted in ONE process. Under a
        // single-slot memo — which is what the rule carried while the path was
        // a constant — whichever set was parsed first would answer for both,
        // and every assertion here would come out inverted for the second path.
        const code = `:root {
    --ch-fixture-only-token: 1px;
    --ch-alt-only-token: 2px;
}`;

        expect(lintOverride(code, fixtureTokensCss)).toEqual(['--ch-alt-only-token']);
        expect(lintOverride(code, altTokensCss)).toEqual(['--ch-fixture-only-token']);

        // And back, so a memo that simply overwrote one slot on every read —
        // giving the right answer whenever the paths happen to alternate — is
        // not mistaken for one that caches.
        expect(lintOverride(code, fixtureTokensCss)).toEqual(['--ch-alt-only-token']);
    });

    it('rejects an unknown rule option instead of ignoring it', () => {
        // `additionalProperties: false` on the schema. Without it a misspelled
        // `tokenscsspath` is accepted and silently ignored, and the rule reads
        // the engine token set while the caller believes it injected one.
        const verifyWith = (ruleOptions: Record<string, string>): void => {
            new Linter().verify(
                ':root { --ch-color-surface: #000; }',
                [
                    {
                        files: ['**/*.css'],
                        language: 'css/css',
                        plugins: {
                            css: css as unknown as ESLint.Plugin,
                            chimera: { rules: { 'no-unknown-token-overrides': rule } },
                        },
                        rules: {
                            'chimera/no-unknown-token-overrides': ['error', ruleOptions],
                        },
                    },
                ],
                OVERRIDE_FILE,
            );
        };

        expect(() => verifyWith({ tokensCssPathTypo: fixtureTokensCss })).toThrow(
            /tokensCssPathTypo/u,
        );
        // The correctly-spelled option must still be accepted — otherwise the
        // assertion above would also pass against a schema that rejects
        // everything.
        expect(() => verifyWith({ tokensCssPath: fixtureTokensCss })).not.toThrow();
    });
});

/** Runs the rule directly over one override file, returning the flagged tokens. */
function lintOverride(code: string, tokensCssPath: string): readonly string[] {
    const reported: string[] = [];
    const visitors = rule.create({
        filename: OVERRIDE_FILE,
        options: [{ tokensCssPath }],
        sourceCode: { text: code },
        report(descriptor: { data?: Record<string, string> }) {
            const token = descriptor.data?.['token'];
            if (token !== undefined) reported.push(token);
        },
    } as never);

    const visitStyleSheet = (visitors as Record<string, ((node: unknown) => void) | undefined>)[
        'StyleSheet'
    ];
    visitStyleSheet?.({});

    return reported;
}
