/**
 * renderer/components/r3f/__tests__/r3f-barrel-side-effects.test.ts
 *
 * Holds the claims `renderer/components/r3f/index.ts` makes about itself —
 * the `ui` and `audio` barrels each ship a test of this shape; the r3f barrel
 * had none until `useModelAnimation` joined it.
 *
 * **What it drags in.** The graph reaches TWO stores (`perfStore` via
 * `PerfProbe`, `settingsStore` via `selectTargetFps`) and the renderer log
 * bridge (attribution recorded at the module-set assertion below) — recorded
 * decisions, not drift. `useModelAnimation`'s `ModelInstance` import is TYPE-ONLY, so
 * the clone seam (and with it `SkeletonUtils`) is deliberately NOT in this
 * graph: the model machinery ships from the `assets` barrel, and this one
 * only animates an instance a caller already holds. What this test measures
 * is the import GRAPH, not what evaluating it does.
 *
 * **The exported surface.** Pinned as a closed set below; the types by
 * `BarrelTypeSurface` (removal-only, via typecheck).
 *
 * Mechanism mirrors `renderer/audio/__tests__/audio-barrel-side-effects.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as r3fBarrel from '../index';
import type {
    CameraMode,
    CameraPreset,
    CameraConfig,
    PerspectiveCameraConfig,
    OrthographicCameraConfig,
    OrthographicFrustum,
    GameCanvasCamera,
    GameCanvasProps,
    Vector3Tuple,
} from '../index';

/** The barrel's TYPE surface — see the audio sibling for why each is named. */
interface BarrelTypeSurface {
    readonly mode: CameraMode;
    readonly preset: CameraPreset;
    readonly config: CameraConfig;
    readonly perspective: PerspectiveCameraConfig;
    readonly orthographic: OrthographicCameraConfig;
    readonly frustum: OrthographicFrustum;
    readonly camera: GameCanvasCamera;
    readonly props: GameCanvasProps;
    readonly vector: Vector3Tuple;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Marks every bare specifier external so the bundle holds only in-repo source. */
const externalizeBareImports: Plugin = {
    name: 'externalize-bare-imports',
    setup(b) {
        // esbuild filters are Go RE2 regexes — the JS `u` flag is rejected.
        b.onResolve({ filter: /^[^./]/ }, (args) => ({ path: args.path, external: true }));
        b.onResolve({ filter: /\.css$/ }, (args) => ({ path: args.path, external: true }));
    },
};

async function analyzeBarrel(
    entryAbsPath: string,
): Promise<{ readonly inputs: readonly string[]; readonly externals: ReadonlySet<string> }> {
    const result = await build({
        entryPoints: [entryAbsPath],
        bundle: true,
        treeShaking: true,
        write: false,
        metafile: true,
        format: 'esm',
        platform: 'browser',
        jsx: 'automatic',
        logLevel: 'silent',
        plugins: [externalizeBareImports],
    });
    const metafile = result.metafile;
    const externals = new Set<string>();
    for (const input of Object.values(metafile.inputs)) {
        for (const imported of input.imports) {
            if (imported.external) {
                externals.add(imported.path);
            }
        }
    }
    return { inputs: Object.keys(metafile.inputs), externals };
}

/** A forbidden external is the named runtime or any of its subpaths. */
function importsRuntime(externals: ReadonlySet<string>, name: string): boolean {
    return [...externals].some((spec) => spec === name || spec.startsWith(`${name}/`));
}

describe('@chimera-engine/renderer/components/r3f barrel', () => {
    it('exports exactly the documented public surface', () => {
        const typeSurface: BarrelTypeSurface | undefined = undefined;
        expect(typeSurface).toBeUndefined();

        // The runtime surface is the GameCanvas root plus the one Canvas-bound
        // hook; the barrel header (index.ts) records why the wiring modules
        // are not public.
        expect(Object.keys(r3fBarrel).sort()).toEqual(['GameCanvas', 'useModelAnimation']);
    });

    it('pulls in exactly eleven modules — two stores, the log bridge, and no clone seam', async () => {
        const { inputs, externals } = await analyzeBarrel(resolve(__dirname, '../index.ts'));

        // EXHAUSTIVE, not a denylist (see the audio sibling for why). The two
        // store edges are real: PerfProbe publishes into perfStore, and both
        // FrameRateLimiter and useEngineFrameloop read settings.display.targetFps
        // through the one shared selectTargetFps module. rendererLogger is the
        // third recorded edge: FrameRateLimiter reports a half-wired canvas and
        // mainCanvasRegistry a duplicate role="main" pair through the log
        // bridge rather than console (Invariant #67).
        // useModelAnimation imports ModelInstance TYPE-ONLY, so no assets/
        // module — and no SkeletonUtils — appears; the clone seam ships from the
        // assets barrel.
        const dirAndFile = inputs.map((input) => input.split('/').slice(-2).join('/')).sort();
        expect(dirAndFile).toEqual([
            'logging/rendererLogger.ts',
            'perf/PerfProbe.tsx',
            'perf/perfStore.ts',
            'r3f/FrameRateLimiter.tsx',
            'r3f/GameCanvas.tsx',
            'r3f/index.ts',
            'r3f/mainCanvasRegistry.ts',
            'r3f/selectTargetFps.ts',
            'r3f/useEngineFrameloop.ts',
            'r3f/useModelAnimation.ts',
            'state/settingsStore.ts',
        ]);

        // three and the fiber runtime are externalized peers — reached, but the
        // consumer app owns the one copy. The clone seam must stay out.
        expect(importsRuntime(externals, 'three')).toBe(true);
        expect(importsRuntime(externals, '@react-three/fiber')).toBe(true);
        expect(externals.has('three/examples/jsm/utils/SkeletonUtils.js')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/ai')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/networking')).toBe(false);
    });

    it('names none of the removed engine-wiring exports in its export statements', () => {
        // The runtime-keys pin above cannot see TYPE exports and
        // BarrelTypeSurface is removal-only, so a re-added
        // `export type { EngineFrameloop }` would survive every other gate.
        // index.ts holds nothing but comments and export statements, so after
        // stripping comments any surviving mention IS a re-export.
        const source = readFileSync(resolve(__dirname, '..', 'index.ts'), 'utf8');
        const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
        for (const name of [
            'PerfProbe',
            'FrameRateLimiter',
            'useEngineFrameloop',
            'EngineFrameloop',
        ]) {
            expect(withoutComments, `${name} must not be re-exported`).not.toContain(name);
        }
    });

    it("carries 'use client' on line 1 of every module shipping React surface", () => {
        for (const [dir, moduleFile] of [
            ['..', 'GameCanvas.tsx'],
            ['..', 'FrameRateLimiter.tsx'],
            ['..', 'useEngineFrameloop.ts'],
            ['..', 'useModelAnimation.ts'],
            ['../../shell/perf', 'PerfProbe.tsx'],
        ] as const) {
            const source = readFileSync(resolve(__dirname, dir, moduleFile), 'utf8');
            expect(source.split('\n')[0], moduleFile).toBe(`'use client';`);
        }
    });
});
