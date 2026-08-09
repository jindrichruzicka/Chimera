// @vitest-environment jsdom

/**
 * renderer/components/r3f/useClipPlayer.test.tsx
 *
 * The React binding of the animation layer, against REAL `three` objects and
 * the `fakeFiberRoot` stand-in for `@react-three/fiber`.
 *
 * **Why the fiber stand-in rather than a `useFrame` spy.** The subscriber
 * ledger and `internal.priority` are the two things this hook is asked about,
 * and `fakeFiberRoot` reproduces both — `subscribe` bumps the counter only for
 * a positive priority, and `update()` calls every subscriber. A hand-rolled
 * `vi.fn()` would record calls but could not answer either question, and it
 * would record one entry per RENDER where R3F keeps one SUBSCRIPTION per mount.
 *
 * **Why real `three`.** Phase advance is measured off the real
 * `AnimationAction.time`, so the speed stack is asserted as arithmetic three
 * actually performed rather than as a `setSpeed` argument. `AnimationMixer` is
 * subclassed only to add a creation/release ledger; every method still runs.
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimationClip, AnimationMixer, Object3D, VectorKeyframeTrack } from 'three';
import type * as ThreeModule from 'three';

import type { AnimationLoopMode } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { ClipPlayer } from '../../animation/ClipPlayer.js';
import type { ClipSheetSource } from '../../animation/ClipTimeline.js';
import type { MarkerEvent } from '../../animation/clipMarkerScheduler.js';
import { MeshClipBackend } from '../../animation/MeshClipBackend.js';
import type { ModelInstance } from '../../assets/ModelInstance.js';
import { fakeRootState, resetFakeFiberRoot, update } from './__test-support__/fakeFiberRoot';
import { useClipPlayer } from './useClipPlayer.js';
import type { ClipPlayerHandle, UseClipPlayerOptions } from './useClipPlayer.js';

vi.mock('@react-three/fiber', () => import('./__test-support__/fakeFiberRoot'));

const { mixerLog } = vi.hoisted(() => ({
    mixerLog: {
        created: [] as unknown[],
        events: [] as { kind: 'stopAllAction' | 'uncacheRoot'; mixer: unknown }[],
    },
}));

vi.mock('three', async (importOriginal) => {
    const original = await importOriginal<typeof ThreeModule>();
    class TrackedAnimationMixer extends original.AnimationMixer {
        constructor(root: ThreeModule.Object3D) {
            super(root);
            mixerLog.created.push(this);
        }
        override stopAllAction(): ThreeModule.AnimationMixer {
            mixerLog.events.push({ kind: 'stopAllAction', mixer: this });
            return super.stopAllAction();
        }
        override uncacheRoot(root: ThreeModule.Object3D): void {
            mixerLog.events.push({ kind: 'uncacheRoot', mixer: this });
            super.uncacheRoot(root);
        }
    }
    return { ...original, AnimationMixer: TrackedAnimationMixer };
});

// ─── fixtures ───────────────────────────────────────────────────────────────────

/** The clip every case plays. Two seconds, so a phase is a halved second. */
const CLIP_SECONDS = 2;

/**
 * One two-key position track — enough for `AnimationMixer` to bind and advance.
 * No `.glb` and no loader: `AnimationClip` is pure data over an `Object3D`.
 */
function makeClip(name: string, durationSeconds: number): AnimationClip {
    return new AnimationClip(name, durationSeconds, [
        new VectorKeyframeTrack('.position', [0, durationSeconds], [0, 0, 0, 1, 0, 0]),
    ]);
}

function createInstance(): ModelInstance {
    return { root: new Object3D(), clips: [makeClip('attack', CLIP_SECONDS)] };
}

/**
 * `swing` spans phase 0.1 → 0.9 and `impact` sits at 0.5.
 *
 * The passage deliberately does not start at phase 0: Rule MARK-CROSS covers
 * `(lastPhase, nextPhase]`, so a passage authored at the very start of a clip
 * is never crossed on the first step and would make every case below vacuous.
 */
const SHEET: ClipSheetSource = {
    clips: {
        attack: {
            durationSeconds: CLIP_SECONDS,
            passages: { swing: { from: { seconds: 0.2 }, to: { seconds: 1.8 } } },
            notifies: { impact: { at: { seconds: 1 } } },
        },
    },
};

