/**
 * renderer/animation/MeshClipBackend.test.ts
 *
 * The mesh half of the `ClipBackend` seam, against real `three` objects: a bare
 * `Object3D`, a hand-built `AnimationClip`, and the `AnimationMixer` the test
 * itself allocates. No `.glb`, no loader, no jsdom.
 *
 * The shared contract runs first through `describeClipBackend`; everything below
 * it is what only the mesh implementation can be asked.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';
import {
    AnimationClip,
    AnimationMixer,
    LoopOnce,
    LoopPingPong,
    LoopRepeat,
    Object3D,
    VectorKeyframeTrack,
} from 'three';
import type { AnimationAction } from 'three';

import type { AnimationLoopMode } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import type {
    ClipBackend,
    ClipPlayOptions,
    ClipPlayback,
    SupportsClipBlending,
} from './ClipBackend.js';
import { checkedFade, supportsBlending } from './ClipBackend.js';
import { ClipPlayer } from './ClipPlayer.js';
import { MeshClipBackend } from './MeshClipBackend.js';
import {
    describeBlendingClipBackend,
    describeClipBackend,
} from './__test-support__/clipBackendContract.js';

/**
 * A clip with one two-key position track — enough for `AnimationMixer` to bind
 * and advance. No `.glb`, no loader, no jsdom: `AnimationClip` and
 * `AnimationMixer` are pure math over an `Object3D`.
 */
function makeClip(name: string, durationSeconds: number): AnimationClip {
    return new AnimationClip(name, durationSeconds, [
        new VectorKeyframeTrack('.position', [0, durationSeconds], [0, 0, 0, 1, 0, 0]),
    ]);
}

/**
 * A clip driving `.scale` rather than `.position`, so a case can hold two clips
 * whose bindings are distinct: a property two live actions share is restored
 * only when the LAST of them lets go, which would make an "is the node back to
 * its original state" assertion say nothing about either one.
 */
function makeScaleClip(name: string, durationSeconds: number): AnimationClip {
    return new AnimationClip(name, durationSeconds, [
        new VectorKeyframeTrack('.scale', [0, durationSeconds], [1, 1, 1, 2, 1, 1]),
    ]);
}

/**
 * `action`'s scheduled weight ramp, or `null` when it has none. three exposes no
 * public reader for one, and "a fade was scheduled" is exactly the difference
 * between a degenerate ramp and a cut.
 */
function weightInterpolantOf(action: AnimationAction): unknown {
    return (action as unknown as { _weightInterpolant: unknown })._weightInterpolant;
}

/** A mixer bound to a bare root, plus the clips a case plays on it. */
function makeRig(clips: readonly AnimationClip[]): {
    readonly root: Object3D;
    readonly mixer: AnimationMixer;
    readonly backend: MeshClipBackend;
} {
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    return { root, mixer, backend: new MeshClipBackend({ mixer, clips }) };
}

/** `play`, refusing `null` so a case never asserts against an optional handle. */
function play(backend: ClipBackend, clipName: string, options?: ClipPlayOptions): ClipPlayback {
    const playback = backend.play(clipName, options);
    if (playback === null) {
        throw new Error(`clip '${clipName}' is not playable`);
    }
    return playback;
}

describeClipBackend('MeshClipBackend', () => {
    const clip = makeClip('attack', 1);
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    return {
        backend: new MeshClipBackend({ mixer, clips: [clip] }),
        clipName: 'attack',
        durationSeconds: 1,
        blends: true,
        release: () => {
            // The mixer is the FIXTURE's allocation, not the backend's.
            mixer.uncacheRoot(root);
        },
    };
});

describeBlendingClipBackend('MeshClipBackend', () => {
    // `attack` drives `.position` and `idle` drives `.scale`, so the posed value
    // below reads ONE clip's contribution: a property both of them wrote would
    // be restored only when the second let go, and every "the outgoing clip is
    // gone" assertion would pass for the wrong reason.
    const attack = makeClip('attack', 1);
    const root = new Object3D();
    const mixer = new AnimationMixer(root);
    return {
        backend: new MeshClipBackend({ mixer, clips: [attack, makeScaleClip('idle', 1)] }),
        clipName: 'attack',
        otherClipName: 'idle',
        durationSeconds: 1,
        blends: true,
        posedValue: () => root.position.x,
        release: () => {
            mixer.uncacheRoot(root);
        },
    };
});

