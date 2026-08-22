/**
 * renderer/audio/cueSampler.test.ts
 *
 * Architecture reference: §4.25 — Audio System → Cue, Fade & Crossfade Extensions.
 *
 * What is under test is the CHAIN and the registry, not the cue maths: the sampler
 * threads {@link stepCueScheduler} — whose rules have their own tests — between two
 * seams it owns, a frame source and a per-voice playhead reader, and everything that
 * can go wrong here is about WHEN a frame exists and WHO is handed its batch.
 *
 * Both seams are doubles, so no test here touches `requestAnimationFrame`, an
 * `AudioContext` or a timer. The frame source is the shared
 * {@link FrameSourceDouble}: it counts frames REQUESTED separately from frames IN
 * FLIGHT, because a chain that arms itself twice per frame and one that arms itself
 * once are indistinguishable in the first count alone.
 *
 * Written test-first against an absent module.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { FrameSourceDouble, recordCueEvents } from './__test-support__/CueObservationDoubles';
import type { CueEvent, CuePoint } from './cueMarkerScheduler';
import type { LoopWindowSeconds } from './voicePlayhead';
import { browserFrameSource, CueSampler, type VoiceCueReading } from './cueSampler';

/** Two cues inside a `[2, 6]` window, so a wrap can put each on a different side. */
const CUES: readonly CuePoint[] = [
    { name: 'intro', seconds: 1 },
    { name: 'chorus', seconds: 4 },
];

const LOOP_WINDOW: LoopWindowSeconds = { startSeconds: 2, endSeconds: 6 };

describe('CueSampler — the on-demand frame chain', () => {
    it('schedules no frame while nothing is observing', () => {
        const { frames } = createSampler();

        expect(frames.requestCount).toBe(0);
        expect(frames.pendingCount).toBe(0);
    });

    it('starts the chain on the first observation and keeps exactly one frame in flight', () => {
        // The chain re-arms itself from inside its own callback, so "one frame per
        // frame" is a property of the callback rather than of the subscription.
        const { frames, sampler, voices } = createSampler();
        voices.at('audio-0', 0);
        sampler.observe('audio-0', () => CUES, {});

        expect(frames.requestCount).toBe(1);

        frames.fire();
        frames.fire();

        expect(frames.requestCount).toBe(3);
        expect(frames.pendingCount).toBe(1);
    });

    it('runs one chain however many voices are observed', () => {
        const { frames, sampler } = createSampler();

        sampler.observe('audio-0', () => CUES, {});
        sampler.observe('audio-1', () => CUES, {});

        expect(frames.requestCount).toBe(1);
    });

    it("compiles a voice's cue sheet once, however many observers it gains", () => {
        // The sheet is a property of the CLIP, and so is the scheduler state threaded
        // through it — which is what makes a second observer join where the voice already
        // is rather than start a timeline of its own.
        const { sampler } = createSampler();
        const compile = vi.fn(() => CUES);

        sampler.observe('audio-0', compile, {});
        sampler.observe('audio-0', compile, {});

        expect(compile).toHaveBeenCalledTimes(1);
    });

    it('cancels the chain when the last observer unsubscribes', () => {
        const { frames, sampler } = createSampler();
        const unsubscribe = sampler.observe('audio-0', () => CUES, {});

        unsubscribe();

        expect(frames.cancelled).toEqual([1]);
        expect(frames.pendingCount).toBe(0);

        frames.fire();

        expect(frames.requestCount).toBe(1);
    });

    it('keeps the chain running while another voice is still observed', () => {
        const { frames, sampler, voices } = createSampler();
        voices.at('audio-1', 0);
        const unsubscribe = sampler.observe('audio-0', () => CUES, {});
        sampler.observe('audio-1', () => CUES, {});

        unsubscribe();

        expect(frames.cancelled).toEqual([]);
        expect(frames.pendingCount).toBe(1);

        frames.fire();

        expect(voices.reads).toEqual(['audio-1']);
    });

    it('re-arms the chain when the last unsubscribe and a new observation share a turn', () => {
        // A `started` flag that is left standing by the cancel would leave the second
        // observation with no chain at all, and nothing would ever sample it.
        const { frames, sampler, voices } = createSampler();
        const unsubscribe = sampler.observe('audio-0', () => CUES, {});
        voices.at('audio-1', 0);

        unsubscribe();
        sampler.observe('audio-1', () => CUES, {});

        expect(frames.pendingCount).toBe(1);

        frames.fire();

        expect(voices.reads).toEqual(['audio-1']);
    });
});

