// @vitest-environment jsdom

/**
 * renderer/components/r3f/useClipPlayback.test.tsx
 *
 * The backend-agnostic half of a clip binding, driven directly rather than
 * through one of its two callers: the declarative surface's three arms — no
 * clip, a player that is already disposed, and a transition — plus the frame
 * driver.
 *
 * Feature reference: F82 — Animation System (clip sheets, marker scheduling,
 * beat-owned gameplay windows, time dilation),
 * `docs/roadmap-sections/m10-first-public-release-v1.0.0.md`.
 *
 * **Why a fake backend rather than `three` or an atlas.** What this module owns
 * is which VERB it calls and when. `createFakeClipBackend` answers that exactly
 * — the deltas it advanced with, the clips it stopped, the clips it held — while
 * a mesh mixer or a sprite quad would answer it through two more layers of
 * arithmetic. The mesh and sprite bindings keep their own suites for what only
 * they can be asked.
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFakeClipBackend } from '../../animation/__test-support__/fakeClipBackend.js';
import { ClipPlayer } from '../../animation/ClipPlayer.js';
import type { ClipSheetSource } from '../../animation/ClipTimeline.js';
import type { MarkerEvent } from '../../animation/clipMarkerScheduler.js';
import { resetFakeFiberRoot, update } from './__test-support__/fakeFiberRoot';
import { useClipPlayback } from './useClipPlayback.js';
import type { UseClipPlaybackOptions } from './useClipPlayback.js';

vi.mock('@react-three/fiber', () => import('./__test-support__/fakeFiberRoot'));

/** Two clips of one second, each carrying a passage over the same span. */
const SHEET: ClipSheetSource = {
    clips: {
        attack: { passages: { swing: { from: 0.2, to: 0.9 } } },
        idle: { passages: { hold: { from: 0.2, to: 0.9 } } },
    },
};

function makeRecorder(): {
    readonly events: MarkerEvent[];
    readonly handlers: NonNullable<UseClipPlaybackOptions['handlers']>;
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

/** A real `ClipPlayer` over the fake backend, plus the ledgers a case reads. */
function makePlayer(): {
    readonly player: ClipPlayer;
    readonly backend: ReturnType<typeof createFakeClipBackend>;
} {
    const backend = createFakeClipBackend({
        attack: { durationSeconds: 1, loop: 'loop' },
        idle: { durationSeconds: 1, loop: 'loop' },
    });
    return {
        player: new ClipPlayer({ backend, getTimeScale: () => 1, report: () => undefined }),
        backend,
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

beforeEach(() => {
    resetFakeFiberRoot();
    frameClockSeconds = 0;
});

afterEach(() => {
    cleanup();
});

describe('useClipPlayback — the three arms of the playback effect', () => {
    it('starts nothing and reports nothing while the clip is null', () => {
        const { player, backend } = makePlayer();
        const reportFault = vi.fn();
        const recorder = makeRecorder();

        renderHook(() =>
            useClipPlayback(
                player,
                SHEET,
                { clip: null, handlers: recorder.handlers },
                reportFault,
            ),
        );
        driveFrame(0.5);

        expect(player.activeClips).toEqual([]);
        expect(recorder.events).toEqual([]);
        // `null` is a documented public value, not an authoring fault: a guard
        // that let it reach the player would get `false` back — the same answer
        // an unplayable clip gives — and report against a clip named "null".
        expect(reportFault).not.toHaveBeenCalled();
        expect(backend.stopped).toEqual([]);
    });

    it('stops everything when the clip goes null, with reason stopped', () => {
        const { player, backend } = makePlayer();
        const recorder = makeRecorder();
        let clip: string | null = 'attack';
        const { rerender } = renderHook(() =>
            useClipPlayback(player, SHEET, { clip, handlers: recorder.handlers }, vi.fn()),
        );
        driveFrame(0.5);
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'swing' }]);
        recorder.events.length = 0;

        clip = null;
        rerender();

        // The effect registers no per-clip cleanup, so this arm is the ONLY
        // thing that can take the clip down — and the outgoing name is not
        // recoverable here, which is why it is `stopAll` rather than a `stop`.
        expect(recorder.events).toEqual([
            { kind: 'passage-end', name: 'swing', reason: 'stopped' },
        ]);
        expect(player.activeClips).toEqual([]);
        expect(backend.stopped).toEqual(['attack']);
    });

    it('makes the declared clip the only one in flight', () => {
        const { player, backend } = makePlayer();
        const recorder = makeRecorder();
        let clip = 'attack';
        const { rerender } = renderHook(() =>
            useClipPlayback(player, SHEET, { clip, handlers: recorder.handlers }, vi.fn()),
        );
        driveFrame(0.5);
        recorder.events.length = 0;

        clip = 'idle';
        rerender();

        expect(recorder.events).toEqual([
            { kind: 'passage-end', name: 'swing', reason: 'clip-changed' },
        ]);
        expect(player.activeClips).toEqual(['idle']);
        expect(backend.stopped).toEqual(['attack']);

        // …and the clip it replaced fires nothing for the rest of the mount.
        recorder.events.length = 0;
        driveFrame(0.5);
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'hold' }]);
    });

    it('skips a player the same commit already disposed, without reporting a fault', () => {
        const { player, backend } = makePlayer();
        const reportFault = vi.fn();
        player.dispose();

        renderHook(() => useClipPlayback(player, SHEET, { clip: 'attack' }, reportFault));

        // `transitionTo` answers `false` for a disposed player and for a clip
        // the backend cannot play, and a caller has to tell those apart: the
        // second is an authoring fault worth reporting, the first is a player
        // its owner already replaced.
        expect(reportFault).not.toHaveBeenCalled();
        expect(backend.stopped).toEqual([]);
    });

    it('reports a clip the backend cannot play, once', () => {
        const { player } = makePlayer();
        const reportFault = vi.fn();

        renderHook(() => useClipPlayback(player, SHEET, { clip: 'no-such-clip' }, reportFault));

        expect(reportFault).toHaveBeenCalledExactlyOnceWith('no-such-clip');
        expect(player.activeClips).toEqual([]);
    });

    it('seats the declared speed on every restart the hook performs for itself', () => {
        const { player, backend } = makePlayer();
        let loop: 'once' | 'loop' = 'loop';
        const { rerender } = renderHook(() =>
            useClipPlayback(player, SHEET, { clip: 'attack', loop, speed: 0.25 }, vi.fn()),
        );
        expect(backend.speedOf('attack')).toBe(0.25);

        loop = 'once';
        rerender();

        // A restart that seated nothing would drop the declared speed back to
        // the layer's default of 1 — silently, on an axis where the only
        // symptom is a clip that plays four times too fast.
        expect(backend.speedOf('attack')).toBe(0.25);
    });

    it('leaves one clip in flight across a StrictMode double mount', () => {
        const { player, backend } = makePlayer();
        const recorder = makeRecorder();

        renderHook(
            () =>
                useClipPlayback(
                    player,
                    SHEET,
                    { clip: 'attack', handlers: recorder.handlers },
                    vi.fn(),
                ),
            { reactStrictMode: true },
        );
        driveFrame(0.5);

        // setup → cleanup → setup with no cleanup of its own: the second setup
        // is a same-name transition, which releases the playback the first one
        // started rather than leaving it live on the backend.
        expect(player.activeClips).toEqual(['attack']);
        expect(backend.stopped).toEqual(['attack']);
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'swing' }]);
    });
});
