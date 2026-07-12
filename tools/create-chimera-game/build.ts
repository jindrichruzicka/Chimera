/**
 * Build the publishable `create-chimera-game` bin: esbuild-bundle `index.ts` (and its sibling
 * pure modules — normalize / tokens / standalone / toolchain.generated) into a single
 * self-contained CommonJS `dist/index.js` with a `#!/usr/bin/env node` shebang, so end users run
 * it under plain `node` via `npm create chimera-game`.
 *
 * Output is ESM as `dist/index.mjs`: the CLI uses `import.meta.url` to locate its bundled
 * `templates/` at runtime, which esbuild only supports in `esm` output (a CJS bundle warns and
 * leaves `import.meta` undefined). Emitting a `.mjs` makes Node treat the bin as ESM regardless of
 * the package `type`, so the published package needs NO `"type": "module"` — which keeps the dev
 * surface (tsx + vitest, run as CommonJS under the root) and the cross-tool imports
 * (gen-toolchain / verify-scaffold consume these modules) completely unchanged. The bundle has no
 * runtime dependencies (only Node builtins), so the published package ships `dist` + `templates`
 * and nothing else.
 */

import { buildSync } from 'esbuild';
import { chmodSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(dir, 'dist', 'index.mjs');

buildSync({
    entryPoints: [path.join(dir, 'index.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    // The bin is invoked directly by Node, so it needs a shebang. Adding it via the esbuild banner
    // (not the source) keeps `index.ts` shebang-free for the tsx/vitest dev runs.
    banner: { js: '#!/usr/bin/env node' },
});

// npm sets the bin executable bit on install, but make the freshly-built file runnable locally too.
chmodSync(outfile, 0o755);

console.log(`[create-chimera-game build] wrote ${path.relative(dir, outfile)}`);