describe('CueSampler — emissions', () => {
    it('takes its first sample as a seat and emits nothing for it', () => {
        // A voice that entered its buffer at 5 s never played the cues behind it, and a
        // scheduler seated at 0 would fire every one of them on the first frame.
        const { frames, sampler, voices } = createSampler();
        const observer = recordCueEvents();
        voices.at('audio-0', 5);
        sampler.observe('audio-0', () => CUES, observer.handlers);

        frames.fire();

        expect(observer.events).toEqual([]);
    });

    it('emits every cue a step crossed, in the scheduler order', () => {
        const { frames, sampler, voices } = createSampler();
        const observer = recordCueEvents();
        voices.at('audio-0', 0);
        sampler.observe('audio-0', () => CUES, observer.handlers);

        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(observer.events).toEqual([
            { kind: 'cue', name: 'intro' },
            { kind: 'cue', name: 'chorus' },
        ]);
    });

    it('emits a loop between the halves of a step that wrapped', () => {
        // 5 → 9 over a `[2, 6]` window: the pre-wrap half `(5, 6]` holds no cue, and the
        // chorus at 4 is crossed on the pass that follows the wrap.
        const { frames, sampler, voices } = createSampler();
        const observer = recordCueEvents();
        voices.at('audio-0', 5, { loopWindow: LOOP_WINDOW });
        sampler.observe('audio-0', () => CUES, observer.handlers);

        frames.fire();
        voices.at('audio-0', 9, { loopWindow: LOOP_WINDOW });
        frames.fire();

        expect(observer.events).toEqual([{ kind: 'loop' }, { kind: 'cue', name: 'chorus' }]);
    });

    it('takes no sample from a voice that has no playhead yet', () => {
        // A voice still loading, or one whose start is ahead of the clock, is read as
        // `null`. Seating from it at 0 would fire the cue at 1 s on the frame the voice
        // really starts, from a position it entered above.
        const { frames, sampler, voices } = createSampler();
        const observer = recordCueEvents();
        voices.silent('audio-0');
        sampler.observe('audio-0', () => CUES, observer.handlers);

        frames.fire();
        frames.fire();
        voices.at('audio-0', 3);
        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(observer.events).toEqual([{ kind: 'cue', name: 'chorus' }]);
    });

    it('leaves a voice observed from inside a frame to the NEXT one', () => {
        // The frame owns the set of voices it started with: a voice observed from a cue
        // handler is seated on the following frame, so its first span is one it was
        // actually observed across rather than a window reaching back before it joined.
        const { frames, sampler, voices } = createSampler();
        voices.at('audio-0', 0);
        voices.at('audio-1', 0);
        sampler.observe('audio-0', () => CUES, {
            onCue: () => {
                sampler.observe('audio-1', () => CUES, {});
            },
        });

        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(voices.reads).toEqual(['audio-0', 'audio-0']);
    });

    it('gives a cue batch only to the observers it began with', () => {
        // The frame's rule one level down: a handler that subscribes another observer is
        // not handing it the tail of an emission it was not there for. Cues and loops
        // only — the `end` below is the batch's other half.
        const { frames, sampler, voices } = createSampler();
        const joining = recordCueEvents();
        voices.at('audio-0', 0);
        sampler.observe('audio-0', () => CUES, {
            onCue: () => {
                sampler.observe('audio-0', () => CUES, joining.handlers);
            },
        });

        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(joining.events).toEqual([]);
    });

    it('hands the end of an ending batch to an observer that subscribed inside it', () => {
        // The other half of the rule above, and the reason it is not stated as one: an
        // `end` is fanned out by the release, not by the batch, so it reaches every
        // observation that is live when the voice closes — including one made a moment
        // earlier, from inside that same batch.
        const { frames, sampler, voices } = createSampler();
        const joining = recordCueEvents();
        let joined = false;
        voices.at('audio-0', 0);
        sampler.observe('audio-0', () => CUES, {
            onCue: () => {
                // Once: this batch crosses two cues, and a second call would make a
                // second subscription rather than say anything about the first.
                if (joined) {
                    return;
                }
                joined = true;
                sampler.observe('audio-0', () => CUES, joining.handlers);
            },
        });

        frames.fire();
        voices.at('audio-0', 5, { ended: true });
        frames.fire();

        expect(joining.events).toEqual([{ kind: 'end' }]);
    });

    it('gives one handler record passed twice two subscriptions of its own', () => {
        // Keyed by the CALL and not by the record: a module-level handlers object is the
        // obvious way for a game to write one, and two observations sharing it would
        // otherwise collapse into a single subscription that the first unsubscribe takes
        // down for both.
        const { frames, sampler, voices } = createSampler();
        const shared = recordCueEvents();
        voices.at('audio-0', 0);
        const unsubscribeFirst = sampler.observe('audio-0', () => CUES, shared.handlers);
        sampler.observe('audio-0', () => CUES, shared.handlers);

        unsubscribeFirst();
        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(shared.events).toEqual([
            { kind: 'cue', name: 'intro' },
            { kind: 'cue', name: 'chorus' },
        ]);
    });

    it('hands the same batch to every observer of one voice', () => {
        const { frames, sampler, voices } = createSampler();
        const first = recordCueEvents();
        const second = recordCueEvents();
        voices.at('audio-0', 0);
        sampler.observe('audio-0', () => CUES, first.handlers);
        sampler.observe('audio-0', () => CUES, second.handlers);

        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(first.events).toEqual([
            { kind: 'cue', name: 'intro' },
            { kind: 'cue', name: 'chorus' },
        ]);
        expect(second.events).toEqual(first.events);
    });

    it('stops delivering to an unsubscribed observer without disturbing the other', () => {
        const { frames, sampler, voices } = createSampler();
        const leaving = recordCueEvents();
        const staying = recordCueEvents();
        voices.at('audio-0', 0);
        const unsubscribe = sampler.observe('audio-0', () => CUES, leaving.handlers);
        sampler.observe('audio-0', () => CUES, staying.handlers);

        frames.fire();
        unsubscribe();
        voices.at('audio-0', 5);
        frames.fire();

        expect(leaving.events).toEqual([]);
        expect(staying.events).toEqual([
            { kind: 'cue', name: 'intro' },
            { kind: 'cue', name: 'chorus' },
        ]);
    });

    it('drops only its own observer when one unsubscribe is called twice', () => {
        // The unsubscribe names a SUBSCRIPTION, not the voice: a second call must not
        // reach the observer that is still there — nor the two handler records collapse
        // into one when a caller passes the same object twice.
        const { frames, sampler, voices } = createSampler();
        const leaving = recordCueEvents();
        const staying = recordCueEvents();
        voices.at('audio-0', 0);
        const unsubscribe = sampler.observe('audio-0', () => CUES, leaving.handlers);
        sampler.observe('audio-0', () => CUES, staying.handlers);

        unsubscribe();
        unsubscribe();
        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(staying.events).toHaveLength(2);
        expect(frames.cancelled).toEqual([]);
    });

    it('delivers no further event of a batch to an observer that unsubscribed inside it', () => {
        const { frames, sampler, voices } = createSampler();
        const events: CueEvent[] = [];
        voices.at('audio-0', 0);
        const unsubscribe: () => void = sampler.observe('audio-0', () => CUES, {
            onCue: (event) => {
                events.push(event);
                unsubscribe();
            },
        });

        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(events).toEqual([{ kind: 'cue', name: 'intro' }]);
    });
});

