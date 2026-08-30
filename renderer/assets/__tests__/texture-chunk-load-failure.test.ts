/**
 * renderer/assets/__tests__/texture-chunk-load-failure.test.ts
 *
 * A texture load whose `three` chunk never arrives REJECTS (§4.10).
 *
 * `loadTexture` reaches `three` through `await import`, which is what keeps the
 * package out of the always-mounted shell layout chunk
 * (`renderer/__tests__/shell-layout-graph-census.test.ts`). That buys a failure
 * mode the static form did not have: the chunk request itself can fail — a
 * `ChunkLoadError`, or the loader giving up on a `<script>` that never answers
 * — and it fails while the caller is already awaiting.
 *
 * What must not happen is a load that hangs. `AssetManager.load` caches the
 * in-flight promise, so a pending-forever entry would wedge every later `load`
 * of the same ref, and a preload gate would spend its whole budget on it rather
 * than settling. A rejection is instead evicted, which is what lets the next
 * `load` try again.
 *
 * The failure is injected by mocking the module so that EVALUATING it throws.
 * Vitest wraps a throwing factory in a diagnostic of its own and carries the
 * original on `cause`, so that is where the simulated failure is asserted.
 *
 * It needs its own FILE because a module mock is file-scoped:
 * `renderer/assets/AssetManager.test.ts` mocks `three` with a WORKING
 * `TextureLoader`, which is the same seam pointed the other way. The co-located
 * `<Module>.test.ts` slot is therefore taken, and a second file beside it could
 * only take a name the convention does not have; it sits here instead, with the
 * other guards over this module's edges.
 *
 * Tests written first (red confirmed: before `loadTexture` reached `three`
 * dynamically, the mock threw while `AssetManager.ts` itself was evaluating, so
 * the file could not even collect — there was no load path to reject).
 */

import { describe, expect, it, vi } from 'vitest';

// The literal sits INSIDE the factory: `vi.mock` is hoisted above every
// top-level binding, so a factory closing over one throws vitest's
// hoisting diagnostic instead of the failure being simulated.
vi.mock('three', () => {
    throw new Error('Loading chunk 4301 failed.');
});

import { buildAssetRef, type TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';

import { createAssetManager, type AssetManager } from '../AssetManager';

const CHUNK_FAILURE = 'Loading chunk 4301 failed.';

const ref = buildAssetRef<TextureAsset>('tactics', 'textures/grass.webp');

const manifest: AssetManifest = {
    gameId: 'tactics',
    entries: [{ ref, kind: 'texture', priority: 'deferred' }],
};

function createManager(): AssetManager {
    return createAssetManager(
        { resolve: (assetRef) => `resolved://${String(assetRef)}` },
        manifest,
    );
}

/** The chunk failure the mock injects, read off the wrapper vitest raises. */
async function loadFailureCause(manager: AssetManager): Promise<string> {
    try {
        await manager.load(ref);
    } catch (error: unknown) {
        return String((error as Error).cause);
    }
    return 'the load resolved';
}

describe('a texture load whose three chunk fails to arrive', () => {
    it('rejects rather than hanging', async () => {
        const manager = createManager();

        await expect(manager.load(ref)).rejects.toThrow();
        expect(await loadFailureCause(manager)).toContain(CHUNK_FAILURE);
    });

    it('caches nothing, so the next load attempts the import again', async () => {
        const manager = createManager();

        expect(await loadFailureCause(manager)).toContain(CHUNK_FAILURE);
        expect(manager.get(ref)).toBeNull();
        expect(await loadFailureCause(manager)).toContain(CHUNK_FAILURE);
    });
});
