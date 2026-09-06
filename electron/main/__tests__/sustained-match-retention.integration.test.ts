/**
 * electron/main/__tests__/sustained-match-retention.integration.test.ts
 *
 * The sustained-match retention gate: does anything the host retains grow with
 * the number of beats elapsed?
 *
 * Every growth defect this arc found shares one shape — a structure that grows
 * with elapsed beats and nothing that notices. This test drives a REAL hosted
 * session with the action history, the deterministic recorder and the
 * perspective recorder all armed
 * (`electron/main/__test-support__/sustained-match-harness.ts`); the §13.4 heap
 * gate in `apps/tactics/__tests__/ActionPipelinePerf.bench.test.ts` builds a
 * bare `ActionPipeline`, so none of those three is wired there.
 *
 * It probes the DEFECT CLASS rather than an instance. The question is not "is
 * this buffer 10,000 entries" — a tuned constant that drifts — but "does the
 * retained size follow the beat count?", answered by measuring at N beats and
 * again at 2N and comparing the two. A bounded structure reports the same size
 * twice; an unbounded one doubles.
 *
 * ## Why two scales
 *
 * The two families of retained structure need different beat counts, and one
 * run cannot serve both.
 *
 *  - The CAPPED BUFFERS (action history, perspective frames) only stop growing
 *    once they are full, so their first sample has to be past a 10,000 cap.
 *    Removing either cap leaves appends O(1), so the run stays fast.
 *  - The PER-BEAT WORKING STATE (`snapshot.events`, `snapshot.timers`) is
 *    rebuilt every beat and settles within a couple of them, so a few hundred
 *    beats already separates flat from linear. It must be measured SMALL
 *    because of the timer half: `TimerManager.advance` walks the registry once
 *    per beat, so a fired timer that survives its beat makes the run quadratic,
 *    and at 12,000 beats the mutant that proves this gate works hangs instead
 *    of failing — measured. A synchronous beat loop cannot be interrupted by
 *    `testTimeout`, so that is a hang and not a red test.
 *
 * Which is why the capped-buffer run passes `perBeatState: false`: with the
 * beat hook inert it installs no timer, so the same defect cannot make the
 * 12,000-beat legs quadratic through the back door.
 *
 * Architecture: §10 — Testing. Invariants #30/#45.
 */

import { describe, expect, it } from 'vitest';

import type { BaseGameSnapshot } from '@chimera-engine/simulation/engine/types.js';
import { gamePhase } from '@chimera-engine/simulation/engine/types.js';
import { MAX_ACTION_HISTORY_ENTRIES } from '@chimera-engine/simulation/foundation/game-manifest-contract.js';

import { DEFAULT_MAX_PERSPECTIVE_REPLAY_FRAMES } from '../replay/PerspectiveReplayManager.js';
import type { RetainedSizes } from '../__test-support__/sustained-match-harness.js';
import {
    HARNESS_VIEWER,
    createSustainedMatchHarness,
    harnessBeat,
} from '../__test-support__/sustained-match-harness.js';

/**
 * Beats in the first leg of the capped-buffer run. Above both shipped caps, so
 * the first sample is already saturated — which is what makes the second
 * sample's equality mean "bounded" rather than "not full yet".
 */
const CAP_N = 12_000;

/** Beats in the first leg of the working-state run. See "Why two scales". */
const BEAT_N = 500;

interface Legs {
    readonly atN: RetainedSizes;
    readonly at2N: RetainedSizes;
}

/** A snapshot with no events and no timers, for driving `harnessBeat` directly. */
function makeIdleSnapshot(): BaseGameSnapshot {
    return {
        tick: 0,
        seed: 42,
        players: { [HARNESS_VIEWER]: { id: HARNESS_VIEWER } },
        entities: {},
        phase: gamePhase('playing'),
        events: [],
        turnNumber: 0,
        timers: {},
        gameResult: null,
    };
}

/** Run `n` beats, sample, run `n` more, sample again — one continuous match. */
function sampleAtNand2N(n: number, perBeatState: boolean): Legs {
    const session = createSustainedMatchHarness({
        retainActions: MAX_ACTION_HISTORY_ENTRIES,
        maxPerspectiveFrames: DEFAULT_MAX_PERSPECTIVE_REPLAY_FRAMES,
        perBeatState,
    });
    try {
        session.beat(n);
        const atN = session.retained();
        session.beat(n);
        const at2N = session.retained();
        expect(session.beatsElapsed()).toBe(2 * n);
        return { atN, at2N };
    } finally {
        session.dispose();
    }
}

