// @ts-check
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
// The COMPILED plugin from the published package — the same artifact a
// standalone game gets, so the monorepo's own enforcement and a consumer's are
// the same code.
//
// This resolves onto `electron/dist`, so the package must be BUILT. The root
// `lint` script and both CI lint steps run `build:packages` first; the entry
// points that do not (`lint:fix`, `pnpm --filter <pkg> lint`, an editor's
// ESLint server) fail loudly on a missing dist — but a STALE one is silent, and
// since the rules themselves now come from dist, that means linting against
// yesterday's rule logic. Rebuild after editing anything under
// `electron/dev-tools/eslint/`.
import { chimeraPlugin } from '@chimera-engine/electron/eslint';
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
 *   - Determinism guard via `no-restricted-syntax` scoped to simulation/ai paths
 *     (see docs/coding-standards.md §7, §1.2).
 *   - The nine `chimera/*` architecture rules, loaded as compiled JS from
 *     `@chimera-engine/electron/eslint` — the same artifact a standalone game
 *     composes through `standaloneLintConfig()` (see §3, §4.32).
 *
 * A note on `no-restricted-imports`, which most of the boundary work rests on:
 * which specifier positions it visits — and which it does not — is stated in
 * `tools/eslint-dynamic-games-import-zone.test.ts`, which pins the one that
 * matters here (`import()`, which it never visits). The consequence
 * here is that every zone below whose group names a game also declares
 * `chimera/no-dynamic-games-import`, whose classifier is
 * `electron/dev-tools/eslint/game-path.ts` rather than the group beside it, so
 * neither guard subsumes the other. The sibling-package specifiers in those
 * groups (`renderer/*`, `networking/*`, `electron/*`, `@chimera-engine/ai`, …)
 * stay static-only, deliberately: a game dependency is the boundary these zones
 * exist to hold, and widening the dynamic arm past it is its own change.
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
            // electron-builder app-bundle output: apps/<game>/release — generated installers/bundles.
            'apps/*/release/**',
            '**/*.d.ts',
            // Fixture files used by the ESLint smoke tests, which lint them
            // explicitly with `--no-ignore`. Most violate a rule on purpose;
            // some are the negative control that must not.
            'simulation/engine/__tests__/fixtures/**',
            'ai/engine/__tests__/fixtures/**',
            'networking/__tests__/fixtures/**',
            'electron/main/__tests__/fixtures/**',
            'electron/preload/__tests__/fixtures/**',
            'renderer/__tests__/fixtures/**',
            // Per-game gameplay lint fixtures — determinism, fromFloat, and the
            // import boundaries in both specifier positions.
            'apps/*/simulation/__tests__/fixtures/**',
            'apps/*/ai/__tests__/fixtures/**',
            'apps/*/content/__tests__/fixtures/**',
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
                        // Per-game determinism/fromFloat fixtures are excluded from the
                        // app tsconfig program (they intentionally import an unresolvable
                        // deep specifier to trip the rule), so — like the sibling fixtures
                        // above — the project service lints them via the default inferred
                        // project rather than a named one.
                        'apps/*/simulation/__tests__/fixtures/*.ts',
                        'apps/*/ai/__tests__/fixtures/*.ts',
                        'apps/*/content/__tests__/fixtures/*.ts',
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
            //
            // Flat config resolves one value per rule, last matching block wins,
            // and pattern arrays are never merged — so a block below that
            // re-declares `no-restricted-imports` WITH options and does not
            // repeat this group drops it. Severity alone is the exception: a
            // block supplying only `'off'`/`'error'` keeps the options already
            // resolved, which is how the e2e suite turns this group off rather
            // than replacing it (pinned in the test named next).
            // `tools/eslint-deep-relative-import-ban.test.ts` enumerates every
            // block that sets the rule and holds each to a stated disposition —
            // repeats the group, or `renderer/**`, or the e2e suite's `'off'` —
            // so a block added later reds until it is classified there.
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
            'apps/*/ai/**/*.{ts,tsx}',
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

    // `@chimera-engine/ai` and the game-side code that shares its dependency
    // profile — a game's gameplay tree, its content descriptors and its settings
    // schema — forbid importing the UI/host/game/networking layers.
    // `@chimera-engine/ai` depends on `@chimera-engine/simulation` ONLY (coding-standards §3):
    // now that the package is consumed through its `exports` map, the realistic
    // violation is the `@chimera-engine/<pkg>` workspace-alias form, so both the alias
    // and the legacy relative-path forms are forbidden. (simulation/ has its own
    // stricter zero-dependency leaf rule below.)
    //
    // The content and settings-schema globs are here because their headers state
    // this boundary and, before these globs joined, nothing enforced its
    // electron and networking half (the renderer half is held by
    // `chimera/no-game-renderer-internals` on the `apps/**` zone). Their
    // workspace imports already honour the boundary, so the ban is a ratchet,
    // not a migration.
    {
        files: [
            'ai/**/*.{ts,tsx}',
            'apps/*/actions/**/*.{ts,tsx}',
            'apps/*/simulation/**/*.{ts,tsx}',
            'apps/*/ai/**/*.{ts,tsx}',
            'apps/*/content/**/*.{ts,tsx}',
            'apps/*/settings-schema.{ts,tsx}',
        ],
        plugins: { chimera: chimeraPlugin },
        rules: {
            // The `import()` position of the game ban — see the file header.
            'chimera/no-dynamic-games-import': 'error',
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
                                'ai/ and per-game code must not import from networking, renderer, electron, or game-app aliases. See coding-standards.md §3.',
                        },
                        // Repeated from the base block above.
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

    // Most of the app ROOT (`apps/<game>/*.ts`, one level deep) is covered by no
    // import zone at all, and one root file now legitimately reaches for
    // `@chimera-engine/electron`: `asset-manifest.test.ts`, for the published
    // asset-fact readers at `@chimera-engine/electron/test-support` (§3).
    //
    // That edge is DEV-TIME ONLY, and the distinction is load-bearing rather than
    // stylistic: `asset-manifest.ts` sits beside its test and is imported by
    // `renderer/loaders.ts`, so the same import one file over would pull the
    // main-process package into the renderer bundle. Tests are exempted below;
    // production root files are not, which is what makes "test only" mechanical.
    //
    // TWO exemptions, and the second is the subtle one:
    //
    //   *.test.ts — the files the electron edge exists for.
    //
    //   settings-schema.ts — ALREADY covered, by the ai/game zone above (its
    //   `files` list ends with `apps/*/settings-schema.{ts,tsx}`, which is also
    //   one level deep). Flat config resolves ONE value per rule, last block
    //   wins, so matching that file here would REPLACE its group with this
    //   block's — silently un-banning networking, the game aliases and the
    //   relative-path forms, while `pnpm lint` stayed green
    //   because `chimera/no-game-renderer-internals` still caught the renderer
    //   half. Leaving it to the zone above loses nothing: that group already
    //   bans `@chimera-engine/electron` and `@chimera-engine/electron/*`.
    //
    // For the same last-block-wins reason the base block's `../../../*` group is
    // REPEATED below rather than inherited. `eslint-app-root-import-zone.test.ts`
    // pins the resolved patterns per file, because none of this is visible to a
    // lint run — only to `--print-config`.
    {
        files: ['apps/*/*.{ts,tsx}'],
        ignores: ['apps/*/*.test.{ts,tsx}', 'apps/*/settings-schema.{ts,tsx}'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['@chimera-engine/electron', '@chimera-engine/electron/*'],
                            message:
                                "A game's production code must not import @chimera-engine/electron — it is the main-process package, and an app-root module reaches the renderer bundle. The test-support readers are for *.test.ts only. See coding-standards.md §3.",
                        },
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

    // `@chimera-engine/networking` depends on `@chimera-engine/simulation` ONLY (+ the
    // third-party `ws`) (Invariant #1): it must not import the AI/UI/host/game
    // layers. Now that the package is consumed through its `exports` map, the
    // realistic violation is the `@chimera-engine/<pkg>` workspace-alias form, so both
    // the alias and the legacy relative-path forms are forbidden. The barrel
    // exposes the provider/transport interfaces only; concrete providers stay
    // internal (Invariant #47).
    {
        files: ['networking/**/*.{ts,tsx}'],
        plugins: { chimera: chimeraPlugin },
        rules: {
            // The `import()` position of the game ban — see the file header.
            'chimera/no-dynamic-games-import': 'error',
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
                                'networking/ must not import from ai, renderer, electron, or game apps (apps/*) — @chimera-engine/simulation is its only @chimera-engine/* dependency. The barrel exposes provider/transport interfaces only; concrete providers stay internal (Invariant #47). See coding-standards.md §3.',
                        },
                        // Repeated from the base block above.
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

    // `@chimera-engine/simulation` is the zero-dependency engine leaf (Invariant #1): it
    // must not import ANY sibling workspace package — not ai, networking,
    // renderer, electron, or games. The foundation it absorbed (formerly
    // `@chimera-engine/shared`) now lives at `@chimera-engine/simulation/foundation`, so the
    // package needs no workspace dependency at all, and has zero runtime
    // dependencies on React, DOM, or networking (Invariant #1).
    // Only the reserved `engine:` namespace crosses cuts (Invariant #107). Test files are included on
    // purpose — a type-only back-edge in a test still makes the leaf non-pure.
    {
        files: ['simulation/**/*.{ts,tsx}'],
        plugins: { chimera: chimeraPlugin },
        rules: {
            // The `import()` position of the game ban — see the file header.
            'chimera/no-dynamic-games-import': 'error',
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
                                '@chimera-engine/simulation is the zero-dependency engine leaf — it must not import from ai, networking, renderer, electron, or game apps (apps/*). Keep contracts in @chimera-engine/simulation/foundation; only the reserved engine: namespace crosses cuts (Invariant #107).',
                        },
                        // Repeated from the base block above.
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

    // `@chimera-engine/renderer` consumes the engine through `@chimera-engine/simulation`'s
    // type-only contract surface only (Invariant #1): it must not import the
    // `@chimera-engine/ai` or `@chimera-engine/networking` runtime — neither is a renderer
    // dependency. (The renderer↔`@chimera-engine/electron/preload` type-only contract is
    // a tolerated back-edge cleaned up in F62.) `renderer/**` is also wholly
    // game-agnostic: it must not import any game — `@chimera-engine/tactics`, an
    // `apps/*` consumer path, or a legacy `games/*` path. The renderer host is a
    // runtime injection seam (`renderer/game/rendererGameRegistry.ts` →
    // `registerRendererGame`); a game's renderer contribution enters only at the
    // consumer-app renderer composition root (`apps/tactics/renderer/register.ts`),
    // selected by the synthetic `chimera-game-registration` build alias — never by
    // a renderer source import. What a game may import from renderer is decided
    // by `chimera/no-game-renderer-internals` (Invariant #96), which enumerates
    // it — restating the set here has gone stale once already.
    //
    // This zone declares the rule at `'error'` WITHOUT the base block's
    // `../../../*` group, and the leaf zones above are no precedent for it —
    // they repeat it and lint clean. Renderer cannot: its own deeply nested
    // files reach package-internal modules three levels up
    // (`app/replays/player/page.tsx` → `../../../i18n/useTranslate`), and
    // renderer code must not self-import through its public
    // `@chimera-engine/renderer/*` alias, which resolves only what renderer's
    // `exports` map publishes. The pattern cannot separate those from an escape:
    // the specifier is identical either way, and only the depth of the importing
    // file — which `no-restricted-imports` never sees — decides which it is. The
    // property the group would have held is measured instead, in
    // `tools/eslint-deep-relative-import-ban.test.ts`: every deep-relative
    // specifier in renderer source, outside the globally lint-ignored fixtures,
    // is resolved against the package root and asserted to land inside it.
    // See coding-standards.md §3.
    {
        files: ['renderer/**/*.{ts,tsx}'],
        plugins: { chimera: chimeraPlugin },
        rules: {
            // The `import()` position of the game ban — see the file header.
            // Wherever `chimera/no-shell-games-import`'s zone intersects this
            // one, both rules RESOLVE at error severity on the same file (the
            // zone suite's reach check pins that on a shell page). Left
            // overlapping on purpose: carving out the intersection would copy
            // that rule's zone globs into a second place, and a drifting
            // exclusion list is worse than a second accurate message.
            'chimera/no-dynamic-games-import': 'error',
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
                                'renderer/ must not import the @chimera-engine/ai or @chimera-engine/networking runtime — the renderer depends on @chimera-engine/simulation contracts only (Invariant #1). Game-facing renderer code is exposed through the surfaces chimera/no-game-renderer-internals permits (Invariant #96). See coding-standards.md §3.',
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
                                'renderer/ must name no game (Invariants #80, #94). The renderer host is a runtime injection seam; a game enters only at the consumer-app renderer composition root (apps/tactics/renderer/register.ts), selected by the chimera-game-registration build alias — never by a renderer source import. See coding-standards.md §3.',
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
    // See coding-standards.md §3.
    {
        files: ['electron/preload/**/*.{ts,tsx}'],
        plugins: { chimera: chimeraPlugin },
        rules: {
            // The `import()` position of the game ban — see the file header.
            'chimera/no-dynamic-games-import': 'error',
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
                                'electron/preload is the sole renderer-facing surface and depends on @chimera-engine/simulation contracts only. It must not import the ai/networking runtime, the renderer UI library, a game package, or electron/main internals. See coding-standards.md §3.',
                        },
                        // Repeated from the base block above.
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

    // Invariant #67 — no main-process module emits logs via raw `console.*`; all
    // structured logging flows through the injected Logger. Exactly one call site
    // takes the exception: the Invariant #27/#77 startup guard in
    // electron/main/index.ts, which must be the first statement in main() and so
    // runs before the root logger is constructed. It carries a targeted disable
    // plus the @chimera-review comment the invariant requires, which is what makes
    // this rule a ratchet rather than a formality — a second raw console call
    // cannot be added without an explicit, reviewable disable.
    //
    // NO `ignores`, deliberately. Test files are covered too: none of them call
    // `console.*` today (`vi.spyOn(console, 'error')` passes `console` as an
    // argument, not a member call, so the rule does not see it), and an `ignores`
    // entry for `__tests__/**` would also exempt `__tests__/fixtures/`, silently
    // neutering the smoke test in electron/main/__tests__/eslint-no-console.test.ts
    // that proves this zone is wired — a config-object `ignores` still applies
    // under `--no-ignore`, unlike the global ignores at the top of this file.
    // That test asserts this object's own shape AND the RESOLVED config of a file
    // from every subtree, not only the fixtures: an `ignores` added here, or a
    // subtree added to the GLOBAL ignores above, would otherwise disable the rule
    // where it matters while every fixture case still passed.
    //
    // Covers every module that runs in a main process: the engine's own tree and
    // each consumer composition root (`apps/*/electron/main.ts`, which calls
    // `main()`) — including a `--workspace` scaffold, which lands in `apps/`.
    // A STANDALONE scaffold is not covered and cannot be from here: it has its
    // own flat config, composing the engine's curated preset (`curated-rules.ts`),
    // which carries the games-side rules and not this engine-internal zone.
    //
    // Two neighbours are deliberately out, as a scope call rather than because
    // enforcement is impossible there. The preload layer would in fact ratchet
    // identically — Invariant #67(b) sanctions it, and it has exactly one
    // `console.*` call site today (`electron/preload/shared/listener.ts`), so one
    // targeted disable would do — but preload is a different layer with a
    // different logging story, and extending the ban there is its own change.
    // `apps/*/electron/build-main.ts` and the app-level verify scripts are the
    // genuine exclusion: Node build tooling that never runs in the app, whose
    // console output IS its interface. Sinks that write to stdout/stderr
    // (`createStdoutSink`, `createStderrSink`) are transport, not `console.*`,
    // and are unaffected.
    {
        files: ['electron/main/**/*.{ts,tsx}', 'apps/*/electron/main.ts'],
        rules: {
            'no-console': 'error',
        },
    },

    // Invariant #76 — fromFloat() is only permitted at content-load time.
    // Enabled for engine simulation/** AND per-game gameplay code
    // (apps/*/simulation/**, apps/*/ai/**); overridden to 'off' for the loaders
    // exemption path and test files. The rule's own path guard mirrors this zone
    // (fires on /simulation/ and apps/<game>/ai/), so both must stay in sync.
    // Rule implementation: electron/dev-tools/eslint/rules/no-fromfloat-in-simulation.ts
    {
        files: [
            'simulation/**/*.{ts,tsx}',
            'apps/*/simulation/**/*.{ts,tsx}',
            'apps/*/ai/**/*.{ts,tsx}',
        ],
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
    // Test files inside simulation/ and per-game gameplay dirs may call
    // fromFloat() to exercise the function under test. They are not hot paths
    // (Invariant #76 applies to validate()/reduce() calls, not test code).
    {
        files: [
            'simulation/**/*.test.{ts,tsx}',
            'simulation/**/*.spec.{ts,tsx}',
            'apps/*/simulation/**/*.test.{ts,tsx}',
            'apps/*/simulation/**/*.spec.{ts,tsx}',
            'apps/*/ai/**/*.test.{ts,tsx}',
            'apps/*/ai/**/*.spec.{ts,tsx}',
        ],
        rules: {
            'chimera/no-fromfloat-in-simulation': 'off',
        },
    },

    // Invariants #86 and #91 — renderer UI and game screens must use
    // `var(--ch-*)` tokens for design values instead of hardcoded literals.
    // Rule implementation: electron/dev-tools/eslint/rules/no-hardcoded-design-values.ts
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
            // Invariant #127 — GameCanvas is the only canvas root a game mounts.
            'chimera/no-raw-r3f-canvas': 'error',
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
    // Rule implementation: electron/dev-tools/eslint/rules/no-shell-games-import.ts
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
    // concrete networking provider is in use (Invariant #47).
    //   * no-main-games-import — no electron/main module may import a game, by
    //     an `apps/`/`games/` path segment or a non-engine `@chimera-engine/*`;
    //     since #788/#789 every game seam (actions, content schemas, lobby setup)
    //     arrives via the injected MainGameContribution, so no in-package
    //     composition registries remain exempt.
    //   * no-main-provider-internals — orchestration imports the public barrel
    //     interfaces (@chimera-engine/networking) only; the concrete provider is wired
    //     solely in the composition root electron/main/index.ts.
    // Both rules exempt test fixtures (no-main-provider-internals also exempts its
    // sole composition point, index.ts). Mirrors
    // `no-shell-games-import` + rendererGameRegistry on the renderer side.
    // Rule implementations: electron/dev-tools/eslint/rules/no-main-*.ts
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
