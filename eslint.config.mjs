// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import chimeraPlugin from './tools/eslint-plugin-chimera/plugin.cjs';
import nextPlugin from '@next/eslint-plugin-next';
import css from '@eslint/css';

const jsRecommendedRulesOff = Object.fromEntries(
    Object.keys(js.configs.recommended.rules).map((ruleId) => [ruleId, 'off']),
);
const typescriptEslintRulesOff = Object.fromEntries(
    [
        ...tseslint.configs.recommendedTypeChecked,
        ...tseslint.configs.stylisticTypeChecked,
        tseslint.configs.disableTypeChecked,
    ]
        .flatMap((config) => Object.keys(config.rules ?? {}))
        .map((ruleId) => [ruleId, 'off']),
);

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
 *   These require the `FixedPoint` module and `simulation/` tree to exist
 *   before they can be implemented and tested.
 */
export default tseslint.config(
    {
        ignores: [
            '**/node_modules/**',
            '**/dist/**',
            'build/**',
            'coverage/**',
            'renderer/out/**',
            'renderer/.next/**',
            // Per-app Next host build output (F65 Phase 2c): apps/<game>/renderer/{out,.next}.
            '**/.next/**',
            'apps/*/renderer/out/**',
            // electron-builder app-bundle output (#813): apps/<game>/release — generated installers/bundles.
            'apps/*/release/**',
            '**/*.d.ts',
            // Fixture files used by ESLint smoke tests; they intentionally violate lint rules.
            'simulation/engine/__tests__/fixtures/**',
            'ai/engine/__tests__/fixtures/**',
            'networking/__tests__/fixtures/**',
            'electron/main/__tests__/fixtures/**',
            'electron/preload/__tests__/fixtures/**',
            'renderer/__tests__/fixtures/**',
            // CJS bridge shim for eslint.config.mjs — uses require() / module.exports by design.
            'tools/eslint-plugin-chimera/plugin.cjs',
            // Playwright output directories — generated artefacts, not source.
            '.e2e-build/**',
            'apps/tactics/e2e/playwright-report/**',
            'test-results/**',
            // In-tree Electron bundle outputs — source lives in the adjacent .ts files.
            'electron/main/index.js',
            'electron/preload/api.js',
            // Scaffolding templates (create-chimera-game): a tokenised, game-agnostic
            // app skeleton (`@chimera-engine/__game_kebab__`, `__GamePascal__` identifiers),
            // bundled beside the CLI so the published initializer ships its own templates.
            // It is not valid source in place — its tokens are substituted into a real
            // `apps/<name>` before it lints/typechecks; the import-boundary rules run on
            // that generated app (the `apps/**` zones below), not on the raw template.
            'tools/create-chimera-game/templates/**',
            // Machine-generated toolchain snapshot (tools/gen-toolchain.ts) — a frozen data module
            // with JSON-style formatting; lint-ignored as a build artifact (it is still typechecked).
            'tools/create-chimera-game/toolchain.generated.ts',
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
                        'ai/engine/__tests__/fixtures/*.ts',
                        'networking/__tests__/fixtures/*.ts',
                        'electron/main/__tests__/fixtures/*.ts',
                        'electron/preload/__tests__/fixtures/*.ts',
                        'renderer/__tests__/fixtures/*.ts',
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
            // Allow bracket notation for index-signature properties (e.g. process.env['KEY']).
            // Aligns with TypeScript's noPropertyAccessFromIndexSignature: true.
            '@typescript-eslint/dot-notation': [
                'error',
                { allowIndexSignaturePropertyAccess: true },
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
                                'Do not reach across package boundaries with deep relative paths. Use @chimera-engine/* aliases.',
                        },
                    ],
                },
            ],
        },
    },

    // Simulation + AI layers: forbid non-deterministic globals.
    // docs/coding-standards.md §1.2, §7.
    {
        files: [
            'simulation/**/*.{ts,tsx}',
            'ai/**/*.{ts,tsx}',
            'apps/*/actions/**/*.{ts,tsx}',
            'apps/*/simulation/**/*.{ts,tsx}',
        ],
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
        },
    },

    // AI + game simulation layers (apps/*/simulation, legacy apps/*/actions):
    // forbid importing the UI/host/game/networking layers.
    // `@chimera-engine/ai` depends on `@chimera-engine/simulation` ONLY (Invariant #1):
    // now that the package is consumed through its `exports` map, the realistic
    // violation is the `@chimera-engine/<pkg>` workspace-alias form, so both the alias
    // and the legacy relative-path forms are forbidden. (simulation/ has its own
    // stricter zero-dependency leaf rule below.) See issue #764.
    {
        files: [
            'ai/**/*.{ts,tsx}',
            'apps/*/actions/**/*.{ts,tsx}',
            'apps/*/simulation/**/*.{ts,tsx}',
        ],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [
                                '@chimera-engine/networking',
                                '@chimera-engine/networking/*',
                                '@chimera-engine/renderer',
                                '@chimera-engine/renderer/*',
                                '@chimera-engine/electron',
                                '@chimera-engine/electron/*',
                                '@chimera-engine/tactics',
                                '@chimera-engine/tactics/*',
                                'renderer/*',
                                '**/renderer/*',
                                'electron/*',
                                '**/electron/*',
                                'networking/*',
                                '**/networking/*',
                                'apps/*',
                                '**/apps/*',
                            ],
                            message:
                                'ai/ and game simulation code (apps/*/simulation) must not import from networking, renderer, electron, or game-app aliases — @chimera-engine/simulation (plus sibling-relative game modules) is the only dependency (Invariant #1). See coding-standards.md §3, issue #764.',
                        },
                    ],
                },
            ],
        },
    },

    // `@chimera-engine/networking` depends on `@chimera-engine/simulation` ONLY (+ the
    // third-party `ws`) (Invariant #1): it must not import the AI/UI/host/game
    // layers. Now that the package is consumed through its `exports` map, the
    // realistic violation is the `@chimera-engine/<pkg>` workspace-alias form, so both
    // the alias and the legacy relative-path forms are forbidden. The barrel
    // exposes the provider/transport interfaces only; concrete providers stay
    // internal (Invariant #47). See issue #768.
    {
        files: ['networking/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [
                                '@chimera-engine/ai',
                                '@chimera-engine/ai/*',
                                '@chimera-engine/renderer',
                                '@chimera-engine/renderer/*',
                                '@chimera-engine/electron',
                                '@chimera-engine/electron/*',
                                '@chimera-engine/tactics',
                                '@chimera-engine/tactics/*',
                                'ai/*',
                                '**/ai/*',
                                'renderer/*',
                                '**/renderer/*',
                                'electron/*',
                                '**/electron/*',
                                'apps/*',
                                '**/apps/*',
                            ],
                            message:
                                'networking/ must not import from ai, renderer, electron, or game apps (apps/*) — @chimera-engine/simulation is its only @chimera-engine/* dependency (Invariant #1). The barrel exposes provider/transport interfaces only; concrete providers stay internal (Invariant #47). See coding-standards.md §3, issue #768.',
                        },
                    ],
                },
            ],
        },
    },

    // `@chimera-engine/simulation` is the zero-dependency engine leaf (Invariant #1): it
    // must not import ANY sibling workspace package — not ai, networking,
    // renderer, electron, or games. The foundation it absorbed (formerly
    // `@chimera-engine/shared`) now lives at `@chimera-engine/simulation/foundation`, so the
    // package declares no runtime dependencies; only the reserved `engine:`
    // namespace crosses cuts (Invariant #107). Test files are included on
    // purpose — a type-only back-edge in a test still makes the leaf non-pure.
    // See issue #759.
    {
        files: ['simulation/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [
                                '@chimera-engine/ai',
                                '@chimera-engine/ai/*',
                                '@chimera-engine/networking',
                                '@chimera-engine/networking/*',
                                '@chimera-engine/renderer',
                                '@chimera-engine/renderer/*',
                                '@chimera-engine/electron',
                                '@chimera-engine/electron/*',
                                'ai/*',
                                '**/ai/*',
                                'networking/*',
                                '**/networking/*',
                                'renderer/*',
                                '**/renderer/*',
                                'electron/*',
                                '**/electron/*',
                                'apps/*',
                                '**/apps/*',
                            ],
                            message:
                                '@chimera-engine/simulation is the zero-dependency engine leaf — it must not import from ai, networking, renderer, electron, or game apps (apps/*) (Invariant #1). Keep contracts in @chimera-engine/simulation/foundation; only the reserved engine: namespace crosses cuts (Invariant #107). See issue #759.',
                        },
                    ],
                },
            ],
        },
    },

    // `@chimera-engine/renderer` consumes the engine through `@chimera-engine/simulation`'s
    // type-only contract surface only (Invariant #1): it must not import the
    // `@chimera-engine/ai` or `@chimera-engine/networking` runtime — neither is a renderer
    // dependency. (The renderer↔`@chimera-engine/electron/preload` type-only contract is
    // a tolerated back-edge cleaned up in F62.) `renderer/**` is also wholly
    // game-agnostic (#784): it must not import any game — `@chimera-engine/tactics`, an
    // `apps/*` consumer path, or a legacy `games/*` path. The renderer host is a
    // runtime injection seam (`renderer/game/rendererGameRegistry.ts` →
    // `registerRendererGame`); a game's renderer contribution enters only at the
    // consumer-app renderer composition root (`apps/tactics/renderer/register.ts`),
    // selected by the synthetic `chimera-game-registration` build alias — never by
    // a renderer source import. The two public component barrels —
    // `@chimera-engine/renderer/components/ui` and `.../components/chat` — are the only
    // surface games may import (Invariant #96, enforced from the games side by
    // `chimera/no-game-renderer-internals`). Mirrors the leaf-package zones above;
    // like them it omits the global deep-relative ban, because renderer's own
    // deeply nested files legitimately reach package-internal modules with
    // relative paths — renderer code must not self-import through its public
    // `@chimera-engine/renderer/*` alias (that alias resolves only the two barrels).
    // See coding-standards.md §3, issues #772, #784.
    {
        files: ['renderer/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [
                                '@chimera-engine/ai',
                                '@chimera-engine/ai/*',
                                '@chimera-engine/networking',
                                '@chimera-engine/networking/*',
                                'ai/*',
                                '**/ai/*',
                                'networking/*',
                                '**/networking/*',
                            ],
                            message:
                                'renderer/ must not import the @chimera-engine/ai or @chimera-engine/networking runtime — the renderer depends on @chimera-engine/simulation contracts only (Invariant #1). Game-facing renderer code is exposed solely through @chimera-engine/renderer/components/ui and .../components/chat (Invariant #96). See coding-standards.md §3, issue #772.',
                        },
                        {
                            group: [
                                '@chimera-engine/tactics',
                                '@chimera-engine/tactics/*',
                                'apps/*',
                                'apps/**',
                                '**/apps/*',
                                '**/apps/**',
                                'games/*',
                                'games/**',
                                '**/games/*',
                                '**/games/**',
                            ],
                            message:
                                'renderer/ must name no game (Invariants #80, #94; #784). The renderer host is a runtime injection seam; a game enters only at the consumer-app renderer composition root (apps/tactics/renderer/register.ts), selected by the chimera-game-registration build alias — never by a renderer source import. See coding-standards.md §3, issue #784.',
                        },
                    ],
                },
            ],
        },
    },

    // `@chimera-engine/electron`'s preload bridge is the sole renderer-facing surface
    // (Invariant #5) and depends on the `@chimera-engine/simulation` contract surface ONLY
    // (Invariant #1): the contextBridge layer must not pull the renderer UI library,
    // the ai/networking runtime, a game package, or the electron main-process
    // internals into the sandboxed preload. Mirrors the per-package import zones
    // (ai/networking/renderer) and forbids both the `@chimera-engine/<pkg>` workspace-alias
    // form and the legacy relative-path form (the F59 lesson). The main-process
    // games + provider-internal boundaries are enforced separately on
    // `electron/main/**` (chimera/no-main-games-import, chimera/no-main-provider-internals).
    // See coding-standards.md §3, issue #777.
    {
        files: ['electron/preload/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: [
                                '@chimera-engine/ai',
                                '@chimera-engine/ai/*',
                                '@chimera-engine/networking',
                                '@chimera-engine/networking/*',
                                '@chimera-engine/renderer',
                                '@chimera-engine/renderer/*',
                                '@chimera-engine/tactics',
                                '@chimera-engine/tactics/*',
                                '@chimera-engine/electron/main',
                                '@chimera-engine/electron/main/*',
                                'ai/*',
                                '**/ai/*',
                                'networking/*',
                                '**/networking/*',
                                'renderer/*',
                                '**/renderer/*',
                                'apps/*',
                                '**/apps/*',
                                '../main/*',
                                '../../main/*',
                                '**/electron/main/*',
                            ],
                            message:
                                'electron/preload is the sole renderer-facing surface (Invariant #5) and depends on @chimera-engine/simulation contracts only (Invariant #1). It must not import the ai/networking runtime, the renderer UI library, a game package, or electron/main internals. See coding-standards.md §3, issue #777.',
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

    // The Playwright e2e suite (apps/tactics/e2e/, relocated under the tactics consumer
    // app in F63 #785) is test infrastructure that drives the running app over IPC
    // (Invariant #3). It legitimately reaches into electron main/preload SOURCE for the
    // shared constants it asserts on (CHIMERA_RENDERER_HOST, SYSTEM_QUIT_CHANNEL) — these
    // are internal, not part of @chimera-engine/electron's curated public exports, so they
    // cannot be imported through the package alias. Pre-move these were shallow
    // `../../electron/*` reaches under the global `../../../*` deep-relative ban; nesting
    // the suite three levels deeper pushed the identical reaches past that threshold.
    // Exempt the suite from the deep-relative import pattern; every other rule still
    // applies (the per-package boundary bans below never match apps/tactics/e2e/**).
    {
        files: ['apps/tactics/e2e/**/*.{ts,tsx}'],
        rules: {
            'no-restricted-imports': 'off',
        },
    },

    // Config / tooling JS files — no type-aware linting.
    {
        files: ['*.js', '*.mjs', '*.cjs', '**/*.cjs', 'eslint.config.js'],
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
                                'Do not reach across package boundaries with deep relative paths. Use @chimera-engine/* aliases.',
                        },
                        {
                            group: [
                                '**/ProfileSanitizer*',
                                '@chimera-engine/simulation/profile/ProfileSanitizer*',
                            ],
                            message:
                                'ProfileSanitizer.admit() must only be called from electron/main/profile/ProfileGate.ts (Invariant #61). Inject a ProfileGate instead.',
                        },
                    ],
                },
            ],
        },
    },

    // Invariant #76 — fromFloat() is only permitted at content-load time.
    // Enabled for simulation/**; overridden to 'off' for the loaders exemption path.
    // Rule implementation: tools/eslint-plugin-chimera/rules/no-fromfloat-in-simulation.ts
    // Issue: #400
    {
        files: ['simulation/**/*.{ts,tsx}'],
        plugins: { chimera: chimeraPlugin },
        rules: {
            'chimera/no-fromfloat-in-simulation': 'error',
        },
    },
    {
        files: ['simulation/content/loaders/**/*.{ts,tsx}'],
        rules: {
            'chimera/no-fromfloat-in-simulation': 'off',
        },
    },
    // Test files inside simulation/ may call fromFloat() to exercise the function
    // under test. They are not hot simulation paths (Invariant #76 applies to
    // validate()/reduce() calls, not test code).
    {
        files: ['simulation/**/*.test.{ts,tsx}', 'simulation/**/*.spec.{ts,tsx}'],
        rules: {
            'chimera/no-fromfloat-in-simulation': 'off',
        },
    },

    // Invariants #86 and #91 — renderer UI and game screens must use
    // `var(--ch-*)` tokens for design values instead of hardcoded literals.
    // Rule implementation: tools/eslint-plugin-chimera/rules/no-hardcoded-design-values.ts
    // Issue: #560
    {
        files: ['renderer/**/*.{ts,tsx,js,jsx,mjs}', 'apps/*/screens/**/*.{ts,tsx,js,jsx,mjs}'],
        plugins: { chimera: chimeraPlugin },
        rules: {
            'chimera/no-hardcoded-design-values': 'error',
        },
    },
    {
        files: [
            'renderer/styles/tokens.css',
            'renderer/styles/animations.css',
            'renderer/**/*.module.css',
            'apps/*/screens/**/*.module.css',
        ],
        language: 'css/css',
        plugins: { css, chimera: chimeraPlugin },
        rules: {
            ...jsRecommendedRulesOff,
            ...typescriptEslintRulesOff,
            'chimera/no-hardcoded-design-values': 'error',
        },
    },
    {
        files: ['apps/*/styles/tokens-override.css'],
        language: 'css/css',
        plugins: { css, chimera: chimeraPlugin },
        rules: {
            ...jsRecommendedRulesOff,
            ...typescriptEslintRulesOff,
            'chimera/no-unknown-token-overrides': 'error',
        },
    },
    {
        files: ['apps/**/*.{ts,tsx,js,jsx,mjs}'],
        plugins: { chimera: chimeraPlugin },
        rules: {
            'chimera/no-game-renderer-internals': 'error',
        },
    },

    // Next.js plugin scoped to the renderer package.
    {
        files: ['renderer/**/*.{ts,tsx,js,jsx,mjs}'],
        plugins: {
            '@next/next': nextPlugin,
        },
        rules: {
            ...nextPlugin.configs.recommended.rules,
            // Point the pages-link rule at the actual renderer app directory.
            '@next/next/no-html-link-for-pages': ['warn', 'renderer/app'],
        },
    },

    // Invariants #93/#94 — engine shell pages must not import game token override
    // CSS or any game-app (apps/*) path. Invariant #80 — GameShell.tsx /
    // InGameMenuHost.tsx stay game-agnostic; the GameScreenRegistry prop is the
    // sole coupling point.
    // The same rule guards both surface sets; #774 locks #80 across the
    // @chimera-engine/renderer package cut alongside the bash invariants Check 7.
    // Rule implementation: tools/eslint-plugin-chimera/rules/no-shell-games-import.ts
    // Issue: #561, #774
    {
        files: [
            'renderer/app/main-menu/**/*.{ts,tsx,js,jsx,mjs}',
            'renderer/app/lobby/**/*.{ts,tsx,js,jsx,mjs}',
            'renderer/app/game/**/*.{ts,tsx,js,jsx,mjs}',
            'renderer/app/settings/**/*.{ts,tsx,js,jsx,mjs}',
            'renderer/app/saves/**/*.{ts,tsx,js,jsx,mjs}',
            'renderer/app/component-gallery/**/*.{ts,tsx,js,jsx,mjs}',
            'renderer/app/debug/**/*.{ts,tsx,js,jsx,mjs}',
            'renderer/components/debug/**/*.{ts,tsx,js,jsx,mjs}',
            'renderer/components/shell/GameShell.{ts,tsx,js,jsx,mjs}',
            'renderer/components/shell/InGameMenuHost.{ts,tsx,js,jsx,mjs}',
        ],
        plugins: { chimera: chimeraPlugin },
        rules: {
            'chimera/no-shell-games-import': 'error',
        },
    },

    // Main-process boundaries — electron/main orchestration must stay agnostic of
    // (a) which games exist (packaged, multi-game builds, F18), and (b) which
    // concrete networking provider is in use (Invariant #47, issue #769).
    //   * no-main-games-import — no electron/main module may import `games/*`;
    //     since #788/#789 every game seam (actions, content schemas, lobby setup)
    //     arrives via the injected MainGameContribution, so no in-package
    //     composition registries remain exempt.
    //   * no-main-provider-internals — orchestration imports the public barrel
    //     interfaces (@chimera-engine/networking) only; the concrete provider is wired
    //     solely in the composition root electron/main/index.ts.
    // Both rules exempt test fixtures (no-main-provider-internals also exempts its
    // sole composition point, index.ts). Mirrors
    // `no-shell-games-import` + rendererGameRegistry on the renderer side.
    // Rule implementations: tools/eslint-plugin-chimera/rules/no-main-*.ts
    {
        files: ['electron/main/**/*.{ts,tsx}'],
        plugins: { chimera: chimeraPlugin },
        rules: {
            'chimera/no-main-games-import': 'error',
            'chimera/no-main-provider-internals': 'error',
        },
    },

    // Prettier compatibility — must be last.
    prettier,
);
