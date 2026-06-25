// apps/tactics/e2e/global-setup.test.ts
//
// Unit tests for the pure @chimera/* resolution helpers extracted from the
// Playwright global setup. They decide how esbuild resolves the engine packages
// when bundling the Electron main + preload:
//   - the normal suite resolves the four library packages through their `exports`
//     map onto `<pkg>/dist` (workspace symlinks) and aliases `@chimera/electron/main`
//     onto host SOURCE (#778);
//   - `verify:pack` mode sets CHIMERA_VERIFY_PACK_NODE_MODULES so esbuild resolves
//     EVERY @chimera/* — including the electron host — from the throwaway tarball
//     install, dropping the electron-main source alias (true-artifact validation).

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
    computeEsbuildAlias,
    computeNodePaths,
    VERIFY_PACK_NODE_MODULES_ENV,
} from './global-setup';

const ROOT = '/repo';
const THROWAWAY_NM = '/tmp/chimera-verify-pack-1/consumer/node_modules';

describe('VERIFY_PACK_NODE_MODULES_ENV', () => {
    it('matches the env var tools/verify-pack.ts passes to the E2E run', () => {
        expect(VERIFY_PACK_NODE_MODULES_ENV).toBe('CHIMERA_VERIFY_PACK_NODE_MODULES');
    });
});

describe('computeNodePaths', () => {
    it('is empty for the normal suite (no esbuild nodePaths override)', () => {
        expect(computeNodePaths({})).toEqual([]);
        expect(computeNodePaths({ [VERIFY_PACK_NODE_MODULES_ENV]: '' })).toEqual([]);
    });

    it('points esbuild at the throwaway tarball node_modules in verify:pack mode', () => {
        expect(computeNodePaths({ [VERIFY_PACK_NODE_MODULES_ENV]: THROWAWAY_NM })).toEqual([
            THROWAWAY_NM,
        ]);
    });
});

describe('computeEsbuildAlias', () => {
    it('aliases tactics + the electron host onto SOURCE for the normal suite (#778)', () => {
        const alias = computeEsbuildAlias({}, ROOT);
        expect(alias['@chimera/tactics']).toBe(path.join(ROOT, 'apps/tactics'));
        expect(alias['@chimera/electron/main']).toBe(path.join(ROOT, 'electron/main/index.ts'));
    });

    it('drops the electron-main source alias in verify:pack mode (host resolves from the tarball)', () => {
        const alias = computeEsbuildAlias({ [VERIFY_PACK_NODE_MODULES_ENV]: THROWAWAY_NM }, ROOT);
        expect(alias['@chimera/electron/main']).toBeUndefined();
        // The consumer game itself is not a packed engine artifact, so it stays on source.
        expect(alias['@chimera/tactics']).toBe(path.join(ROOT, 'apps/tactics'));
    });
});
