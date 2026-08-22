/**
 * ambience-cue-aligned.spec.ts
 * §4.25 Audio System → Cue Observation & Cue-Aligned Transitions
 *
 * That the ambience swap is **scheduled onto the bed's own loop cue**, proved in the
 * real runtime rather than against a double.
 *
 * No spec can hear sound, so both claims here are about **when**, and they are made
 * at two different depths on purpose.
 *
 *   1. **The markers.** `<TacticsAmbience>` renders two: `data-track` moves with the
 *      turn, `data-playing-track` with the handover it was armed to reach — neither is
 *      a claim about what is audible, per that component's header. At the commit that
 *      moves the first,
 *      the second is still on the outgoing bed, recorded from inside the document by
 *      a `MutationObserver` that reads BOTH attributes in one callback. Polling from
 *      the test process cannot make this claim — between the commit and a poll the
 *      swap may already have landed, so the run would be green on a fast machine for
 *      a reason that has nothing to do with cues.
 *
 *      This half is deliberately WEAK, and saying so is the point: an implementation
 *      that swapped instantly but moved the second marker one React commit later
 *      satisfies it. Measured, not assumed — that mutant was run and it passed.
 *
 *   2. **The schedule.** So the claim that carries the feature is made against Web
 *      Audio itself. `AudioBufferSourceNode.prototype.start` is patched to record the
 *      `when` each looping bed was scheduled for alongside `AudioContext.currentTime`
 *      at that moment, and two things follow that an instant swap cannot produce:
 *      every handover is booked AHEAD of the clock, and the instant it is booked for
 *      is a `loopEnd` arrival of the bed it replaces — `when` lands on
 *      `previousWhen + loopEnd + k × (loopEnd − loopStart)` for a whole number of
 *      passes. `crossfade` books `currentTime`, so it fails both.
 *
 * The second claim is also what makes the first non-vacuous in the other direction:
 * a cue only ever arrives if the bed started, the clip decoded, and the window's
 * audio clock is genuinely advancing.
 *
 * `audio-smoke.spec.ts` holds the orthogonal claims: that the clips decode to the
 * duration their sheets author, that the turn signal reaches both windows, and that
 * no cue resolved fail-soft on the way.
 */

import type { Page } from '@playwright/test';
import { expect, test } from '../fixtures/direct-game.fixture';
import { GamePage } from '../pages/GamePage';

// A dedicated port: separate spec FILES run on separate workers (`workers: 2`), and
// this one launches its own host/client pair.
test.use({ port: '7795' });

/**
 * The bed's own numbers, authored in `apps/tactics/asset-manifest.ts`.
 *
 * Restated here rather than imported because that is what makes this an independent
 * measurement: a spec that derived its expectation from the same constant the
 * component reads would agree with itself whatever either one became.
 */
const AMBIENCE_DURATION_SECONDS = 1.5;
const AMBIENCE_LOOP_START_SECONDS = 0.2;
const AMBIENCE_LOOP_END_SECONDS = 1.3;
/** One pass of the loop body — the longest a handover can be made to wait. */
const LOOP_PERIOD_SECONDS = AMBIENCE_LOOP_END_SECONDS - AMBIENCE_LOOP_START_SECONDS;

/**
 * Which looping voices are the beds: those whose decoded buffer is a bed's length.
 *
 * Never the bare `loop` flag, so a future looping sound effect cannot satisfy this
 * spec on the bed's behalf. The tolerance covers the app `AudioContext` resampling
 * the clip to the device rate, which `audio-smoke.spec.ts`'s 44.1 kHz offline decode
 * does not — the same allowance `ambience-second-match.spec.ts` makes.
 */
const DURATION_TOLERANCE_SECONDS = 0.05;

/**
 * How far a booked instant may sit from the loop boundary it claims to be on.
 *
 * The manager derives `when` arithmetically from the voice's own start and the sheet's
 * cue seconds — there is no sampling in that path and no frame to round to — so the
 * expected residue is float noise. 5 ms is orders of magnitude above that and orders
 * of magnitude below the 1.1 s it has to be distinguished from.
 */
const CUE_TOLERANCE_SECONDS = 0.005;

/** Time allowed for a handover: one loop pass, with a wide margin for a slow runner. */
const HANDOVER_TIMEOUT_MS = 15_000;

/** What the ambience markers said at one instant. */
interface MarkerPair {
    readonly track: string | null;
    readonly playing: string | null;
}

/** The recorded flip, or the reason none was seen. */
type FlipRecord = { readonly seen: true; readonly at: MarkerPair } | { readonly seen: false };

/** One looping voice's booking, as Web Audio received it. */
interface ScheduledStart {
    readonly durationSeconds: number;
    /** The context time `source.start(when, offset)` was told to begin at. */
    readonly when: number;
    /** `AudioContext.currentTime` immediately after that call returned. */
    readonly at: number;
}

interface StartProbe {
    readonly starts: ScheduledStart[];
}

