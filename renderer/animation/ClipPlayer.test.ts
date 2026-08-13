import { describe, expect, it, vi } from 'vitest';

import type { AnimationTrackSheet } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import {
    createBlendingFakeClipBackend,
    createFakeClipBackend,
    type FakeClipSpec,
} from './__test-support__/fakeClipBackend.js';
import {
    boundedStepSeconds,
    ClipPlayer,
    effectiveClipSpeed,
    MAX_CLIP_SPEED,
    type ClipMarkerHandlers,
} from './ClipPlayer.js';

// ─── fixtures ───────────────────────────────────────────────────────────────────

const sheetOf = (
    clip: AnimationTrackSheet,
): { readonly clips: Record<string, AnimationTrackSheet> } => ({
    clips: { swing: clip },
});

/** A player over `clips`, plus the handles every case reads. */
function makePlayer(
    clips: Readonly<Record<string, FakeClipSpec>>,
    getTimeScale: () => number = () => 1,
): {
    readonly player: ClipPlayer;
    readonly backend: ReturnType<typeof createFakeClipBackend>;
    readonly report: ReturnType<typeof vi.fn>;
    readonly calls: string[];
    readonly handlers: ClipMarkerHandlers;
} {
    const backend = createFakeClipBackend(clips);
    const report = vi.fn();
    const calls: string[] = [];
    const handlers: ClipMarkerHandlers = {
        onNotify: (event) => calls.push(`notify:${event.name}`),
        onPassageStart: (event) => calls.push(`start:${event.name}`),
        onPassageTick: (event) => calls.push(`tick:${event.name}`),
        onPassageEnd: (event) => calls.push(`end:${event.name}:${event.reason}`),
        onClipEnd: () => calls.push('clip-end'),
    };
    const player = new ClipPlayer({ backend, getTimeScale, report });
    return { player, backend, report, calls, handlers };
}

// ─── the three-layer speed stack ────────────────────────────────────────────────

describe('effectiveClipSpeed — clipSpeed x playerSpeed x timeScale', () => {
    it('multiplies all three layers', () => {
        expect(effectiveClipSpeed(0.5, 2, 0.25)).toBe(0.25);
    });

    it('clamps the product at MAX_CLIP_SPEED', () => {
        expect(MAX_CLIP_SPEED).toBe(100);
        expect(effectiveClipSpeed(MAX_CLIP_SPEED, MAX_CLIP_SPEED, 4)).toBe(MAX_CLIP_SPEED);
    });

    it('falls back to real time for a time scale that is not a usable multiplier', () => {
        expect(effectiveClipSpeed(2, 1, Number.NaN)).toBe(2);
        expect(effectiveClipSpeed(2, 1, -1)).toBe(2);
        expect(effectiveClipSpeed(2, 1, Number.POSITIVE_INFINITY)).toBe(2);
    });

    it('accepts a scale of zero, which is a hit-stop rather than a fault', () => {
        expect(effectiveClipSpeed(2, 1, 0)).toBe(0);
    });
});

describe('Rule SPEED-NON-NEGATIVE', () => {
    it('refuses a negative clip or player speed with a RangeError', () => {
        const { player } = makePlayer({ swing: { durationSeconds: 1 } });
        player.play({ clipName: 'swing' });

        expect(() => player.setClipSpeed('swing', -1)).toThrow(RangeError);
        expect(() => player.setPlayerSpeed(-0.5)).toThrow(RangeError);
        expect(() => player.play({ clipName: 'swing', speed: -0.25 })).toThrow(RangeError);
    });

    it('refuses a speed that is not a finite number', () => {
        const { player } = makePlayer({ swing: { durationSeconds: 1 } });

        expect(() => player.setPlayerSpeed(Number.NaN)).toThrow(RangeError);
        expect(() => player.setPlayerSpeed(Number.POSITIVE_INFINITY)).toThrow(RangeError);
    });

    it('accepts zero and clamps an absurd speed rather than refusing it', () => {
        const { player, backend } = makePlayer({ swing: { durationSeconds: 1, loop: 'loop' } });
        player.play({ clipName: 'swing' });

        player.setClipSpeed('swing', 0);
        player.tick(0.5);
        expect(backend.speedOf('swing')).toBe(0);

        player.setClipSpeed('swing', 1e6);
        player.tick(0.001);
        expect(backend.speedOf('swing')).toBe(MAX_CLIP_SPEED);
    });

    it('leaves the player alone when a speed is set for a clip that is not playing', () => {
        const { player } = makePlayer({ swing: { durationSeconds: 1 } });

        expect(() => player.setClipSpeed('idle', 2)).not.toThrow();
        expect(player.activeClips).toEqual([]);
    });
});

// ─── Rule STEP-BOUNDED ──────────────────────────────────────────────────────────

describe('boundedStepSeconds', () => {
    it('passes a step shorter than the clip straight through', () => {
        expect(boundedStepSeconds(0.25, 4)).toBe(0.25);
    });

    it('bounds a step at the clip length it is measured against', () => {
        expect(boundedStepSeconds(10, 0.2)).toBe(0.2);
        expect(boundedStepSeconds(10, 4)).toBe(4);
    });
});

describe('Rule STEP-BOUNDED — the bound is per playback, not per backend', () => {
    it('does not clamp a long clip to a short sibling on the same backend', () => {
        const { player, backend } = makePlayer({
            short: { durationSeconds: 0.2, loop: 'loop' },
            long: { durationSeconds: 4, loop: 'loop' },
        });
        player.play({ clipName: 'short' });
        player.play({ clipName: 'long' });

        player.tick(1);

        // A single shared minimum would hand `long` the 0.2 s bound too, leaving
        // it at phase 0.05 instead of 0.25.
        expect(backend.speedOf('short')).toBe(0.2);
        expect(backend.speedOf('long')).toBe(1);
        expect(backend.sampleOf('long')?.phase).toBe(0.25);
        expect(backend.sampleOf('short')).toEqual({ phase: 0, cycle: 1, ended: false });
    });

    it('advances the backend once per tick, with the raw delta', () => {
        const { player, backend } = makePlayer({
            short: { durationSeconds: 0.2, loop: 'loop' },
            long: { durationSeconds: 4, loop: 'loop' },
        });
        player.play({ clipName: 'short' });
        player.play({ clipName: 'long' });

        player.tick(1);

        expect(backend.advanceCalls).toEqual([1]);
    });

    it('treats a non-finite or negative raw delta as zero', () => {
        const { player, backend } = makePlayer({ swing: { durationSeconds: 1, loop: 'loop' } });
        player.play({ clipName: 'swing' });

        player.tick(Number.NaN);
        player.tick(-1);
        player.tick(Number.POSITIVE_INFINITY);

        expect(backend.advanceCalls).toEqual([0, 0, 0]);
        expect(backend.sampleOf('swing')?.phase).toBe(0);
    });
});

