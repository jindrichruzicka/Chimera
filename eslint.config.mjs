// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

/**
 * Chimera ESLint configuration (flat config, ESLint 9).
 *
 * Scope of this config:
 *   - Generic TypeScript quality rules (typescript-eslint recommended + type-checked).
 *   - Module-boundary enforcement via `no-restricted-imports`
 *     (see docs/coding-standards.md §3).
 *   - Determinism guard via `no-restricted-globals` scoped to simulation/ai paths
 *     (see docs/coding-standards.md §7, §1.2).
 *
 * Explicitly deferred (tracked under roadmap F04 / F20):
 *   - `chimera/no-restricted-globals` custom rule
 *   - `chimera/no-fromfloat-in-simulation` custom rule
 *   These require the `FixedPoint` module and `simulation/` tree to exist
 *   before they can be implemented and tested.
 */
export default tseslint.config(
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'build/**',
            'coverage/**',
            'renderer/out/**',
            'renderer/.next/**',
            '**/*.d.ts',
            // Fixture files used by ESLint smoke tests; they intentionally violate lint rules.
            'simulation/engine/__tests__/fixtures/**',
        ],
    },

    // Base JS recommended rules.
    js.configs.recommended,

    // TypeScript: recommended + type-checked.
    ...tseslint.configs.recommendedTypeChecked,
    ...tseslint.configs.stylisticTypeChecked,

    // Project-wide TypeScript settings.
    {
        files: ['**/*.{ts,tsx,mts,cts}'],
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: [
                        '*.ts',
                        '*.mts',
                        '*.cts',
                        'simulation/engine/__tests__/fixtures/*.ts',
                    ],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            // Forbidden per docs/coding-standards.md §1.2.
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/no-misused-promises': 'error',
            '@typescript-eslint/consistent-type-imports': [
                'error',
                { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
            ],
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^_',
                    varsIgnorePattern: '^_',
                    caughtErrorsIgnorePattern: '^_',
                },
            ],

            // Module boundaries — docs/coding-standards.md §3.
            // The patterns reference directories that will exist as the engine
            // lands; until then they are inert (no matching imports yet).
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['../../../*'],
                            message:
                                'Do not reach across package boundaries with deep relative paths. Use @chimera/* aliases.',
                        },
                    ],
                },
            ],
        },
    },

    // Simulation + AI layers: forbid non-deterministic globals.
    // docs/coding-standards.md §1.2, §7.
    {
        files: ['simulation/**/*.{ts,tsx}', 'ai/**/*.{ts,tsx}', 'games/*/actions/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-syntax': [
                'error',
                {
                    selector:
                        "CallExpression[callee.object.name='Math'][callee.property.name='random']",
                    message: 'Math.random is forbidden in simulation/ and ai/. Use ctx.rng.',
                },
                {
                    selector:
                        "CallExpression[callee.object.name='Date'][callee.property.name='now']",
                    message: 'Date.now is forbidden in simulation/ and ai/. Use snapshot.tick.',
                },
                {
                    selector: "MemberExpression[object.name='performance'][property.name='now']",
                    message:
                        'performance.now is forbidden in simulation/ and ai/. Use snapshot.tick.',
                },
                // Invariant — ActionSchemaError must only be thrown from StateReducer.ts.
                // Prevents re-introduction of the duplicated try/catch that was
                // centralised in refactor(simulation): centralize parsePayload schema wrapping.
                // Use StateReducer.parsePayloadOrThrow() instead.
                // StateReducer.ts itself is exempted via @chimera-review + eslint-disable-next-line.
                {
                    selector: "ThrowStatement > NewExpression[callee.name='ActionSchemaError']",
                    message:
                        'ActionSchemaError must only be thrown in simulation/engine/StateReducer.ts. Use StateReducer.parsePayloadOrThrow() to route schema errors through the single authoritative site.',
                },
            ],
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [
                                'renderer/*',
                                '**/renderer/*',
                                'electron/*',
                                '**/electron/*',
                                'games/*',
                                '**/games/*',
                            ],
                            message:
                                'simulation/ and ai/ must not import from renderer, electron, or games. See coding-standards.md §3.',
                        },
                    ],
                },
            ],
        },
    },

    // Test files: relax a few rules that are noisy in test scaffolding.
    {
        files: ['**/*.test.{ts,tsx}', '**/*.spec.{ts,tsx}', 'test/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unsafe-assignment': 'off',
            '@typescript-eslint/no-unsafe-member-access': 'off',
            '@typescript-eslint/no-unsafe-call': 'off',
            '@typescript-eslint/no-unsafe-argument': 'off',
            '@typescript-eslint/no-unsafe-return': 'off',
            // vitest's `expect(mockFn)` pattern intentionally passes method
            // references around; unbound-method is pure noise in test code.
            '@typescript-eslint/unbound-method': 'off',
            // Empty stub functions and async stubs without await are common in
            // test scaffolding and do not indicate real code quality issues.
            '@typescript-eslint/no-empty-function': 'off',
            '@typescript-eslint/require-await': 'off',
        },
    },

    // Config / tooling JS files — no type-aware linting.
    {
        files: ['*.js', '*.mjs', '*.cjs', 'eslint.config.js'],
        ...tseslint.configs.disableTypeChecked,
    },

    // Invariant #61 — ProfileSanitizer.admit() may only be called from
    // electron/main/profile/ProfileGate.ts. All other electron/main/ modules
    // must inject a ProfileGate rather than importing admit() directly.
    {
        files: ['electron/main/**/*.{ts,tsx}'],
        ignores: ['electron/main/profile/ProfileGate.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['../../../*'],
                            message:
                                'Do not reach across package boundaries with deep relative paths. Use @chimera/* aliases.',
                        },
                        {
                            group: [
                                '**/ProfileSanitizer*',
                                '@chimera/simulation/profile/ProfileSanitizer*',
                            ],
                            message:
                                'ProfileSanitizer.admit() must only be called from electron/main/profile/ProfileGate.ts (Invariant #61). Inject a ProfileGate instead.',
                        },
                    ],
                },
            ],
        },
    },

    // Prettier compatibility — must be last.
    prettier,
);
