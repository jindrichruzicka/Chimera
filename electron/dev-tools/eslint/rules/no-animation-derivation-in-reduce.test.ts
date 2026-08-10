/**
 * electron/dev-tools/eslint/rules/no-animation-derivation-in-reduce.test.ts
 *
 * Unit tests for the `chimera/no-animation-derivation-in-reduce` ESLint rule
 * using Vitest + ESLint RuleTester (typescript-eslint parser: the annotated
 * `reduce(state: S, action: A): S` method shapes the rule must REPORT are TS
 * syntax espree cannot parse).
 *
 * Feature F82 — Animation System, docs/roadmap-sections/m10-first-public-release-v1.0.0.md.
 *
 * The property under test has two independent halves, and both are exercised in
 * both directions: WHAT is called (the two window-derivation functions, and
 * nothing else) and WHERE it is called from (lexically inside a function NAMED
 * `reduce` or `validate` — never a callback merely handed to `Array#reduce`).
 *
 * Both halves match a NAME at the site, so both have a computed form the rule
 * declines to guess at and an alias form it cannot see — four limits. Those are
 * limits, not accidents, and each of the four has a `valid` fixture: a limit
 * asserted only in prose stops being true silently.
 */

import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, it } from 'vitest';
import rule from './no-animation-derivation-in-reduce.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
    languageOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2022,
        sourceType: 'module',
    },
});

const IMPORT_WINDOWS = `import { beatsForRealSeconds, compileAnimationWindows } from '../content/animationWindows.js';`;
const IMPORT_WINDOWS_NAMESPACE = `import * as windows from '../content/animationWindows.js';`;