// ─── renderer proportionality ───────────────────────────────────────────────────

describe('time dilation reaches the playhead, with no store and no snapshot', () => {
    it('reaches exactly a quarter of the undilated phase at a quarter scale', () => {
        const deltas = [0.0625, 0.0625, 0.0625, 0.0625];
        const run = (scale: number): number => {
            const { player, backend } = makePlayer(
                { swing: { durationSeconds: 1, loop: 'loop' } },
                () => scale,
            );
            player.play({ clipName: 'swing' });
            for (const delta of deltas) {
                player.tick(delta);
            }
            return backend.sampleOf('swing')?.phase ?? Number.NaN;
        };

        expect(run(1)).toBe(0.25);
        expect(run(0.25)).toBe(0.0625);
        expect(run(0.25)).toBe(run(1) * 0.25);
    });

    it('reads the time scale once per tick, however many clips are in flight', () => {
        // Two clips, because with one the once-per-tick reading and a
        // once-per-playback reading are the same number. Reading it inside the
        // per-playback loop would pace two clips on a backend against two
        // different readings of a scalar that moves every frame.
        const getTimeScale = vi.fn(() => 1);
        const { player } = makePlayer(
            {
                short: { durationSeconds: 1, loop: 'loop' },
                long: { durationSeconds: 4, loop: 'loop' },
            },
            getTimeScale,
        );
        player.play({ clipName: 'short' });
        player.play({ clipName: 'long' });
        const afterPlay = getTimeScale.mock.calls.length;

        player.tick(0.1);

        expect(player.activeClips).toEqual(['short', 'long']);
        expect(getTimeScale.mock.calls.length - afterPlay).toBe(1);
    });

    it('reads the time scale through the injected getter on every tick', () => {
        const getTimeScale = vi.fn(() => 1);
        const { player } = makePlayer(
            { swing: { durationSeconds: 1, loop: 'loop' } },
            getTimeScale,
        );
        player.play({ clipName: 'swing' });
        const afterPlay = getTimeScale.mock.calls.length;

        player.tick(0.1);
        player.tick(0.1);

        expect(getTimeScale.mock.calls.length - afterPlay).toBe(2);
    });
});

// ─── play ───────────────────────────────────────────────────────────────────────

describe('play', () => {
    it('refuses a clip the backend does not have', () => {
        const { player, backend } = makePlayer({ swing: { durationSeconds: 1 } });

        expect(player.play({ clipName: 'missing' })).toBe(false);
        expect(player.activeClips).toEqual([]);
        expect(backend.advanceCalls).toEqual([]);
    });

    it('plays a clip with no sheet at all, unmarked', () => {
        const { player, calls } = makePlayer({ swing: { durationSeconds: 1, loop: 'loop' } });

        expect(player.play({ clipName: 'swing' })).toBe(true);
        player.tick(0.9);

        expect(player.activeClips).toEqual(['swing']);
        expect(calls).toEqual([]);
    });

    it('compiles the sheet against the RUNTIME duration, not the authored one', () => {
        // The sheet says the clip is 2 s long; the loaded clip is 1 s. A notify
        // half a second in therefore sits at phase 0.5, not at 0.25.
        const { player, calls, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
        });
        player.play({
            clipName: 'swing',
            sheet: sheetOf({ durationSeconds: 2, notifies: { hit: { at: { seconds: 0.5 } } } }),
            handlers,
        });

        player.tick(0.3);
        expect(calls).toEqual([]);

        player.tick(0.3);
        expect(calls).toEqual(['notify:hit']);
    });

    it('reports every compile warning the sheet produced', () => {
        const { player, report, handlers } = makePlayer({ swing: { durationSeconds: 1 } });

        player.play({
            clipName: 'swing',
            sheet: sheetOf({ notifies: { broken: { at: { seconds: Number.NaN } } } }),
            handlers,
        });

        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]?.[0]).toContain('broken');
    });

    it('takes the loop mode from the sheet, and lets the request override it', () => {
        // The backend's own default is `'once'`, so a clip that wraps here got
        // its loop mode from the sheet and nowhere else.
        const looping = makePlayer({ swing: { durationSeconds: 1 } });
        looping.player.play({ clipName: 'swing', sheet: sheetOf({ loop: 'loop' }) });
        looping.player.tick(2);
        expect(looping.backend.sampleOf('swing')).toEqual({ phase: 0, cycle: 1, ended: false });

        const once = makePlayer({ swing: { durationSeconds: 1 } });
        once.player.play({ clipName: 'swing', sheet: sheetOf({ loop: 'loop' }), loop: 'once' });
        once.player.tick(2);
        // The ended clip was released, so the backend no longer has a playback.
        expect(once.player.activeClips).toEqual([]);
        expect(once.backend.sampleOf('swing')).toBeNull();
    });

    it('starts the playback already at its dilated speed', () => {
        const { player, backend } = makePlayer(
            { swing: { durationSeconds: 1, loop: 'loop' } },
            () => 0.25,
        );

        player.play({ clipName: 'swing', speed: 2 });

        // Read before any tick: a clip that started at full speed and was
        // corrected one frame later would show 1 here.
        expect(backend.speedOf('swing')).toBe(0.5);
    });
});

// ─── the six-step tick pass ─────────────────────────────────────────────────────