describe('CueSampler — ending an observation', () => {
    it('sweeps the cues before the end, emits end last, and stops observing', () => {
        const { frames, sampler, voices } = createSampler();
        const observer = recordCueEvents();
        voices.at('audio-0', 3);
        sampler.observe('audio-0', () => CUES, observer.handlers);

        frames.fire();
        voices.at('audio-0', 10, { ended: true });
        frames.fire();

        expect(observer.events).toEqual([{ kind: 'cue', name: 'chorus' }, { kind: 'end' }]);
        expect(frames.pendingCount).toBe(0);
    });

    it('emits end to every observer when the voice is released', () => {
        const { frames, sampler, voices } = createSampler();
        const first = recordCueEvents();
        const second = recordCueEvents();
        voices.at('audio-0', 0);
        sampler.observe('audio-0', () => CUES, first.handlers);
        sampler.observe('audio-0', () => CUES, second.handlers);

        sampler.endVoice('audio-0');

        expect(first.events).toEqual([{ kind: 'end' }]);
        expect(second.events).toEqual([{ kind: 'end' }]);
        expect(frames.pendingCount).toBe(0);
    });

    it('emits end exactly once when a release follows a sample that already ended', () => {
        // The two ends race by construction: the playhead runs off the buffer on a frame,
        // and the native `onended` that releases the voice arrives in its own turn.
        const { frames, sampler, voices } = createSampler();
        const observer = recordCueEvents();
        voices.at('audio-0', 3);
        sampler.observe('audio-0', () => CUES, observer.handlers);

        frames.fire();
        voices.at('audio-0', 10, { ended: true });
        frames.fire();
        sampler.endVoice('audio-0');

        expect(observer.events.filter((event) => event.kind === 'end')).toHaveLength(1);
    });

    it('leaves a fresh observation of the same voice alone when a stale unsubscribe fires', () => {
        // An unsubscribe outlives the observation it came from: the voice ended, another
        // observer arrived, and the old cleanup finally ran. It names a SUBSCRIPTION that
        // is already gone, so it must reach nothing — least of all the chain the new
        // observation is running on.
        const { frames, sampler, voices } = createSampler();
        const fresh = recordCueEvents();
        voices.at('audio-0', 0);
        const unsubscribe = sampler.observe('audio-0', () => CUES, {});
        sampler.endVoice('audio-0');
        sampler.observe('audio-0', () => CUES, fresh.handlers);

        unsubscribe();
        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(fresh.events).toEqual([
            { kind: 'cue', name: 'intro' },
            { kind: 'cue', name: 'chorus' },
        ]);
    });

    it('keeps an observation made from inside the end it was told about', () => {
        // An `onEnd` handler is a place a game starts the next track from, and it runs
        // while the release that called it is still unwinding. The observation it makes
        // must outlive that unwind.
        const { frames, sampler, voices } = createSampler();
        const rejoining = recordCueEvents();
        voices.at('audio-0', 0);
        sampler.observe('audio-0', () => CUES, {
            onEnd: () => {
                sampler.observe('audio-0', () => CUES, rejoining.handlers);
            },
        });

        sampler.endVoice('audio-0');
        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(rejoining.events).toEqual([
            { kind: 'cue', name: 'intro' },
            { kind: 'cue', name: 'chorus' },
        ]);
    });

    it('does nothing when a voice nobody observes is released', () => {
        const { frames, sampler } = createSampler();

        sampler.endVoice('audio-0');

        expect(frames.requestCount).toBe(0);
        expect(frames.cancelled).toEqual([]);
    });

    it('keeps sampling the other observed voices after one ends', () => {
        const { frames, sampler, voices } = createSampler();
        voices.at('audio-0', 0);
        voices.at('audio-1', 0);
        sampler.observe('audio-0', () => CUES, {});
        sampler.observe('audio-1', () => CUES, {});

        sampler.endVoice('audio-0');
        frames.fire();

        expect(voices.reads).toEqual(['audio-1']);
    });
});