/**
 * One unresolvable notify, so every `play` of `attack` against it produces
 * exactly one compile warning — which makes the report count a proxy for the
 * number of times the hook actually started the clip.
 */
const SHEET_WITH_FAULT: ClipSheetSource = {
    clips: {
        attack: {
            durationSeconds: CLIP_SECONDS,
            notifies: { nowhere: { at: { seconds: Number.NaN } } },
        },
    },
};

/** Collects every event the hook fans out, in order. */
function makeRecorder(): {
    readonly events: MarkerEvent[];
    readonly handlers: NonNullable<UseClipPlayerOptions['handlers']>;
} {
    const events: MarkerEvent[] = [];
    return {
        events,
        handlers: {
            onNotify: (event) => events.push(event),
            onPassageStart: (event) => events.push(event),
            onPassageTick: (event) => events.push(event),
            onPassageEnd: (event) => events.push(event),
            onClipEnd: (event) => events.push(event),
        },
    };
}

let frameClockSeconds = 0;

/** One frame of `deltaSeconds`, through the fake root's real subscriber walk. */
function driveFrame(deltaSeconds: number): void {
    frameClockSeconds += deltaSeconds;
    act(() => {
        update(frameClockSeconds);
    });
}

/**
 * A REAL StrictMode double mount, measured rather than assumed.
 *
 * React 19 simulates the double mount only when `<StrictMode>` is the element
 * handed to `root.render`. A `wrapper` component that RENDERS `<StrictMode>` —
 * the shape RTL's `wrapper` option produces — puts it one level down, and the
 * effect then runs `['setup']` where the root form runs
 * `['setup', 'cleanup', 'setup']`. Probed both ways against
 * `@testing-library/react@16.3.2` and `react@19.2.5`; this option is the form
 * that reaches `root.render` directly.
 */
const STRICT = { reactStrictMode: true } as const;

/** Every mixer this render allocated that was never released. */
function liveMixers(): unknown[] {
    return mixerLog.created.filter(
        (mixer) => !mixerLog.events.some((event) => event.mixer === mixer),
    );
}

function releaseKindsFor(mixer: unknown): string[] {
    return mixerLog.events.filter((event) => event.mixer === mixer).map((event) => event.kind);
}

/**
 * `action.time` for `clipName`, read off the mixer the hook allocated last.
 *
 * `clipAction` is a cache lookup for a `(clip, root)` pair three already holds
 * an action for, so this observes the backend's own action rather than making
 * a second one.
 */
function actionSecondsFor(instance: ModelInstance, clipName: string): number {
    const mixer = mixerLog.created[mixerLog.created.length - 1] as AnimationMixer;
    const clip = instance.clips.find((candidate) => candidate.name === clipName);
    if (clip === undefined) {
        throw new Error(`fixture instance carries no clip named '${clipName}'`);
    }
    return mixer.clipAction(clip).time;
}

function actionSeconds(instance: ModelInstance): number {
    return actionSecondsFor(instance, 'attack');
}

/** Stands in for the preload log bridge `emitRendererError` reads at call time. */
function installLogsApi(): { emit: ReturnType<typeof vi.fn> } {
    const logs = { emit: vi.fn() };
    (globalThis as Record<string, unknown>)['__chimera'] = { logs };
    return logs;
}

beforeEach(() => {
    mixerLog.created.length = 0;
    mixerLog.events.length = 0;
    frameClockSeconds = 0;
    resetFakeFiberRoot();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    delete (globalThis as Record<string, unknown>)['__chimera'];
});

// ─── the frame subscription ─────────────────────────────────────────────────────

describe('useClipPlayer — frame subscription', () => {
    it('registers exactly one frame subscriber per player and contributes nothing to internal.priority', async () => {
        const instance = createInstance();
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, { clip: 'attack', loop: 'loop' }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        rerender();
        rerender();

        const { internal } = fakeRootState();
        expect(internal.subscribers).toHaveLength(1);
        expect(internal.subscribers[0]?.priority).toBe(0);
        expect(internal.priority).toBe(0);
    });

    it('registers its subscriber while instance is null and leaves it inert', async () => {
        const { result } = renderHook(() => useClipPlayer(null, SHEET, { clip: 'attack' }));
        await act(async () => {
            await Promise.resolve();
        });

        expect(fakeRootState().internal.subscribers).toHaveLength(1);
        expect(mixerLog.created).toHaveLength(0);
        expect(() => {
            driveFrame(0.5);
        }).not.toThrow();
        // The handle is usable before anything is loaded; it just drives nothing.
        expect(() => {
            result.current.setClipSpeed(0.5);
        }).not.toThrow();
    });

    it('releases its frame subscriber on unmount', async () => {
        const instance = createInstance();
        const { unmount } = renderHook(() => useClipPlayer(instance, SHEET, { clip: 'attack' }));
        await act(async () => {
            await Promise.resolve();
        });
        expect(fakeRootState().internal.subscribers).toHaveLength(1);

        unmount();

        expect(fakeRootState().internal.subscribers).toHaveLength(0);
    });
});