describe('the tick pass samples before it advances', () => {
    it('fires nothing for marks a foreign move of the playhead skipped over', () => {
        const { player, calls, handlers, backend } = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
        });
        player.play({
            clipName: 'swing',
            sheet: sheetOf({ notifies: { hit: { at: 0.6 } } }),
            handlers,
        });

        player.tick(0.3);
        // A crossfade re-seating the action, or any other hand on the playhead.
        backend.jumpTo('swing', { phase: 0.7, cycle: 0, ended: false });
        player.tick(0);

        // Stepping from the scheduler's own last phase instead of the sampled one
        // would sweep (0.3, 0.7] and fire `hit`.
        expect(calls).toEqual([]);
    });

    it('fires nothing for a foreign move that changed only the cycle', () => {
        const { player, calls, handlers, backend } = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
        });
        player.play({
            clipName: 'swing',
            sheet: sheetOf({
                notifies: { hit: { at: 0.6 } },
                passages: { span: { from: 0.1, to: 0.9 } },
            }),
            handlers,
        });

        player.tick(0.3);
        // Same phase, four cycles on. Seating on the phase alone would leave the
        // scheduler's cycle behind and turn this into a wrap, replaying a whole
        // clip's worth of marks for a move the playhead never made.
        backend.jumpTo('swing', { phase: 0.3, cycle: 4, ended: false });
        player.tick(0);

        expect(calls).toEqual(['start:span', 'tick:span']);
    });

    it('still ticks an open passage on a zero-advance step', () => {
        const { player, calls, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
        });
        player.play({
            clipName: 'swing',
            sheet: sheetOf({ passages: { span: { from: 0.25, to: 0.75 } } }),
            handlers,
        });

        player.tick(0.5);
        player.tick(0);

        expect(calls).toEqual(['start:span', 'tick:span']);
    });
});

// ─── Rule CLIP-END-LAST, observed on the handlers ───────────────────────────────

describe('a batch that ends the clip is fanned out in array order', () => {
    it('delivers every passage end before the clip end', () => {
        const { player, calls, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'once', endsAtPhase: 0.8 },
        });
        player.play({
            clipName: 'swing',
            sheet: sheetOf({
                passages: {
                    early: { from: 0.2, to: 0.7 },
                    late: { from: 0.3, to: 1 },
                },
            }),
            handlers,
        });

        player.tick(0.5);
        player.tick(0.5);

        // A player fanning out BY EVENT KIND — every notify, then every passage
        // end, then the clip end — would produce the same array and the same
        // relative order here, so the claim is asserted on the handler calls.
        expect(calls).toEqual([
            'start:early',
            'start:late',
            'end:early:reached-end',
            'end:late:clip-ended',
            'clip-end',
        ]);
    });

    it('drops the clip from the active set once it ended', () => {
        const { player, handlers } = makePlayer({ swing: { durationSeconds: 1, loop: 'once' } });
        player.play({ clipName: 'swing', handlers });

        player.tick(2);

        expect(player.activeClips).toEqual([]);
    });

    it('holds the playback of a clip that ended rather than stopping it', () => {
        const { player, backend, calls, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'once' },
        });
        player.play({
            clipName: 'swing',
            sheet: sheetOf({ passages: { span: { from: 0.2, to: 1 } } }),
            handlers,
        });

        player.tick(2);

        // The two verbs are ledgered apart, so this cannot pass because the
        // other one was called. A stop here restores the model's original state
        // on the same tick the `clip-end` handler runs.
        expect(backend.held).toEqual(['swing']);
        expect(backend.stopped).toEqual([]);
        expect(calls).toEqual(['start:span', 'end:span:reached-end', 'clip-end']);
    });

    it('releases a held playback on stop and fans out nothing for it', () => {
        const { player, backend, calls, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'once' },
        });
        player.play({
            clipName: 'swing',
            sheet: sheetOf({ passages: { span: { from: 0.2, to: 1 } } }),
            handlers,
        });
        player.tick(2);
        const afterTheEnd = [...calls];

        player.stop('swing');

        // Nothing is fanned out for a pose: `#posing` holds a backend handle
        // rather than an entry, so there is no scheduler to close and no
        // handlers to close it to.
        expect(calls).toEqual(afterTheEnd);
        expect(backend.stopped).toEqual(['swing']);
        // …and releasing it twice is still a no-op.
        player.stop('swing');
        expect(backend.stopped).toEqual(['swing']);
    });

    it('releases what a clip end left posing when the same clip is played again', () => {
        const { player, backend, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'once' },
        });
        player.play({ clipName: 'swing', handlers });
        player.tick(2);

        player.play({ clipName: 'swing', handlers });

        // The pose belonged to the playback that ended, not to the clip name: a
        // player that kept it would hold a backend resource for a clip that is
        // playing again, and release it on the NEXT end.
        expect(backend.held).toEqual(['swing']);
        expect(backend.stopped).toEqual(['swing']);
        expect(player.activeClips).toEqual(['swing']);
    });

    it('releases every held playback before it disposes the backend', () => {
        const { player, backend, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'once' },
            jab: { durationSeconds: 1, loop: 'once' },
        });
        // Read INSIDE the backend's dispose: this backend releases whatever it
        // is still holding, so a `stopped` read afterwards says 'swing' whether
        // or not the player released it first, and the ordering claim would pass
        // for a player that never touched its posing map.
        const stoppedWhenDisposed: string[] = [];
        const disposeBackend = backend.dispose.bind(backend);
        vi.spyOn(backend, 'dispose').mockImplementation(() => {
            stoppedWhenDisposed.push(...backend.stopped);
            disposeBackend();
        });
        player.play({ clipName: 'swing', handlers });
        player.play({ clipName: 'jab', handlers });
        // Two clips ending on the same tick, so "every" is a claim the fixture
        // can carry: one held pose leaves a release-the-first-one-only mutant
        // alive.
        player.tick(2);
        expect(backend.held).toEqual(['swing', 'jab']);
        expect(backend.stopped).toEqual([]);

        player.dispose();

        expect(stoppedWhenDisposed).toEqual(['swing', 'jab']);
        expect(backend.stopped).toEqual(['swing', 'jab']);
        expect(backend.disposeCalls).toBe(1);
    });
});

// ─── Rule HANDLER-ISOLATION ─────────────────────────────────────────────────────

