// apps/tactics/e2e/global-setup.test.ts
//
// The pure @chimera-engine/* esbuild resolution helpers (computeEsbuildAlias /
// computeNodePaths) now live in the app-owned bundler and are unit-tested by
// apps/tactics/electron/build-main.test.ts — global-setup delegates bundling to
// `buildAppBundles`, so the only thing left to guard on the e2e side is that the
// verify:pack env-var literal it re-exports matches the one tools/verify-pack.ts
// passes (it must not drift across the e2e ↔ tools boundary).

import { describe, it, expect } from 'vitest';
import { VERIFY_PACK_NODE_MODULES_ENV } from './global-setup';

describe('VERIFY_PACK_NODE_MODULES_ENV', () => {
    it('matches the env var tools/verify-pack.ts passes to the E2E run', () => {
        expect(VERIFY_PACK_NODE_MODULES_ENV).toBe('CHIMERA_VERIFY_PACK_NODE_MODULES');
    });
});