ruleTester.run('chimera/no-animation-derivation-in-reduce', rule, {
    // ── Valid — rule must NOT fire ───────────────────────────────────────────
    valid: [
        // 1. The sanctioned site: module scope in a content module. This is the
        //    call the rule exists to PROTECT, so it is the first fixture.
        {
            filename: 'apps/tactics/simulation/content/animations.ts',
            code: `${IMPORT_WINDOWS}\nexport const WINDOWS = compileAnimationWindows(SHEET, 'wave', 50);`,
        },

        // 2. Module scope, the other guarded function.
        {
            filename: 'simulation/content/pacing.ts',
            code: `${IMPORT_WINDOWS}\nexport const BEATS = beatsForRealSeconds(1, 50, 1000);`,
        },

        // 3. A callback handed to `Array#reduce`. The arrow is an ARGUMENT of a
        //    call whose callee is named `reduce`; it is not itself a function
        //    named `reduce`, and reading it as one is the false positive this
        //    rule's name invites.
        {
            filename: 'simulation/content/pacing.ts',
            code: `${IMPORT_WINDOWS}\nexport const total = xs.reduce((acc, x) => acc + beatsForRealSeconds(x, 50, 1000), 0);`,
        },

        // 4. A function whose name merely STARTS with a guarded name.
        {
            filename: 'simulation/content/pacing.ts',
            code: `${IMPORT_WINDOWS}\nconst validateSheet = () => compileAnimationWindows(SHEET, 'wave', 50);`,
        },

        // 5. A reducer that calls something else entirely.
        {
            filename: 'simulation/engine/reducers.ts',
            code: `export function reduce(state: number): number {\n    return clamp(state);\n}`,
        },

        // 6. A method named `reduce` on a receiver, invoked from inside a
        //    reducer — the CALLEE name is what is guarded, not every member call.
        {
            filename: 'simulation/engine/reducers.ts',
            code: `export function reduce(state: number[]): number {\n    return state.reduce((a, b) => a + b, 0);\n}`,
        },

        // 7. A named import of the guarded symbol with no call at all.
        {
            filename: 'simulation/engine/reducers.ts',
            code: `${IMPORT_WINDOWS}\nexport const ref = compileAnimationWindows;`,
        },

        // 8. A computed member callee. The name is a runtime value, so the rule
        //    reads it as no name rather than guessing at the identifier's text
        //    — deleting that guard makes this fixture report.
        {
            filename: 'simulation/engine/reducers.ts',
            code: `${IMPORT_WINDOWS_NAMESPACE}\nexport function reduce(state: S): S {\n    windows[compileAnimationWindows](1, 50, 1000);\n    return state;\n}`,
        },

        // 9. A computed IDENTIFIER key. Its `['reduce']` string-literal sibling
        //    is invalid fixture 9 and routes through the literal branch, so
        //    this is the only fixture that reaches the computed guard in
        //    `keyName` — without it, deleting that guard stays green.
        {
            filename: 'apps/tactics/simulation/actions/strike.ts',
            code: `${IMPORT_WINDOWS}\nexport const strike = {\n    [reduce]: (state: S) => compileAnimationWindows(SHEET, 'wave', 50),\n};`,
        },

        // 10. The measured LIMIT of matching at the call site: an aliased
        //     import is not reported. Recorded as a fixture rather than as a
        //     sentence in the header, because a stated limit and a measured one
        //     drift apart the moment the matcher changes.
        {
            filename: 'simulation/engine/reducers.ts',
            code: `import { compileAnimationWindows as compile } from '../content/animationWindows.js';\nexport function reduce(state: S): S {\n    compile(SHEET, 'wave', 50);\n    return state;\n}`,
        },

        // 11. The same limit through a local binding.
        {
            filename: 'simulation/engine/reducers.ts',
            code: `${IMPORT_WINDOWS}\nconst compile = compileAnimationWindows;\nexport function reduce(state: S): S {\n    compile(SHEET, 'wave', 50);\n    return state;\n}`,
        },

        // 12. The WHERE half's matching alias limit: a body declared under
        //     another name and only REFERENCED as `reduce`. Containment is
        //     lexical, and lexically this body is `reduceStrike`. Nothing under
        //     `simulation/**` or `apps/*/simulation/**` is written this way
        //     today, which is why the limit is recorded rather than closed.
        {
            filename: 'apps/tactics/simulation/actions/strike.ts',
            code: `${IMPORT_WINDOWS}\nfunction reduceStrike(state: S): S {\n    compileAnimationWindows(SHEET, 'wave', 50);\n    return state;\n}\nexport const strike = { reduce: reduceStrike };`,
        },
    ],

    // ── Invalid — rule MUST fire ─────────────────────────────────────────────
    invalid: [
        // 1. A plain reducer function declaration.
        {
            filename: 'simulation/engine/reducers.ts',
            code: `${IMPORT_WINDOWS}\nexport function reduce(state: S, action: A): S {\n    const w = compileAnimationWindows(SHEET, 'wave', 50);\n    return state;\n}`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 2. A `validate` function declaration, the other guarded body.
        {
            filename: 'apps/tactics/simulation/actions/strike.ts',
            code: `${IMPORT_WINDOWS}\nexport function validate(action: A): string | null {\n    return beatsForRealSeconds(action.seconds, 50, 1000) > 0 ? null : 'no';\n}`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 3. An object-literal method — the shape an action definition uses.
        {
            filename: 'apps/tactics/simulation/actions/strike.ts',
            code: `${IMPORT_WINDOWS}\nexport const strike = {\n    reduce(state: S): S {\n        compileAnimationWindows(SHEET, 'wave', 50);\n        return state;\n    },\n};`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 4. An object-literal property holding an arrow.
        {
            filename: 'apps/tactics/simulation/actions/strike.ts',
            code: `${IMPORT_WINDOWS}\nexport const strike = {\n    validate: (action: A) => compileAnimationWindows(SHEET, 'wave', 50),\n};`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 5. A class method.
        {
            filename: 'simulation/engine/ActionPipeline.ts',
            code: `${IMPORT_WINDOWS}\nexport class Pipeline {\n    validate(action: A): void {\n        beatsForRealSeconds(1, 50, 1000);\n    }\n}`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 6. A class field holding an arrow.
        {
            filename: 'simulation/engine/ActionPipeline.ts',
            code: `${IMPORT_WINDOWS}\nexport class Pipeline {\n    reduce = (state: S): S => {\n        compileAnimationWindows(SHEET, 'wave', 50);\n        return state;\n    };\n}`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 7. A `const` arrow — the reducer form a module-level definition uses.
        {
            filename: 'apps/tactics/ai/policy.ts',
            code: `${IMPORT_WINDOWS}\nconst validate = (action: A) => beatsForRealSeconds(1, 50, 1000);`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 8. A prototype assignment — the name lives on the assignment target.
        {
            filename: 'simulation/engine/ActionPipeline.ts',
            code: `${IMPORT_WINDOWS}\nPipeline.prototype.reduce = function (state) {\n    return compileAnimationWindows(SHEET, 'wave', 50);\n};`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 9. A computed string key — `{ ['reduce']: … }` is the same body under
        //    a syntax the key reader has to unwrap separately.
        {
            filename: 'apps/tactics/simulation/actions/strike.ts',
            code: `${IMPORT_WINDOWS}\nexport const strike = {\n    ['reduce']: (state: S) => compileAnimationWindows(SHEET, 'wave', 50),\n};`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 10. Nested one level down: a helper arrow declared INSIDE the reducer
        //     body. Lexical containment is the property, not the immediately
        //     enclosing function.
        {
            filename: 'simulation/engine/reducers.ts',
            code: `${IMPORT_WINDOWS}\nexport function reduce(state: S): S {\n    const derive = () => compileAnimationWindows(SHEET, 'wave', 50);\n    derive();\n    return state;\n}`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 11. A namespace member call — the same derivation reached through
        //     `import * as`.
        {
            filename: 'simulation/engine/reducers.ts',
            code: `${IMPORT_WINDOWS_NAMESPACE}\nexport function reduce(state: S): S {\n    windows.beatsForRealSeconds(1, 50, 1000);\n    return state;\n}`,
            errors: [{ messageId: 'noAnimationDerivation' }],
        },

        // 12. Both guarded functions in one reducer body report SEPARATELY —
        //     the rule reports per call site, so fixing one leaves the other lit.
        {
            filename: 'simulation/engine/reducers.ts',
            code: `${IMPORT_WINDOWS}\nexport function reduce(state: S): S {\n    compileAnimationWindows(SHEET, 'wave', 50);\n    beatsForRealSeconds(1, 50, 1000);\n    return state;\n}`,
            errors: [
                { messageId: 'noAnimationDerivation' },
                { messageId: 'noAnimationDerivation' },
            ],
        },
    ],
});
