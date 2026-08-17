/**
 * renderer/components/r3f/__tests__/r3f-barrel-side-effects.test.ts
 *
 * Holds the claims `renderer/components/r3f/index.ts` makes about itself —
 * the `ui` and `audio` barrels each ship a test of this shape; the r3f barrel
 * had none until `useModelAnimation` joined it.
 *
 * **What it drags in.** The graph reaches FOUR stores (`perfStore` via
 * `PerfProbe`, `settingsStore` via `selectTargetFps`, `timeScaleStore` via
 * `useAnimationTimeScale`, `gameStore` via `InteractionBlocker`), the renderer
 * log bridge, part of
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
 * **Why the dilation multiplier lives in `animation/timeScaleStore.ts` and not
 * in `gameStore`.** The multiplier has to live somewhere both the shell (which
 * holds the snapshot) and the animation layer (which paces against it) can
 * reach. `gameStore` already holds the snapshot, so reading the permille
 * straight off it looks free — but `renderer/state/gameStore.ts` builds its
 * singleton at module scope, so an edge to it constructs the game store in
 * every consumer of the barrel, including ones that never mount a match. A
 * one-float store in `renderer/animation/` costs one more edge here and nothing
 * at all at runtime, so it is still the cheaper of the two.
 *
 * That was once also the reason NOTHING in this graph reached `gameStore`.
 * It is not any more, and the distinction matters: what the paragraph above
 * prices is a CHOICE between two homes for one float, not a prohibition. F91
 * made `GameCanvas` mount `<InteractionBlocker>`, which reads
 * `snapshot.sceneTransition` — a fact that lives in `gameStore` and nowhere
 * else, with no cheaper home to move it to. So `state/gameStore.ts` is the
 * FOURTH store edge, accepted deliberately and recorded here the way the other
 * three are. The module-scope construction cost is real and unchanged; it buys
 * a `useGameInteraction` that does not throw in every game that calls it
 * (Invariant #83), which the alternative — a provider each game mounts by hand,
 * which no game did — did not.
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
    EasingFn,
    TweenState,
    TweenCallbackHandlers,
    CameraController,
    CameraAnimationTarget,
    CameraAnimationCancelReason,
    InteractionHandlers,
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
    // §4.21/§4.22/§4.23. Each is named because a game that factors a handler or
    // a controller out of a call site has to annotate it, and neither
    // `renderer/hooks/` nor `renderer/utils/` is an importable subpath
    // (Invariant #96) — the same reason the marker event types above are named.
    readonly easing: EasingFn;
    readonly tween: TweenState;
    readonly tweenCallbacks: TweenCallbackHandlers;
    readonly cameraController: CameraController;
    readonly cameraTarget: CameraAnimationTarget;
    readonly cameraCancelReason: CameraAnimationCancelReason;
    readonly interaction: InteractionHandlers;
}

/**
 * A blend duration is a mesh option and only a mesh option.
 *
 * Values rather than type declarations, because only an object LITERAL trips
 * excess-property checking — a declared field of a narrowed type is legal, and a
 * spread would satisfy the same assignment silently. A sprite playback rewrites
 * quad UVs and has no weight to interpolate, so the field is absent from its
 * options and from the element's props rather than accepted and ignored, and
 * each `@ts-expect-error` below fails `pnpm typecheck` the day that stops being
 * true.
 */
