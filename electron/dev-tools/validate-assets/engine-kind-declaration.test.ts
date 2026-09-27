/**
 * electron/dev-tools/validate-assets/engine-kind-declaration.test.ts
 *
 * The gate's membership set is READ from the shared declaration, not copied
 * beside it (§4.10).
 *
 * Its own suite next door measures what the set currently contains, which a
 * hardcoded copy of today's ids satisfies just as well — and a copy is exactly
 * the shape this declaration exists to remove. So this file replaces
 * `ENGINE_ASSET_LOADER_KIND_IDS` with a list of its own and asserts the gate's
 * answer moves with it.
 *
 * Its own file because the mock is module-scoped: the suite next door needs the
 * real declaration.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@chimera-engine/simulation/foundation/engine-asset-kinds.js', () => ({
    // Deliberately NOT the real set: `texture` alone, so a kind the engine does
    // register a loader for — and that the real list carries — is reported.
    ENGINE_ASSET_LOADER_KIND_IDS: ['texture'] as const,
}));

import { validateAssetWorkspace, type WorkspaceFileHost } from './index.js';

const workspaceRoot = '/repo';

function hostWith(kind: string, relativePath: string): WorkspaceFileHost {
    const files = new Map([
        [
            `${workspaceRoot}/apps/tactics/asset-manifest.ts`,
            `export const tacticsAssetManifest = {
                gameId: 'tactics',
                entries: [
                    { ref: 'tactics/${relativePath}', kind: '${kind}', priority: 'deferred' },
                ],
            };`,
        ],
        [`${workspaceRoot}/apps/tactics/assets/${relativePath}`, ''],
    ]);
    return {
        findDataJsonFiles: async () => [],
        findSceneSourceFiles: async () => [],
        findAssetManifestFiles: async () => [`${workspaceRoot}/apps/tactics/asset-manifest.ts`],
        readFile: async (filePath) => {
            const contents = files.get(filePath);
            if (contents === undefined) {
                throw new Error(`Missing fixture file: ${filePath}`);
            }
            return contents;
        },
        fileExists: async (filePath) => files.has(filePath),
    };
}

describe('the gate reads the shared asset-kind declaration', () => {
    it('refuses a kind the replaced declaration leaves out, though the engine loads it', async () => {
        // `gltf-model` is in the real declaration and has a real loader. Under a
        // declaration that omits it, the gate must refuse it — which it can only
        // do by having read the declaration rather than a copy of its contents.
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: hostWith('gltf-model', 'models/rig.glb'),
        });

        expect(report.unknownKinds.map((entry) => entry.kind)).toEqual(['gltf-model']);
        expect(report.ok).toBe(false);
    });

    it('accepts the one kind the replaced declaration does carry', async () => {
        // The control arm: the refusal above is the declaration being read, not
        // the gate refusing everything under a mock.
        const report = await validateAssetWorkspace({
            workspaceRoot,
            host: hostWith('texture', 'textures/grass.webp'),
        });

        expect(report.unknownKinds).toEqual([]);
        expect(report.ok).toBe(true);
    });
});