// ─── playback ───────────────────────────────────────────────────────────────────

describe('useClipPlayer — declarative playback', () => {
    it('plays the declared clip and fans marks out through the supplied handlers', async () => {
        const instance = createInstance();
        const recorder = makeRecorder();
        renderHook(() =>
            useClipPlayer(instance, SHEET, {
                clip: 'attack',
                loop: 'loop',
                handlers: recorder.handlers,
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });

        // 0 → phase 0.15: crosses the passage start at 0.1, nothing else.
        driveFrame(0.3);
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'swing' }]);

        // phase 0.15 → 0.55: crosses the notify at 0.5 and ticks the passage.
        recorder.events.length = 0;
        driveFrame(0.8);
        expect(recorder.events.map((event) => event.kind)).toEqual(['notify', 'passage-tick']);
    });

    it('plays nothing for a null clip and stops the clip in flight when clip goes null', async () => {
        // The log bridge is installed for the whole case: `clip: null` is a
        // documented public value, and a guard that let it reach
        // `ClipPlayer.play` would get `false` back — the same answer an
        // unplayable clip gives — and report an authoring fault named "null"
        // against a model that is deliberately playing nothing.
        const logs = installLogsApi();
        const instance = createInstance();
        const recorder = makeRecorder();
        let clip: string | null = null;
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, {
                clip,
                loop: 'loop',
                handlers: recorder.handlers,
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });

        driveFrame(0.3);
        expect(recorder.events).toEqual([]);
        expect(logs.emit.mock.calls).toEqual([]);

        clip = 'attack';
        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.3);
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'swing' }]);

        recorder.events.length = 0;
        clip = null;
        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        expect(recorder.events).toEqual([
            { kind: 'passage-end', name: 'swing', reason: 'stopped' },
        ]);
        expect(logs.emit.mock.calls).toEqual([]);
    });

    it('closes the outgoing clip as stopped when the clip prop changes', async () => {
        const instance: ModelInstance = {
            root: new Object3D(),
            clips: [makeClip('attack', CLIP_SECONDS), makeClip('idle', CLIP_SECONDS)],
        };
        const recorder = makeRecorder();
        let clip = 'attack';
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, {
                clip,
                loop: 'loop',
                handlers: recorder.handlers,
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.3);
        recorder.events.length = 0;

        clip = 'idle';
        rerender();
        await act(async () => {
            await Promise.resolve();
        });

        expect(recorder.events).toEqual([
            { kind: 'passage-end', name: 'swing', reason: 'stopped' },
        ]);
    });

    it('re-plays the clip when the loop prop changes, so a once clip becomes a looping one', async () => {
        const instance = createInstance();
        const recorder = makeRecorder();
        let loop: AnimationLoopMode = 'once';
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, { clip: 'attack', loop, handlers: recorder.handlers }),
        );
        await act(async () => {
            await Promise.resolve();
        });

        // Positive control: a 'once' clip driven past its end DOES end. The
        // step is bounded to one clip length (Rule STEP-BOUNDED), so 2.5 s of
        // wall clock moves the playhead exactly to the end of a 2 s clip.
        driveFrame(2.5);
        expect(recorder.events.map((event) => event.kind)).toContain('clip-end');

        recorder.events.length = 0;
        loop = 'loop';
        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(2.5);

        // Re-played, and now wrapping instead of ending. Without the re-play the
        // terminated 'once' playback is already forgotten and this is empty.
        expect(recorder.events.map((event) => event.kind)).not.toContain('clip-end');
        expect(recorder.events.map((event) => event.kind)).toContain('passage-start');
    });

    it('restarts the clip against a replaced sheet', async () => {
        const renamed: ClipSheetSource = {
            clips: {
                attack: {
                    durationSeconds: CLIP_SECONDS,
                    passages: { parry: { from: { seconds: 0.2 }, to: { seconds: 1.8 } } },
                },
            },
        };
        const instance = createInstance();
        const recorder = makeRecorder();
        let sheet: ClipSheetSource = SHEET;
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, sheet, {
                clip: 'attack',
                loop: 'loop',
                handlers: recorder.handlers,
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.3);
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'swing' }]);

        recorder.events.length = 0;
        sheet = renamed;
        rerender();
        await act(async () => {
            await Promise.resolve();
        });

        // The sheet is a dependency of the playback effect, so a replacement
        // closes what the old timeline had open and re-seats the playhead.
        expect(recorder.events).toEqual([
            { kind: 'passage-end', name: 'swing', reason: 'stopped' },
        ]);
        recorder.events.length = 0;
        driveFrame(0.3);
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'parry' }]);
    });

    it('reads the latest handlers without restarting the clip in flight', async () => {
        const instance = createInstance();
        const first = makeRecorder();
        const second = makeRecorder();
        let handlers = first.handlers;
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, { clip: 'attack', loop: 'loop', handlers }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.3);
        expect(first.events).toEqual([{ kind: 'passage-start', name: 'swing' }]);

        handlers = second.handlers;
        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        first.events.length = 0;
        driveFrame(0.8);

        // The swap reached the live playback: the new handlers see the notify,
        // and the old ones see nothing more. A restart would have re-emitted
        // passage-start instead.
        expect(second.events.map((event) => event.kind)).toEqual(['notify', 'passage-tick']);
        expect(first.events).toEqual([]);
    });
});

