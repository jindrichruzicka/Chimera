/**
 * renderer/assets/__tests__/compressed-texture-premise.test.ts
 *
 * §4.10 records a decision: the engine does NOT load GPU-compressed textures,
 * and the reason is that three's `KTX2Loader` cannot work without the WebGL
 * renderer, which the asset layer has no way to reach.
 *
 * This file holds that premise against the installed three, so the decision is
 * measured rather than remembered. If a later version drops the requirement, the
 * case below reds and the decision is worth reopening — which is the only way a
 * recorded "not yet" stays honest as its reasons age.
 *
 * It pins nothing about Chimera's own code: there is no compressed-texture
 * surface for a test to reach.
 */

import { describe, expect, it } from 'vitest';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

describe("the premise behind §4.10's compressed-texture decision", () => {
    it('refuses to load without a renderer handed to detectSupport', () => {
        // The asset layer builds its loaders in `createDefaultAssetLoaderRegistry`,
        // reached from managers built outside any canvas (Invariant #21 enumerates
        // their owners) — and in a game that mounts none, no `WebGLRenderer` is
        // ever created at all. So this throw is not a detail of initialisation
        // order; it is a dependency the asset layer cannot satisfy where it lives.
        const loader = new KTX2Loader();

        expect(() => loader.load('chimera://renderer/game-assets/x/t.ktx2', () => {})).toThrow(
            /detectSupport/u,
        );
    });

    it('refuses to parse bytes it already holds, for the same reason', () => {
        // Which rules out the obvious workaround of fetching the file through the
        // engine's own path and handing three only the buffer: the renderer is
        // required to choose a transcode TARGET, so it is needed before any byte
        // is decoded, not merely before one is fetched.
        const loader = new KTX2Loader();

        expect(() => loader.parse(new ArrayBuffer(8), () => {})).toThrow(/detectSupport/u);
    });
});