type Holder = typeof globalThis & {
    __ambienceFlip?: Promise<FlipRecord>;
    __ambienceStartProbe?: StartProbe;
};

/** The one element this spec reads, and the two attributes it reads off it. */
interface MarkerElement {
    getAttribute(name: string): string | null;
}

/**
 * The platform this spec needs, declared locally.
 *
 * The `page.evaluate` bodies below are typechecked by the root `tsc --noEmit`
 * program, whose `lib` is ES2022 only — the same reason `audio-smoke.spec.ts` reaches
 * `OfflineAudioContext` through `globalThis` and `ambience-second-match.spec.ts`
 * reaches `AudioBufferSourceNode` the same way.
 */
interface AmbiencePlatform {
    readonly document: { querySelector(selectors: string): MarkerElement | null };
    readonly MutationObserver: new (callback: () => void) => {
        observe(target: MarkerElement, options: { attributes: boolean }): void;
        disconnect(): void;
    };
}

interface PatchableSource {
    loop: boolean;
    buffer: { duration: number } | null;
    context: { currentTime: number };
}

/**
 * Record what every looping buffer source is scheduled for, from now on.
 *
 * Installed once the game screen is up, which may or may not be after the bed the
 * match opened on has been booked — nothing observable here settles that race, so the
 * reader below takes the last two bookings rather than assuming a count. Either way
 * the arithmetic needs two handovers rather than one: the first gives a phase this
 * window can be measured against, the second is what is measured.
 */
async function installStartProbe(window: Page): Promise<void> {
    await window.evaluate(() => {
        const holder = globalThis as Holder;
        if (holder.__ambienceStartProbe !== undefined) {
            return;
        }

        const prototype = (
            globalThis as unknown as {
                AudioBufferSourceNode: {
                    prototype: { start: (this: PatchableSource, ...args: number[]) => void };
                };
            }
        ).AudioBufferSourceNode.prototype;
        const nativeStart = prototype.start;
        const probe: StartProbe = { starts: [] };
        holder.__ambienceStartProbe = probe;

        prototype.start = function patchedStart(this: PatchableSource, ...args: number[]): void {
            // Delegate FIRST and record on the way back: a `start()` the platform
            // refuses throws, and a voice that never played must not be counted as a
            // booking that stood. `loop` and `buffer` are both already set by then —
            // `startVoice` assigns them before it starts the source.
            nativeStart.apply(this, args);
            if (this.loop) {
                probe.starts.push({
                    durationSeconds: this.buffer?.duration ?? -1,
                    when: args[0] ?? 0,
                    at: this.context.currentTime,
                });
            }
        };
    });
}

/** Every bed-length looping voice booked since the probe went in. */
async function readAmbienceStarts(window: Page): Promise<ScheduledStart[]> {
    const starts = await window.evaluate(() => {
        const probe = (globalThis as Holder).__ambienceStartProbe;
        if (probe === undefined) {
            throw new Error(
                'the start probe is gone: this window loaded a new document, so bookings ' +
                    'made before it are unreachable and nothing here is comparable',
            );
        }
        return probe.starts;
    });

    return starts.filter(
        (start) =>
            Math.abs(start.durationSeconds - AMBIENCE_DURATION_SECONDS) <
            DURATION_TOLERANCE_SECONDS,
    );
}

/**
 * Arm a recorder for the NEXT change to `data-track`, and hand back nothing.
 *
 * Installed before the click and read after it, through a global rather than an
 * awaited promise: awaiting inside `page.evaluate` would block until the flip that
 * only the click can cause.
 */
async function armFlipRecorder(window: Page, timeoutMs: number): Promise<void> {
    await window.evaluate((timeout: number) => {
        const platform = globalThis as unknown as AmbiencePlatform;
        const marker = platform.document.querySelector('[data-testid="tactics-ambience"]');
        if (marker === null) {
            throw new Error('ambience marker is not in the document');
        }
        const before = marker.getAttribute('data-track');

        (globalThis as Holder).__ambienceFlip = new Promise<FlipRecord>((resolve) => {
            const observer = new platform.MutationObserver(() => {
                const track = marker.getAttribute('data-track');
                if (track === before) {
                    return;
                }
                observer.disconnect();
                // Both attributes read in the SAME callback, so the pair describes one
                // instant. Reading `data-playing-track` any later would be a poll.
                resolve({
                    seen: true,
                    at: { track, playing: marker.getAttribute('data-playing-track') },
                });
            });
            observer.observe(marker, { attributes: true });
            setTimeout(() => {
                observer.disconnect();
                resolve({ seen: false });
            }, timeout);
        });
    }, timeoutMs);
}

/** Await the armed recorder. */
async function readFlip(window: Page): Promise<FlipRecord> {
    return window.evaluate(async () => {
        const pending = (globalThis as Holder).__ambienceFlip;
        if (pending === undefined) {
            throw new Error('flip recorder was never armed');
        }
        return pending;
    });
}