// ─── the speed stack ────────────────────────────────────────────────────────────

describe('useClipPlayer — speed', () => {
    it('starts the clip at the declared speed', async () => {
        const instance = createInstance();
        renderHook(() => useClipPlayer(instance, SHEET, { clip: 'attack', speed: 0.25 }));
        await act(async () => {
            await Promise.resolve();
        });

        driveFrame(0.4);

        expect(actionSeconds(instance)).toBeCloseTo(0.4 * 0.25, 12);
    });

    it('keeps an imperative setClipSpeed across three re-renders with an unchanged speed prop', async () => {
        const instance = createInstance();
        const recorder = makeRecorder();
        const { result, rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, {
                clip: 'attack',
                loop: 'loop',
                speed: 1,
                handlers: recorder.handlers,
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.5);
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'swing' }]);

        act(() => {
            result.current.setClipSpeed(0.35);
        });
        rerender();
        rerender();
        rerender();
        await act(async () => {
            await Promise.resolve();
        });

        recorder.events.length = 0;
        const before = actionSeconds(instance);
        driveFrame(0.4);
        const advanced = actionSeconds(instance) - before;

        // Exactly 0.35x: re-applying `options.speed` on every render would make
        // this 0.4.
        expect(advanced).toBeCloseTo(0.4 * 0.35, 12);
        // Still mid-passage — a restart or a stop would have closed it.
        expect(recorder.events.map((event) => event.kind)).toEqual(['passage-tick']);
    });

    it('lets a changed speed prop overrule the imperative override', async () => {
        const instance = createInstance();
        let speed = 1;
        const { result, rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, { clip: 'attack', loop: 'loop', speed }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        act(() => {
            result.current.setClipSpeed(0.35);
        });

        speed = 0.5;
        rerender();
        await act(async () => {
            await Promise.resolve();
        });

        const before = actionSeconds(instance);
        driveFrame(0.4);

        expect(actionSeconds(instance) - before).toBeCloseTo(0.4 * 0.5, 12);
    });

    it('applies the declared speed to a clip the clip prop switches to', async () => {
        const instance: ModelInstance = {
            root: new Object3D(),
            clips: [makeClip('attack', CLIP_SECONDS), makeClip('idle', CLIP_SECONDS)],
        };
        let clip = 'attack';
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, { clip, loop: 'loop', speed: 0.5 }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.4);
        expect(actionSecondsFor(instance, 'attack')).toBeCloseTo(0.4 * 0.5, 12);

        clip = 'idle';
        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.4);

        // `ClipPlayer.play` defaults the clip-speed layer to 1, so the seat is
        // what carries the declared speed onto the clip a restart starts.
        expect(actionSecondsFor(instance, 'idle')).toBeCloseTo(0.4 * 0.5, 12);
    });

    it.each(['loop', 'sheet'] as const)(
        'keeps the declared speed across a restart the %s prop causes',
        async (which) => {
            // Same seat, reached by the two restart inputs the speed effect is
            // not keyed on at all.
            const renamedSheet: ClipSheetSource = {
                clips: { attack: { durationSeconds: CLIP_SECONDS, frameCount: 4 } },
            };
            const instance = createInstance();
            let loop: AnimationLoopMode = 'loop';
            let sheet: ClipSheetSource = SHEET;
            const { result, rerender } = renderHook(() =>
                useClipPlayer(instance, sheet, { clip: 'attack', loop, speed: 0.5 }),
            );
            await act(async () => {
                await Promise.resolve();
            });
            driveFrame(0.4);
            expect(actionSeconds(instance)).toBeCloseTo(0.4 * 0.5, 12);

            // An imperative override is written first, so the case also pins that a
            // restart resets to the DECLARED speed rather than carrying it over.
            act(() => {
                result.current.setClipSpeed(0.25);
            });
            if (which === 'loop') {
                loop = 'once';
            } else {
                sheet = renamedSheet;
            }
            rerender();
            await act(async () => {
                await Promise.resolve();
            });
            const before = actionSeconds(instance);
            driveFrame(0.4);

            expect(actionSeconds(instance) - before).toBeCloseTo(0.4 * 0.5, 12);
        },
    );

    it('re-paces a clip in flight on a speed change without restarting it', async () => {
        // `speed` is deliberately not a dependency of the playback effect: a
        // restart would reset the playhead and re-open the passage, and a hit
        // that changes the snapshot re-renders the screen on the same frame.
        const instance = createInstance();
        const recorder = makeRecorder();
        let speed = 1;
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, {
                clip: 'attack',
                loop: 'loop',
                speed,
                handlers: recorder.handlers,
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.5);
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'swing' }]);

        recorder.events.length = 0;
        speed = 0.5;
        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        const before = actionSeconds(instance);
        driveFrame(0.4);

        expect(actionSeconds(instance) - before).toBeCloseTo(0.4 * 0.5, 12);
        // Re-paced, not restarted: the passage stayed open and the playhead
        // carried on from where it was.
        expect(before).toBeCloseTo(0.5, 12);
        expect(recorder.events.map((event) => event.kind)).toEqual(['passage-tick']);
    });

    it('returns the clip to full speed when the speed prop is cleared to undefined', async () => {
        // The `?? 1` default in the speed effect, which is the one arm no other
        // case reaches: on mount the effect early-returns with no player, and
        // every case above holds `speed` defined for the life of the mount.
        // `speed={slowMo ? 0.5 : undefined}` is an ordinary React shape.
        const instance = createInstance();
        let speed: number | undefined = 0.5;
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, {
                clip: 'attack',
                loop: 'loop',
                ...(speed !== undefined ? { speed } : {}),
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.4);
        expect(actionSeconds(instance)).toBeCloseTo(0.4 * 0.5, 12);

        speed = undefined;
        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        const before = actionSeconds(instance);
        driveFrame(0.4);

        expect(actionSeconds(instance) - before).toBeCloseTo(0.4, 12);
    });

    it('refuses a negative imperative speed even before an instance has loaded', async () => {
        const { result } = renderHook(() => useClipPlayer(null, SHEET, { clip: 'attack' }));
        await act(async () => {
            await Promise.resolve();
        });

        expect(() => {
            result.current.setClipSpeed(-1);
        }).toThrow(RangeError);
    });

    it('refuses a negative declarative speed the same way the imperative verb does', () => {
        // Rule SPEED-NON-NEGATIVE reaches the declarative half too: every entry
        // point into `renderer/animation/` refuses a sign error where it is
        // written rather than clamping it, and a `speed` prop is written in the
        // game's own JSX exactly as a `setClipSpeed` call is.
        const instance = createInstance();

        expect(() => {
            renderHook(() => useClipPlayer(instance, SHEET, { clip: 'attack', speed: -1 }));
        }).toThrow(RangeError);
    });

    it('scales every clip on the player by the renderer-local timeScale, read per frame', async () => {
        const instance = createInstance();
        let timeScale = 1;
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, { clip: 'attack', loop: 'loop', timeScale }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.4);
        expect(actionSeconds(instance)).toBeCloseTo(0.4, 12);

        timeScale = 0.25;
        rerender();
        const before = actionSeconds(instance);
        driveFrame(0.4);

        expect(actionSeconds(instance) - before).toBeCloseTo(0.4 * 0.25, 12);
    });
});