describe('Rule HANDLER-ISOLATION', () => {
    function throwingPlayer(): ReturnType<typeof makePlayer> & { readonly seen: string[] } {
        const made = makePlayer({ swing: { durationSeconds: 1, loop: 'loop' } });
        const seen: string[] = [];
        const handlers: ClipMarkerHandlers = {
            onNotify: (event) => {
                seen.push(event.name);
                if (event.name === 'boom') {
                    throw new Error('handler exploded');
                }
            },
        };
        made.player.play({
            clipName: 'swing',
            sheet: sheetOf({ notifies: { boom: { at: 0.25 }, fine: { at: 0.4 } } }),
            handlers,
        });
        return { ...made, seen };
    }

    it('does not re-throw out of tick, and still delivers the rest of the batch', () => {
        const { player, seen } = throwingPlayer();

        expect(() => player.tick(0.5)).not.toThrow();
        expect(seen).toEqual(['boom', 'fine']);
    });

    it('reports the throw exactly once per mark, however often it repeats', () => {
        const { player, report, seen } = throwingPlayer();

        player.tick(0.5);
        // Wraps back past 0.25, so `boom` fires a second time.
        player.tick(0.6);
        player.tick(0.3);

        expect(seen.filter((name) => name === 'boom')).toHaveLength(2);
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]?.[0]).toContain('boom');
        expect(report.mock.calls[0]?.[1]).toBeInstanceOf(Error);
    });

    it('reports a throwing clip-end handler once, across two clips that ended', () => {
        // `clip-end` carries no mark name, so it has its own once-per-player
        // ledger; nothing else in this file reaches that branch.
        const { player, report } = makePlayer({ swing: { durationSeconds: 1, loop: 'once' } });
        let handled = 0;
        const handlers: ClipMarkerHandlers = {
            onClipEnd: () => {
                handled += 1;
                throw new Error('handler exploded');
            },
        };

        player.play({ clipName: 'swing', handlers });
        expect(() => player.tick(2)).not.toThrow();
        player.play({ clipName: 'swing', handlers });
        player.tick(2);

        expect(handled).toBe(2);
        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]?.[0]).toContain('clip-end');
    });

    it('reports a second mark separately from the first', () => {
        const { player, report } = makePlayer({ swing: { durationSeconds: 1, loop: 'loop' } });
        player.play({
            clipName: 'swing',
            sheet: sheetOf({ notifies: { one: { at: 0.25 }, two: { at: 0.4 } } }),
            handlers: {
                onNotify: () => {
                    throw new Error('handler exploded');
                },
            },
        });

        player.tick(0.5);

        expect(report).toHaveBeenCalledTimes(2);
    });
});

// ─── stop, replace, dispose ─────────────────────────────────────────────────────

describe('the reasons a player ends a passage', () => {
    function openPassage(): ReturnType<typeof makePlayer> {
        const made = makePlayer({ swing: { durationSeconds: 1, loop: 'loop' } });
        made.player.play({
            clipName: 'swing',
            sheet: sheetOf({ passages: { span: { from: 0.2, to: 0.9 } } }),
            handlers: made.handlers,
        });
        made.player.tick(0.5);
        return made;
    }

    it('stops a clip with reason stopped and releases its playback', () => {
        const { player, calls, backend } = openPassage();

        player.stop('swing');

        expect(calls).toEqual(['start:span', 'end:span:stopped']);
        expect(backend.stopped).toEqual(['swing']);
        expect(player.activeClips).toEqual([]);
    });

    it('ignores a stop for a clip that is not playing', () => {
        const { player, calls } = openPassage();

        player.stop('idle');

        expect(calls).toEqual(['start:span']);
    });

    it('replaces a live playback of the same clip with reason clip-changed', () => {
        const { player, calls, backend } = openPassage();

        expect(player.play({ clipName: 'swing' })).toBe(true);

        expect(calls).toEqual(['start:span', 'end:span:clip-changed']);
        expect(backend.stopped).toEqual(['swing']);
        expect(player.activeClips).toEqual(['swing']);
    });

    it('leaves the live playback alone when the replacement cannot start', () => {
        const { player, calls } = openPassage();

        expect(player.play({ clipName: 'missing' })).toBe(false);

        expect(calls).toEqual(['start:span']);
        expect(player.activeClips).toEqual(['swing']);
    });

    it('leaves the live playback alone when the replacement is refused for its speed', () => {
        // The speed is checked BEFORE anything is started or replaced. Checking it
        // after the teardown would close the live passage with `clip-changed` and
        // release its playback, then throw with nothing to show for it.
        const { player, calls, backend } = openPassage();

        expect(() => player.play({ clipName: 'swing', speed: -1 })).toThrow(RangeError);

        expect(calls).toEqual(['start:span']);
        expect(player.activeClips).toEqual(['swing']);
        expect(backend.stopped).toEqual([]);
    });

    it('releases everything on dispose and disposes the backend', () => {
        const { player, calls, backend } = openPassage();

        player.dispose();

        expect(calls).toEqual(['start:span', 'end:span:released']);
        expect(backend.disposeCalls).toBe(1);
        expect(player.activeClips).toEqual([]);
    });

    it('answers isDisposed false while live and true once disposed', () => {
        // The one channel that separates the two `false`s `play` returns: a
        // disposed player, and a clip the backend cannot play. A caller that
        // reports the second as an authoring fault has to be able to rule out
        // the first — see `useClipPlayback.ts`'s playback effect.
        const { player } = openPassage();

        expect(player.isDisposed).toBe(false);

        player.dispose();

        expect(player.isDisposed).toBe(true);
    });

    it('is idempotent on dispose, and neither plays nor ticks afterwards', () => {
        const { player, calls, backend } = openPassage();

        player.dispose();
        player.dispose();
        player.tick(0.5);
        // Both halves of "a disposed player plays and ticks nothing": a play that
        // still started would put a clip back on a disposed backend.
        expect(player.play({ clipName: 'swing' })).toBe(false);
        expect(player.activeClips).toEqual([]);

        expect(calls).toEqual(['start:span', 'end:span:released']);
        // Counted rather than flagged: a second `dispose` reaching the backend is
        // invisible to a boolean, and disposing a released mixer twice is exactly
        // the shape a dispose guard exists to prevent.
        expect(backend.disposeCalls).toBe(1);
        expect(backend.advanceCalls).toEqual([0.5]);
    });

    it('starts nothing when the backend gives a playback but no duration for it', () => {
        // The converse of the case below. Without the duration guard the entry
        // registers with a `null` length, which `boundedStepSeconds` turns into a
        // zero-second step: the clip is active and frozen.
        const player = new ClipPlayer({
            backend: {
                getDurationSeconds: () => null,
                play: () => ({
                    clipName: 'swing',
                    sample: () => ({ phase: 0, cycle: 0, ended: false }),
                    setSpeed: () => {},
                    stop: () => {},
                    hold: () => {},
                }),
                advance: () => {},
                dispose: () => {},
            },
            getTimeScale: () => 1,
            report: () => {},
        });

        expect(player.play({ clipName: 'swing' })).toBe(false);
        expect(player.activeClips).toEqual([]);
    });

    it('starts nothing when the backend has the clip but refuses to play it', () => {
        // The two `null`s a backend can answer are independent: it may know a
        // clip's length and still fail to allocate a playback for it. The fake
        // answers both from one condition, so this case needs a stub that does not.
        const calls: string[] = [];
        const player = new ClipPlayer({
            backend: {
                getDurationSeconds: () => 1,
                play: () => null,
                advance: () => {},
                dispose: () => {},
            },
            getTimeScale: () => 1,
            report: (message) => calls.push(message),
        });

        expect(player.play({ clipName: 'swing' })).toBe(false);
        expect(player.activeClips).toEqual([]);
        expect(calls).toEqual([]);
    });
});

