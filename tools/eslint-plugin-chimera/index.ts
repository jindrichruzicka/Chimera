/**
 * tools/eslint-plugin-chimera/index.ts
 *
 * ESLint plugin `eslint-plugin-chimera` — Chimera-specific lint rules.
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
 * Usage in eslint.config.mjs:
 *   import chimeraPlugin from './tools/eslint-plugin-chimera/index.js';
 *   // then inside tseslint.config(...):
 *   { plugins: { chimera: chimeraPlugin }, rules: { 'chimera/no-fromfloat-in-simulation': 'error' } }
 */

import noFromFloatInSimulation from './rules/no-fromfloat-in-simulation.js';
import noGameRendererInternals from './rules/no-game-renderer-internals.js';
import noHardcodedDesignValues from './rules/no-hardcoded-design-values.js';
import noUnknownTokenOverrides from './rules/no-unknown-token-overrides.js';
import noShellGamesImport from './rules/no-shell-games-import.js';
import noMainGamesImport from './rules/no-main-games-import.js';
import noMainProviderInternals from './rules/no-main-provider-internals.js';

const plugin = {
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

export default plugin;
