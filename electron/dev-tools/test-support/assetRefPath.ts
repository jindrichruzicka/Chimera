/**
 * electron/dev-tools/test-support/assetRefPath.ts
 *
 * The bridge between a declared `AssetRef` and the bytes it names on disk.
 *
 * A manifest entry's `ref` is `"<game-id>/<path-under-assets/>"`; the file lives
 * at `<gameDir>/assets/<path-under-assets/>` (Invariant #97 — a game's assets are
 * its own). A test walking a manifest needs that mapping, and writing it inline
 * invites the two mistakes this function cannot make: slicing a fixed prefix
 * LENGTH (which truncates the moment the game id changes) and re-deriving the
 * ref grammar (which then drifts from the runtime resolver).
 *
 * The grammar comes from the engine's own parser, so a ref this accepts is a ref
 * `AssetResolver` accepts — including the traversal rules that keep a resolved
 * path inside the assets root.
 */

import path from 'node:path';
// The `foundation/` leaf, not `content/AssetRef.js`: the latter re-exports the
// overload typed to a branded `AssetRef<T>`, and this takes the plain `string` a
// test reads off a manifest entry. `validate-assets` resolves refs through the
// same leaf, so the two agree by construction.
import { parseAssetRef } from '@chimera-engine/simulation/foundation/asset-ref-parse.js';

/**
 * The on-disk path of a declared asset ref.
 *
 * @param gameDir  The game's own directory — the one holding `assets/`. In a
 *                 co-located test that is the test file's own directory.
 * @param ref      A declared `AssetRef` string, e.g. `'tactics/audio/sfx/step.wav'`.
 * @throws {MalformedAssetRefError} When `ref` is not a well-formed asset ref, or
 *   names a path that would escape the assets root.
 */
export function assetPathForRef(gameDir: string, ref: string): string {
    const { relativePath } = parseAssetRef(ref);
    return path.join(gameDir, 'assets', relativePath);
}