// ─── becoming the only clip ─────────────────────────────────────────────────────

describe('transitionTo — become the only clip', () => {
    const SPAN = sheetOf({ passages: { span: { from: 0.2, to: 0.9 } } });

    /** A player with `swing` live and its passage open. */
    function withSwingOpen(): ReturnType<typeof makePlayer> {
        const made = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
            jab: { durationSeconds: 1, loop: 'loop' },
            kick: { durationSeconds: 1, loop: 'loop' },
        });
        made.player.play({ clipName: 'swing', sheet: SPAN, handlers: made.handlers });
        made.player.tick(0.5);
        return made;
    }

    it('leaves exactly the incoming clip active and closes every other one once', () => {
        const { player, calls, backend } = withSwingOpen();
        player.play({ clipName: 'jab', sheet: SPAN, handlers: {} });
        expect(player.activeClips).toEqual(['swing', 'jab']);

        expect(player.transitionTo({ clipName: 'kick', handlers: {} })).toBe(true);

        // `play` releases only the same-name entry, so a transition that fell
        // through to it would leave every earlier clip live at full weight: an
        // averaged pose that never resolves, and marks firing for ever.
        expect(player.activeClips).toEqual(['kick']);
        expect(calls).toEqual(['start:span', 'end:span:clip-changed']);
        expect(backend.stopped).toEqual(['swing', 'jab']);
    });

    it('releases the others even when the incoming clip is one of the live ones', () => {
        const { player, calls, backend } = withSwingOpen();
        player.play({ clipName: 'jab', sheet: SPAN, handlers: {} });

        expect(player.transitionTo({ clipName: 'swing', sheet: SPAN, handlers: {} })).toBe(true);

        // The same-name replacement and the others are two separate releases,
        // and neither is a branch of the other: scoping the second to "there was
        // no same-name entry" leaves `jab` live at full weight for ever.
        expect(player.activeClips).toEqual(['swing']);
        expect(calls).toEqual(['start:span', 'end:span:clip-changed']);
        expect(backend.stopped).toEqual(['swing', 'jab']);
    });

    it('emits no clip-end for the clips it replaced', () => {
        // The outgoing clip is `'once'` and the tick below runs past its end, so
        // a transition that left it live really would produce the `clip-end`
        // this case denies. Against a looping fixture the assertion is
        // unreachable and the case cannot fail.
        const { player, calls, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'once' },
            jab: { durationSeconds: 4, loop: 'loop' },
        });
        player.play({ clipName: 'swing', handlers });
        player.tick(0.5);

        player.transitionTo({ clipName: 'jab', handlers });
        player.tick(1);

        // A replaced clip did not END; `clip-end` is the playhead's word and the
        // scheduler is its only producer.
        expect(calls).not.toContain('clip-end');
        expect(player.activeClips).toEqual(['jab']);
    });

    it('restarts a clip that is already live, exactly as play does', () => {
        const { player, calls, backend } = withSwingOpen();

        expect(player.transitionTo({ clipName: 'swing', sheet: SPAN, handlers: {} })).toBe(true);

        expect(player.activeClips).toEqual(['swing']);
        expect(calls).toEqual(['start:span', 'end:span:clip-changed']);
        expect(backend.stopped).toEqual(['swing']);
        expect(backend.sampleOf('swing')).toEqual({ phase: 0, cycle: 0, ended: false });
    });

    it('refuses a bad speed before it starts, releases or takes down anything', () => {
        const { player, calls, backend, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
            jab: { durationSeconds: 1, loop: 'loop' },
            kick: { durationSeconds: 0.4, loop: 'once' },
        });
        player.play({ clipName: 'swing', sheet: SPAN, handlers });
        // A pose in flight as well as a live clip, so "takes down" is a ledger
        // this case actually reads rather than a word in its title.
        player.play({ clipName: 'kick', handlers });
        player.tick(0.5);
        expect(backend.held).toEqual(['kick']);

        const before = [...calls];

        expect(() => player.transitionTo({ clipName: 'jab', speed: -1 })).toThrow(RangeError);

        expect(player.activeClips).toEqual(['swing']);
        expect(calls).toEqual(before);
        expect(backend.stopped).toEqual([]);
        expect(backend.held).toEqual(['kick']);
        expect(backend.sampleOf('jab')).toBeNull();
    });

    it('answers false and changes nothing for a clip the backend has not got', () => {
        const { player, calls, backend } = withSwingOpen();

        expect(player.transitionTo({ clipName: 'missing' })).toBe(false);

        expect(player.activeClips).toEqual(['swing']);
        expect(calls).toEqual(['start:span']);
        expect(backend.stopped).toEqual([]);
    });

    it('answers false for a disposed player, which is how a caller tells the two apart', () => {
        const { player } = withSwingOpen();
        player.dispose();

        expect(player.transitionTo({ clipName: 'jab' })).toBe(false);
    });

    it('seats a declared speed on the entry and on the first frame', () => {
        const { player, backend } = makePlayer(
            {
                swing: { durationSeconds: 1, loop: 'loop' },
                jab: { durationSeconds: 1, loop: 'loop' },
            },
            () => 0.25,
        );
        player.play({ clipName: 'swing' });

        player.transitionTo({ clipName: 'jab', speed: 2 });

        // 2 x 1 x 0.25 = 0.5, which is neither the declared 2 nor the default 1:
        // factors that cancel would leave a first frame paced at the bare clip
        // speed indistinguishable from one paced by the folded stack.
        expect(backend.speedOf('jab')).toBeCloseTo(0.5, 12);
        // …and the clip's own layer survives on the entry, so a later tick
        // re-folds the same 2 rather than a 1.
        player.tick(1);
        expect(backend.speedOf('jab')).toBeCloseTo(0.5, 12);
    });

    it('keeps the clip a handler played during the clip-changed fan-out', () => {
        // Both clips carry the passage, so the restarted one has marks of its
        // own to fire — a sheet naming only the outgoing clip would leave the
        // incoming one unmarked and this case green for the wrong reason.
        const BOTH = {
            clips: {
                swing: { passages: { span: { from: 0.2, to: 0.9 } } },
                jab: { passages: { span: { from: 0.2, to: 0.9 } } },
            },
        };
        const { player, calls, backend } = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
            jab: { durationSeconds: 1, loop: 'loop' },
        });
        let restarts = 0;
        const handlers: ClipMarkerHandlers = {
            onPassageStart: (event) => calls.push(`start:${event.name}`),
            onPassageEnd: (event) => {
                calls.push(`end:${event.name}:${event.reason}`);
                if (restarts === 0) {
                    restarts += 1;
                    player.play({ clipName: 'jab', sheet: BOTH, handlers });
                }
            },
        };
        player.play({ clipName: 'swing', sheet: BOTH, handlers });
        player.tick(0.3);

        player.transitionTo({ clipName: 'jab', sheet: BOTH, handlers });

        // The incoming entry is registered BEFORE the outgoing release fans out,
        // so the entry a handler installs from that fan-out is the one that
        // survives — registering afterwards would overwrite it and strand its
        // playback on the backend.
        expect(player.activeClips).toEqual(['jab']);
        player.tick(0.3);
        expect(calls).toEqual(['start:span', 'end:span:clip-changed', 'start:span']);
        // The handler's play stops the playback this call started, from inside
        // the release that invoked it, before the outgoing clip is let go.
        expect(backend.stopped).toEqual(['jab', 'swing']);
    });

    it('takes down a pose a clip end left holding', () => {
        const { player, backend, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'once' },
            jab: { durationSeconds: 1, loop: 'loop' },
        });
        player.play({ clipName: 'swing', handlers });
        player.tick(2);
        expect(backend.held).toEqual(['swing']);

        player.transitionTo({ clipName: 'jab' });

        // Becoming the only clip means the poses of the clips that ended come
        // down too, not just the live ones.
        expect(backend.stopped).toEqual(['swing']);
        expect(player.activeClips).toEqual(['jab']);
    });
});

