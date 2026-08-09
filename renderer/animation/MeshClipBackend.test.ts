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
import { supportsBlending } from './ClipBackend.js';
import { ClipPlayer } from './ClipPlayer.js';
import { MeshClipBackend } from './MeshClipBackend.js';
import { describeClipBackend } from './__test-support__/clipBackendContract.js';

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
        release: () => {
            // The mixer is the FIXTURE's allocation, not the backend's.
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
        it('leaves the bound node where it was, however far the backend is advanced', () => {
            const { root, backend } = makeRig([makeClip('attack', 1)]);
            const playback = play(backend, 'attack', { loop: 'loop' });

            backend.advance(0.4);
            const movingX = root.position.x;
            playback.stop();
            backend.advance(0.2);
            const afterStop = root.position.x;
            backend.advance(0.2);

            // The frozen sample is bookkeeping; this is the visible half. An
            // action that was released but never stopped keeps writing its track
            // into the node on every advance — three only hands the node back to
            // its original state when the action is deactivated.
            expect(movingX).toBeGreaterThan(0);
            expect(root.position.x).toBe(afterStop);

            backend.dispose();
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
