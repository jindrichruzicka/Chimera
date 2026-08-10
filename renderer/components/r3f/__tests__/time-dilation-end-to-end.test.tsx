// @vitest-environment jsdom

/**
 * renderer/components/r3f/__tests__/time-dilation-end-to-end.test.tsx
 *
 * The renderer half of authoritative time dilation, driven end to end:
 * `snapshot.timeScalePermille` → `TimeScaleBridge` → `timeScaleStore` → a
 * mounted `useClipPlayer`, measured off the real `AnimationAction.time` three
 * actually advanced.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * Nothing here is a spy on an intermediate: a bridge writing the raw permille,
 * or its reciprocal, moves the playhead by a different amount and reds the first
 * case. The second describe is the negative control against the F80 defect class
 * — the R3F clock is NOT what dilates, so `PerfProbe` reports the same frame
 * rate under a quarter-speed match as under a full-speed one.
 *
 * Real `three` (subclassed only to record which mixer the hook allocated), the
 * `fakeFiberRoot` stand-in for `@react-three/fiber`, and the perf harness
 * mirrored from `perf-hud-presented-rate.test.tsx`.
 */

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnimationClip, Object3D, VectorKeyframeTrack } from 'three';
import type * as ThreeModule from 'three';
import type { AnimationMixer } from 'three';

import type { ModelInstance } from '../../../assets/ModelInstance.js';
import { useTimeScaleStore } from '../../../animation/timeScaleStore.js';
import { useSettingsStore } from '../../../state/settingsStore.js';
import { TimeScaleBridge } from '../../shell/TimeScaleBridge.js';
import { PerfProbe } from '../../shell/perf/PerfProbe.js';
import { usePerfStore } from '../../shell/perf/perfStore.js';
import {
    Canvas,
    fakeRootState,
    resetFakeFiberRoot,
    update,
} from '../__test-support__/fakeFiberRoot';
import { GameCanvas } from '../index';
import { useClipPlayer } from '../useClipPlayer.js';

vi.mock('@react-three/fiber', () => import('../__test-support__/fakeFiberRoot'));

const { mixerLog } = vi.hoisted(() => ({ mixerLog: { created: [] as unknown[] } }));

vi.mock('three', async (importOriginal) => {
    const original = await importOriginal<typeof ThreeModule>();
    class TrackedAnimationMixer extends original.AnimationMixer {
        constructor(root: ThreeModule.Object3D) {
            super(root);
            mixerLog.created.push(this);
        }
    }
    return { ...original, AnimationMixer: TrackedAnimationMixer };
});

/** Two seconds, so a phase is a halved second — the `useClipPlayer` fixture shape. */
const CLIP_SECONDS = 2;

function makeInstance(): ModelInstance {
    return {
        root: new Object3D(),
        clips: [
            new AnimationClip('attack', CLIP_SECONDS, [
                new VectorKeyframeTrack('.position', [0, CLIP_SECONDS], [0, 0, 0, 1, 0, 0]),
            ]),
        ],
    };
}

/**
 * `action.time` for the fixture clip, read off the mixer the hook allocated last.
 *
 * `clipAction` is a cache lookup for a `(clip, root)` pair three already holds an
 * action for, so this observes the backend's own action rather than making a
 * second one.
 */
function actionSeconds(instance: ModelInstance): number {
    const mixer = mixerLog.created[mixerLog.created.length - 1] as AnimationMixer | undefined;
    const clip = instance.clips[0];
    if (mixer === undefined || clip === undefined) {
        throw new Error('the clip player allocated no mixer for the fixture instance');
    }
    return mixer.clipAction(clip).time;
}

/**
 * One model, playing the fixture clip through the hook under test. Renders
 * nothing: what is measured is the playhead, and an intrinsic `<mesh>` would
 * only make jsdom complain about an unrecognized tag.
 */
function Model({
    instance,
    timeScale,
}: {
    readonly instance: ModelInstance;
    /** Absent — the ordinary case — leaves the clip following the shared store. */
    readonly timeScale?: number;
}): null {
    useClipPlayer(instance, null, {
        clip: 'attack',
        loop: 'loop',
        ...(timeScale === undefined ? {} : { timeScale }),
    });
    return null;
}