// ─── ownership and teardown ─────────────────────────────────────────────────────

describe('useClipPlayer — ownership', () => {
    it('fires passage-end(released) synchronously during unmount', async () => {
        const instance = createInstance();
        const recorder = makeRecorder();
        const { unmount } = renderHook(() =>
            useClipPlayer(instance, SHEET, {
                clip: 'attack',
                loop: 'loop',
                handlers: recorder.handlers,
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.3);
        recorder.events.length = 0;

        unmount();

        // Asserted with no await between: a release deferred to a microtask
        // would leave this empty.
        expect(recorder.events).toEqual([
            { kind: 'passage-end', name: 'swing', reason: 'released' },
        ]);
    });

    it('fires passage-end(released) during a StrictMode unmount too', async () => {
        const instance = createInstance();
        const recorder = makeRecorder();
        const { unmount } = renderHook(
            () =>
                useClipPlayer(instance, SHEET, {
                    clip: 'attack',
                    loop: 'loop',
                    handlers: recorder.handlers,
                }),
            STRICT,
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.3);
        recorder.events.length = 0;

        unmount();

        expect(recorder.events).toEqual([
            { kind: 'passage-end', name: 'swing', reason: 'released' },
        ]);
    });

    it.each([
        ['mixer first', true],
        ['player first', false],
    ])(
        'closes an open passage as released with the %s teardown order',
        (_name, releaseMixerFirst) => {
            const root = new Object3D();
            const clip = makeClip('attack', CLIP_SECONDS);
            const mixer = new AnimationMixer(root);
            const events: MarkerEvent[] = [];
            const player = new ClipPlayer({
                backend: new MeshClipBackend({ mixer, clips: [clip] }),
                getTimeScale: () => 1,
                report: () => undefined,
            });
            player.play({
                clipName: 'attack',
                sheet: SHEET,
                loop: 'loop',
                handlers: { onPassageEnd: (event) => events.push(event) },
            });
            player.tick(0.3);
            events.length = 0;

            // The two orders the hook can be torn down in. React runs effect
            // cleanups in hook order, so the real unmount is mixer-first — the
            // one where `stopAllAction` has already reset `action.time` to 0.
            if (releaseMixerFirst) {
                mixer.stopAllAction();
                mixer.uncacheRoot(root);
                player.dispose();
            } else {
                player.dispose();
                mixer.stopAllAction();
                mixer.uncacheRoot(root);
            }

            expect(events).toEqual([{ kind: 'passage-end', name: 'swing', reason: 'released' }]);
        },
    );

    it('leaves exactly one live mixer after a StrictMode double mount, each discard fully released', async () => {
        const instance = createInstance();
        renderHook(() => useClipPlayer(instance, SHEET, { clip: 'attack', loop: 'loop' }), STRICT);
        await act(async () => {
            await Promise.resolve();
        });

        expect(mixerLog.created.length).toBeGreaterThanOrEqual(2);
        expect(liveMixers()).toHaveLength(1);
        for (const mixer of mixerLog.created) {
            if (liveMixers().includes(mixer)) {
                continue;
            }
            expect(releaseKindsFor(mixer)).toEqual(['stopAllAction', 'uncacheRoot']);
        }
        // One live player too: two would advance the live mixer twice per frame.
        driveFrame(0.4);
        expect(actionSeconds(instance)).toBeCloseTo(0.4, 12);
    });

    it('releases every mixer it allocated once the tree unmounts', async () => {
        const instance = createInstance();
        const { unmount } = renderHook(
            () => useClipPlayer(instance, SHEET, { clip: 'attack', loop: 'loop' }),
            STRICT,
        );
        await act(async () => {
            await Promise.resolve();
        });

        unmount();

        expect(mixerLog.created.length).toBeGreaterThanOrEqual(2);
        for (const mixer of mixerLog.created) {
            expect(releaseKindsFor(mixer)).toEqual(['stopAllAction', 'uncacheRoot']);
        }
    });

    it('never plays on a mixer allocated for a previous instance', async () => {
        let instance = createInstance();
        const recorder = makeRecorder();
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, {
                clip: 'attack',
                loop: 'loop',
                handlers: recorder.handlers,
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.3);
        const firstMixer = mixerLog.created[mixerLog.created.length - 1];

        instance = createInstance();
        rerender();
        await act(async () => {
            await Promise.resolve();
        });

        // The commit that swaps the instance still holds the OLD mixer in state,
        // so an allocation keyed on the instance alone would cache an action on
        // a mixer whose root was just uncached.
        expect(releaseKindsFor(firstMixer)).toEqual(['stopAllAction', 'uncacheRoot']);
        expect(liveMixers()).toHaveLength(1);
        recorder.events.length = 0;
        driveFrame(0.3);
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'swing' }]);
        expect(actionSeconds(instance)).toBeCloseTo(0.3, 12);
    });

    it('reports nothing when the clip changes after the instance is cleared', async () => {
        // Clearing `instance` disposes the player, and a disposed `ClipPlayer`
        // answers `play` with `false` — the same answer an unplayable clip
        // gives. So the cleanup has to clear the STATE as well as dispose the
        // object, or the next `clip` change reports an authoring fault against
        // a model that is not even mounted.
        const logs = installLogsApi();
        const instance: ModelInstance = {
            root: new Object3D(),
            clips: [makeClip('attack', CLIP_SECONDS), makeClip('idle', CLIP_SECONDS)],
        };
        let live: ModelInstance | null = instance;
        let clip = 'attack';
        const { rerender } = renderHook(() => useClipPlayer(live, SHEET, { clip, loop: 'loop' }));
        await act(async () => {
            await Promise.resolve();
        });
        driveFrame(0.3);
        expect(logs.emit).not.toHaveBeenCalled();

        live = null;
        rerender();
        await act(async () => {
            await Promise.resolve();
        });
        clip = 'idle';
        rerender();
        await act(async () => {
            await Promise.resolve();
        });

        expect(logs.emit.mock.calls).toEqual([]);
    });

    it('starts the clip once per instance, not once per commit of the swap', async () => {
        // The counting channel is the sheet's one compile warning, emitted by
        // every `play`. Without the root pairing above, the commit that swaps
        // the instance allocates a player on the PREVIOUS mixer and plays on
        // it — a third start, on a mixer whose root was already uncached, that
        // the next commit throws away. Nothing else this hook exposes can see
        // that transient: it is disposed before any frame reaches it.
        const logs = installLogsApi();
        let instance = createInstance();
        const { rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET_WITH_FAULT, { clip: 'attack' }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        expect(logs.emit).toHaveBeenCalledTimes(1);

        instance = createInstance();
        rerender();
        await act(async () => {
            await Promise.resolve();
        });

        expect(logs.emit).toHaveBeenCalledTimes(2);
    });
});