describe('the fixture the gate reads through', () => {
    // A retention gate is only as good as the fixture's sensitivity, and none
    // of the properties below is visible in the gate's own numbers: weakening
    // any of them leaves the run green while disarming a kill or the protection
    // that keeps a kill fast. So each is pinned here.

    it('APPENDS its event to the outbox rather than assigning a fresh array', () => {
        const carried: BaseGameSnapshot = { ...makeIdleSnapshot(), events: [{ type: 'earlier' }] };

        expect(harnessBeat(carried).events).toHaveLength(2);
    });

    it('installs each beat’s timer under a FRESH id, not one that replaces itself', () => {
        // `TimerManager.create` REPLACES an existing id in place, so a fixed id
        // would hold the registry at one entry whether or not a fired one-shot
        // is removed — and the tombstone defect would be invisible.
        const first = harnessBeat({ ...makeIdleSnapshot(), tick: 1 });
        const second = harnessBeat({ ...makeIdleSnapshot(), tick: 2 });

        expect(Object.keys(second.timers)).not.toEqual(Object.keys(first.timers));
    });

    it('writes NO per-beat state when the caller asks for none', () => {
        // The inert arm is what keeps the capped-buffer run's 12,000-beat legs
        // linear. Measured: with the hook always on, a fired-timer tombstone
        // takes that run past 90 s instead of failing — and the gate's own
        // numbers cannot see the difference, since no case there reads either
        // field. This is the case that does.
        const session = createSustainedMatchHarness({
            retainActions: MAX_ACTION_HISTORY_ENTRIES,
            maxPerspectiveFrames: DEFAULT_MAX_PERSPECTIVE_REPLAY_FRAMES,
            perBeatState: false,
        });
        try {
            session.beat(10);
            const sizes = session.retained();

            expect({ events: sizes.snapshotEvents, timers: sizes.snapshotTimers }).toEqual({
                events: 0,
                timers: 0,
            });
        } finally {
            session.dispose();
        }
    });
});

describe('sustained-match retention — capped buffers (Invariants #30/#45)', () => {
    it('holds the action history and the perspective frames flat between N and 2N beats', () => {
        const { atN, at2N } = sampleAtNand2N(CAP_N, false);

        expect({
            historyEntries: at2N.historyEntries,
            perspectiveFrames: at2N.perspectiveFrames,
        }).toEqual({
            historyEntries: atN.historyEntries,
            perspectiveFrames: atN.perspectiveFrames,
        });
    });

    it('takes both samples in the saturated regime, not before the caps fill', () => {
        // Without this the equality above would also hold for a buffer that had
        // simply never filled, so the gate would pass on a broken cap.
        const { atN } = sampleAtNand2N(CAP_N, false);

        expect(atN.historyEntries).toBe(MAX_ACTION_HISTORY_ENTRIES);
        expect(atN.perspectiveFrames).toBe(DEFAULT_MAX_PERSPECTIVE_REPLAY_FRAMES);
    });

    it('reports the two occupancies from their own buffers', () => {
        // The shipped bounds are BOTH 10,000, so the case above would read the
        // same number whichever buffer each field came from — a swapped reader
        // would still fail on an unbounded structure, but would name the wrong
        // one. A distinct declared frame ceiling separates them, and pins that
        // the recorder honours a declared ceiling rather than its default.
        const distinctFrames = 3_000;
        const session = createSustainedMatchHarness({
            retainActions: MAX_ACTION_HISTORY_ENTRIES,
            maxPerspectiveFrames: distinctFrames,
            perBeatState: false,
        });
        try {
            session.beat(CAP_N);

            expect(session.retained().perspectiveFrames).toBe(distinctFrames);
            expect(session.retained().historyEntries).toBe(MAX_ACTION_HISTORY_ENTRIES);
        } finally {
            session.dispose();
        }
    });
});

describe('sustained-match retention — per-beat working state', () => {
    it('holds the event outbox and the timer registry flat between N and 2N beats', () => {
        const { atN, at2N } = sampleAtNand2N(BEAT_N, true);

        expect({
            snapshotEvents: at2N.snapshotEvents,
            snapshotTimers: at2N.snapshotTimers,
        }).toEqual({
            snapshotEvents: atN.snapshotEvents,
            snapshotTimers: atN.snapshotTimers,
        });
    });

    it('keeps both at their steady state, not merely flat', () => {
        // Flatness alone would be satisfied by a structure that grew once and
        // then stopped. The hook appends one event per beat and installs a
        // timer that waits two, so the outbox settles at that beat's single
        // event and the registry at the two still counting down. Anything
        // larger means state from an earlier beat survived. The two numbers
        // differ on purpose — see `harnessBeat` — so a reader that confused
        // the fields would be caught here rather than mislabelling growth.
        const { atN, at2N } = sampleAtNand2N(BEAT_N, true);

        for (const sizes of [atN, at2N]) {
            expect({ events: sizes.snapshotEvents, timers: sizes.snapshotTimers }).toEqual({
                events: 1,
                timers: 2,
            });
        }
    });
});

describe('sustained-match retention — what is deliberately NOT bounded', () => {
    it('lets the deterministic recording grow, which is the format and not a leak', () => {
        // Stated so the gates above are not read as "nothing the host holds
        // grows". A deterministic replay must retain EVERY action or it cannot
        // reproduce the match, so this buffer is bounded by match length alone.
        // Measured rather than gated, so a future cap on it — which would
        // silently break replay — shows up as this expectation failing.
        const { atN, at2N } = sampleAtNand2N(BEAT_N, true);

        expect(at2N.recordedActions).toBe(2 * atN.recordedActions);
        expect(atN.recordedActions).toBe(BEAT_N);
    });

    it('classifies every structure the harness reports', () => {
        // The roll-call. Adding a field to `RetainedSizes` fails here until it
        // is listed as gated or as deliberately unbounded — which is a prompt
        // to decide, not a proof that an assertion was then written for it.
        const gated = ['historyEntries', 'perspectiveFrames', 'snapshotEvents', 'snapshotTimers'];
        const deliberatelyUnbounded = ['recordedActions'];
        const { atN } = sampleAtNand2N(1, true);

        expect(Object.keys(atN).sort()).toEqual([...gated, ...deliberatelyUnbounded].sort());
    });
});