describe('transitionTo — the blend', () => {
    const SPAN = sheetOf({ passages: { span: { from: 0.2, to: 0.9 } } });
    const CLIPS = {
        swing: { durationSeconds: 1, loop: 'loop' },
        guard: { durationSeconds: 1, loop: 'loop' },
    } as const;

    /** A player over the BLENDING double, with `swing` live and its passage open. */
    function blendingPlayer(): {
        readonly player: ClipPlayer;
        readonly backend: ReturnType<typeof createBlendingFakeClipBackend>;
        readonly calls: string[];
    } {
        const backend = createBlendingFakeClipBackend(CLIPS);
        const calls: string[] = [];
        const handlers: ClipMarkerHandlers = {
            onPassageStart: (event) => calls.push(`start:${event.name}`),
            onPassageEnd: (event) => calls.push(`end:${event.name}:${event.reason}`),
            onClipEnd: () => calls.push('clip-end'),
        };
        const player = new ClipPlayer({
            backend,
            getTimeScale: () => 1,
            report: () => undefined,
        });
        player.play({ clipName: 'swing', sheet: SPAN, handlers });
        player.tick(0.5);
        return { player, backend, calls };
    }

    it('routes a positive blend through crossfadeTo and holds what it replaced', () => {
        const { player, backend, calls } = blendingPlayer();

        expect(player.transitionTo({ clipName: 'guard', blendSeconds: 0.3 })).toBe(true);

        expect(backend.crossfadeCalls).toEqual([
            { clipName: 'guard', fadeSeconds: 0.3, options: { speed: 1 } },
        ]);
        // HELD, not stopped: the backend has already released the outgoing
        // playback into its own posing set with a ramp running, and stopping it
        // here would leave the blend with nothing to fade out of.
        expect(backend.held).toEqual(['swing']);
        expect(backend.stopped).toEqual([]);
        expect(player.activeClips).toEqual(['guard']);
        // The passage still closes, and for the reason a replacement closes it.
        expect(calls).toEqual(['start:span', 'end:span:clip-changed']);
    });

    it('cuts when the backend cannot blend, however long the blend asked for', () => {
        const backend = createFakeClipBackend(CLIPS);
        const player = new ClipPlayer({ backend, getTimeScale: () => 1, report: () => undefined });
        player.play({ clipName: 'swing' });

        expect(player.transitionTo({ clipName: 'guard', blendSeconds: 0.3 })).toBe(true);

        // The conjunct that keeps a sprite atlas out of the blending path: it
        // has no weights to interpolate, and a blend that silently did nothing
        // would be worse than a cut.
        expect(backend.stopped).toEqual(['swing']);
        expect(backend.held).toEqual([]);
        expect(player.activeClips).toEqual(['guard']);
    });

    it('cuts on a blend of zero, on a backend that could have blended', () => {
        const { player, backend } = blendingPlayer();

        player.transitionTo({ clipName: 'guard', blendSeconds: 0 });

        expect(backend.crossfadeCalls).toEqual([]);
        expect(backend.stopped).toEqual(['swing']);
        expect(backend.held).toEqual([]);
    });

    it('cuts when no blend is asked for at all', () => {
        const { player, backend } = blendingPlayer();

        player.transitionTo({ clipName: 'guard' });

        expect(backend.crossfadeCalls).toEqual([]);
        expect(backend.stopped).toEqual(['swing']);
    });

    it('cuts a same-name request, because there is nothing to blend out of', () => {
        const { player, backend } = blendingPlayer();

        player.transitionTo({ clipName: 'swing', blendSeconds: 0.3 });

        // A blend from a clip to itself is a fade-out of the very action the
        // incoming playback took over, so it is a restart at full weight.
        expect(backend.crossfadeCalls).toEqual([]);
        expect(backend.stopped).toEqual(['swing']);
        expect(backend.held).toEqual([]);
    });

    it('cuts when the incoming clip is one of the clips already live', () => {
        const { player, backend } = blendingPlayer();
        player.play({ clipName: 'guard' });

        player.transitionTo({ clipName: 'guard', blendSeconds: 0.3 });

        // The conjunct is "the incoming clip is not already in flight", not
        // "something else is": with `guard` live alongside `swing`, a blend into
        // `guard` would fade out the very action the incoming playback takes
        // over.
        expect(backend.crossfadeCalls).toEqual([]);
        expect(backend.stopped).toEqual(['guard', 'swing']);
        expect(backend.held).toEqual([]);
    });

    it('still routes through crossfadeTo when there is nothing live to blend out of', () => {
        const backend = createBlendingFakeClipBackend(CLIPS);
        const player = new ClipPlayer({ backend, getTimeScale: () => 1, report: () => undefined });

        player.transitionTo({ clipName: 'guard', blendSeconds: 0.3 });

        // The backend is what decides a blend with nothing outgoing is a plain
        // start at full weight; the player asks for the blend either way, so
        // widening the conjunct to "something else is live" is visible here.
        expect(backend.crossfadeCalls).toEqual([
            { clipName: 'guard', fadeSeconds: 0.3, options: { speed: 1 } },
        ]);
    });

    it('cuts a blend into a clip this player is still posing, and restarts it', () => {
        const backend = createBlendingFakeClipBackend({
            swing: { durationSeconds: 1, loop: 'loop' },
            guard: { durationSeconds: 0.4, loop: 'once' },
        });
        const player = new ClipPlayer({ backend, getTimeScale: () => 1, report: () => undefined });
        player.play({ clipName: 'guard' });
        player.tick(0.5);
        expect(backend.held).toEqual(['guard']);

        player.transitionTo({ clipName: 'guard', blendSeconds: 0.3 });

        // A clip the player is posing has ENDED, and a caller asking for it
        // again wants it from the top. Blending into it makes the backend resume
        // the held action where it stopped — on a finished clip, its last frame,
        // for ever.
        expect(backend.crossfadeCalls).toEqual([]);
        expect(backend.stopped).toEqual(['guard']);
        expect(backend.sampleOf('guard')).toEqual({ phase: 0, cycle: 0, ended: false });
    });

    it('blends on every transition of an alternation, not every other one', () => {
        const { player, backend } = blendingPlayer();

        player.transitionTo({ clipName: 'guard', blendSeconds: 0.3 });
        player.tick(1);
        player.transitionTo({ clipName: 'swing', blendSeconds: 0.3 });
        player.tick(1);
        player.transitionTo({ clipName: 'guard', blendSeconds: 0.3 });

        // A→B→A is the ordinary case for the only production caller, which
        // transitions on every clip change. A player that remembered a clip as
        // "posing" after its fade had ended would refuse to blend back into it,
        // and the alternation would degrade to blend, cut, blend.
        expect(backend.crossfadeCalls.map((call) => call.clipName)).toEqual([
            'guard',
            'swing',
            'guard',
        ]);
    });

    it('leaves a blend in flight reachable by stopAll', () => {
        const { player, backend } = blendingPlayer();
        player.transitionTo({ clipName: 'guard', blendSeconds: 0.3 });
        expect(backend.held).toEqual(['swing']);

        player.stopAll();

        // "Play nothing" has to mean nothing: a playback the blend left posing
        // is in neither set a caller can name, so the player keeps it where
        // `stopAll` and `dispose` can still reach it. The live clip goes first
        // and the pose after, which is the order `stopAll` walks.
        expect(backend.stopped).toEqual(['guard', 'swing']);
        expect(player.activeClips).toEqual([]);
    });

    it('threads the folded speed stack through the blend', () => {
        const backend = createBlendingFakeClipBackend(CLIPS);
        const player = new ClipPlayer({
            backend,
            getTimeScale: () => 0.5,
            report: () => undefined,
        });
        player.play({ clipName: 'swing' });

        player.transitionTo({ clipName: 'guard', blendSeconds: 0.3, speed: 0.5 });

        // 0.5 x 1 x 0.5: a blended change owes the incoming clip the same first
        // frame a cut does, or a clip declared at half speed plays its first
        // frame at a quarter rate and is corrected on the next tick.
        expect(backend.crossfadeCalls).toEqual([
            { clipName: 'guard', fadeSeconds: 0.3, options: { speed: 0.25 } },
        ]);
        expect(backend.speedOf('guard')).toBe(0.25);
        player.tick(0.1);
        expect(backend.speedOf('guard')).toBe(0.25);
    });

    it.each([-0.2, Number.NaN, Number.POSITIVE_INFINITY])(
        'refuses a blend of %s before anything is started, released or held',
        (blendSeconds) => {
            const { player, backend, calls } = blendingPlayer();

            expect(() => player.transitionTo({ clipName: 'guard', blendSeconds })).toThrow(
                RangeError,
            );

            expect(player.activeClips).toEqual(['swing']);
            expect(calls).toEqual(['start:span']);
            expect(backend.stopped).toEqual([]);
            expect(backend.held).toEqual([]);
            expect(backend.crossfadeCalls).toEqual([]);
            expect(backend.sampleOf('guard')).toBeNull();
        },
    );

    it('refuses a bad blend on a backend that cannot blend either', () => {
        const backend = createFakeClipBackend(CLIPS);
        const player = new ClipPlayer({ backend, getTimeScale: () => 1, report: () => undefined });
        player.play({ clipName: 'swing' });

        // A `blendSeconds > 0` test alone would send this down the cut path and
        // lose the refusal on exactly the backend where the value is inert.
        expect(() => player.transitionTo({ clipName: 'guard', blendSeconds: -1 })).toThrow(
            RangeError,
        );
        expect(backend.stopped).toEqual([]);
        expect(player.activeClips).toEqual(['swing']);
    });
});

