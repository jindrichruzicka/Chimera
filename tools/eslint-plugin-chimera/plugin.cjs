/**
 * tools/eslint-plugin-chimera/plugin.cjs
 *
 * TRANSITIONAL. The rule sources now live at `electron/dev-tools/eslint/`
 * inside the published `@chimera-engine/electron`; this file is all that
 * remains here, and it exists only so the root `eslint.config.mjs` keeps
 * resolving the same plugin object across the relocation. It is retired
 * together with this directory when the root config is repointed at the
 * compiled `@chimera-engine/electron/eslint` subpath.
 *
 * Why CJS: `eslint.config.mjs` is ESM, and ESM can import CJS but cannot
 * synchronously import TypeScript. Hence the tsx CJS transform below — the
 * hack this relocation exists to remove, kept alive one task longer so `lint`
 * never goes red mid-move.
 */

// Register tsx CJS transform so that require()ing TypeScript source works.
require('tsx/cjs');

// Named export, no default: the plugin object is `chimeraPlugin`. Reaching for
// `.default` here would hand the root config `undefined`, which ESLint accepts
// as a plugin with no rules — every `chimera/*` rule silently off.
const { chimeraPlugin } = require('../../electron/dev-tools/eslint/index.ts');

if (chimeraPlugin === undefined) {
    throw new Error(
        'electron/dev-tools/eslint/index.ts does not export `chimeraPlugin`; the root ESLint config would register a plugin with no rules.',
    );
}

module.exports = chimeraPlugin;
