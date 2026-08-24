// @vitest-environment jsdom

import { cleanup, renderHook } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { AssetRef, AudioClipAsset } from '@chimera-engine/simulation/content/AssetRef.js';

import { AudioManagerContext } from './AudioManagerContext.js';
import {
    DEFAULT_FADE_CURVE,
    type AudioHandle,
    type AudioManager,
    type PlayOptions,
} from './AudioManager';
import type { FadeCurve } from './Cue';
import {
    DEFAULT_DISTANCE_FALLOFF,
    DEFAULT_FALLOFF_DISTANCE,
    DEFAULT_FULL_VOLUME_DISTANCE,
    DEFAULT_ROLLOFF_FACTOR,
    type DistanceFalloff,
} from './Spatial';
import { createAudioManagerSpy } from './__test-support__/AudioManagerStubs.js';
import { useSound } from './useSound.js';

const SOUND_REF = 'tactics/audio/sfx/select.ogg' as AssetRef<AudioClipAsset>;
const OTHER_SOUND_REF = 'tactics/audio/sfx/confirm.ogg' as AssetRef<AudioClipAsset>;
const PLAY_OPTIONS: PlayOptions = { bus: 'sfx', volume: 0.5 };

/**
 * Two curves that are both NOT the default, derived rather than named: the fade-in walk
 * needs one move that crosses the default/non-default boundary and one that stays clear of
 * it. Without the second, the curve key can be coarsened to the boolean
 * `curve === DEFAULT_FADE_CURVE` and nothing reds — every move would straddle the boundary
 * the {@link KEYED_FIELDS} header warns about, so the key would be proven read but not
 * proven keyed by VALUE.
 *
 * Derived so that a change to `DEFAULT_FADE_CURVE` alone cannot red these cases: whichever
 * of the three curves becomes the default, these two are the other two.
 */
const NON_DEFAULT_FADE_CURVE: FadeCurve =
    DEFAULT_FADE_CURVE === 'linear' ? 'exponential' : 'linear';
const ALTERNATE_FADE_CURVE: FadeCurve =
    DEFAULT_FADE_CURVE === 'equalPower' ? 'exponential' : 'equalPower';

/** The falloff pair, derived exactly as the curve pair above and for the same reason. */
const NON_DEFAULT_FALLOFF: DistanceFalloff =
    DEFAULT_DISTANCE_FALLOFF === 'linear' ? 'inverse' : 'linear';
const ALTERNATE_FALLOFF: DistanceFalloff =
    DEFAULT_DISTANCE_FALLOFF === 'exponential' ? 'inverse' : 'exponential';

/**
 * One pair of options per {@link PlayOptions} field, each side carrying that field ALONE
 * so the pair moves nothing else. `Record<keyof PlayOptions, ...>` requires every key, so
 * a field added to `PlayOptions` fails this file's typecheck until it is listed — and
 * listing it is not enough, because the case below then rerenders across the pair and
 * fails unless the hook keys it. That is what makes "every field is part of the key" a
 * checked claim rather than a promise.
 *
 * Field granularity only: one pair moves one field, so the SUB-key structure of
 * `spatial`, `loopRegion` and `fadeIn` is pinned by the cases that walk them component
 * by component.
 *
 * Both sides of a pair sit inside one bucket of every coarsening a key could apply —
 * same integer part, same sign, both truthy, equal string length. A pair that straddles
 * such a boundary proves only that the field is read, not that its VALUE is keyed:
 * `{ volume: 1 }` against `{ volume: 0.5 }` is still told apart by `Math.floor`.
 *
 * `loop` is the one field that cannot obey this. A boolean's value IS its truthiness, so
 * its two sides necessarily straddle every truthiness bucket and `Boolean(opts.loop)` is
 * an equivalent mutant — there is nothing weaker than the field itself to coarsen to.
 */
