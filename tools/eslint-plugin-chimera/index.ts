/**
 * tools/eslint-plugin-chimera/index.ts
 *
 * ESLint plugin `eslint-plugin-chimera` — Chimera-specific lint rules.
 *
 * Registered rules:
 *   - `chimera/no-fromfloat-in-simulation` (Invariant #76)
 *   - `chimera/no-hardcoded-design-values` (Invariants #86, #91)
 *   - `chimera/no-unknown-token-overrides` (Invariant #85)
 *
 * Usage in eslint.config.mjs:
 *   import chimeraPlugin from './tools/eslint-plugin-chimera/index.js';
 *   // then inside tseslint.config(...):
 *   { plugins: { chimera: chimeraPlugin }, rules: { 'chimera/no-fromfloat-in-simulation': 'error' } }
 */

import noFromFloatInSimulation from './rules/no-fromfloat-in-simulation.js';
import noHardcodedDesignValues from './rules/no-hardcoded-design-values.js';
import noUnknownTokenOverrides from './rules/no-unknown-token-overrides.js';
import noShellGamesImport from './rules/no-shell-games-import.js';

const plugin = {
    rules: {
        'no-fromfloat-in-simulation': noFromFloatInSimulation,
        'no-hardcoded-design-values': noHardcodedDesignValues,
        'no-unknown-token-overrides': noUnknownTokenOverrides,
        'no-shell-games-import': noShellGamesImport,
    },
} as const;

export default plugin;