describe('CueSampler — containment and disposal', () => {
    it('contains a throwing handler, keeping the chain and the other observer', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { frames, sampler, voices } = createSampler();
        const surviving = recordCueEvents();
        voices.at('audio-0', 0);
        sampler.observe('audio-0', () => CUES, {
            onCue: () => {
                throw new Error('handler defect');
            },
        });
        sampler.observe('audio-0', () => CUES, surviving.handlers);

        frames.fire();
        voices.at('audio-0', 5);
        frames.fire();

        expect(surviving.events).toHaveLength(2);
        expect(frames.pendingCount).toBe(1);
        warn.mockRestore();
    });

    it('reports a throwing handler once rather than once per frame', () => {
        // The sampler runs every frame a game paints, so a handler that throws every
        // frame would otherwise bury the console under one copy of the same defect.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const { frames, sampler, voices } = createSampler();
        voices.at('audio-0', 2, { loopWindow: LOOP_WINDOW });
        sampler.observe('audio-0', () => CUES, {
            onCue: () => {
                throw new Error('handler defect');
            },
        });

        frames.fire();
        voices.at('audio-0', 5, { loopWindow: LOOP_WINDOW });
        frames.fire();
        voices.at('audio-0', 9, { loopWindow: LOOP_WINDOW });
        frames.fire();

        expect(warn).toHaveBeenCalledTimes(1);
        warn.mockRestore();
    });

    it('cancels the pending frame on dispose and emits no end', () => {
        // A disposed manager owes no `end`: the voice did not reach one, and an observer
        // is being torn down alongside the audio graph rather than told a track finished.
        const { frames, sampler, voices } = createSampler();
        const observer = recordCueEvents();
        voices.at('audio-0', 0);
        sampler.observe('audio-0', () => CUES, observer.handlers);

        sampler.dispose();

        expect(frames.cancelled).toEqual([1]);
        expect(frames.pendingCount).toBe(0);
        expect(observer.events).toEqual([]);
    });

    it('stops every observer mid-batch when a handler disposes the sampler', () => {
        // A handler is one of the things that can call `dispose()`, and the frame it
        // interrupted is still walking the snapshot it started with. An observation the
        // disposal forgot must stop being handed events — its own voice's and any other's.
        const { frames, sampler, voices } = createSampler();
        const seen: CueEvent[] = [];
        const other = recordCueEvents();
        voices.at('audio-0', 0);
        voices.at('audio-1', 0);
        sampler.observe('audio-0', () => CUES, {
            onCue: (event) => {
                seen.push(event);
                sampler.dispose();
            },
        });
        sampler.observe('audio-1', () => CUES, other.handlers);

        frames.fire();
        voices.at('audio-0', 5);
        voices.at('audio-1', 5);
        frames.fire();

        expect(seen).toEqual([{ kind: 'cue', name: 'intro' }]);
        expect(other.events).toEqual([]);
        expect(frames.pendingCount).toBe(0);
    });

    it('observes nothing after dispose and still returns a callable unsubscribe', () => {
        const { frames, sampler } = createSampler();
        sampler.dispose();

        const unsubscribe = sampler.observe('audio-0', () => CUES, {});
        unsubscribe();

        expect(frames.requestCount).toBe(0);
    });
});

