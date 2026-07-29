// @ts-check
import css from '@eslint/css';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { standaloneLintConfig } from '@chimera-engine/electron/eslint';

/**
 * This game's lint config.
 *
 * The Chimera half is an OVERLAY: `standaloneLintConfig()` contributes the
 * engine's architecture rules mapped onto this app's directories — `fromFloat()`
 * out of `simulation/` and `ai/` (Invariant #76), design values through
 * `var(--ch-*)` tokens in `screens/` (Invariants #86/#91), only declared tokens
 * in `styles/tokens-override.css` (Invariant #85), and the renderer's public
 * barrels only (Invariant #96). Everything else below is yours to change.
 *
 * Two things are worth knowing before you edit it:
 *
 *   - `css` is passed explicitly. `@eslint/css` is an optional peer of the
 *     engine, so resolving it from your project rather than from inside
 *     `node_modules/@chimera-engine/electron` is the reliable direction.
 *   - `base` is a NAMED value and is handed to `silenceOnCss`. Two curated
 *     rules lint CSS, and a flat config applies every matching block — so a
 *     rule set with no `files` restriction also runs against the stylesheets,
 *     where a JS rule does not misreport but ABORTS the entire run. With the
 *     sets below the preset already covers it, so this is insurance rather
 *     than load-bearing today; it becomes load-bearing the moment you add a
 *     TYPE-CHECKED set (`recommendedTypeChecked`, `strictTypeChecked`,
 *     `stylisticTypeChecked`), which aborts on the first stylesheet without it.
 *     Keep the binding, and keep passing all of it. (The preset silences
 *     `js.configs.recommended` on its own when it can resolve `@eslint/js`
 *     from the engine package — which depends on your install layout, not on
 *     anything here.)
 *
 * There is deliberately NO type-aware linting here. None of the Chimera rules
 * read type information, and `parserOptions.projectService` reds a freshly
 * scaffolded game: `electron/main.ts`, `electron/build-main.ts`,
 * `electron/verify-packaged-bundle.ts` and this config itself sit outside the
 * app's `tsconfig.json` program, and the project service refuses any file it
 * cannot place. To turn it on, add the type-checked set AND list those four
 * under `projectService.allowDefaultProject` — the engine's own root config
 * does exactly that.
 *
 * This file is emitted for a STANDALONE project only. A game scaffolded into
 * the Chimera monorepo (`--workspace`) inherits the repo's root config, which
 * is the stricter of the two — see `STANDALONE_ONLY_TEMPLATE_FILES` in
 * `create-chimera-game` for why shipping this one there would take rules away.
 */
const base = [js.configs.recommended, ...tseslint.configs.recommended];

export default [
    {
        // Build and run output, at the paths this app's own configs write them.
        // Flat-config ignores anchor to THIS directory — unlike .gitignore, a
        // pattern containing a slash does not match at any depth — so each one
        // has to name where the artefact actually lands:
        //   renderer/out     `distDir` in renderer/next.config.ts
        //   e2e/playwright-*  `reporter` in e2e/playwright.config.ts
        //   e2e/test-results  Playwright's default outputDir
        //   .dev-userdata    per-instance dirs from `dev:mp` (Invariant #78)
        // A companion test pairs the config-declared entries against those
        // configs and names the rest as literals, because the cost of missing one
        // is not subtle: a single Playwright HTML report is a 400 KB bundled
        // file, and linting it reports over a thousand errors.
        ignores: [
            'dist/**',
            'release/**',
            'renderer/out/**',
            // Next writes `out` (the export, per distDir) AND `.next` (its own
            // type + server scratch) on every build. `distDir` moves the first
            // and not the second, so both are named.
            'renderer/.next/**',
            // Next OWNS this file and stamps it "should not be edited"; its own
            // triple-slash reference trips a rule the game did not write. The
            // monorepo needs no such entry — a blanket `**/*.d.ts` ignore sweeps
            // it up there, and this config has none.
            'renderer/next-env.d.ts',
            'e2e/playwright-report/**',
            'e2e/test-results/**',
            'e2e/results/**',
            '.dev-userdata/**',
        ],
    },
    ...base,
    ...standaloneLintConfig({ css, silenceOnCss: base }),
];