describe('MeshClipBackend', () => {
    it('is assignable to ClipBackend & SupportsClipBlending with no cast', () => {
        const clip = makeClip('attack', 1);
        const mixer = new AnimationMixer(new Object3D());

        const backend: ClipBackend & SupportsClipBlending = new MeshClipBackend({
            mixer,
            clips: [clip],
        });

        expect(supportsBlending(backend)).toBe(true);
        backend.dispose();
    });

    it('reports the loaded clip length and refuses a clip of no usable length', () => {
        // A clip with no tracks keeps the zero duration it was constructed with,
        // and dividing a playhead by it would make every phase `NaN`.
        const { backend } = makeRig([makeClip('attack', 1.25), new AnimationClip('empty', 0, [])]);

        expect(backend.getDurationSeconds('attack')).toBe(1.25);
        expect(backend.getDurationSeconds('empty')).toBeNull();
        expect(backend.play('empty')).toBeNull();

        backend.dispose();
    });

    describe('the loop mode reaching three', () => {
        it('maps once to a clamped single repetition and loop to an endless repeat', () => {
            const clip = makeClip('attack', 1);
            const { mixer, backend } = makeRig([clip]);

            play(backend, 'attack', { loop: 'once' });
            const onceAction = mixer.clipAction(clip);
            expect(onceAction.loop).toBe(LoopOnce);
            expect(onceAction.repetitions).toBe(1);
            expect(onceAction.clampWhenFinished).toBe(true);

            play(backend, 'attack', { loop: 'loop' });
            const loopAction = mixer.clipAction(clip);
            expect(loopAction.loop).toBe(LoopRepeat);
            expect(loopAction.repetitions).toBe(Number.POSITIVE_INFINITY);
            expect(loopAction.clampWhenFinished).toBe(false);

            backend.dispose();
        });

        it('refuses a loop mode it has no mapping for, which is what keeps LoopPingPong out', () => {
            // `AnimationLoopMode` spells only 'once' and 'loop', so three's
            // LoopPingPong (2202) has no authored spelling and the mapper never
            // produces it. The refusal below is the runtime half of that: a mode
            // arriving from unsound data does not silently fall through to a
            // default.
            const { backend } = makeRig([makeClip('attack', 1)]);
            expect(LoopPingPong).toBe(2202);

            expect(() => backend.play('attack', { loop: 'pingpong' as AnimationLoopMode })).toThrow(
                RangeError,
            );

            backend.dispose();
        });
    });

    describe('ended is derived from state, never from an event', () => {
        /** Records every `'finished'` three announces on `mixer`. */
        function recordFinished(mixer: AnimationMixer): readonly unknown[] {
            const seen: unknown[] = [];
            mixer.addEventListener('finished', (event) => {
                seen.push(event);
            });
            return seen;
        }

        it('latches ended for a playback stopped mid-clip, with three announcing nothing', () => {
            const { mixer, backend } = makeRig([makeClip('attack', 1)]);
            const finished = recordFinished(mixer);
            const playback = play(backend, 'attack', { loop: 'once' });

            backend.advance(0.4);
            playback.stop();

            expect(playback.sample()).toEqual({ phase: 0.4, cycle: 0, ended: true });
            // The discriminator: three announced nothing at all, so an `ended`
            // wired to `'finished'` would still be false here.
            expect(finished).toEqual([]);
        });

        it('latches ended for a playback crossfaded out, with three announcing nothing', () => {
            const { mixer, backend } = makeRig([makeClip('attack', 1), makeClip('idle', 1)]);
            const finished = recordFinished(mixer);
            const outgoing = play(backend, 'attack', { loop: 'loop' });

            backend.advance(0.6);
            const incoming = backend.crossfadeTo('idle', 0.2, { loop: 'loop' });

            expect(incoming).not.toBeNull();
            expect(outgoing.sample()).toEqual({ phase: 0.6, cycle: 0, ended: true });
            expect(finished).toEqual([]);
        });

        it('latches ended from the clamped playhead when a once clip really does finish', () => {
            const { mixer, backend } = makeRig([makeClip('attack', 1)]);
            const finished = recordFinished(mixer);
            const playback = play(backend, 'attack', { loop: 'once' });

            backend.advance(0.5);
            expect(playback.sample().ended).toBe(false);
            backend.advance(0.6);

            expect(playback.sample()).toEqual({ phase: 1, cycle: 0, ended: true });
            // three DOES announce this one — the point is that the backend does
            // not need it to, so both paths above and this one agree.
            expect(finished).toHaveLength(1);
        });

        it('registers no listener of its own on the mixer', () => {
            // `addEventListener` is three's only way onto an `EventDispatcher`,
            // so its absence from the whole file — comments included — is the
            // literal form of "no 'finished' listener registered anywhere".
            const source = readModuleSource('MeshClipBackend.ts');

            expect(source).not.toMatch(/addEventListener/);
            // The positive control: the scan really read that module.
            expect(source).toMatch(/export class MeshClipBackend/);
        });
    });

    describe('the speed layers', () => {
        it('puts the playback multiplier on the action and writes no mixer scale of its own', () => {
            const clip = makeClip('attack', 1);
            const { mixer, backend } = makeRig([clip]);

            const playback = play(backend, 'attack', { loop: 'loop', speed: 2 });
            const action: AnimationAction = mixer.clipAction(clip);
            expect(action.timeScale).toBe(2);

            playback.setSpeed(0.5);
            expect(action.timeScale).toBe(0.5);

            backend.advance(0.8);

            // The mixer's own layer is untouched, so the step is 0.8 s x 0.5.
            expect(mixer.timeScale).toBe(1);
            expect(action.time).toBeCloseTo(0.4, 12);
            expect(playback.sample().phase).toBeCloseTo(0.4, 12);

            backend.dispose();
        });

        it('paces a ClipPlayer-driven playback by the folded stack, with the mixer left at 1', () => {
            const clip = makeClip('attack', 1);
            const { mixer, backend } = makeRig([clip]);
            const player = new ClipPlayer({
                backend,
                getTimeScale: () => 0.25,
                report: () => undefined,
            });
            player.setPlayerSpeed(0.5);
            player.play({ clipName: 'attack', loop: 'loop' });

            player.tick(0.8);

            // `ClipPlayer.tick` folds clip x player x timeScale into the ONE
            // multiplier it hands `setSpeed`, so 0.8 s x 1 x 0.5 x 0.25 = 0.1 s.
            const action: AnimationAction = mixer.clipAction(clip);
            expect(mixer.timeScale).toBe(1);
            expect(action.time).toBeCloseTo(0.1, 12);

            player.dispose();
        });

        it('composes the mixer scale on top of the action, which is why a folded stack leaves it at 1', () => {
            const clip = makeClip('attack', 1);
            const { mixer, backend } = makeRig([clip]);
            const player = new ClipPlayer({
                backend,
                getTimeScale: () => 0.25,
                report: () => undefined,
            });
            player.setPlayerSpeed(0.5);
            player.play({ clipName: 'attack', loop: 'loop' });

            // `AnimationMixer.update` begins `deltaTime *= this.timeScale`, so a
            // mixer scale multiplies whatever each action already carries. Writing
            // `playerSpeed x globalTimeScale` here would apply both layers a
            // SECOND time on top of the multiplier `ClipPlayer` already folded.
            const playerSpeed = 0.5;
            const globalTimeScale = 0.25;
            mixer.timeScale = playerSpeed * globalTimeScale;
            player.tick(0.8);

            const action: AnimationAction = mixer.clipAction(clip);
            expect(mixer.timeScale).toBe(0.125);
            expect(action.time).toBeCloseTo(0.0125, 12);

            player.dispose();
        });

        it('refuses a negative or non-finite speed at play and at set', () => {
            const { backend } = makeRig([makeClip('attack', 1)]);

            expect(() => backend.play('attack', { speed: -1 })).toThrow(RangeError);
            expect(() => backend.play('attack', { speed: Number.NaN })).toThrow(RangeError);

            const playback = play(backend, 'attack');
            expect(() => {
                playback.setSpeed(Number.POSITIVE_INFINITY);
            }).toThrow(RangeError);

            backend.dispose();
        });
    });

    describe('the AnimationClip is never mutated', () => {
        it('leaves tracks identical by reference and structurally equal after play, stop and dispose', () => {
            const clip = makeClip('attack', 1);
            const tracksBefore = clip.tracks;
            const structureBefore = clip.tracks.map((track) => ({
                name: track.name,
                times: [...track.times],
                values: [...track.values],
            }));
            const { backend } = makeRig([clip]);

            const playback = play(backend, 'attack', { loop: 'once', speed: 2 });
            backend.advance(0.4);
            playback.stop();
            backend.dispose();

            expect(clip.tracks).toBe(tracksBefore);
            expect(clip.duration).toBe(1);
            expect(
                clip.tracks.map((track) => ({
                    name: track.name,
                    times: [...track.times],
                    values: [...track.values],
                })),
            ).toEqual(structureBefore);
        });
    });

    describe('what dispose releases', () => {
        it('uncaches only the actions it allocated and leaves a sibling binder alone', () => {
            const mine = makeClip('attack', 1);
            const theirs = makeClip('idle', 1);
            const root = new Object3D();
            const mixer = new AnimationMixer(root);
            const backend = new MeshClipBackend({ mixer, clips: [mine] });
            // The mixer's owner has its own action on the same mixer.
            const sibling = mixer.clipAction(theirs);
            sibling.play();

            play(backend, 'attack', { loop: 'loop' });
            const mineAction = mixer.clipAction(mine);
            backend.dispose();

            expect(mixer.clipAction(mine)).not.toBe(mineAction);
            expect(mixer.clipAction(theirs)).toBe(sibling);
            expect(sibling.isRunning()).toBe(true);
        });
    });

    describe('the wrap count reads the whole step', () => {
        it('counts a wrap that only the action and mixer scales together produced', () => {
            const { mixer, backend } = makeRig([makeClip('run', 1)]);
            const looping = play(backend, 'run', { loop: 'loop', speed: 2 });
            mixer.timeScale = 0.5;

            // 1 s x 2 (action) x 0.5 (mixer) = exactly one clip length. Reading
            // the step through only one of the two scales makes it 2 s or 0.5 s,
            // which counts two wraps or none.
            backend.advance(1);

            const sample = looping.sample();
            expect(sample.cycle).toBe(1);
            expect(sample.phase).toBeCloseTo(0, 12);

            backend.dispose();
        });
    });

    describe('a stopped playback stops moving the object', () => {
        it('hands the bound node back to its original state and stops writing to it', () => {
            const { root, backend } = makeRig([makeClip('attack', 1)]);
            const originalX = root.position.x;
            const playback = play(backend, 'attack', { loop: 'loop' });

            backend.advance(0.4);
            const movingX = root.position.x;
            playback.stop();
            backend.advance(0.2);
            backend.advance(0.2);

            // The frozen sample is bookkeeping; this is the visible half. The
            // original state is captured BEFORE anything played: reading it after
            // the stop would compare the restored value with itself, which holds
            // whether or not the action was ever deactivated.
            expect(movingX).toBeGreaterThan(originalX);
            expect(root.position.x).toBe(originalX);

            backend.dispose();
        });

        it('leaves the bound node posed when the playback is held instead', () => {
            const { root, backend } = makeRig([makeClip('attack', 1)]);
            const playback = play(backend, 'attack', { loop: 'loop' });

            backend.advance(0.4);
            const posed = root.position.x;
            playback.hold();
            backend.advance(0.2);

            // The whole difference between the two terminal verbs: the pose stays
            // on screen, and the playhead does not move under it.
            expect(posed).toBeGreaterThan(0);
            expect(root.position.x).toBe(posed);
            expect(playback.sample()).toEqual({ phase: 0.4, cycle: 0, ended: true });

            backend.dispose();
        });

        it('lets a crossfade resume an action a hold had frozen', () => {
            const attack = makeClip('attack', 1);
            const { backend } = makeRig([attack, makeScaleClip('idle', 1)]);
            const playback = play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.4);
            playback.hold();

            const resumed = backend.crossfadeTo('attack', 0.4, { loop: 'loop' });
            backend.advance(0.2);

            // A hold pauses the action; `play` clears that through `reset()` but
            // a resume does not, so a resumed action that stayed paused would
            // pose its held frame for ever while its handle reported a playhead
            // that never moved.
            expect(resumed?.sample().phase).toBeCloseTo(0.6, 6);

            backend.dispose();
        });

        it('does not let a held handle pause the playback that took its action over', () => {
            const attack = makeClip('attack', 1);
            const { backend } = makeRig([attack]);
            const stale = play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.4);
            stale.hold();
            const live = play(backend, 'attack', { loop: 'loop' });

            stale.hold();
            backend.advance(0.3);

            // three caches ONE action per (clip, root), so a hold that wrote
            // `paused` before checking whether this record still owns its action
            // would freeze the playback that took it over — for ever, under a
            // sample that keeps reporting an ordinary playhead.
            expect(live.sample().phase).toBeCloseTo(0.3, 6);

            backend.dispose();
        });

        it('keeps a clip a clip-end handler replayed moving, rather than holding its action', () => {
            const { root, backend } = makeRig([makeClip('attack', 1)]);
            const player = new ClipPlayer({
                backend,
                getTimeScale: () => 1,
                report: () => undefined,
            });
            let replayed = false;
            const replay = (): void => {
                if (replayed) {
                    return;
                }
                replayed = true;
                player.play({ clipName: 'attack', loop: 'once', handlers: { onClipEnd: replay } });
            };
            player.play({ clipName: 'attack', loop: 'once', handlers: { onClipEnd: replay } });

            player.tick(1.5);
            player.tick(0.3);

            // The player fans `clip-end` out BEFORE it holds, so a handler that
            // replays the clip leaves the ending handle naming an action the new
            // playback is already driving. Pausing that action here freezes the
            // replayed clip for ever under a sample that keeps reporting an
            // ordinary playhead.
            expect(replayed).toBe(true);
            expect(player.activeClips).toEqual(['attack']);
            expect(root.position.x).toBeCloseTo(0.3, 6);
            player.tick(0.3);
            expect(root.position.x).toBeCloseTo(0.6, 6);

            player.dispose();
        });

        it('holds the pose a finished once clip ended on when a ClipPlayer drives it', () => {
            const { root, backend } = makeRig([makeClip('attack', 1)]);
            const originalX = root.position.x;
            const player = new ClipPlayer({
                backend,
                getTimeScale: () => 1,
                report: () => undefined,
            });
            player.play({ clipName: 'attack', loop: 'once' });

            player.tick(0.9);
            const posedBeforeTheEnd = root.position.x;
            player.tick(0.2);

            // Captured before the terminating tick: read afterwards it would be
            // the restored original compared with itself. `clampWhenFinished`
            // holds the last frame right up to the release the terminal branch
            // used to do, which is the bind-pose flash this replaces.
            expect(posedBeforeTheEnd).toBeGreaterThan(originalX);
            expect(root.position.x).toBe(1);
            player.tick(0.5);
            expect(root.position.x).toBe(1);

            player.dispose();
            expect(root.position.x).toBe(originalX);
        });
    });

    describe('one action per clip', () => {
        it('releases the live playback of a clip when the same clip is played again', () => {
            const { backend } = makeRig([makeClip('attack', 1)]);

            const first = play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.7);
            const second = play(backend, 'attack', { loop: 'loop' });

            // three caches one action per (clip, root), so a second play
            // re-targets the SAME action: the first handle is terminal, frozen
            // where it was, and the second starts from zero.
            expect(first.sample()).toEqual({ phase: 0.7, cycle: 0, ended: true });
            expect(second.sample()).toEqual({ phase: 0, cycle: 0, ended: false });

            backend.advance(0.2);
            expect(first.sample().phase).toBe(0.7);
            expect(second.sample().phase).toBeCloseTo(0.2, 12);

            backend.dispose();
        });
    });

    describe('crossfadeTo', () => {
        it('refuses a clip it does not have and a fade that is not a usable length', () => {
            const { backend } = makeRig([makeClip('attack', 1)]);

            expect(backend.crossfadeTo('no-such-clip', 0.2)).toBeNull();
            expect(() => backend.crossfadeTo('attack', -0.2)).toThrow(RangeError);
            expect(() => backend.crossfadeTo('attack', Number.NaN)).toThrow(RangeError);

            backend.dispose();
        });

        it('refuses a bad fade on a clip it does not have and on a disposed backend', () => {
            const { backend } = makeRig([makeClip('attack', 1)]);

            // The refusal runs BEFORE the fail-soft guard, so a sign error is
            // reported where it was written rather than swallowed by the `null`
            // an absent clip answers with. Pairing a bad fade only with a clip
            // the backend HAS leaves the two orderings indistinguishable.
            expect(() => backend.crossfadeTo('no-such-clip', -1)).toThrow(RangeError);
            expect(() => backend.crossfadeTo('no-such-clip', Number.NaN)).toThrow(RangeError);

            backend.dispose();
            expect(() => backend.crossfadeTo('attack', -1)).toThrow(RangeError);
            // A VALID fade still fails soft on both, which is what keeps this an
            // ordering change rather than a contract change.
            expect(backend.crossfadeTo('attack', 0.2)).toBeNull();
        });

        it('refuses it with the message the seam predicate produces', () => {
            const { backend } = makeRig([makeClip('attack', 1)]);
            let seamMessage = '';
            try {
                checkedFade(-0.2);
            } catch (error) {
                seamMessage = (error as RangeError).message;
            }

            // Two copies of the predicate could drift into two different
            // contracts, both green; the message is the observable that says
            // which one ran.
            expect(seamMessage).not.toBe('');
            expect(() => backend.crossfadeTo('attack', -0.2)).toThrow(seamMessage);

            backend.dispose();
        });

        it('cuts on a zero-length fade, deactivating the outgoing action and restoring its node', () => {
            // The two clips drive DIFFERENT properties, so `.position` has one
            // binder and the restore below is unambiguously the outgoing
            // action's binding being handed back.
            const attack = makeClip('attack', 1);
            const { root, mixer, backend } = makeRig([attack, makeScaleClip('idle', 1)]);
            const originalX = root.position.x;

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.4);
            const movedX = root.position.x;
            const outgoing = mixer.clipAction(attack);
            const incoming = backend.crossfadeTo('idle', 0, { loop: 'loop' });

            expect(incoming).not.toBeNull();
            expect(movedX).toBeGreaterThan(originalX);
            // `fadeOut(0)` schedules a degenerate ramp: the action reaches weight
            // 0 on the NEXT update and is disabled there, but `_deactivateAction`
            // never runs — the binding is never handed back, `action.time` never
            // reset. All three below are false under that, synchronously, with
            // no further advance.
            expect(root.position.x).toBe(originalX);
            expect(outgoing.isRunning()).toBe(false);
            expect(outgoing.time).toBe(0);

            backend.dispose();
        });

        it('stops every outgoing playback on a zero-length fade and freezes each handle', () => {
            const attack = makeClip('attack', 1);
            const run = makeClip('run', 1);
            const { mixer, backend } = makeRig([attack, run, makeScaleClip('idle', 1)]);
            const first = play(backend, 'attack', { loop: 'loop' });
            const second = play(backend, 'run', { loop: 'loop' });
            backend.advance(0.4);

            backend.crossfadeTo('idle', 0, { loop: 'loop' });

            // Both halves of the release are pinned here. A bare `action.stop()`
            // without the record release resets the action to 0 and leaves the
            // record live, so each handle would answer phase 0 and `ended: false`
            // — and a loop that cut only the first outgoing record would leave
            // `run` running with a handle that never latched.
            expect(first.sample()).toEqual({ phase: 0.4, cycle: 0, ended: true });
            expect(second.sample()).toEqual({ phase: 0.4, cycle: 0, ended: true });
            expect(mixer.clipAction(attack).isRunning()).toBe(false);
            expect(mixer.clipAction(run).isRunning()).toBe(false);

            backend.advance(0.4);
            expect(first.sample().phase).toBe(0.4);
            expect(second.sample().phase).toBe(0.4);

            backend.dispose();
        });

        it('treats a small positive fade as a fade rather than a cut', () => {
            const attack = makeClip('attack', 1);
            const { mixer, backend } = makeRig([attack, makeScaleClip('idle', 1)]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.4);
            backend.crossfadeTo('idle', 0.05, { loop: 'loop' });

            // The cut arm is an equality on 0, never a threshold: widen it into
            // one and a short blend silently becomes a hard cut, which this
            // separates from a fade by the weight the outgoing action still has.
            expect(mixer.clipAction(attack).isRunning()).toBe(true);
            backend.advance(0.025);
            expect(mixer.clipAction(attack).getEffectiveWeight()).toBeCloseTo(0.5, 6);

            backend.dispose();
        });

        it('refuses an unusable loop mode with nothing yet released', () => {
            const attack = makeClip('attack', 1);
            const { mixer, backend } = makeRig([attack, makeScaleClip('idle', 1)]);
            const outgoing = play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.4);

            expect(() =>
                backend.crossfadeTo('idle', 0, { loop: 'pingpong' as AnimationLoopMode }),
            ).toThrow(RangeError);

            // The incoming clip is started before anything is released, so a
            // refusal there leaves the outgoing playback exactly as it was;
            // releasing first would end it on a call that did nothing.
            expect(outgoing.sample()).toEqual({ phase: 0.4, cycle: 0, ended: false });
            expect(mixer.clipAction(attack).isRunning()).toBe(true);

            backend.dispose();
        });

        it('leaves no action holding a three fade interpolant, on a cut or on a fade', () => {
            const attack = makeClip('attack', 1);
            const idle = makeScaleClip('idle', 1);
            const { mixer, backend } = makeRig([attack, idle]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.4);
            backend.crossfadeTo('idle', 0, { loop: 'loop' });

            expect(weightInterpolantOf(mixer.clipAction(attack))).toBeNull();
            expect(weightInterpolantOf(mixer.clipAction(idle))).toBeNull();

            // And on a real fade too: this backend owns its weight ramps rather
            // than handing them to `fadeIn` / `fadeOut`, whose schedules start
            // from hardcoded endpoints instead of from where the action is.
            backend.crossfadeTo('attack', 0.4, { loop: 'loop' });
            expect(weightInterpolantOf(mixer.clipAction(attack))).toBeNull();
            expect(weightInterpolantOf(mixer.clipAction(idle))).toBeNull();

            // The positive control: the probe can see a scheduled fade, so the
            // four nulls above are the absence of one rather than the absence of
            // a reader. Scheduled directly on the action, since nothing in this
            // backend schedules one any more.
            mixer.clipAction(idle).fadeOut(0.4);
            expect(weightInterpolantOf(mixer.clipAction(idle))).not.toBeNull();

            backend.dispose();
        });

        it('lets stop() cancel a blend that is still posing', () => {
            const attack = makeClip('attack', 2);
            const { root, mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);
            const originalX = root.position.x;
            const outgoing = play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.1);
            expect(root.position.x).not.toBe(originalX);

            outgoing.stop();

            // A released record was frozen and then unreachable: `#stop` returned
            // early on it, so a crossfaded-out action posed at falling weight
            // with no verb left to cancel it until the backend was disposed.
            expect(mixer.clipAction(attack).isRunning()).toBe(false);
            expect(root.position.x).toBe(originalX);
            backend.advance(0.1);
            expect(root.position.x).toBe(originalX);

            backend.dispose();
        });

        it('never raises the interrupted action weight when another blend starts', () => {
            const attack = makeClip('attack', 2);
            const idle = makeClip('idle', 2);
            const run = makeClip('run', 2);
            const { mixer, backend } = makeRig([attack, idle, run]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.1);
            const idleAction = mixer.clipAction(idle);
            const before = idleAction.getEffectiveWeight();
            expect(before).toBeCloseTo(0.25, 6);

            backend.crossfadeTo('run', 0.4, { loop: 'loop' });
            backend.advance(1 / 60);

            // three's `fadeOut` schedules a ramp from a hardcoded 1 rather than
            // from where the action actually is, so a blend interrupted a
            // quarter of the way in snaps back to nearly full weight before it
            // starts falling. The claim is about the INTERRUPTED action: the
            // incoming one rises by design, so a universal over every action
            // would be false of a module that is behaving.
            expect(idleAction.getEffectiveWeight()).toBeLessThanOrEqual(before);

            backend.dispose();
        });

        it('starts at full weight when there is nothing to fade out', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([attack]);

            backend.crossfadeTo('attack', 0.4, { loop: 'loop' });
            const action = mixer.clipAction(attack);

            // A fade-in ramps from 0 — not from the pose on screen — so a blend
            // with nothing outgoing dissolves the model out of its rest pose.
            expect(action.getEffectiveWeight()).toBe(1);
            backend.advance(0.1);
            expect(action.getEffectiveWeight()).toBe(1);

            backend.dispose();
        });

        it('resumes a clip that is still posing instead of restarting it', () => {
            const attack = makeClip('attack', 2);
            const idle = makeClip('idle', 2);
            const { mixer, backend } = makeRig([attack, idle]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(1);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.1);
            const attackAction = mixer.clipAction(attack);
            const weightBefore = attackAction.getEffectiveWeight();
            expect(weightBefore).toBeCloseTo(0.75, 6);

            const resumed = backend.crossfadeTo('attack', 0.4, { loop: 'loop' });
            if (resumed === null) {
                throw new Error('crossfadeTo returned null for a clip the backend has');
            }

            // `play`'s `action.reset()` snaps the playhead to 0 and the weight to
            // 0, which looks worse than the cut the blend replaced. The playhead
            // is kept and the weight rises from where it already is.
            expect(resumed.sample().phase).toBeCloseTo(0.55, 6);
            expect(attackAction.getEffectiveWeight()).toBeCloseTo(weightBefore, 6);
            backend.advance(0.1);
            expect(attackAction.getEffectiveWeight()).toBeGreaterThan(weightBefore);

            backend.dispose();
        });

        it('hard-stops a record that is already posing when another blend starts', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([
                attack,
                makeScaleClip('idle', 2),
                makeClip('run', 2),
            ]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.1);
            const posing = mixer.clipAction(attack);
            expect(posing.isRunning()).toBe(true);

            backend.crossfadeTo('run', 0.4, { loop: 'loop' });

            // Overlapping blends must not accumulate posing actions: the record
            // the first blend left is terminal the moment a second one starts.
            expect(posing.isRunning()).toBe(false);
            expect(posing.time).toBe(0);

            backend.dispose();
        });

        it('fades a held pose out rather than hard-stopping it', () => {
            const attack = makeClip('attack', 2);
            const { root, mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            const playback = play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            playback.hold();
            const held = mixer.clipAction(attack);
            expect(held.getEffectiveWeight()).toBe(1);

            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.2);

            // A held pose is on the screen exactly as a live clip is, so a blend
            // ramps it out instead of ending it: hard-stopping it here would put
            // the model back into its original state on the frame the blend
            // started, which is the pop the blend exists to remove. The node
            // still carrying the held frame is the claim — `isRunning` says
            // nothing here, being false for any paused action. At half weight
            // and no second contributor three mixes the pose toward the node's
            // original state, so the reading is half of the held frame; the
            // FRAME is still the one it was held on, because a held action does
            // not advance while it fades.
            expect(held.time).toBe(0.5);
            expect(held.getEffectiveWeight()).toBeCloseTo(0.5, 6);
            expect(root.position.x).toBeCloseTo(0.125, 6);

            // …and the pose comes down when the ramp arrives, binding and all.
            backend.advance(0.2);
            expect(root.position.x).toBe(0);
            expect(held.time).toBe(0);

            backend.dispose();
        });

        it('fades out of a pose held while its own fade-in was still running', () => {
            const attack = makeClip('attack', 0.3);
            const { root, mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            play(backend, 'idle', { loop: 'loop' });
            const playback = backend.crossfadeTo('attack', 0.6, { loop: 'once' });
            // Past the end of a clip SHORTER than the blend that brought it in:
            // it is held on its last frame with a rising ramp still running, and
            // a blend out of it must fade rather than cut. Reading "does it have
            // a ramp" would call this a blend tail and hard-stop it.
            backend.advance(0.35);
            playback?.hold();
            const held = mixer.clipAction(attack);
            const weightWhenHeld = held.getEffectiveWeight();
            expect(weightWhenHeld).toBeGreaterThan(0);
            expect(weightWhenHeld).toBeLessThan(1);

            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.2);

            expect(held.time).toBe(0.3);
            expect(held.getEffectiveWeight()).toBeCloseTo(weightWhenHeld / 2, 6);
            expect(root.position.x).toBeGreaterThan(0);

            backend.dispose();
        });

        it('ramps a fresh clip in against a pose that is still fading in', () => {
            const attack = makeClip('attack', 0.3);
            const run = makeClip('run', 2);
            const { mixer, backend } = makeRig([attack, run, makeScaleClip('idle', 2)]);

            play(backend, 'idle', { loop: 'loop' });
            const playback = backend.crossfadeTo('attack', 0.6, { loop: 'once' });
            backend.advance(0.35);
            playback?.hold();

            // Nothing is LIVE here — `idle` is fading out and `attack` is a held
            // pose with its own fade-in still running — so the incoming clip's
            // ramp turns entirely on the pose being counted as something to fade
            // in against. Seated at full weight it would pop against a pose that
            // is still most of the screen.
            backend.crossfadeTo('run', 0.4, { loop: 'loop' });

            expect(mixer.clipAction(run).getEffectiveWeight()).toBe(0);
            backend.advance(0.2);
            expect(mixer.clipAction(run).getEffectiveWeight()).toBeCloseTo(0.5, 6);

            backend.dispose();
        });

        it('keeps posing a held clip whose own fade-in arrives', () => {
            const attack = makeClip('attack', 0.3);
            const { root, mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            play(backend, 'idle', { loop: 'loop' });
            const playback = backend.crossfadeTo('attack', 0.6, { loop: 'once' });
            backend.advance(0.35);
            playback?.hold();

            // Past the end of the fade-in the pose was still ramping through.
            backend.advance(0.3);

            // Its arrival settles the pose at full weight; releasing on it would
            // take the last frame off the screen a fraction of a second after it
            // got there, with nothing having asked for anything.
            expect(mixer.clipAction(attack).getEffectiveWeight()).toBe(1);
            // Close rather than exact: three's own interpolant lands a hair under
            // the last key. The weight above is this module's arithmetic and IS
            // exact; a released pose reads 0 here, not a rounding away from 1.
            expect(root.position.x).toBeCloseTo(1, 6);

            backend.dispose();
        });

        it('ramps the incoming clip in against a held pose rather than seating it at full weight', () => {
            const attack = makeClip('attack', 2);
            const idle = makeScaleClip('idle', 2);
            const { mixer, backend } = makeRig([attack, idle]);

            play(backend, 'attack', { loop: 'loop' }).hold();
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });

            // The count of things being faded out is what decides this, and a
            // held pose never was in the live set. Seating the incoming clip at 1
            // against a pose still at full weight pops the other way, because
            // three normalizes the accumulation across contributors.
            expect(mixer.clipAction(idle).getEffectiveWeight()).toBe(0);
            backend.advance(0.2);
            expect(mixer.clipAction(idle).getEffectiveWeight()).toBeCloseTo(0.5, 6);

            backend.dispose();
        });

        it('restarts rather than resumes a blend into a pose clamped at the end of a once clip', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            // Held on its last frame and then faded out by a blend to something
            // else, so it is posing WITH a ramp when the caller asks for it back.
            const playback = play(backend, 'attack', { loop: 'once' });
            backend.advance(2.5);
            expect(playback.sample().phase).toBe(1);
            playback.hold();
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.1);

            const resumed = backend.crossfadeTo('attack', 0.4, { loop: 'once' });

            // `clampWhenFinished` parks a finished action at its clip length, so
            // resuming it poses that frame for ever and plays nothing. The one
            // answer that plays what was asked for is a restart — and the pose it
            // replaces is released on the way, not left owned by nothing.
            expect(resumed?.sample().phase).toBe(0);
            expect(mixer.clipAction(attack).time).toBe(0);
            backend.advance(0.2);
            expect(resumed?.sample().phase).toBeCloseTo(0.1, 6);

            backend.dispose();
        });

        it('resumes a once clip that was faded out before it finished', () => {
            const attack = makeClip('attack', 2);
            const { backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            play(backend, 'attack', { loop: 'once' });
            backend.advance(1);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.1);

            const resumed = backend.crossfadeTo('attack', 0.4, { loop: 'once' });

            // Interrupted is not finished. Nothing has parked this action, so it
            // comes back where it was, exactly as a looping one does; only an
            // action `clampWhenFinished` left AT the end has to restart, and a
            // loop mode alone cannot tell those two apart.
            expect(resumed?.sample().phase).toBeCloseTo(0.55, 6);

            backend.dispose();
        });

        it('resumes a looping posing clip that shared state pushed to phase 1', () => {
            const idle = makeClip('idle', 2);
            const { backend } = makeRig([idle, makeScaleClip('attack', 2)]);

            const playback = play(backend, 'idle', { loop: 'loop' });
            // The same shared-state hazard `state this backend does not own`
            // covers: three wraps at the LIVE duration while this backend divides
            // by the one it captured, so a lengthened clip puts a LOOPING
            // playback at phase 1 — where nothing is finished and nothing is
            // clamped.
            idle.duration = 8;
            backend.advance(3);
            expect(playback.sample().phase).toBe(1);
            backend.crossfadeTo('attack', 0.4, { loop: 'loop' });
            backend.advance(0.1);

            const resumed = backend.crossfadeTo('idle', 0.4, { loop: 'loop' });

            // Resumed, not restarted: the restart is for an action `'once'` and
            // `clampWhenFinished` have parked, and a loop mode is what tells the
            // two apart — the playhead alone cannot.
            expect(resumed?.sample().phase).toBe(1);

            backend.dispose();
        });

        it('hard-stops a held pose on a zero-length fade', () => {
            const attack = makeClip('attack', 2);
            const { root, mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            const playback = play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            playback.hold();

            backend.crossfadeTo('idle', 0, { loop: 'loop' });

            // The negative control for the two cases above: a cut ends a held
            // pose on the transition frame, before anything is advanced, and
            // hands the node back to its original state.
            expect(root.position.x).toBe(0);
            expect(mixer.clipAction(attack).time).toBe(0);

            backend.dispose();
        });

        it('stops the actions it left posing when it is disposed', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            const posing = mixer.clipAction(attack);
            expect(posing.time).toBeCloseTo(0.5, 6);

            backend.dispose();

            // `uncacheAction` deactivates an action and hands its binding back,
            // so the node returns to its original state either way; only a real
            // stop also resets the playhead. That is the observable that says
            // the posing record was released rather than swept up by the
            // uncache loop it happens to be in front of.
            expect(posing.time).toBe(0);
            expect(posing.isRunning()).toBe(false);
        });

        it('seats a released action at the rate it was started at', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);
            const playback = play(backend, 'attack', { loop: 'loop', speed: 0.5 });

            // Rule STEP-BOUNDED's emergency rate: `ClipPlayer` writes
            // `bounded / raw` for exactly one frame's delta, and a released
            // action would otherwise spend its whole fade at it.
            playback.setSpeed(20);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });

            expect(mixer.clipAction(attack).timeScale).toBe(0.5);

            backend.dispose();
        });

        it('does not let a stopped posing handle disturb the playback that resumed its action', () => {
            const attack = makeClip('attack', 2);
            const idle = makeClip('idle', 2);
            const { mixer, backend } = makeRig([attack, idle]);
            const stale = play(backend, 'attack', { loop: 'loop' });
            backend.advance(1);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            const resumed = backend.crossfadeTo('attack', 0.4, { loop: 'loop' });
            if (resumed === null) {
                throw new Error('crossfadeTo returned null for a clip the backend has');
            }

            // Both handles name the same clip and three caches ONE action for
            // it, so a `stop` on the released handle must not reach the action
            // the resumed playback is now driving.
            stale.stop();

            expect(mixer.clipAction(attack).isRunning()).toBe(true);
            backend.advance(0.1);
            expect(resumed.sample().phase).toBeCloseTo(0.55, 6);

            backend.dispose();
        });

        it('releases the posing action when its ramp reaches zero', () => {
            const attack = makeClip('attack', 2);
            const { root, mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);
            const originalX = root.position.x;

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.2);
            expect(mixer.clipAction(attack).isRunning()).toBe(true);

            backend.advance(0.2);

            // The end of the ramp is the end of the posing. Without this the
            // backend accumulates permanently-active weight-0 actions, each
            // still lending a binding, from the first crossfade onwards.
            expect(mixer.clipAction(attack).isRunning()).toBe(false);
            expect(root.position.x).toBe(originalX);

            backend.dispose();
        });

        it('writes this frame ramp position before the mixer applies it', () => {
            const attack = makeClip('attack', 2);
            const { root, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(1);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.2);

            // The clip runs `.position.x` from 0 to 1 across its length, so at
            // phase 0.6 under weight 0.5 the node sits at 0.3 — a mixer updated
            // with the PREVIOUS frame's weight would leave it at 0.6, which is
            // the whole first frame of a blend rendered unblended.
            expect(root.position.x).toBeCloseTo(0.3, 6);

            backend.dispose();
        });

        it('lands exactly on the target weight when advanced past the fade', () => {
            const attack = makeClip('attack', 2);
            const idle = makeScaleClip('idle', 2);
            const { mixer, backend } = makeRig([attack, idle]);

            play(backend, 'attack', { loop: 'loop' });
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            const incoming = mixer.clipAction(idle);
            backend.advance(4);

            // A ramp read as raw elapsed/duration overshoots to -9 and 10 here.
            expect(mixer.clipAction(attack).getEffectiveWeight()).toBe(0);
            expect(incoming.getEffectiveWeight()).toBe(1);

            backend.dispose();
        });

        // The mixer is shared, and its owner may write any weight on any action
        // it can reach. Both ends of the clamp, separately: one fixture tripping
        // a two-sided guard leaves the drop-either-side mutant alive.
        it.each([
            { wrote: 5, halfway: 0.5, note: 'five times the pose for the whole fade' },
            { wrote: -3, halfway: 0, note: 'a negative weight, which is a pose subtracted' },
        ])(
            'seeds a ramp from a usable weight when the mixer owner wrote $wrote',
            ({ wrote, halfway }) => {
                const attack = makeClip('attack', 2);
                const { mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

                play(backend, 'attack', { loop: 'loop' });
                mixer.clipAction(attack).setEffectiveWeight(wrote);
                backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
                backend.advance(0.2);

                expect(mixer.clipAction(attack).getEffectiveWeight()).toBeCloseTo(halfway, 6);

                backend.dispose();
            },
        );

        it('cuts rather than resumes when a zero-length fade names a posing clip', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(1);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            const cut = backend.crossfadeTo('attack', 0, { loop: 'loop' });

            // The resume arm is gated on a positive fade: a cut is a cut even
            // for a clip this backend happens to be fading out, and resuming one
            // mid-pose would leave the caller with a clip it never asked to
            // continue.
            expect(cut?.sample()).toEqual({ phase: 0, cycle: 0, ended: false });
            expect(mixer.clipAction(attack).time).toBe(0);

            backend.dispose();
        });

        it('resumes onto the loop mode and speed the request carried', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            play(backend, 'attack', { loop: 'once', speed: 0.5 });
            backend.advance(1);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });

            backend.crossfadeTo('attack', 0.4, { loop: 'loop', speed: 2 });

            // A resume takes over an action that was seated for the PREVIOUS
            // playback — a different loop mode, a different rate, and, for a
            // 'once' clip, `clampWhenFinished`. Options that reached `play` but
            // not the resume path would be silently dropped for the one call
            // shape that needs them most.
            const action = mixer.clipAction(attack);
            expect(action.timeScale).toBe(2);
            expect(action.loop).toBe(LoopRepeat);
            expect(action.clampWhenFinished).toBe(false);

            backend.dispose();
        });

        it('counts a wrap a resumed looping playback crosses', () => {
            const attack = makeClip('attack', 2);
            const { backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(1.1);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            const resumed = backend.crossfadeTo('attack', 0.4, { loop: 'loop' });

            backend.advance(1.2);

            // `wrapsCrossed` measures the step from `lastPhase`, so a resumed
            // record seeded at 0 rather than at the playhead it took over
            // reports no wrap — and the seated scheduler drops every mark in the
            // clip for that frame.
            expect(resumed?.sample().cycle).toBe(1);

            backend.dispose();
        });

        it('seats the incoming ramp before the caller can draw a frame', () => {
            const attack = makeClip('attack', 2);
            const idle = makeScaleClip('idle', 2);
            const { mixer, backend } = makeRig([attack, idle]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });

            // With no `advance` in between: `play` leaves the incoming action at
            // weight 1, so a ramp installed but not applied renders the incoming
            // clip unblended for every frame drawn before the next tick.
            expect(mixer.clipAction(idle).getEffectiveWeight()).toBe(0);
            expect(mixer.clipAction(attack).getEffectiveWeight()).toBe(1);

            backend.dispose();
        });

        it('takes over the action of a clip that is still posing when it is played again', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(1);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            const replayed = play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.1);

            // A posing record left owned by nothing keeps stepping its own
            // fade-out ramp onto the action `play` just restarted, so the
            // replayed clip would be dragged back down to 0 by its predecessor.
            expect(mixer.clipAction(attack).getEffectiveWeight()).toBe(1);
            expect(replayed.sample().phase).toBeCloseTo(0.05, 6);

            backend.dispose();
        });

        it('resumes against the divisor the playback was started with', () => {
            const attack = makeClip('attack', 2);
            const { backend } = makeRig([attack, makeScaleClip('idle', 2)]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(1);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            // `ModelInstance` hands back the cached asset's `animations` array by
            // reference, so `clip.duration` is public mutable state. A resume
            // that re-read it would move the reported phase of a playhead that
            // did not move at all.
            attack.duration = 8;

            const resumed = backend.crossfadeTo('attack', 0.4, { loop: 'loop' });

            expect(resumed?.sample().phase).toBeCloseTo(0.5, 6);

            backend.dispose();
        });

        it('refuses an unusable loop mode on the resume path with the posing record untouched', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([attack, makeScaleClip('idle', 2)]);
            const outgoing = play(backend, 'attack', { loop: 'loop' });
            backend.advance(1);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.1);
            const posingWeight = mixer.clipAction(attack).getEffectiveWeight();

            expect(() =>
                backend.crossfadeTo('attack', 0.4, { loop: 'pingpong' as AnimationLoopMode }),
            ).toThrow(RangeError);

            // The resume path does not go through `play`, so it owes the same
            // refusal before it touches anything: the posing record is still
            // posing, still frozen, still on the weight it was on.
            expect(outgoing.sample()).toEqual({ phase: 0.5, cycle: 0, ended: true });
            expect(mixer.clipAction(attack).getEffectiveWeight()).toBe(posingWeight);
            expect(mixer.clipAction(attack).isRunning()).toBe(true);

            backend.dispose();
        });

        it('fades the outgoing action out and the incoming one in over the fade', () => {
            const attack = makeClip('attack', 2);
            const idle = makeClip('idle', 2);
            const { mixer, backend } = makeRig([attack, idle]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            const outgoing = mixer.clipAction(attack);
            const incoming = mixer.clipAction(idle);

            backend.advance(0.2);
            expect(outgoing.getEffectiveWeight()).toBeCloseTo(0.5, 6);
            expect(incoming.getEffectiveWeight()).toBeCloseTo(0.5, 6);

            backend.advance(0.2);
            expect(outgoing.getEffectiveWeight()).toBe(0);
            expect(incoming.getEffectiveWeight()).toBe(1);

            backend.dispose();
        });

        it('brings a faded-out clip back at full weight when it is played again', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([attack, makeClip('idle', 2)]);

            play(backend, 'attack', { loop: 'loop' });
            backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            backend.advance(0.5);
            expect(mixer.clipAction(attack).getEffectiveWeight()).toBe(0);

            play(backend, 'attack', { loop: 'loop' });

            // `AnimationAction.reset()` restores `enabled` and the playhead but
            // NOT the weight, so a re-played clip would come back invisible.
            expect(mixer.clipAction(attack).getEffectiveWeight()).toBe(1);

            backend.dispose();
        });

        it('fades in the clip already in flight rather than fading out the action it just took over', () => {
            const attack = makeClip('attack', 2);
            const { mixer, backend } = makeRig([attack]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            const incoming = backend.crossfadeTo('attack', 0.4, { loop: 'loop' });
            backend.advance(0.4);

            // three caches ONE action per (clip, root), so the incoming playback
            // holds the same action the outgoing one did. A fade-out loop that
            // did not exclude this clip would fade out the very action `play`
            // just restarted, and the clip would land invisible while its handle
            // still reported an ordinary playhead.
            expect(incoming).not.toBeNull();
            expect(mixer.clipAction(attack).getEffectiveWeight()).toBe(1);

            backend.dispose();
        });

        it('starts the incoming clip at zero and keeps it advancing after the fade', () => {
            const { backend } = makeRig([makeClip('attack', 2), makeClip('idle', 2)]);

            play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.5);
            const incoming = backend.crossfadeTo('idle', 0.4, { loop: 'loop' });
            if (incoming === null) {
                throw new Error('crossfadeTo returned null for a clip the backend has');
            }

            expect(incoming.sample()).toEqual({ phase: 0, cycle: 0, ended: false });
            backend.advance(1);
            expect(incoming.sample().phase).toBeCloseTo(0.5, 12);

            backend.dispose();
        });
    });

    describe('cycle counts the boundaries a step crossed', () => {
        it('counts the wrap an ordinary two-step pass crossed, and none for a once clip', () => {
            const { backend } = makeRig([makeClip('run', 1), makeClip('attack', 1)]);
            const looping = play(backend, 'run', { loop: 'loop' });
            const once = play(backend, 'attack', { loop: 'once' });

            backend.advance(0.6);
            expect(looping.sample().cycle).toBe(0);
            backend.advance(0.6);
            const wrapped = looping.sample();
            expect(wrapped.phase).toBeCloseTo(0.2, 12);
            expect(wrapped.cycle).toBe(1);
            expect(wrapped.ended).toBe(false);

            // The once clip clamped at 1 and stayed there: `ended` latching never
            // touches `cycle`.
            expect(once.sample()).toEqual({ phase: 1, cycle: 0, ended: true });

            backend.dispose();
        });
    });

    describe('state this backend does not own', () => {
        it('keeps phase at 1 when the shared clip is lengthened mid-playback', () => {
            const clip = makeClip('attack', 1);
            const { backend } = makeRig([clip]);
            const playback = play(backend, 'attack', { loop: 'once' });

            // `ModelInstance` hands back the cached asset's `animations` array by
            // reference, so `clip.duration` is public mutable state. This backend
            // divides by the length it CAPTURED while three keeps reading the
            // live one, and the two diverge the moment anything moves it.
            clip.duration = 8;
            backend.advance(6);

            expect(playback.sample().phase).toBe(1);
            expect(playback.sample().ended).toBe(true);
            // Six captured lengths' worth of step on a clip that cannot wrap:
            // `ended` latching never touches `cycle`, and neither does the step.
            expect(playback.sample().cycle).toBe(0);
        });

        it('does not end a looping playback that the same lengthening pushed to phase 1', () => {
            const clip = makeClip('run', 1);
            const { backend } = makeRig([clip]);
            const playback = play(backend, 'run', { loop: 'loop' });

            clip.duration = 8;
            backend.advance(6);

            // Phase 1 is reachable for a looping clip only through this
            // divergence, and it is not an ending: `ended` belongs to `'once'`.
            expect(playback.sample().phase).toBe(1);
            expect(playback.sample().ended).toBe(false);
        });

        it('answers phase 0 when the shared mixer has been poisoned by its owner', () => {
            const { mixer, backend } = makeRig([makeClip('attack', 1)]);
            const playback = play(backend, 'attack', { loop: 'loop' });
            backend.advance(0.4);

            // The mixer is shared: its owner drives it too, and one non-finite
            // delta there puts `action.time` permanently out of range.
            mixer.update(Number.NaN);

            const sample = playback.sample();
            expect(sample.phase).toBe(0);
            expect(Number.isNaN(sample.phase)).toBe(false);
        });

        it('keeps cycle finite and non-decreasing under any mixer scale its owner writes', () => {
            const { mixer, backend } = makeRig([makeClip('run', 1)]);
            const playback = play(backend, 'run', { loop: 'loop' });
            backend.advance(0.6);
            const before = playback.sample().cycle;

            // `mixer.timeScale` belongs to the mixer's owner and this backend
            // derives its wrap count through it, so the seam's "cycle never
            // decreases" promise has to survive whatever the owner writes there.
            for (const scale of [-1, Number.NaN, Number.POSITIVE_INFINITY, -0.5]) {
                mixer.timeScale = scale;
                backend.advance(0.6);
                const { cycle } = playback.sample();
                expect(cycle, `mixer.timeScale ${scale}`).toBeGreaterThanOrEqual(before);
                expect(Number.isFinite(cycle), `mixer.timeScale ${scale}`).toBe(true);
            }

            backend.dispose();
        });

        it('keeps the first clip registered under a duplicated name', () => {
            const first = makeClip('attack', 1);
            const second = makeClip('attack', 3);
            const { backend } = makeRig([first, second]);

            expect(backend.getDurationSeconds('attack')).toBe(1);

            backend.dispose();
        });

        it('does not let a released handle re-pace the playback that took over its action', () => {
            const clip = makeClip('attack', 1);
            const { mixer, backend } = makeRig([clip]);
            const stale = play(backend, 'attack', { loop: 'loop' });
            const live = play(backend, 'attack', { loop: 'loop', speed: 1 });

            // Both handles name the same clip, and three caches ONE action for
            // it: a `setSpeed` on the released handle must not reach the action
            // the live playback is now driving.
            stale.setSpeed(9);

            expect(mixer.clipAction(clip).timeScale).toBe(1);
            backend.advance(0.1);
            expect(live.sample().phase).toBeCloseTo(0.1, 12);

            backend.dispose();
        });
    });

    describe('advance never poisons the mixer', () => {
        it('does not call through to the mixer for a delta it ignores', () => {
            const { mixer, backend } = makeRig([makeClip('attack', 1)]);
            play(backend, 'attack', { loop: 'loop' });
            const update = vi.spyOn(mixer, 'update');

            for (const delta of [0, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
                backend.advance(delta);
            }

            expect(update).not.toHaveBeenCalled();
            backend.advance(0.25);
            expect(update).toHaveBeenCalledExactlyOnceWith(0.25);

            backend.dispose();
        });
    });
});

// ─── source scan ────────────────────────────────────────────────────────────────

/**
 * Read a sibling module's source. Vite rewrites `new URL(<relative>,
 * import.meta.url)` to a root-relative URL, so the pathname is resolved against
 * cwd when the direct path does not exist — every `pnpm` script's cwd is the
 * vitest `--dir`.
 */
function readModuleSource(fileName: string): string {
    const moduleUrl = new URL(`./${fileName}`, import.meta.url);
    const directPath =
        moduleUrl.protocol === 'file:' ? fileURLToPath(moduleUrl) : moduleUrl.pathname;
    const modulePath = existsSync(directPath)
        ? directPath
        : join(process.cwd(), moduleUrl.pathname);
    return readFileSync(modulePath, 'utf8');
}
