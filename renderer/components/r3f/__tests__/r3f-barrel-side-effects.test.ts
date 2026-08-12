/**
 * renderer/components/r3f/__tests__/r3f-barrel-side-effects.test.ts
 *
 * Holds the claims `renderer/components/r3f/index.ts` makes about itself —
 * the `ui` and `audio` barrels each ship a test of this shape; the r3f barrel
 * had none until `useModelAnimation` joined it.
 *
 * **What it drags in.** The graph reaches THREE stores (`perfStore` via
 * `PerfProbe`, `settingsStore` via `selectTargetFps`, `timeScaleStore` via
 * `useAnimationTimeScale`), the renderer log bridge, part of
 * `renderer/animation/`, and part of `renderer/assets/` (attribution recorded at
 * the module-set assertion below, which is the enumeration) — recorded
 * decisions, not drift. The `assets/` edge is `AnimatedSprite`'s: an element
 * that takes an `AssetRef` has to resolve it, so it reaches `useAsset` and the
 * two sprite readers at RUNTIME. What stays out is `assets/ModelInstance.ts` —
 * the sole `SkeletonUtils` importer — so the clone seam is still deliberately
 * NOT in this graph: the model machinery ships from the `assets` barrel, and
 * every `ModelInstance` import here is TYPE-ONLY. What this test measures is the
 * import GRAPH, not what evaluating it does.
 *
 * **Why the third store edge is `animation/timeScaleStore.ts` and not
 * `gameStore`.** The dilation multiplier has to live somewhere both the shell
 * (which holds the snapshot) and the animation layer (which paces against it)
 * can reach. `gameStore` already holds the snapshot, so reading the permille
 * straight off it looks free — but `renderer/state/gameStore.ts` builds its
 * singleton at module scope, so an edge to it from anything in THIS graph
 * would construct the game store in every consumer of the r3f barrel,
 * including ones that never mount a match. A one-float store in
 * `renderer/animation/` costs one more edge here and nothing at all at
 * runtime. Recorded here the way the `perfStore` and `settingsStore` edges
 * are.
 *
 * **The exported surface.** Pinned as a closed set below; the types by
 * `BarrelTypeSurface` (removal-only, via typecheck).
 *
 * Mechanism mirrors `renderer/audio/__tests__/audio-barrel-side-effects.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { build, type Plugin } from 'esbuild';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import * as r3fBarrel from '../index';
import type {
    CameraMode,
    CameraPreset,
    CameraConfig,
    CameraFit,
    PerspectiveCameraConfig,
    OrthographicCameraConfig,
    OrthographicFrustum,
    GameCanvasCamera,
    GameCanvasProps,
    Vector3Tuple,
    UseClipPlayerOptions,
    ClipPlayerHandle,
    ClipMarkerHandlers,
    MarkerEvent,
    NotifyEvent,
    PassageEvent,
    PassageTickEvent,
    PassageEndEvent,
    PassageEndReason,
    ClipEndEvent,
    UseSpriteClipPlayerOptions,
    AnimatedSpriteProps,
} from '../index';

/** The barrel's TYPE surface — see the audio sibling for why each is named. */
interface BarrelTypeSurface {
    readonly mode: CameraMode;
    readonly preset: CameraPreset;
    readonly config: CameraConfig;
    readonly fit: CameraFit;
    readonly perspective: PerspectiveCameraConfig;
    readonly orthographic: OrthographicCameraConfig;
    readonly frustum: OrthographicFrustum;
    readonly camera: GameCanvasCamera;
    readonly props: GameCanvasProps;
    readonly vector: Vector3Tuple;
    // useClipPlayer's own signature: the options it takes, the handle it
    // returns, and the handler surface a game writes against. The marker event
    // types are named because a game that factors a handler out of the options
    // literal has to annotate its parameter, and `renderer/animation/*` is not
    // an importable subpath (Invariant #96).
    readonly clipOptions: UseClipPlayerOptions;
    readonly clipHandle: ClipPlayerHandle;
    readonly clipHandlers: ClipMarkerHandlers;
    // The sprite half's own two: the options its seam takes and the props its
    // element takes. The marker event types above are shared with it — one
    // scheduler, one handler surface, whichever backend is under it.
    readonly spriteClipOptions: UseSpriteClipPlayerOptions;
    readonly spriteProps: AnimatedSpriteProps;
    readonly markerEvent: MarkerEvent;
    readonly notify: NotifyEvent;
    readonly passageStart: PassageEvent;
    readonly passageTick: PassageTickEvent;
    readonly passageEnd: PassageEndEvent;
    readonly passageEndReason: PassageEndReason;
    readonly clipEnd: ClipEndEvent;
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Every shipped `.ts`/`.tsx` under `renderer/`, absolute, excluding tests,
 * doubles, declaration files and build output — the set a bundler could reach.
 */
function walkRendererSources(rendererRoot: string): readonly string[] {
    const found: string[] = [];
    const skipped = new Set([
        'node_modules',
        'dist',
        'out',
        '.next',
        '__tests__',
        '__test-support__',
    ]);

    const walk = (directory: string): void => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = resolve(directory, entry.name);
            if (entry.isDirectory()) {
                if (!skipped.has(entry.name)) {
                    walk(path);
                }
                continue;
            }
            if (
                /\.tsx?$/u.test(entry.name) &&
                !entry.name.endsWith('.d.ts') &&
                !/\.test\.tsx?$/u.test(entry.name)
            ) {
                found.push(path);
            }
        }
    };

    walk(rendererRoot);
    return found;
}

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

        // The runtime surface is the GameCanvas root, the Canvas-bound animation
        // hooks for both halves, and the one element (AnimatedSprite) that
        // packages the sprite half; the barrel header (index.ts) records why the
        // wiring modules are not public.
        expect(Object.keys(r3fBarrel).sort()).toEqual([
            'AnimatedSprite',
            'GameCanvas',
            'useAnimationTimeScale',
            'useClipPlayer',
            'useModelAnimation',
            'useSpriteClipPlayer',
        ]);
    });

    it('pulls in exactly thirty-four modules — three stores, the log bridge, both animation halves, and no clone seam', async () => {
        const { inputs, externals } = await analyzeBarrel(resolve(__dirname, '../index.ts'));

        // EXHAUSTIVE, not a denylist (see the audio sibling for why). The three
        // store edges are real: PerfProbe publishes into perfStore, both
        // FrameRateLimiter and useEngineFrameloop read settings.display.targetFps
        // through the one shared selectTargetFps module, and both clip players
        // read the dilation multiplier out of timeScaleStore through
        // useAnimationTimeScale (see the header for why that store and not
        // gameStore). rendererLogger is the fourth recorded edge:
        // FrameRateLimiter reports a half-wired canvas,
        // mainCanvasRegistry a duplicate role="main" pair, mixerBindingRegistry
        // a root carrying two mixer-owning hooks, and both clip players a
        // clip-sheet authoring fault or a throwing game handler, all through the
        // log bridge rather than console (Invariant #67).
        // The eight clip `animation/` modules are the two players' runtime
        // layer: the player, BOTH backends, the authored-sheet-to-run-spec
        // bridge, and the compile half under them. They stay internal
        // (Invariant #96) — reaching this graph is what a barrel EXPORT means,
        // and none of them is an importable subpath.
        // The six `assets/` modules are AnimatedSprite's: it resolves an
        // AssetRef, so it reaches useAsset and the two sprite readers at
        // RUNTIME. `assets/ModelInstance.ts` is deliberately absent and is the
        // one that matters — it is the sole SkeletonUtils importer, so the clone
        // seam stays out of this graph and keeps shipping from the assets
        // barrel. Every ModelInstance import HERE is still type-only.
        // cameraFit is GameCanvas's own fit-policy geometry, and being pure
        // arithmetic it adds no edge of its own — no store, no bridge, no
        // external package.
        const dirAndFile = inputs.map((input) => input.split('/').slice(-2).join('/')).sort();
        expect(dirAndFile).toEqual([
            'animation/ClipBackend.ts',
            'animation/ClipPlayer.ts',
            'animation/ClipPosition.ts',
            'animation/ClipTimeline.ts',
            'animation/MeshClipBackend.ts',
            'animation/SpriteClipBackend.ts',
            'animation/clipMarkerScheduler.ts',
            'animation/spriteClipSpecs.ts',
            'animation/timeScaleStore.ts',
            'animation/useAnimationTimeScale.ts',
            'assets/AssetManagerContext.ts',
            'assets/animationSheet.ts',
            'assets/spriteAtlas.ts',
            'assets/useAnimationSheet.ts',
            'assets/useAsset.ts',
            'assets/useSpriteAtlas.ts',
            'logging/rendererLogger.ts',
            'perf/PerfProbe.tsx',
            'perf/perfStore.ts',
            'r3f/AnimatedSprite.tsx',
            'r3f/FrameRateLimiter.tsx',
            'r3f/GameCanvas.tsx',
            'r3f/cameraFit.ts',
            'r3f/index.ts',
            'r3f/mainCanvasRegistry.ts',
            'r3f/mixerBindingRegistry.ts',
            'r3f/selectTargetFps.ts',
            'r3f/useClipPlayback.ts',
            'r3f/useClipPlayer.ts',
            'r3f/useEngineFrameloop.ts',
            'r3f/useModelAnimation.ts',
            'r3f/useOwnedMixer.ts',
            'r3f/useSpriteClipPlayer.ts',
            'state/settingsStore.ts',
        ]);

        // The clone seam's own module, named directly: the SkeletonUtils
        // assertion below is what this graph must not reach, and this is the
        // in-repo module that would carry it in.
        expect(dirAndFile).not.toContain('assets/ModelInstance.ts');

        // three and the fiber runtime are externalized peers — reached, but the
        // consumer app owns the one copy. The clone seam must stay out.
        //
        // Why `assets/ModelInstance.ts` absent IS the clone seam absent: it is
        // the SOLE module under `renderer/` that imports `SkeletonUtils`, so
        // there is no second door. That word is load-bearing for the reasoning
        // three headers now state, so it is measured rather than asserted —
        // see `is the sole SkeletonUtils importer under renderer/` below.
        expect(importsRuntime(externals, 'three')).toBe(true);
        expect(importsRuntime(externals, '@react-three/fiber')).toBe(true);
        expect(externals.has('three/examples/jsm/utils/SkeletonUtils.js')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/ai')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/networking')).toBe(false);
    });

    it('is the sole SkeletonUtils importer under renderer/, so ModelInstance absent means the seam is absent', () => {
        // The absolute three headers rest on. Without it, "ModelInstance.ts is
        // out, therefore SkeletonUtils is out" is a non-sequitur the day a
        // second module imports the clone helper — and that module could be one
        // this graph DOES reach, leaving the assertion above green and the
        // reasoning false. Sources only: a test may name it freely (and
        // `useModelInstance.test.tsx` does, to mock it).
        const shipped = walkRendererSources(resolve(__dirname, '..', '..', '..'));
        const importers = shipped.filter((file) =>
            readFileSync(file, 'utf8').includes('three/examples/jsm/utils/SkeletonUtils.js'),
        );

        expect(importers.map((file) => file.split('/').slice(-2).join('/'))).toEqual([
            'assets/ModelInstance.ts',
        ]);
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
            ['..', 'useOwnedMixer.ts'],
            ['..', 'useClipPlayer.ts'],
            ['..', 'useClipPlayback.ts'],
            ['..', 'useSpriteClipPlayer.ts'],
            ['..', 'AnimatedSprite.tsx'],
            ['../../../animation', 'useAnimationTimeScale.ts'],
            ['../../shell/perf', 'PerfProbe.tsx'],
        ] as const) {
            const source = readFileSync(resolve(__dirname, dir, moduleFile), 'utf8');
            expect(source.split('\n')[0], moduleFile).toBe(`'use client';`);
        }
    });
});
