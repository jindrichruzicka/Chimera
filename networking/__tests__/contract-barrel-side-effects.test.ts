/**
 * networking/__tests__/contract-barrel-side-effects.test.ts
 *
 * Asserts the `@chimera-engine/networking` public root barrel is SIDE-EFFECT-FREE in
 * the sense the F60 AC (issue #768) requires: "Importing the barrel is
 * side-effect-free (no provider runtime evaluated)." Importing
 * `@chimera-engine/networking` must evaluate NO concrete-provider runtime — neither a
 * module under `provider/local/` (the WebSocket provider, lobby server, client
 * connection) or `provider/steam/`, nor the `ws` package.
 *
 * Unlike the strictly type-only `@chimera-engine/simulation` / `@chimera-engine/ai` root
 * barrels (which erase to an empty bundle — F58 #759 / F59 #764), the networking
 * contract module legitimately carries three runtime VALUES that ARE part of
 * the provider contract: the `playerId` brand factory, the `JoinRejectedError`
 * error class consumers branch on, and the `isBrowsable` type guard. So the
 * barrel does NOT erase to empty; instead this test bundles it with esbuild
 * (already a devDependency) and asserts — via the bundle's resolved inputs —
 * that no concrete-provider module or `ws` was pulled in. If a concrete
 * provider ever leaked into the barrel, its source file (or `ws`) would appear
 * in the inputs and this test would fail (Invariant #47).
 *
 * Mirrors `simulation/__tests__/contract-barrel-side-effects.test.ts` (#759) and
 * `ai/__tests__/contract-barrel-side-effects.test.ts` (#764) in mechanism;
 * differs only in the assertion shape (inputs filter vs empty-string), as the
 * networking contract surface legitimately includes runtime contract values.
 */

import { describe, it, expect } from 'vitest';
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const networkingDir = resolve(__dirname, '..');

describe('@chimera-engine/networking contract barrel is side-effect-free (issue #768)', () => {
    it('importing @chimera-engine/networking evaluates no concrete-provider runtime (provider/local, provider/steam, ws)', async () => {
        const result = await build({
            entryPoints: [resolve(networkingDir, 'index.ts')],
            bundle: true,
            treeShaking: true,
            write: false,
            metafile: true,
            format: 'esm',
            platform: 'node',
            logLevel: 'silent',
        });

        // metafile inputs are workspace-relative (vitest runs from the repo root):
        // e.g. `networking/provider/MultiplayerProvider.ts`, `simulation/dist/...`.
        const inputs = Object.keys(result.metafile.inputs);
        const offenders = inputs.filter(
            (input) =>
                input.includes('provider/local/') ||
                input.includes('provider/steam/') ||
                input.includes('node_modules/ws/'),
        );

        expect(offenders).toEqual([]);
    });
});
