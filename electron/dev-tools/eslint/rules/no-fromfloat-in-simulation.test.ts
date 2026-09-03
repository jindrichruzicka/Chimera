/**
 * electron/dev-tools/eslint/rules/no-fromfloat-in-simulation.test.ts
 *
 * Unit tests for the `chimera/no-fromfloat-in-simulation` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * Architecture reference: §4.31 — Fixed-Point Math (Q32.32)
 * Invariant #76: fromFloat() is permitted only at content-load time; must not
 *   be called inside validate(), reduce(), or any hot simulation path.
 *
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

        // 8. Engine AI (a bare `ai/` path) is NOT a fromFloat-forbidden zone —
        // parity with the engine fromFloat config zone, which is simulation-only.
        // Only per-game AI (apps/<game>/ai/) fires; a bare `ai/` path must not.
        {
            filename: 'ai/engine/AIController.ts',
            code: `${IMPORT_FIXED_POINT_ALIAS}\nconst v = fromFloat(1.0);`,
        },

        // 9. `APP_AI_PATH`'s SEGMENT anchor `(?:^|\/)`, on the shape that has a
        // real-world trigger: `webapps/` merely ENDS in `apps`, so
        // `apps/tactics/ai/` sits inside it as a substring. Drop the anchor and
        // this fires. The call is a real `fromFloat` from FixedPoint, so this
        // case can only pass because the zone check said no.
        {
            filename: '/repo/webapps/tactics/ai/tacticsPolicy.ts',
            code: `${IMPORT_FIXED_POINT_ALIAS}\nconst v = fromFloat(2.5);`,
        },

        // 10. `APP_AI_PATH`'s TRAILING `\/`: the zone is the per-game `ai/`
        // DIRECTORY, so a file sitting directly under `apps/<game>/` whose
        // NAME merely starts with `ai` is outside it. Drop the trailing slash
        // and `apps\/[^/]+\/ai` matches this filename, so it fires.
        //
        // Note this is NOT the sibling rules' shape: their predicate ends one
        // segment earlier, at `apps/<name>/`. `APP_AI_PATH` needs the `ai`
        // segment too, so a file directly under `apps/` misses both the
        // shipped regex and the mutant, and would pin nothing.
        {
            filename: 'apps/tactics/aiPolicy.ts',
            code: `${IMPORT_FIXED_POINT_ALIAS}\nconst w = fromFloat(0.75);`,
        },

        // 11. `APP_AI_PATH`'s app-name segment is SINGLE-segment (`[^/]+`): the
        // zone is the game's own top-level `ai/`, one directory under the app.
        // Widen it to `.+` and the match crosses slashes, so any nested `ai/`
        // anywhere inside a game app — here a renderer one — becomes a
        // forbidden zone.
        {
            filename: 'apps/tactics/renderer/ai/useAiHints.ts',
            code: `${IMPORT_FIXED_POINT_ALIAS}\nconst z = fromFloat(1.25);`,
        },

        // 12. `APP_AI_PATH`'s `ai` segment RIGHT BOUNDARY: the zone is the
        // per-game directory named exactly `ai`, so a sibling directory whose
        // name merely STARTS WITH `ai` (e.g. `aiHelpers/`, a plausible helper
        // dir that is NOT the sanctioned AI zone) sits outside it. Give the
        // `ai` segment a `[^/]*` suffix before its own trailing slash and
        // `apps\/[^/]+\/ai[^/]*\/` matches `aiHelpers/` too, so it fires.
        {
            filename: 'apps/tactics/aiHelpers/util.ts',
            code: `${IMPORT_FIXED_POINT_ALIAS}\nconst w = fromFloat(4.5);`,
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

        // 7. fromFloat() inside a per-game simulation hot path
        // (apps/<game>/simulation) — the path contains `/simulation/`, so the
        // guard fires as it does for the engine.
        {
            filename: 'apps/tactics/simulation/actions.ts',
            code: `${IMPORT_FIXED_POINT_ALIAS}\nconst v = fromFloat(1.5);`,
            errors: [{ messageId: 'noFromFloat' }],
        },

        // 8. fromFloat() inside a per-game AI path (apps/<game>/ai) — the guard
        // must fire here even though the path has no `/simulation/` segment.
        // This is the case the internal-guard widening exists for.
        {
            filename: 'apps/tactics/ai/tacticsPolicy.ts',
            code: `${IMPORT_FIXED_POINT_ALIAS}\nconst v = fromFloat(2.5);`,
            errors: [{ messageId: 'noFromFloat' }],
        },

        // 9. The same per-game AI path on a WINDOWS filename. The zone check
        // opens with `filename.replace(/\\/g, '/')` under a header claiming it
        // "normalises Windows backslashes", and every zone test downstream of it
        // — `APP_AI_PATH` and the `/simulation/` substring checks alike — is
        // `/`-separated. Drop that replace and the guard goes silently inert on
        // a Windows filename.
        {
            filename: 'C:\\repo\\apps\\tactics\\ai\\tacticsPolicy.ts',
            code: `${IMPORT_FIXED_POINT_ALIAS}\nconst v = fromFloat(2.5);`,
            errors: [{ messageId: 'noFromFloat' }],
        },
    ],
});
