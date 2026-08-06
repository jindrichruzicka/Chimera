/**
 * electron/dev-tools/test-support/index.ts
 *
 * Asset-fact readers for a game's own unit tests, published at the
 * `@chimera-engine/electron/test-support` subpath.
 *
 * Every game declares an `asset-manifest.ts`, and the build gate that reads it
 * (`chimera-validate-assets`) checks MEMBERSHIP and self-consistency: a declared
 * ref must resolve to a file that exists (Invariant #52), and a cue sheet must
 * be internally coherent (Invariant #125). Neither opens the file. So the class
 * of defect where the manifest and the bytes disagree — an authored
 * `durationSeconds` that is not the clip's real length, a re-exported model that
 * dropped the bone a screen poses by name, a truncated container — is invisible
 * to the build and shows up as a mis-timed cue or an empty scene at runtime.
 *
 * These readers close that gap, and they live here rather than in each game
 * because the parsing is the part that is easy to get subtly wrong (a fixed
 * 44-byte RIFF offset, an unpadded odd-sized chunk, a JSON chunk read to
 * end-of-file) and because a scaffolded game gets them on day one.
 *
 * Deliberately framework-free: no `vitest` import, no `expect`. A malformed file
 * raises {@link MalformedAssetFileError} naming the path and what disagreed, so
 * these compose with any runner — and so the module stays publishable at all
 * (`verify:publish`'s depcheck fails a published `.js` that imports an
 * undeclared runtime dependency, and `vitest` is a root devDependency only).
 *
 * Usage, from a game's own `asset-manifest.test.ts`:
 *
 *   import { assetPathForRef, readWavFacts } from '@chimera-engine/electron/test-support';
 *
 *   const here = path.dirname(fileURLToPath(import.meta.url));
 *   const wav = readWavFacts(assetPathForRef(here, myAudioRefs.theme));
 *   expect(wav.durationSeconds).toBe(myMusicCues.durationSeconds);
 */

export { MalformedAssetFileError } from './MalformedAssetFileError.js';
export { assetPathForRef } from './assetRefPath.js';
export { readWavFacts, type WavFacts } from './wavFacts.js';
export {
    readGlbDocument,
    type GltfAccessor,
    type GltfAssetInfo,
    type GltfBuffer,
    type GltfDocument,
    type GltfImage,
    type GltfMaterial,
    type GltfMesh,
    type GltfNamed,
    type GltfNode,
    type GltfPrimitive,
} from './glbDocument.js';
