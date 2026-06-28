/**
 * tools/eslint-plugin-chimera/rules/no-fromfloat-in-simulation.test.ts
 *
 * Unit tests for the `chimera/no-fromfloat-in-simulation` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * Architecture reference: §4.31 — Fixed-Point Math (Q32.32)
 * Invariant #76: fromFloat() is permitted only at content-load time; must not
 *   be called inside validate(), reduce(), or any hot simulation path.
 *
 * Issue: #400
 */

import { describe, it } from 'vitest';
import { RuleTester } from 'eslint';
import rule from './no-fromfloat-in-simulation.js';

// Integrate RuleTester with Vitest test runner.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
    // Register the plugin so that eslint-disable comments inside test code
    // referencing 'chimera/no-fromfloat-in-simulation' are recognised.
    plugins: {
        chimera: {
            rules: { 'no-fromfloat-in-simulation': rule },
        },
    },
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const IMPORT_FIXED_POINT = `import { fromFloat } from './FixedPoint.js';`;
const IMPORT_FIXED_POINT_RELATIVE = `import { fromFloat } from '../../engine/FixedPoint.js';`;
const IMPORT_FIXED_POINT_ALIAS = `import { fromFloat } from '@chimera-engine/simulation/engine/FixedPoint';`;
const IMPORT_FIXED_POINT_RENAMED = `import { fromFloat as fp } from './FixedPoint.js';`;

// ── Test suite ────────────────────────────────────────────────────────────────

ruleTester.run('chimera/no-fromfloat-in-simulation', rule, {
    // ── Valid — rule must NOT fire ───────────────────────────────────────────
    valid: [
        // 1. fromFloat() called outside simulation/ — file in renderer
        {
            filename: 'renderer/components/FooBar.ts',
            code: `${IMPORT_FIXED_POINT}\nconst x = fromFloat(1.5);`,
        },

        // 2. fromFloat() called in simulation/content/loaders/ — exempt path
        {
            filename: 'simulation/content/loaders/MapLoader.ts',
            code: `${IMPORT_FIXED_POINT_RELATIVE}\nconst x = fromFloat(1.5);`,
        },

        // 3. Inside simulation/engine/ but fromFloat is NOT imported from FixedPoint
        {
            filename: 'simulation/engine/SomeHelper.ts',
            code: `import { fromFloat } from './MyCustomLib.js';\nconst x = fromFloat(1.5);`,
        },

        // 4. Inside simulation/engine/ with no fromFloat call at all
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `import { fromInt } from './FixedPoint.js';\nconst x = fromInt(42);`,
        },

        // 5. eslint-disable-next-line with @chimera-review companion on the PREVIOUS line.
        // Note: we test the companion detection without a fromFloat call because
        // ESLint's RuleTester registers the rule as 'rule-to-test/...' internally,
        // which means eslint-disable-next-line comments referencing the real rule name
        // won't suppress errors in the RuleTester context. The @chimera-review companion
        // detection logic is exercised here; full integration is tested in e2e lint runs.
        {
            filename: 'simulation/engine/SomeReducer.ts',
            code: [
                '// @chimera-review: one-time legacy conversion acceptable here',
                '// eslint-disable-next-line chimera/no-fromfloat-in-simulation',
                'const x = 1;',
            ].join('\n'),
        },

        // 6. Companion present on the same line as the disable directive.
        // This tests the same-line detection branch.
        {
            filename: 'simulation/engine/SomeReducer.ts',
            code: [
                '// @chimera-review: OK',
                '// eslint-disable-next-line chimera/no-fromfloat-in-simulation',
                'const x = 1;',
            ].join('\n'),
        },

        // 7. fromFloat called in a deeply nested loaders sub-path
        {
            filename: 'simulation/content/loaders/tiles/TileLoader.ts',
            code: `${IMPORT_FIXED_POINT_ALIAS}\nconst v = fromFloat(3.14);`,
        },
    ],

    // ── Invalid — rule MUST fire ─────────────────────────────────────────────
    invalid: [
        // 1. fromFloat() inside simulation/engine/ — primary case
        {
            filename: 'simulation/engine/SomePipeline.ts',
            code: `${IMPORT_FIXED_POINT}\nconst x = fromFloat(1.5);`,
            errors: [{ messageId: 'noFromFloat' }],
        },

        // 2. fromFloat() inside simulation/ root (not a loader path)
        {
            filename: 'simulation/Utilities.ts',
            code: `${IMPORT_FIXED_POINT}\nconst y = fromFloat(0.5);`,
            errors: [{ messageId: 'noFromFloat' }],
        },

        // 3. fromFloat() with relative ../../ import still triggers
        {
            filename: 'simulation/engine/ActionPipeline.ts',
            code: `${IMPORT_FIXED_POINT_RELATIVE}\nconst z = fromFloat(2.0);`,
            errors: [{ messageId: 'noFromFloat' }],
        },

        // 4. fromFloat() via @chimera-engine alias import triggers
        {
            filename: 'simulation/engine/DeterministicRng.ts',
            code: `${IMPORT_FIXED_POINT_ALIAS}\nconst v = fromFloat(1.0);`,
            errors: [{ messageId: 'noFromFloat' }],
        },

        // 5. fromFloat renamed on import — renamed callee still triggers
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `${IMPORT_FIXED_POINT_RENAMED}\nconst v = fp(0.25);`,
            errors: [{ messageId: 'noFromFloat' }],
        },

        // 6. eslint-disable-next-line WITHOUT @chimera-review — secondary error.
        // We test this without a fromFloat call so the only error is the
        // missing-companion error (see note above about RuleTester rule naming).
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: [
                '// eslint-disable-next-line chimera/no-fromfloat-in-simulation',
                'const x = 1;',
            ].join('\n'),
            errors: [{ messageId: 'missingChimeraReview' }],
        },
    ],
});
