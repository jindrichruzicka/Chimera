/**
 * tools/eslint-plugin-chimera/plugin.cjs
 *
 * CommonJS bridge that loads the TypeScript plugin source at runtime via tsx.
 * Used ONLY by eslint.config.mjs, which is loaded by Node.js without a TypeScript
 * transpiler. The actual rule logic lives in index.ts / rules/*.ts — this file is
 * a thin runtime shim.
 *
 * Why CJS?  eslint.config.mjs is ESM but ESM can import CJS; it cannot
 * synchronously import TypeScript (.ts) files directly in Node.js.
 */

// Register tsx CJS transform so that require('./index.ts') works.
require('tsx/cjs');

const plugin = require('./index.ts');
// Handle both `export default` (ESM) and plain CJS exports.
module.exports = plugin.default ?? plugin;
