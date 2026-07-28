/**
 * electron/dev-tools/eslint/index.ts
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
 * Exported NAMED, with no default. Both consumers — the monorepo's own root
 * config and the games-facing preset — compose against `{ chimeraPlugin }`, and
 * a default export is the failure that hides: `plugins: { chimera: undefined }`
 * is not an error ESLint raises, it is a plugin with no rules, and every
 * `chimera/*` rule quietly stops firing.
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
