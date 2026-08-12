import { describe, expect, it, vi } from 'vitest';

import type { AnimationTrackSheet } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import { createFakeClipBackend, type FakeClipSpec } from './__test-support__/fakeClipBackend.js';
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