test.describe('Ambience — the swap lands on the bed’s own cue', () => {
    test('leaves the sounding bed alone at the turn boundary and moves it afterwards', async ({
        hostWindow,
    }) => {
        const game = new GamePage(hostWindow);

        // The host moves first, so it opens calm, and both markers agree before the
        // turn passes — the starting state the deferral is measured against.
        await expect(game.ambience).toHaveAttribute('data-track', 'calm');
        await expect(game.ambience).toHaveAttribute('data-playing-track', 'calm');

        await armFlipRecorder(hostWindow, HANDOVER_TIMEOUT_MS);
        await game.endTurnButton.click();
        const flip = await readFlip(hostWindow);

        expect(flip.seen, 'the turn never reached the ambience marker').toBe(true);
        expect(flip.seen ? flip.at : null).toEqual({ track: 'tense', playing: 'calm' });

        // And the handover is real rather than deferred forever. Reachable only if the
        // voice started, the clip decoded, and the audio clock advanced to `loopEnd`.
        await expect(game.ambience).toHaveAttribute('data-playing-track', 'tense', {
            timeout: HANDOVER_TIMEOUT_MS,
        });
        // Settled: both markers name the same bed again, so the lag closed rather than
        // the two having drifted apart permanently.
        await expect(game.ambience).toHaveAttribute('data-track', 'tense');
    });

    test('books each handover ahead of the clock, on a loop boundary of the bed it replaces', async ({
        hostWindow,
        clientWindow,
    }) => {
        const hostGame = new GamePage(hostWindow);
        const clientGame = new GamePage(clientWindow);
        await expect(hostGame.ambience).toHaveAttribute('data-playing-track', 'calm');

        await installStartProbe(hostWindow);

        // Two handovers: the first booking establishes a phase this window can be
        // measured against, and the second is the one the arithmetic is about. Each
        // turn is ended by the seat that holds it, and the wait between them is
        // required — an armed swap refuses a second arm until it lands.
        await hostGame.endTurnButton.click();
        await expect(hostGame.ambience).toHaveAttribute('data-playing-track', 'tense', {
            timeout: HANDOVER_TIMEOUT_MS,
        });
        await clientGame.endTurnButton.click();
        await expect(hostGame.ambience).toHaveAttribute('data-playing-track', 'calm', {
            timeout: HANDOVER_TIMEOUT_MS,
        });

        const starts = await readAmbienceStarts(hostWindow);

        // The LAST two, not all of them. Whether the bed the match opened on is in the
        // recording depends on a race this spec does not control: `data-playing-track`
        // is seeded at first render rather than by a started voice, so waiting for it
        // does not prove the opening `start()` has already run. The last two bookings
        // are the two handovers either way, and the opening bed — booked at `now` —
        // would fail the lead assertion below if it were included.
        expect(
            starts.length,
            'fewer bookings than handovers: a swap never reached Web Audio',
        ).toBeGreaterThanOrEqual(2);
        const [first, second] = starts.slice(-2) as [ScheduledStart, ScheduledStart];

        // Native scheduling, not a timer that calls `play()` when it fires (Invariant
        // #122). `crossfade` books `currentTime` and would leave this at or below zero.
        for (const [index, start] of [first, second].entries()) {
            const lead = start.when - start.at;
            expect(
                lead,
                `handover ${String(index)} was not booked ahead of the clock`,
            ).toBeGreaterThan(0);
            expect(
                lead,
                `handover ${String(index)} was booked further out than one pass of the loop`,
            ).toBeLessThanOrEqual(LOOP_PERIOD_SECONDS + CUE_TOLERANCE_SECONDS);
        }

        // The instant itself. The second bed entered its buffer at 0 when the first
        // handover started it, so its `loopEnd` arrivals are at `first.when + 1.3` and
        // every 1.1 s after — and the second handover was booked for one of them. This
        // is the claim that separates "later" from "on the cue": a swap deferred by any
        // other mechanism lands at an instant with no such relationship.
        const sinceFirstArrival = second.when - first.when - AMBIENCE_LOOP_END_SECONDS;
        const passes = Math.round(sinceFirstArrival / LOOP_PERIOD_SECONDS);

        expect(
            passes,
            'the handover was booked before the outgoing bed’s first cue',
        ).toBeGreaterThanOrEqual(0);
        // `Math.abs`, because `Math.round` puts the residue on either side of the
        // nearest arrival. A signed residue compared against a positive bound reds in
        // one direction only, and would accept everything from the arrival back to half
        // a pass before it — 555 ms of tolerance dressed up as 5 ms.
        expect(
            Math.abs(sinceFirstArrival - passes * LOOP_PERIOD_SECONDS),
            `booked ${String(second.when - first.when)}s after the bed it replaced started, which is not a loopEnd arrival`,
        ).toBeLessThan(CUE_TOLERANCE_SECONDS);
    });
});