const KEYED_FIELDS = {
    bus: [{ bus: 'music' }, { bus: 'voice' }],
    loop: [{ loop: false }, { loop: true }],
    volume: [{ volume: 0.2 }, { volume: 0.3 }],
    spatial: [
        { spatial: { position: [0.1, 0.2, 0.3] } },
        { spatial: { position: [0.1, 0.2, 0.4] } },
    ],
    priority: [{ priority: 4.1 }, { priority: 4.2 }],
    from: [{ from: 1.1 }, { from: 1.2 }],
    to: [{ to: 8.1 }, { to: 8.2 }],
    loopRegion: [
        { loopRegion: { start: 1.1, end: 2.1 } },
        { loopRegion: { start: 1.1, end: 2.2 } },
    ],
    fadeIn: [{ fadeIn: { durationMs: 400.1 } }, { fadeIn: { durationMs: 400.2 } }],
    rate: [{ rate: 1.1 }, { rate: 1.2 }],
} satisfies Record<keyof PlayOptions, readonly [PlayOptions, PlayOptions]>;

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('useSound', () => {
    it('plays the sound through the injected audio manager and returns the handle', () => {
        const audioManager = createAudioManagerSpy();
        const { result } = renderHook(() => useSound(SOUND_REF, PLAY_OPTIONS), {
            wrapper: createWrapper(audioManager),
        });

        const handle = result.current();

        expect(audioManager.play).toHaveBeenCalledOnce();
        expect(audioManager.play).toHaveBeenCalledWith(SOUND_REF, PLAY_OPTIONS);
        expect(handle).toEqual({
            id: 'test-audio-handle',
            ref: SOUND_REF,
            bus: 'sfx',
            priority: 0,
            valid: true,
        });
    });

    it('returns a stable play callback when inputs stay the same', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: PLAY_OPTIONS },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF, opts: PLAY_OPTIONS });

        expect(result.current).toBe(initialPlay);
    });

    it('updates the play callback when the sound ref changes', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: PLAY_OPTIONS },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: OTHER_SOUND_REF, opts: PLAY_OPTIONS });

        expect(result.current).not.toBe(initialPlay);
    });

    it.each(Object.entries(KEYED_FIELDS))(
        'updates the play callback when %s alone changes',
        (field, [before, after]) => {
            const audioManager = createAudioManagerSpy();
            const { result, rerender } = renderHook<
                () => AudioHandle,
                { ref: AssetRef<AudioClipAsset>; opts: PlayOptions }
            >(({ ref, opts }) => useSound(ref, opts), {
                initialProps: { ref: SOUND_REF, opts: before },
                wrapper: createWrapper(audioManager),
            });
            const initialPlay = result.current;

            rerender({ ref: SOUND_REF, opts: after });

            // The row says something about `field` only if that is the single key either
            // side carries: a pair that moved two fields would pass on the other one.
            expect([Object.keys(before), Object.keys(after)]).toEqual([[field], [field]]);
            expect(result.current).not.toBe(initialPlay);
        },
    );

    it('updates the play callback when a cue option changes', () => {
        // `from`, `to` and the region's two bounds are four separate keys, not one cue
        // key: each step moves exactly one of them, so collapsing any pair is visible
        // here. The field-level claim is the table's; this case owns the sub-keys.
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook<
            () => AudioHandle,
            { ref: AssetRef<AudioClipAsset>; opts: PlayOptions }
        >(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: { from: 1 } },
            wrapper: createWrapper(audioManager),
        });

        const afterFrom = result.current;
        rerender({ ref: SOUND_REF, opts: { from: 5 } });
        expect(result.current).not.toBe(afterFrom);

        const afterTo = result.current;
        rerender({ ref: SOUND_REF, opts: { from: 5, to: 8 } });
        expect(result.current).not.toBe(afterTo);

        const afterRegion = result.current;
        rerender({ ref: SOUND_REF, opts: { from: 5, to: 8, loopRegion: { start: 1, end: 2 } } });
        expect(result.current).not.toBe(afterRegion);

        const afterRegionEnd = result.current;
        rerender({ ref: SOUND_REF, opts: { from: 5, to: 8, loopRegion: { start: 1, end: 3 } } });
        expect(result.current).not.toBe(afterRegionEnd);

        // The region's start is the one sub-key no other step moves on its own: every
        // earlier step that introduced a region moved both bounds together, so the end
        // key alone would carry them.
        const afterRegionStart = result.current;
        rerender({ ref: SOUND_REF, opts: { from: 5, to: 8, loopRegion: { start: 2, end: 3 } } });
        expect(result.current).not.toBe(afterRegionStart);

        // A fresh but equal region must NOT churn. Without this the two sub-keys could
        // collapse into the region object's identity and every step above would still
        // pass — each of them allocates a new region, so identity churns exactly where
        // they demand churn. An inline `loopRegion` literal would then hand back a new
        // callback on every render.
        const afterEqualRegion = result.current;
        rerender({ ref: SOUND_REF, opts: { from: 5, to: 8, loopRegion: { start: 2, end: 3 } } });
        expect(result.current).toBe(afterEqualRegion);
    });

    it('distinguishes a named cue from the symbolic bound sharing its name', () => {
        // `{ name: 'start' }` and `'start'` are different cues; keying both to the bare
        // string would collapse them and freeze the callback across a real change.
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook<
            () => AudioHandle,
            { ref: AssetRef<AudioClipAsset>; opts: PlayOptions }
        >(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: { from: 'start' } },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF, opts: { from: { name: 'start' } } });

        expect(result.current).not.toBe(initialPlay);
    });

    it('returns a stable play callback when an equal named cue is passed again', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: {
                ref: SOUND_REF,
                opts: { from: { name: 'chorus' } } satisfies PlayOptions,
            },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        // A freshly created but equal cue object must not churn the callback.
        rerender({ ref: SOUND_REF, opts: { from: { name: 'chorus' } } });

        expect(result.current).toBe(initialPlay);
    });

    it('updates the play callback when a fade-in option changes', () => {
        // `fadeIn` is two authored values, not one: a duration and a curve. Keying only
        // the pair's presence, or only its duration, hands back a callback that plays
        // the previous fade — the shape the caller hears rather than sees.
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook<
            () => AudioHandle,
            { ref: AssetRef<AudioClipAsset>; opts: PlayOptions }
        >(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: {} },
            wrapper: createWrapper(audioManager),
        });

        const afterNone = result.current;
        rerender({ ref: SOUND_REF, opts: { fadeIn: { durationMs: 400 } } });
        expect(result.current).not.toBe(afterNone);

        const afterDuration = result.current;
        rerender({ ref: SOUND_REF, opts: { fadeIn: { durationMs: 100 } } });
        expect(result.current).not.toBe(afterDuration);

        const afterCurve = result.current;
        rerender({
            ref: SOUND_REF,
            opts: { fadeIn: { durationMs: 100, curve: NON_DEFAULT_FADE_CURVE } },
        });
        expect(result.current).not.toBe(afterCurve);

        // Both sides non-default, duration held: the step that proves the curve is keyed by
        // VALUE and not merely by whether it is the default one. Every move above crosses
        // that boundary, so without this the key can be a boolean and two authored curves
        // share it.
        const afterNonDefaultCurve = result.current;
        rerender({
            ref: SOUND_REF,
            opts: { fadeIn: { durationMs: 100, curve: ALTERNATE_FADE_CURVE } },
        });
        expect(result.current).not.toBe(afterNonDefaultCurve);
    });

    it('returns a stable play callback when an equal fade-in spec is passed again', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: {
                ref: SOUND_REF,
                opts: {
                    fadeIn: { durationMs: 400, curve: NON_DEFAULT_FADE_CURVE },
                } satisfies PlayOptions,
            },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        // A freshly created but equal spec must not churn the callback. Kept for symmetry
        // with the named-cue and position stability cases rather than for unique coverage:
        // the identity-keying mutant it exists for is also caught by the defaulted-curve
        // case below.
        rerender({
            ref: SOUND_REF,
            opts: {
                fadeIn: { durationMs: 400, curve: NON_DEFAULT_FADE_CURVE },
            } satisfies PlayOptions,
        });

        expect(result.current).toBe(initialPlay);
    });

    it('keeps a stable play callback between an omitted and an explicit default fade curve', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook<
            () => AudioHandle,
            { ref: AssetRef<AudioClipAsset>; opts: PlayOptions }
        >(({ ref, opts }) => useSound(ref, opts), {
            initialProps: {
                ref: SOUND_REF,
                opts: { fadeIn: { durationMs: 400 } },
            },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({
            ref: SOUND_REF,
            opts: { fadeIn: { durationMs: 400, curve: DEFAULT_FADE_CURVE } },
        });

        expect(result.current).toBe(initialPlay);
    });

    it('returns a stable play callback when options are omitted', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref }) => useSound(ref), {
            initialProps: { ref: SOUND_REF },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF });

        expect(result.current).toBe(initialPlay);
    });

    it('keeps a stable play callback between omitted and empty options', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: undefined as PlayOptions | undefined },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF, opts: {} });

        expect(result.current).toBe(initialPlay);
    });

    it('keeps a stable play callback between empty and omitted options', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook<
            () => AudioHandle,
            { ref: AssetRef<AudioClipAsset>; opts: PlayOptions | undefined }
        >(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: {} },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF, opts: undefined });

        expect(result.current).toBe(initialPlay);
    });

    it('keeps a stable play callback between omitted and explicit default options', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: undefined as PlayOptions | undefined },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({
            ref: SOUND_REF,
            opts: { bus: 'sfx', loop: false, volume: 1, priority: 0 },
        });

        expect(result.current).toBe(initialPlay);
    });

    it('returns a stable play callback when options values are unchanged', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: {
                ref: SOUND_REF,
                opts: { bus: 'sfx', volume: 0.5 } satisfies PlayOptions,
            },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({ ref: SOUND_REF, opts: { bus: 'sfx', volume: 0.5 } satisfies PlayOptions });

        expect(result.current).toBe(initialPlay);
    });

    it('returns a stable play callback when spatial values are unchanged', () => {
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook(({ ref, opts }) => useSound(ref, opts), {
            initialProps: {
                ref: SOUND_REF,
                opts: { spatial: { position: [1, 2, 3] } } satisfies PlayOptions,
            },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        // A freshly created but equal spatial object must not churn the callback.
        rerender({
            ref: SOUND_REF,
            opts: { spatial: { position: [1, 2, 3] } } satisfies PlayOptions,
        });

        expect(result.current).toBe(initialPlay);
    });

    it('updates the play callback when any one spatial position axis changes', () => {
        // Three keys, so three moves. A pair that shifts more than one axis leaves the
        // others unproven, and a dropped axis is silent: the sound simply keeps playing
        // where it was until some other axis moves.
        //
        // Every coordinate is fractional and inside (0, 0.5), so each step also stays
        // within one bucket of `Math.floor`, `Math.round` and `Boolean`. Integer
        // coordinates cannot express a rounding key at all — the emitter would track in
        // whole units and drift silently between them.
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook<
            () => AudioHandle,
            { ref: AssetRef<AudioClipAsset>; opts: PlayOptions }
        >(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: { spatial: { position: [0.1, 0.2, 0.3] } } },
            wrapper: createWrapper(audioManager),
        });

        const afterX = result.current;
        rerender({ ref: SOUND_REF, opts: { spatial: { position: [0.4, 0.2, 0.3] } } });
        expect(result.current).not.toBe(afterX);

        const afterY = result.current;
        rerender({ ref: SOUND_REF, opts: { spatial: { position: [0.4, 0.1, 0.3] } } });
        expect(result.current).not.toBe(afterY);

        const afterZ = result.current;
        rerender({ ref: SOUND_REF, opts: { spatial: { position: [0.4, 0.1, 0.2] } } });
        expect(result.current).not.toBe(afterZ);
    });

    it('updates the play callback when any one spatial distance field changes', () => {
        // Four more sub-keys beside the three axes, each moved alone. The falloff step
        // moves between two NON-default models, so the key is proven keyed by VALUE
        // rather than by whether it is the default one — the same discipline the
        // fade-curve walk applies.
        const audioManager = createAudioManagerSpy();
        const position = [0.1, 0.2, 0.3] as const;
        const { result, rerender } = renderHook<
            () => AudioHandle,
            { ref: AssetRef<AudioClipAsset>; opts: PlayOptions }
        >(({ ref, opts }) => useSound(ref, opts), {
            initialProps: {
                ref: SOUND_REF,
                opts: {
                    spatial: {
                        position,
                        fullVolumeDistance: 2.1,
                        falloffDistance: 8.1,
                        falloff: NON_DEFAULT_FALLOFF,
                        rolloffFactor: 1.1,
                    },
                },
            },
            wrapper: createWrapper(audioManager),
        });

        const afterFullVolume = result.current;
        rerender({
            ref: SOUND_REF,
            opts: {
                spatial: {
                    position,
                    fullVolumeDistance: 2.2,
                    falloffDistance: 8.1,
                    falloff: NON_DEFAULT_FALLOFF,
                    rolloffFactor: 1.1,
                },
            },
        });
        expect(result.current).not.toBe(afterFullVolume);

        const afterFalloffDistance = result.current;
        rerender({
            ref: SOUND_REF,
            opts: {
                spatial: {
                    position,
                    fullVolumeDistance: 2.2,
                    falloffDistance: 8.2,
                    falloff: NON_DEFAULT_FALLOFF,
                    rolloffFactor: 1.1,
                },
            },
        });
        expect(result.current).not.toBe(afterFalloffDistance);

        const afterFalloff = result.current;
        rerender({
            ref: SOUND_REF,
            opts: {
                spatial: {
                    position,
                    fullVolumeDistance: 2.2,
                    falloffDistance: 8.2,
                    falloff: ALTERNATE_FALLOFF,
                    rolloffFactor: 1.1,
                },
            },
        });
        expect(result.current).not.toBe(afterFalloff);

        const afterRolloff = result.current;
        rerender({
            ref: SOUND_REF,
            opts: {
                spatial: {
                    position,
                    fullVolumeDistance: 2.2,
                    falloffDistance: 8.2,
                    falloff: ALTERNATE_FALLOFF,
                    rolloffFactor: 1.2,
                },
            },
        });
        expect(result.current).not.toBe(afterRolloff);
    });

    it('keeps a stable play callback between omitted and explicit default spatial fields', () => {
        // The defaults are shared constants rather than copies, so equivalent authored
        // specs collapse to one callback — the coupling the imported names prove.
        const audioManager = createAudioManagerSpy();
        const { result, rerender } = renderHook<
            () => AudioHandle,
            { ref: AssetRef<AudioClipAsset>; opts: PlayOptions }
        >(({ ref, opts }) => useSound(ref, opts), {
            initialProps: { ref: SOUND_REF, opts: { spatial: { position: [1, 2, 3] } } },
            wrapper: createWrapper(audioManager),
        });
        const initialPlay = result.current;

        rerender({
            ref: SOUND_REF,
            opts: {
                spatial: {
                    position: [1, 2, 3],
                    fullVolumeDistance: DEFAULT_FULL_VOLUME_DISTANCE,
                    falloffDistance: DEFAULT_FALLOFF_DISTANCE,
                    falloff: DEFAULT_DISTANCE_FALLOFF,
                    rolloffFactor: DEFAULT_ROLLOFF_FACTOR,
                },
            },
        });

        expect(result.current).toBe(initialPlay);
    });

    it('updates the play callback when the provider supplies a different manager', () => {
        // A callback keyed without the manager stays bound to the FIRST one for the
        // component's whole life. RTL's renderHook does not pass props to the wrapper, so
        // the provided manager is swapped through a local the wrapper re-reads.
        const firstManager = createAudioManagerSpy();
        const secondManager = createAudioManagerSpy();
        let providedManager = firstManager;
        const { result, rerender } = renderHook(() => useSound(SOUND_REF, PLAY_OPTIONS), {
            wrapper: ({ children }): React.ReactElement => (
                <AudioManagerContext.Provider value={providedManager}>
                    {children}
                </AudioManagerContext.Provider>
            ),
        });
        const initialPlay = result.current;

        providedManager = secondManager;
        rerender();

        expect(result.current).not.toBe(initialPlay);
        result.current();
        expect(secondManager.play).toHaveBeenCalledOnce();
        expect(firstManager.play).not.toHaveBeenCalled();
    });
});

function createWrapper(audioManager: AudioManager): React.ComponentType<{
    readonly children: React.ReactNode;
}> {
    return function AudioManagerWrapper({ children }): React.ReactElement {
        return (
            <AudioManagerContext.Provider value={audioManager}>
                {children}
            </AudioManagerContext.Provider>
        );
    };
}