describe('stopAll', () => {
    const SPAN = sheetOf({ passages: { span: { from: 0.2, to: 0.9 } } });

    it('closes every active clip as stopped and releases every pose', () => {
        // TWO clips still active when the call comes, so "every" is a claim the
        // fixture carries: with one, a stopAll that closed only the first entry
        // ships green. `jab` is short enough to end into a pose inside the same
        // tick, so the call also has something held to take down.
        const BOTH = {
            clips: {
                swing: { passages: { span: { from: 0.2, to: 0.9 } } },
                kick: { passages: { arc: { from: 0.2, to: 0.9 } } },
            },
        };
        const { player, calls, backend, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
            kick: { durationSeconds: 1, loop: 'loop' },
            jab: { durationSeconds: 0.4, loop: 'once' },
        });
        player.play({ clipName: 'swing', sheet: BOTH, handlers });
        player.play({ clipName: 'kick', sheet: BOTH, handlers });
        player.play({ clipName: 'jab', handlers });
        player.tick(0.5);
        expect(backend.held).toEqual(['jab']);
        expect(player.activeClips).toEqual(['swing', 'kick']);

        player.stopAll();

        expect(player.activeClips).toEqual([]);
        // `jab` ended on its own before the call, so its own `clip-end` is in
        // here; what `stopAll` produced is the two `'stopped'` closes.
        expect(calls).toEqual([
            'start:span',
            'start:arc',
            'clip-end',
            'end:span:stopped',
            'end:arc:stopped',
        ]);
        expect(backend.stopped).toEqual(['swing', 'kick', 'jab']);
    });

    it('is idempotent and leaves the player usable', () => {
        const { player, calls, backend, handlers } = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
        });
        player.play({ clipName: 'swing', sheet: SPAN, handlers });
        player.tick(0.5);

        player.stopAll();
        player.stopAll();

        expect(calls).toEqual(['start:span', 'end:span:stopped']);
        expect(backend.stopped).toEqual(['swing']);
        expect(player.play({ clipName: 'swing' })).toBe(true);
        expect(player.activeClips).toEqual(['swing']);
    });
});

