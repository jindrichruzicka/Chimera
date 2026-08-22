/**
 * renderer/audio/__tests__/audio-barrel-side-effects.test.ts
 *
 * Holds the two claims `renderer/audio/index.ts` makes about itself, neither of
 * which any other artifact checks.
 *
 * **What it drags in.** The barrel's header says importing it mounts nothing and
 * starts no voice, and names `settingsStore` as the one store in its graph. Writing
 * this test is what established that second half: the claim began as "subscribes to
 * nothing, mirrors `components/ui`", and the bundle showed `AudioBus` reaching the
 * settings store for its per-bus gain. The sibling barrels each ship a test of this
 * shape; without one, a later edge into `gameStore` would go unnoticed until a
 * consumer's Next prerender ran it in Node. What this test measures is the import
 * GRAPH, not what evaluating it does: a side effect added inside a module already in
 * the set — a stray `subscribe`, an eagerly constructed `AudioContext` — changes no
 * edge and would pass here.
 *
 * **The exported surface.** `package-exports-contract.test.ts` pins the package's
 * `exports` MAP, never what the barrel behind it exports. Removing a symbol from the
 * re-export block is a breaking change to a published package, and typecheck catches
 * only the ones this repo happens to consume through the barrel — so the runtime
 * names are pinned as a closed set below, and the types by `BarrelTypeSurface`, which
 * catches a removal but not an addition.
 *
 * Mechanism mirrors `renderer/components/ui/__tests__/ui-barrel-side-effects.test.ts`:
 * esbuild bundles the barrel with tree-shaking, and the test asserts over the
 * resolved inputs and external specifiers. The bundling itself lives in
 * `audioGraph.js`, shared with the other graph guards in this directory so they
 * cannot drift into measuring different graphs.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';

import { analyze, AUDIO_DIR } from './audioGraph.js';
import * as audioBarrel from '../index';
import type {
    AudioBusId,
    AudioHandle,
    AudioListenerPose,
    AudioManager,
    AudioManagerProviderProps,
    AudioPosition,
    AudioTrackControls,
    CrossfadeOptions,
    Cue,
    DistanceFalloff,
    FadeCurve,
    FadeInSpec,
    FadeOutSpec,
    FadeToSpec,
    LoopRegion,
    PlayOptions,
    SetListenerOptions,
    SetVoicePositionOptions,
    SpatialAudioControls,
    SpatialOptions,
} from '../index';

/**
 * The barrel's TYPE surface, held by naming every member of it.
 *
 * Types leave no runtime trace, so the symbol-set assertion below cannot see them, and
 * most have no consumer through the barrel to red on their removal. Dropping one from
 * the re-export block is a breaking change to a published package that would otherwise
 * compile, ship, and fail only in an adopter's build. Naming each here makes
 * `pnpm typecheck` the gate that catches it.
 */
interface BarrelTypeSurface {
    readonly busId: AudioBusId;
    readonly handle: AudioHandle;
    readonly listenerPose: AudioListenerPose;
    readonly manager: AudioManager;
    readonly providerProps: AudioManagerProviderProps;
    readonly position: AudioPosition;
    readonly trackControls: AudioTrackControls;
    readonly crossfade: CrossfadeOptions;
    readonly cue: Cue;
    readonly curve: FadeCurve;
    readonly distanceFalloff: DistanceFalloff;
    readonly fadeIn: FadeInSpec;
    readonly fadeOut: FadeOutSpec;
    readonly fadeTo: FadeToSpec;
    readonly loopRegion: LoopRegion;
    readonly play: PlayOptions;
    readonly setListenerOpts: SetListenerOptions;
    readonly setVoicePositionOpts: SetVoicePositionOptions;
    readonly spatialControls: SpatialAudioControls;
    readonly spatial: SpatialOptions;
}

/** A forbidden external is the named runtime or any of its subpaths. */
function importsRuntime(externals: readonly string[], name: string): boolean {
    return externals.some((spec) => spec === name || spec.startsWith(`${name}/`));
}

describe('@chimera-engine/renderer/audio barrel', () => {
    it('exports exactly the documented public surface', () => {
        // Referencing the type roll-call keeps it from reading as unused; the assertion
        // that matters for it is made by tsc, not here.
        const typeSurface: BarrelTypeSurface | undefined = undefined;
        expect(typeSurface).toBeUndefined();

        // Sorted and exhaustive on purpose: an ADDITION is as reportable as a removal,
        // since every name here becomes public API of a published package the moment it
        // lands. Types do not survive to runtime and are pinned separately, against
        // removal only.
        expect(Object.keys(audioBarrel).sort()).toEqual([
            'AudioManagerProvider',
            'DEFAULT_FADE_CURVE',
            'MUSIC_PRIORITY',
            'useAudioManager',
            'useMusicTrack',
            'useSound',
            'useSpatialAudio',
        ]);
    });

    it('pulls in exactly fourteen modules, one of them a store', async () => {
        const { inputs, externals } = await analyze({ entryPoint: resolve(AUDIO_DIR, 'index.ts') });

        // EXHAUSTIVE, not a denylist. A denylist only rejects the subsystems whoever
        // wrote it thought of — `assets/`, `hooks/`, `game/` and `logging/` would all
        // have walked past one — while a closed set makes any new edge, into any
        // subsystem, a failure that has to be looked at and either justified here or
        // removed. The one store edge is real rather than an oversight: `AudioBus`
        // reads `settings.audio.*` for its per-bus gain (§4.25). It is also the reason
        // this barrel is not import-inert — that singleton is eager, so importing the
        // barrel constructs it.
        //
        // Full repo-relative paths: the analyzer pins what they are relative TO, so a
        // single-file run and `pnpm -r test` report the same spelling. Whole paths
        // rather than basenames, so `state/settingsStore.ts` cannot be replaced by any
        // other `settingsStore.ts` without the set changing.
        expect([...inputs].sort()).toEqual([
            'renderer/audio/AudioBus.ts',
            'renderer/audio/AudioManager.ts',
            'renderer/audio/AudioManagerContext.ts',
            'renderer/audio/AudioManagerProvider.tsx',
            'renderer/audio/Spatial.ts',
            'renderer/audio/audioCueSheet.ts',
            'renderer/audio/cueMarkerScheduler.ts',
            'renderer/audio/cueSampler.ts',
            'renderer/audio/index.ts',
            'renderer/audio/useMusicTrack.ts',
            'renderer/audio/useSound.ts',
            'renderer/audio/useSpatialAudio.ts',
            'renderer/audio/voicePlayhead.ts',
            'renderer/state/settingsStore.ts',
        ]);

        // Heavy runtimes are externalized rather than bundled, so they never appear as
        // inputs — the set above cannot speak for them and they are checked separately.
        expect(importsRuntime(externals, 'three')).toBe(false);
        expect(importsRuntime(externals, '@react-three/fiber')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/ai')).toBe(false);
        expect(importsRuntime(externals, '@chimera-engine/networking')).toBe(false);
    });
});
