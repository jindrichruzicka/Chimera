// electron/main/app-icon.ts
//
// Resolve the application/window icon for the hosted game (F67 — App Icon &
// Per-Game Branding). Returns either a game's `GameManifest.icon` override —
// a renderer-relative path resolved to an absolute path under the game's asset
// root — or the bundled default Chimera icon shipped inside this package.
//
// Lives in `@chimera-engine/electron` (not pure `simulation/`, where the
// stringy `resolveWindowTitle` lives) because it performs filesystem path-math
// and owns the package-bundled default asset. It stays game-agnostic: the only
// icon this package knows about is the default (Invariant #97).

import * as path from 'node:path';

import type { GameManifest } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { isInsidePath } from './path-containment.js';

/**
 * Path segments from the compiled main module dir (`<pkg>/dist/main`) to the
 * bundled default icon. `assets/` ships as a sibling of `dist/` (see the
 * `files` field in `electron/package.json`), so the same two-level hop resolves
 * correctly in both the in-tree dev layout (`electron/assets/…`) and the
 * published package (`node_modules/@chimera-engine/electron/assets/…`).
 */
const DEFAULT_ICON_SEGMENTS = ['..', '..', 'assets', 'icons', 'chimera.png'] as const;

/**
 * Resolve the absolute filesystem path of the app/window icon to apply at
 * window creation.
 *
 * - When the manifest declares an `icon`, it is treated as a renderer-relative
 *   path and resolved under `<gameAssetsRoot>/<gameId>/assets/` (the same idiom
 *   as renderer game-asset serving). A path that escapes that root falls back
 *   to the default rather than reaching outside the game's owned assets.
 * - Otherwise (no manifest, or no `icon`) the bundled default Chimera icon is
 *   returned, resolved relative to `moduleDirname` (the main module's dir).
 *
 * Always returns a path; the caller passes it straight to `createMainWindow`.
 */
export function resolveAppIcon(
    manifest: GameManifest | undefined,
    gameAssetsRoot: string,
    moduleDirname: string,
): string {
    const defaultIcon = path.join(moduleDirname, ...DEFAULT_ICON_SEGMENTS);

    const override = manifest?.icon;
    if (manifest === undefined || override === undefined) {
        return defaultIcon;
    }

    const gameAssetRoot = path.resolve(gameAssetsRoot, manifest.gameId, 'assets');
    const candidate = path.resolve(gameAssetRoot, override);
    return isInsidePath(gameAssetRoot, candidate) ? candidate : defaultIcon;
}
