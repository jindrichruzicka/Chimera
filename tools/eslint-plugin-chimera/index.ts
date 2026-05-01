/**
 * tools/eslint-plugin-chimera/index.ts
 *
 * ESLint plugin `eslint-plugin-chimera` — Chimera-specific lint rules.
 *
 * Registered rules:
 *   - `chimera/no-fromfloat-in-simulation` (Invariant #76)
 *
 * Usage in eslint.config.mjs:
 *   import chimeraPlugin from './tools/eslint-plugin-chimera/index.js';
 *   // then inside tseslint.config(...):
 *   { plugins: { chimera: chimeraPlugin }, rules: { 'chimera/no-fromfloat-in-simulation': 'error' } }
 */

import noFromFloatInSimulation from './rules/no-fromfloat-in-simulation.js';

const plugin = {
    rules: {
        'no-fromfloat-in-simulation': noFromFloatInSimulation,
    },
} as const;

export default plugin;