describe('the default frame source', () => {
    afterEach(() => {
        // Lifted here rather than at the end of the test that sets it: a failure before
        // that line would leak the stub into the sibling asserting the host has none.
        vi.unstubAllGlobals();
    });

    it('forwards to requestAnimationFrame and cancelAnimationFrame where the host has them', () => {
        const request = vi.fn(() => 7);
        const cancel = vi.fn();
        vi.stubGlobal('requestAnimationFrame', request);
        vi.stubGlobal('cancelAnimationFrame', cancel);
        const callback = (): void => undefined;

        const id = browserFrameSource.request(callback);
        browserFrameSource.cancel(id);

        expect(request).toHaveBeenCalledWith(callback);
        expect(id).toBe(7);
        expect(cancel).toHaveBeenCalledWith(7);
    });

    it('asks for nothing on a host with no frames to give', () => {
        // A unit run, or the main process. There is no frame clock there and no audio
        // clock to sample against either, so the chain holds an id that never fires —
        // rather than falling back to a timer, which would sample the wrong clock.
        expect(typeof requestAnimationFrame).toBe('undefined');

        const id = browserFrameSource.request(() => undefined);

        expect(typeof id).toBe('number');
        expect(() => browserFrameSource.cancel(id)).not.toThrow();
    });
});

// ─── helpers ────────────────────────────────────────────────────────────────────

function createSampler(): {
    readonly frames: FrameSourceDouble;
    readonly sampler: CueSampler;
    readonly voices: VoiceReadingsDouble;
} {
    const frames = new FrameSourceDouble();
    const voices = new VoiceReadingsDouble();
    const sampler = new CueSampler({ frameSource: frames, readVoice: voices.read });
    return { frames, sampler, voices };
}

/**
 * The manager's side of the sampler's second seam, as a table: what each voice's
 * playhead reads on the next frame, and which voices were asked at all.
 */
class VoiceReadingsDouble {
    /** Every voice id read, in order — a chain that samples a dropped voice shows here. */
    public readonly reads: string[] = [];

    private readonly readings = new Map<string, VoiceCueReading | null>();

    public readonly read = (voiceId: string): VoiceCueReading | null => {
        this.reads.push(voiceId);
        return this.readings.get(voiceId) ?? null;
    };

    public at(
        voiceId: string,
        unwrappedSeconds: number,
        options: { readonly ended?: boolean; readonly loopWindow?: LoopWindowSeconds } = {},
    ): void {
        this.readings.set(voiceId, {
            sample: { unwrappedSeconds, ended: options.ended ?? false },
            loopWindow: options.loopWindow ?? null,
        });
    }

    /** A voice with no playhead: still loading, or scheduled to start later. */
    public silent(voiceId: string): void {
        this.readings.set(voiceId, null);
    }
}