beforeEach(() => {
    mixerLog.created.length = 0;
    resetFakeFiberRoot();
    vi.stubGlobal('__chimera', { logs: { emit: vi.fn() } });
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

describe('a dilated snapshot reaches a mounted clip player', () => {
    it.each([
        ['quarter speed', 250, 0.25],
        ['double speed', 2000, 2],
        ['real time', undefined, 1],
    ])('advances the clip at %s', (_name, permille, multiplier) => {
        const instance = makeInstance();
        render(
            <>
                <TimeScaleBridge permille={permille} />
                <Model instance={instance} />
            </>,
        );

        update(0.4);

        // A bridge writing the raw permille would advance 100 s here at 250; its
        // reciprocal would advance 1.6 s.
        expect(actionSeconds(instance)).toBeCloseTo(0.4 * multiplier, 12);
    });

    it('lets options.timeScale OVERRIDE the dilated store rather than compose with it', () => {
        // The one fixture that can tell the two apart: the store is dilated AND
        // the clip names its own multiplier, so overriding advances by 2x while
        // composing would advance by 2 x 0.25. Every other case in the branch
        // holds one of the two at 1, where the arithmetic is identical.
        const instance = makeInstance();
        render(
            <>
                <TimeScaleBridge permille={250} />
                <Model instance={instance} timeScale={2} />
            </>,
        );

        update(0.4);

        expect(actionSeconds(instance)).toBeCloseTo(0.4 * 2, 12);
    });

    it('re-paces a clip already in flight when the snapshot dilates mid-playback', () => {
        const instance = makeInstance();
        const { rerender } = render(
            <>
                <TimeScaleBridge permille={undefined} />
                <Model instance={instance} />
            </>,
        );
        update(0.4);
        expect(actionSeconds(instance)).toBeCloseTo(0.4, 12);

        rerender(
            <>
                <TimeScaleBridge permille={250} />
                <Model instance={instance} />
            </>,
        );
        const before = actionSeconds(instance);
        update(0.8);

        // Read per frame, not seated at play time: the hit that dilates the
        // match arrives while the swing is already running.
        expect(actionSeconds(instance) - before).toBeCloseTo(0.4 * 0.25, 12);
    });
});

describe('the R3F clock is not what dilates', () => {
    const HZ_120 = 1000 / 120;
    /** Two seconds of a 120 Hz panel — long enough to fill the probe's 1 s window. */
    const TWO_SECONDS_OF_FRAMES = 240;

    let rafCallbacks: Map<number, (timestamp: number) => void>;
    let nextRafHandle: number;
    let clockMs: number;

    function installFakeRaf(): void {
        rafCallbacks = new Map();
        nextRafHandle = 1;
        clockMs = 0;
        vi.stubGlobal('requestAnimationFrame', (callback: (timestamp: number) => void): number => {
            const handle = nextRafHandle++;
            rafCallbacks.set(handle, callback);
            return handle;
        });
        vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
            rafCallbacks.delete(handle);
        });
    }

    /** One native vsync frame; R3F's own loop runs only while it owns the loop. */
    function driveNativeFrames(count: number, deltaMs: number): void {
        for (let i = 0; i < count; i++) {
            clockMs += deltaMs;
            const due = [...rafCallbacks.values()];
            rafCallbacks.clear();
            for (const callback of due) {
                callback(clockMs);
            }
            if (fakeRootState().frameloop !== 'never') {
                update(clockMs / 1000);
            }
        }
    }

    function resetPerfSample(): void {
        usePerfStore.getState().setPerfFrame({
            fps: 0,
            frameMsAvg: 0,
            frameMsP95: 0,
            drawCalls: 0,
            triangles: 0,
        });
    }

    /** Mount a main canvas carrying one dilated clip player, and read the HUD. */
    function measureHud(permille: number | undefined): { fps: number; frameMsAvg: number } {
        render(
            <>
                <TimeScaleBridge permille={permille} />
                <GameCanvas camera="free">
                    <Model instance={makeInstance()} />
                </GameCanvas>
            </>,
        );
        driveNativeFrames(TWO_SECONDS_OF_FRAMES, HZ_120);

        const { sample } = usePerfStore.getState();
        return { fps: sample.fps, frameMsAvg: sample.frameMsAvg };
    }

    beforeEach(() => {
        installFakeRaf();
        useSettingsStore.setState({ activeGameId: null, settings: {} });
        resetPerfSample();
    });

    afterEach(() => {
        useSettingsStore.setState({ activeGameId: null, settings: {} });
        resetPerfSample();
    });

    it('reports the same frame rate at quarter speed as at real time', () => {
        const undilated = measureHud(undefined);
        cleanup();
        resetFakeFiberRoot();
        resetPerfSample();
        installFakeRaf();
        const dilated = measureHud(250);

        // Positive control: the harness really measured something.
        expect(undilated.fps).toBeGreaterThan(0);
        // Scaling the R3F clock instead of the clip playback would divide this
        // by four — the F80 defect, where the HUD reported a rate the player
        // never saw.
        expect(dilated.fps).toBe(undilated.fps);
        expect(dilated.frameMsAvg).toBeCloseTo(undilated.frameMsAvg, 12);
    });

    it('leaves a bare probe untouched by a dilated store', () => {
        useTimeScaleStore.getState().setAuthoritativePermille(250);
        render(
            <Canvas>
                <PerfProbe />
            </Canvas>,
        );

        driveNativeFrames(TWO_SECONDS_OF_FRAMES, HZ_120);

        // The same numbers `perf-hud-presented-rate.test.tsx` measures for an
        // uncapped canvas; the dilation reaches neither.
        expect(usePerfStore.getState().sample.fps).toBe(121);
        expect(usePerfStore.getState().sample.frameMsAvg).toBeCloseTo(HZ_120, 2);
    });
});
