/**
 * electron/dev-tools/eslint/index.ts
 *
 * The `chimera` ESLint plugin — Chimera-specific lint rules. Published as
 * `chimeraPlugin` at the `@chimera-engine/electron/eslint` subpath; there is no
 * `eslint-plugin-chimera` package, and the repo-root tsx-shim tree that used to
 * load these is retired (`tools/root-eslint-config.test.ts` keeps it retired).
 *
 * Registered rules:
 *   - `chimera/no-fromfloat-in-simulation` (Invariant #76)
 *   - `chimera/no-hardcoded-design-values` (Invariants #86, #91)
 *   - `chimera/no-unknown-token-overrides` (Invariant #85)
 *   - `chimera/no-game-renderer-internals` (game renderer UI boundary)
 *   - `chimera/no-shell-games-import` (Invariants #93, #94)
 *   - `chimera/no-main-games-import` (main-process game boundary)
 *   - `chimera/no-main-provider-internals` (main-process networking provider boundary, Invariant #47)
 *
 * Exported NAMED, with no default: consumers compose against
 * `{ chimeraPlugin }`, so the export shape is API. Getting it wrong is loud
 * rather than silent — ESLint 9 refuses a config whose plugin is `undefined`
 * ('Key "chimera": Expected an object') and refuses one whose plugin lacks a
 * configured rule ('Could not find "…" in plugin "chimera"').
 *
 * Usage:
 *   import { chimeraPlugin } from '@chimera-engine/electron/eslint';
 *   // then inside a flat config:
 *   { plugins: { chimera: chimeraPlugin }, rules: { 'chimera/no-fromfloat-in-simulation': 'error' } }
 */

import noFromFloatInSimulation from './rules/no-fromfloat-in-simulation.js';
import noGameRendererInternals from './rules/no-game-renderer-internals.js';
import noHardcodedDesignValues from './rules/no-hardcoded-design-values.js';
import noUnknownTokenOverrides from './rules/no-unknown-token-overrides.js';
import noShellGamesImport from './rules/no-shell-games-import.js';
import noMainGamesImport from './rules/no-main-games-import.js';
import noMainProviderInternals from './rules/no-main-provider-internals.js';

export const chimeraPlugin = {
    rules: {
        'no-fromfloat-in-simulation': noFromFloatInSimulation,
        'no-game-renderer-internals': noGameRendererInternals,
        'no-hardcoded-design-values': noHardcodedDesignValues,
        'no-unknown-token-overrides': noUnknownTokenOverrides,
        'no-shell-games-import': noShellGamesImport,
        'no-main-games-import': noMainGamesImport,
        'no-main-provider-internals': noMainProviderInternals,
    },
} as const;

// The games-facing preset lives beside the plugin and ships from the same
// subpath, so a game needs one import to get both.
export { standaloneLintConfig, type StandaloneLintConfigOptions } from './preset.js';
