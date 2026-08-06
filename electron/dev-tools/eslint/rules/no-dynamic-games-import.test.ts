/**
 * electron/dev-tools/eslint/rules/no-dynamic-games-import.test.ts
 *
 * Unit tests for the `chimera/no-dynamic-games-import` ESLint rule using
 * Vitest + ESLint RuleTester.
 *
 * The rule carries NO path predicate — the flat-config `files` glob decides
 * which zones it guards — so every case here is about the SPECIFIER, and the
 * filenames are incidental. Two properties it has to hold:
 *
 *   - a dynamic `import()` naming a game reports, in every form the sibling
 *     game-import rules already classify: an `apps/`/`games/` path segment and
 *     a non-engine `@chimera-engine/*` package, quoted or written as a
 *     no-substitution template;
 *   - a static import does NOT report. The static position is `no-restricted-imports`'
 *     job in these zones; a second report on the same line would be noise, and
 *     making this rule cover both would hide which guard is actually load-bearing.
 */

import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from './no-dynamic-games-import.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    languageOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

ruleTester.run('chimera/no-dynamic-games-import', rule, {
    // ── Valid — rule must NOT fire ───────────────────────────────────────────
    valid: [
        // The STATIC positions belong to no-restricted-imports in every zone
        // that declares this rule. Covering them here too would double-report
        // and blur which guard holds the line.
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `import { rules } from '../../apps/tactics/simulation/rules.js';`,
        },
        {
            filename: 'renderer/hooks/useThing.ts',
            code: `export { rules } from '@chimera-engine/tactics/rules.js';`,
        },
        {
            filename: 'renderer/hooks/useThing.ts',
            code: `export * from '../apps/tactics/rules.js';`,
        },

        // Dynamic imports of NON-game modules — the ordinary case, and the one
        // that must stay silent for the rule to be usable in these zones at all.
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import('./ActionPipeline.js');`,
        },
        {
            filename: 'renderer/hooks/useThing.ts',
            code: `const m = await import('@chimera-engine/simulation/foundation/logging.js');`,
        },
        {
            filename: 'networking/provider/local/server/LobbyServer.ts',
            code: `const m = await import('@chimera-engine/simulation/engine/index.js');`,
        },
        // Engine packages share the @chimera-engine/* scope with games; the
        // allowlist — not a substring — is what separates them.
        {
            filename: 'electron/preload/api.ts',
            code: `const m = await import('@chimera-engine/electron/main/index.js');`,
        },
        // Both segment anchors. A prefix lookalike…
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import('../../webapps/thing.js');`,
        },
        // …and a suffix one.
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import('./gamestate.js');`,
        },

        // A sibling game reached by a relative path whose TEXT carries no
        // `apps/` segment. Not a gap this rule opens: `no-restricted-imports`
        // matches the same literal specifier text, so its `apps/*` group misses
        // this form in the static position too. The two guards agree, which is
        // the property this rule exists to hold.
        {
            filename: 'apps/tactics/simulation/rules.ts',
            code: `const m = await import('../../other-game/simulation/rules.js');`,
        },

        // A specifier ASSEMBLED at runtime names no one module, so there is
        // nothing to classify. Both shapes: a bare identifier and a template
        // with a substitution.
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import(specifier);`,
        },
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import(\`../../\${dir}/tactics/rules.js\`);`,
        },
        // The same shape with a GAME in the leading quasi. Load-bearing: the
        // case above passes even if the substitution conjunct is dropped, since
        // its first quasi (`../../`) classifies as nothing. Here the first quasi
        // names a game, so a reader that took it for the whole specifier would
        // report — and this rule is where "assembled at runtime names no one
        // module" is documented, so it is where that has to be held.
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import(\`../../apps/\${game}/rules.js\`);`,
        },
        // A non-STRING literal specifier. Unreachable from typechecked TS, but
        // it is what separates `typeof source === 'string'` from a mere
        // defined-check: under the looser test the classifier is handed a number
        // and crashes on `.replace`, so the rule dies instead of ignoring it.
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import(5);`,
        },
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import(null);`,
        },
    ],

    // ── Invalid — rule MUST fire ─────────────────────────────────────────────
    invalid: [
        // A simulation/ module lazily loading a game — the case the rule exists
        // for, and the one the zone gate's mutation check turns on.
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import('../../apps/tactics/simulation/rules.js');`,
            errors: [{ messageId: 'dynamicGamesImport' }],
        },
        // The same, from the other zones that ban the static form.
        {
            filename: 'renderer/hooks/useGameThing.ts',
            code: `const m = await import('../apps/tactics/screens/Board.js');`,
            errors: [{ messageId: 'dynamicGamesImport' }],
        },
        {
            filename: 'electron/preload/apis/game-api.ts',
            code: `const m = await import('@chimera-engine/tactics/actions.js');`,
            errors: [{ messageId: 'dynamicGamesImport' }],
        },
        {
            filename: 'networking/provider/local/server/LobbyServer.ts',
            code: `const m = await import('apps/tactics/rules.js');`,
            errors: [{ messageId: 'dynamicGamesImport' }],
        },
        {
            filename: 'ai/engine/scheduler.ts',
            code: `const m = await import('../../apps/tactics/ai/heuristics.js');`,
            errors: [{ messageId: 'dynamicGamesImport' }],
        },
        // A game's own gameplay code reaching a SIBLING game.
        {
            filename: 'apps/tactics/simulation/rules.ts',
            code: `const m = await import('../../../apps/other-game/simulation/rules.js');`,
            errors: [{ messageId: 'dynamicGamesImport' }],
        },
        // The legacy games/ home stays rejected.
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import('../../games/tactics/rules.js');`,
            errors: [{ messageId: 'dynamicGamesImport' }],
        },
        // A no-substitution TEMPLATE resolves to exactly one module, so one
        // swapped quote character must not walk a game past the guard.
        {
            filename: 'simulation/engine/StateReducer.ts',
            code: `const m = await import(\`../../apps/tactics/simulation/rules.js\`);`,
            errors: [{ messageId: 'dynamicGamesImport' }],
        },
        {
            filename: 'renderer/hooks/useGameThing.ts',
            code: `const m = await import(\`@chimera-engine/tactics\`);`,
            errors: [{ messageId: 'dynamicGamesImport' }],
        },
    ],
});