// ─── reporting ──────────────────────────────────────────────────────────────────

describe('useClipPlayer — reporting', () => {
    it('reports a clip the model does not carry, and plays nothing', async () => {
        const logs = installLogsApi();
        const instance = createInstance();
        renderHook(() => useClipPlayer(instance, SHEET, { clip: 'missing' }));
        await act(async () => {
            await Promise.resolve();
        });

        expect(logs.emit).toHaveBeenCalledTimes(1);
        const entry = logs.emit.mock.calls[0]?.[0] as {
            message?: string;
            source?: { module?: string };
        };
        expect(String(entry.message)).toContain('missing');
        // Attributable, not 'global' — every emitRendererError call site in the
        // renderer names its own module and prefixes its own message, the way
        // FrameRateLimiter.test.tsx pins for the sibling call site.
        expect(entry.source?.module).toBe('clip-player');
        expect(String(entry.message)).toContain('[useClipPlayer]');
        driveFrame(0.4);
        expect(actionSeconds(instance)).toBe(0);
    });

    it('reports a clip of no usable length the model DOES carry, with the same branch', async () => {
        // `MeshClipBackend` drops a clip whose duration is not finite and
        // positive, so `play` refuses one that is present in `instance.clips`.
        // The message has to name that case too, or it sends an author looking
        // for a clip that is right there in the .glb.
        const logs = installLogsApi();
        const instance: ModelInstance = {
            root: new Object3D(),
            clips: [
                new AnimationClip('attack', 0, [
                    new VectorKeyframeTrack('.position', [0], [0, 0, 0]),
                ]),
            ],
        };
        renderHook(() => useClipPlayer(instance, SHEET, { clip: 'attack' }));
        await act(async () => {
            await Promise.resolve();
        });

        expect(logs.emit).toHaveBeenCalledTimes(1);
        expect(String(logs.emit.mock.calls[0]?.[0]?.message)).toContain('no usable length');
    });

    it('reports an authoring fault in the sheet through the renderer log bridge', async () => {
        const logs = installLogsApi();
        const instance = createInstance();
        renderHook(() => useClipPlayer(instance, SHEET_WITH_FAULT, { clip: 'attack' }));
        await act(async () => {
            await Promise.resolve();
        });

        expect(logs.emit).toHaveBeenCalledTimes(1);
        expect(String(logs.emit.mock.calls[0]?.[0]?.message)).toContain('nowhere');
    });

    it('relays a throwing game handler under the error the GAME threw, and keeps playing', async () => {
        const logs = installLogsApi();
        const instance = createInstance();
        const seen: string[] = [];
        renderHook(() =>
            useClipPlayer(instance, SHEET, {
                clip: 'attack',
                loop: 'loop',
                handlers: {
                    onNotify: () => {
                        throw new TypeError('game handler blew up');
                    },
                    onPassageStart: (event) => seen.push(event.kind),
                    onPassageTick: (event) => seen.push(event.kind),
                },
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });

        driveFrame(1.2);

        // Relayed, not renamed: an engine-detected fault gets ClipPlaybackError,
        // a fault the engine only passes on keeps the game's own error, so a log
        // reader can tell which of the game's throws this was.
        expect(logs.emit).toHaveBeenCalledTimes(1);
        const entry = logs.emit.mock.calls[0]?.[0] as { error?: { name?: string } };
        expect(entry.error?.name).toBe('TypeError');
        // Rule HANDLER-ISOLATION: the clip does not stop, and the marks after
        // the throwing one are still delivered.
        expect(seen).toContain('passage-start');
        driveFrame(0.4);
        expect(seen).toContain('passage-tick');
        expect(actionSeconds(instance)).toBeCloseTo(1.6, 12);
    });

    it('still reports a handler that threw a non-Error value', async () => {
        // The fallback arm of the relay fork, and it is reachable from game
        // code: `emitRendererError` reads `error.name`, so handing it a bare
        // string would throw inside the bridge and be swallowed by its own
        // try/catch — the report would vanish, and under Rule
        // HANDLER-ISOLATION the log is the only channel this fault has.
        const logs = installLogsApi();
        const instance = createInstance();
        renderHook(() =>
            useClipPlayer(instance, SHEET, {
                clip: 'attack',
                loop: 'loop',
                handlers: {
                    onNotify: () => {
                        // eslint-disable-next-line @typescript-eslint/only-throw-error
                        throw 'game threw a string';
                    },
                },
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });

        driveFrame(1.2);

        expect(logs.emit).toHaveBeenCalledTimes(1);
        const entry = logs.emit.mock.calls[0]?.[0] as { error?: { name?: string } };
        expect(entry.error?.name).toBe('ClipPlaybackError');
    });

    it('names an engine-detected fault ClipPlaybackError', async () => {
        const logs = installLogsApi();
        const instance = createInstance();
        renderHook(() => useClipPlayer(instance, SHEET, { clip: 'missing' }));
        await act(async () => {
            await Promise.resolve();
        });

        const entry = logs.emit.mock.calls[0]?.[0] as { error?: { name?: string } };
        expect(entry.error?.name).toBe('ClipPlaybackError');
    });

    it('plays without a sheet at all, firing no marks', async () => {
        const instance = createInstance();
        const recorder = makeRecorder();
        renderHook(() =>
            useClipPlayer(instance, null, {
                clip: 'attack',
                loop: 'loop',
                handlers: recorder.handlers,
            }),
        );
        await act(async () => {
            await Promise.resolve();
        });

        driveFrame(0.8);

        expect(recorder.events).toEqual([]);
        expect(actionSeconds(instance)).toBeCloseTo(0.8, 12);
    });
});

// ─── module shape ───────────────────────────────────────────────────────────────

describe('useClipPlayer module shape', () => {
    it('returns a handle whose identity survives a re-render', async () => {
        const instance = createInstance();
        const { result, rerender } = renderHook(() =>
            useClipPlayer(instance, SHEET, { clip: 'attack' }),
        );
        await act(async () => {
            await Promise.resolve();
        });
        const handle: ClipPlayerHandle = result.current;

        rerender();

        expect(result.current).toBe(handle);
    });
});
