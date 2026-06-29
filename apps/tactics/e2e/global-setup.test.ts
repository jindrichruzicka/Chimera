// apps/tactics/e2e/global-setup.test.ts
//
// The pure @chimera-engine/* esbuild resolution helpers (computeEsbuildAlias /
// computeNodePaths) now live in the app-owned bundler and are unit-tested by
// apps/tactics/electron/build-main.test.ts — global-setup delegates bundling to
// `buildAppBundles`, so the only thing left to guard on the e2e side is that the
// verify:pack env-var literal it re-exports matches the one tools/verify-pack.ts
// passes (it must not drift across the e2e ↔ tools boundary).

import path from 'path';

import { describe, it, expect } from 'vitest';
import { VERIFY_PACK_NODE_MODULES_ENV, resolveE2eAssetCopy } from './global-setup';

describe('VERIFY_PACK_NODE_MODULES_ENV', () => {
    it('matches the env var tools/verify-pack.ts passes to the E2E run', () => {
        expect(VERIFY_PACK_NODE_MODULES_ENV).toBe('CHIMERA_VERIFY_PACK_NODE_MODULES');
    });
});

describe('resolveE2eAssetCopy', () => {
    const root = '/repo';
    const e2eBuildRoot = path.join(root, '.e2e-build');

    it('mirrors the host package electron/assets dir into the .e2e-build layout', () => {
        expect(resolveE2eAssetCopy(root, e2eBuildRoot)).toEqual({
            from: path.join(root, 'electron', 'assets'),
            to: path.join(e2eBuildRoot, 'assets'),
        });
    });

    it('copies assets to exactly where the bundled main resolves its default icon (../../assets)', () => {
        // The e2e bundle's main lives at <e2eBuildRoot>/electron/main/index.js, and
        // resolveAppIcon's default icon is <mainDir>/../../assets/icons/chimera.png.
        // The copy destination MUST equal that ../../assets root or the default icon
        // 404s and (pre-fix #2) dock.setIcon throws, blocking window creation.
        const mainDir = path.join(e2eBuildRoot, 'electron', 'main');
        const iconRootFromBundledMain = path.resolve(mainDir, '..', '..', 'assets');
        expect(resolveE2eAssetCopy(root, e2eBuildRoot).to).toBe(iconRootFromBundledMain);
    });
});