// ─── handlers that call back into the player ────────────────────────────────────

describe('a handler that restarts its own clip during the fan-out', () => {
    const SPAN_SHEET = sheetOf({ passages: { span: { from: 0.2, to: 0.9 } } });
    const HIT_SHEET = sheetOf({ notifies: { hit: { at: 0.5 } } });

    it('keeps the clip a clip-end handler started, and keeps ticking it', () => {
        // Chaining the next clip from `onClipEnd` is what that handler is for.
        // Both teardown paths fan out BEFORE they clean up, so a cleanup that
        // removed whatever sits under the clip name would delete the playback the
        // handler had just installed.
        const { player, calls } = makePlayer({ swing: { durationSeconds: 1, loop: 'once' } });
        let restarts = 0;
        const handlers: ClipMarkerHandlers = {
            onNotify: (event) => calls.push(`notify:${event.name}`),
            onClipEnd: () => {
                calls.push('clip-end');
                if (restarts === 0) {
                    restarts += 1;
                    player.play({ clipName: 'swing', sheet: HIT_SHEET, handlers });
                }
            },
        };
        player.play({ clipName: 'swing', sheet: HIT_SHEET, handlers });

        player.tick(2);
        expect(player.activeClips).toEqual(['swing']);

        player.tick(0.6);
        expect(calls).toEqual(['notify:hit', 'clip-end', 'notify:hit']);
    });

    it('leaves no playback behind when the restart comes from a clip-changed close', () => {
        // The registration site, not the teardown site: `play` fans out the
        // outgoing `clip-changed` close, and a handler that plays this clip again
        // during that fan-out installs its own entry. Registering after the
        // fan-out would overwrite it and strand its playback on the backend.
        const { player, calls, backend } = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
        });
        let restarts = 0;
        const handlers: ClipMarkerHandlers = {
            onPassageStart: (event) => calls.push(`start:${event.name}`),
            onPassageEnd: (event) => {
                calls.push(`end:${event.name}:${event.reason}`);
                if (restarts === 0) {
                    restarts += 1;
                    player.play({ clipName: 'swing', sheet: SPAN_SHEET, handlers });
                }
            },
        };
        player.play({ clipName: 'swing', sheet: SPAN_SHEET, handlers });
        player.tick(0.3);

        player.play({ clipName: 'swing', sheet: SPAN_SHEET, handlers });
        player.tick(0.3);
        player.stop('swing');

        expect(calls).toEqual([
            'start:span',
            'end:span:clip-changed',
            'start:span',
            'end:span:stopped',
        ]);
        expect(player.activeClips).toEqual([]);
        // Every playback the player started is one the player released: the
        // backend holds none once the last clip is stopped.
        expect(backend.sampleOf('swing')).toBeNull();
    });

    it('keeps the clip a stop-time passage-end handler started', () => {
        const { player, calls, backend } = makePlayer({
            swing: { durationSeconds: 1, loop: 'loop' },
        });
        let restarted = false;
        const handlers: ClipMarkerHandlers = {
            onPassageStart: (event) => calls.push(`start:${event.name}`),
            onPassageEnd: (event) => {
                calls.push(`end:${event.name}:${event.reason}`);
                if (!restarted) {
                    restarted = true;
                    player.play({ clipName: 'swing', sheet: SPAN_SHEET, handlers });
                }
            },
        };
        player.play({ clipName: 'swing', sheet: SPAN_SHEET, handlers });

        player.tick(0.3);
        player.stop('swing');
        expect(player.activeClips).toEqual(['swing']);

        player.tick(0.3);
        expect(calls).toEqual(['start:span', 'end:span:stopped', 'start:span']);
        // The clip the handler started is the live one; the stopped playback was
        // released exactly once.
        expect(backend.stopped).toEqual(['swing']);
    });
});