const blendSurface = {
    mesh: { clip: 'attack', blendSeconds: 0.3 } satisfies UseClipPlayerOptions,
    // @ts-expect-error a sprite playback has no weights to blend
    sprite: { clip: 'run', blendSeconds: 0.3 } satisfies UseSpriteClipPlayerOptions,
    // @ts-expect-error and neither has the element that drives one
    spriteElement: { clip: 'run', sheet: null, blendSeconds: 0.3 } satisfies AnimatedSpriteProps,
};

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
        // hooks for both halves, the one element (AnimatedSprite) that packages
        // the sprite half, and — since F91 — the tween, camera, curve and
        // pointer-interaction surface §4.21/§4.22/§4.23 document; the barrel
        // header (index.ts) records why the wiring modules are not public.
        //
        // The five curve functions are values, not types: they are what a caller
        // PASSES to useTween/useCamera, so a barrel that exported only EasingFn
        // would leave every caller stuck with the `linear` default.
        //
        // InteractionContext is deliberately absent. The assets and input
        // barrels export a Provider plus its useX() accessor and never the raw
        // context object; this one follows them, so a nested provider still gets
        // its value from a component rather than hand-built.
        expect(Object.keys(r3fBarrel).sort()).toEqual([
            'AnimatedSprite',
            'CameraAnimationCancelled',
            'GameCanvas',
            'InteractionBlocker',
            'easeIn',
            'easeInOut',
            'easeOut',
            'lerp',
            'linear',
            'useAnimationTimeScale',
            'useCamera',
            'useClipPlayer',
            'useGameInteraction',
            'useInteractionContext',
            'useModelAnimation',
            'useSpriteClipPlayer',
            'useTween',
            'useTweenCallback',
        ]);
    });

    it('pulls in exactly forty-three modules — four stores, the log bridge, both animation halves, and no clone seam', async () => {
        const { inputs, externals } = await analyzeBarrel(resolve(__dirname, '../index.ts'));

        // EXHAUSTIVE, not a denylist (see the audio sibling for why). The four
        // store edges are real: PerfProbe publishes into perfStore, both
        // FrameRateLimiter and useEngineFrameloop read settings.display.targetFps
        // through the one shared selectTargetFps module, both clip players
        // read the dilation multiplier out of timeScaleStore through
        // useAnimationTimeScale (see the header for why the multiplier lives
        // there and not on the snapshot), and InteractionBlocker — which
        // GameCanvas mounts around every canvas child — reads
        // snapshot.sceneTransition out of gameStore. rendererLogger is the fifth
        // recorded edge:
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
        // The four `hooks/` modules and `utils/curves.ts` are F91's: the
        // tween/camera/interaction surface a game reaches through this barrel,
        // since neither directory is an importable subpath (Invariant #96).
        // `bridge/useSendAction.ts` rides in on useGameInteraction and is the
        // one to read twice — a BRIDGE in the graph, not a store. It reaches
        // perfStore, which was already here via PerfProbe, so it adds no store
        // edge; what it does add is a read of `globalThis.__chimera.game`, which
        // is a host seam rather than an import, so no module records it.
        // `utils/curves.ts` is the whole of §4.21's maths and imports nothing at
        // all — it is a leaf in every sense.
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
            'bridge/useSendAction.ts',
            'hooks/useCamera.ts',
            'hooks/useGameInteraction.ts',
            'hooks/useTween.ts',
            'hooks/useTweenCallback.ts',
            'logging/rendererLogger.ts',
            'perf/PerfProbe.tsx',
            'perf/perfStore.ts',
            'r3f/AnimatedSprite.tsx',
            'r3f/FrameRateLimiter.tsx',
            'r3f/GameCanvas.tsx',
            'r3f/InteractionBlocker.tsx',
            'r3f/cameraFit.ts',
            'r3f/index.ts',
            'r3f/interactionContext.ts',
            'r3f/mainCanvasRegistry.ts',
            'r3f/mixerBindingRegistry.ts',
            'r3f/selectTargetFps.ts',
            'r3f/useClipPlayback.ts',
            'r3f/useClipPlayer.ts',
            'r3f/useEngineFrameloop.ts',
            'r3f/useModelAnimation.ts',
            'r3f/useOwnedMixer.ts',
            'r3f/useSpriteClipPlayer.ts',
            'state/gameStore.ts',
            'state/settingsStore.ts',
            'utils/curves.ts',
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
        // react-dom is F91's one new external, and it is `useCamera`'s alone:
        // animateTo calls flushSync so useTweenCallback re-renders with the new
        // duration and easing BEFORE start() runs. Already a peer dependency, so
        // it costs the manifest nothing — recorded because a graph that stopped
        // reaching it would mean that ordering had been dropped.
        expect(importsRuntime(externals, 'react-dom')).toBe(true);
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

    it('publishes a blend duration on the mesh options and on nothing else', () => {
        // The runtime half of the three declarations above: the mesh literal
        // really carries the field, so the two suppressed errors are the absence
        // of it from the sprite surfaces rather than a typo in the property name.
        // Read on ALL THREE literals: a typo in the property name would leave
        // the two suppressed errors reporting an excess property that is not the
        // one this pin is about, and the sprite reads below are what catch it.
        expect(blendSurface.mesh.blendSeconds).toBe(0.3);
        expect(blendSurface.sprite.blendSeconds).toBe(0.3);
        expect(blendSurface.spriteElement.blendSeconds).toBe(0.3);
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
            ['..', 'InteractionBlocker.tsx'],
            ['..', 'interactionContext.ts'],
            ['../../../animation', 'useAnimationTimeScale.ts'],
            ['../../../hooks', 'useTween.ts'],
            ['../../../hooks', 'useTweenCallback.ts'],
            ['../../../hooks', 'useCamera.ts'],
            ['../../../hooks', 'useGameInteraction.ts'],
            ['../../../bridge', 'useSendAction.ts'],
            ['../../shell/perf', 'PerfProbe.tsx'],
        ] as const) {
            const source = readFileSync(resolve(__dirname, dir, moduleFile), 'utf8');
            expect(source.split('\n')[0], moduleFile).toBe(`'use client';`);
        }

        // `utils/curves.ts` ships from this barrel too and deliberately carries
        // NO directive: it is five arithmetic functions and a type, imports
        // nothing, and calls no React hook, so it is not a client boundary —
        // matching the assets barrel's class-only modules. Asserted rather than
        // left to the list above being short, because an omission and a decision
        // read identically in a list.
        //
        // Matched as a DIRECTIVE rather than as the substring `'use client'`:
        // the quoted-string form would pass a file carrying `"use client";`,
        // which is the same directive to every bundler and leaves the guard true
        // while the property is false. (`format:check` also rewrites double to
        // single quotes, but that is prettier holding the property, not this.)
        const curves = readFileSync(resolve(__dirname, '../../../utils/curves.ts'), 'utf8');
        expect(curves).not.toMatch(/^\s*(['"])use client\1\s*;?/mu);
        // Imports NOTHING — not react, not anything. The docs and the roadmap
        // both say so as the reason these five functions may ship from an
        // otherwise Canvas-bound barrel, so it is measured here rather than
        // asserted there. `not.toContain('react')` alone would leave the
        // sentence resting on one forbidden name out of all of them.
        expect(curves).not.toMatch(/^\s*import\b/mu);
        expect(curves).not.toMatch(/\brequire\s*\(/u);
        expect(curves).not.toContain('react');

        // The four stores this graph reaches carry no directive either, and that
        // is a convention rather than four oversights — a store is not a client
        // boundary; the component that subscribes to it is. Measured as a SET so
        // the list above stays honestly shorter than "every module in the
        // graph": `gameStore` is newly in the graph, and a reader comparing the
        // two lists would otherwise have to guess whether it was considered.
        for (const storeModule of [
            '../../../state/gameStore.ts',
            '../../../state/settingsStore.ts',
            '../../shell/perf/perfStore.ts',
            '../../../animation/timeScaleStore.ts',
        ]) {
            const source = readFileSync(resolve(__dirname, storeModule), 'utf8');
            expect(source, storeModule).not.toMatch(/^\s*(['"])use client\1\s*;?/mu);
        }
    });
});
