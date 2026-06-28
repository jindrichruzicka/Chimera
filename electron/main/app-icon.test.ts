import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveAppIcon } from './app-icon.js';
import type { GameManifest } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

// Fixed, platform-agnostic inputs mirroring the runtime call site
// (`__dirname` = <pkg>/dist/main, gameAssetsRoot = <repo>/apps).
const MODULE_DIRNAME = path.join('/app', 'electron', 'dist', 'main');
const GAME_ASSETS_ROOT = path.join('/app', 'apps');

// The bundled default ships as a sibling of `dist/` inside @chimera-engine/electron.
const DEFAULT_ICON = path.join('/app', 'electron', 'assets', 'icons', 'chimera.png');

function makeManifest(overrides: Partial<GameManifest> = {}): GameManifest {
    return {
        gameId: 'sample',
        displayName: 'Sample',
        realtime: false,
        ...overrides,
    };
}

describe('resolveAppIcon', () => {
    it('returns the bundled default Chimera icon when the manifest declares no icon (tactics case)', () => {
        const manifest = makeManifest({ gameId: 'tactics', displayName: 'Tactics' });
        expect(resolveAppIcon(manifest, GAME_ASSETS_ROOT, MODULE_DIRNAME)).toBe(DEFAULT_ICON);
    });

    it('returns the bundled default when there is no manifest at all', () => {
        expect(resolveAppIcon(undefined, GAME_ASSETS_ROOT, MODULE_DIRNAME)).toBe(DEFAULT_ICON);
    });

    it('resolves a manifest icon override to an absolute path under the game asset root', () => {
        const manifest = makeManifest({ gameId: 'demo', icon: 'branding/app-icon.png' });
        const expected = path.resolve(GAME_ASSETS_ROOT, 'demo', 'assets', 'branding/app-icon.png');
        expect(resolveAppIcon(manifest, GAME_ASSETS_ROOT, MODULE_DIRNAME)).toBe(expected);
    });

    it('falls back to the default when an override path escapes the game asset root', () => {
        const manifest = makeManifest({ gameId: 'demo', icon: '../../../../etc/evil.png' });
        expect(resolveAppIcon(manifest, GAME_ASSETS_ROOT, MODULE_DIRNAME)).toBe(DEFAULT_ICON);
    });
});
