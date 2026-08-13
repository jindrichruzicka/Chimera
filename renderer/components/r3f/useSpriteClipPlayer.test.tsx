// @vitest-environment jsdom

/**
 * renderer/components/r3f/useSpriteClipPlayer.test.tsx
 *
 * The sprite half of the animation binding, against a REAL `PlaneGeometry` and
 * the `fakeFiberRoot` stand-in for `@react-three/fiber`.
 *
 * **Why a real geometry.** What this hook ultimately does is move four `uv`
 * pairs, so the cell on the quad is read straight off
 * `geometry.attributes.uv` — the same array a shader would sample. A geometry
 * double would record `setXY` calls and could not answer which CELL is showing,
 * which is the only question a sprite animation is actually asked.
 *
 * **Why the fiber stand-in.** Same reason as the mesh sibling: the subscriber
 * ledger and `internal.priority` are reproduced, so "exactly one DEFAULT-priority
 * driver" is assertable rather than merely intended.
 *
 * **Why every mount goes through {@link mountSprite}.** `atlas` and `geometry`
 * are dependencies of the allocation effect, so passing a fresh object per
 * render rebuilds the backend on every commit — which, since allocating sets
 * state, is an infinite render loop rather than a wrong pixel. The helper holds
 * ONE identity of each across renders, which is what `useSpriteAtlas` and
 * `AnimatedSprite` do in production. `sheet` is the one allocation input a
 * rerender may change, and `re-allocates the backend when the sheet identity
 * changes` is the case that pins that dependency actually being there.
 */

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PlaneGeometry } from 'three';

import type { SpriteAnimationMetadata } from '@chimera-engine/simulation/foundation/animation-clip-sheet.js';

import type { MarkerEvent } from '../../animation/clipMarkerScheduler.js';
import { useTimeScaleStore } from '../../animation/timeScaleStore.js';
import type { SpriteAtlas } from '../../assets/spriteAtlas.js';
import type * as RendererLoggerModule from '../../logging/rendererLogger.js';
import { fakeRootState, resetFakeFiberRoot, update } from './__test-support__/fakeFiberRoot';
import { useSpriteClipPlayer } from './useSpriteClipPlayer.js';
import type { UseSpriteClipPlayerOptions } from './useSpriteClipPlayer.js';

vi.mock('@react-three/fiber', () => import('./__test-support__/fakeFiberRoot'));

const emit = vi.hoisted(() => vi.fn());

vi.mock('../../logging/rendererLogger.js', async (importOriginal) => {
    const original = await importOriginal<typeof RendererLoggerModule>();
    return { ...original, readRendererLogsApi: () => ({ emit }) };
});

// ─── fixtures ───────────────────────────────────────────────────────────────────

/** Four cells cut from a 4x1 strip, so cell N occupies u ∈ [N/4, (N+1)/4]. */
function makeAtlas(): SpriteAtlas {
    const frames = [0, 1, 2, 3].map((index) => {
        const u0 = index / 4;
        const u1 = (index + 1) / 4;
        return {
            name: `run_${String(index)}`,
            x: index * 16,
            y: 0,
            width: 16,
            height: 16,
            uv: [
                [u0, 1],
                [u1, 1],
                [u0, 0],
                [u1, 0],
            ] as const,
        };
    });
    return { imageWidth: 64, imageHeight: 16, frames, warnings: [] };
}

/**
 * A 1-second, 4-frame run, so one frame is 0.25 s and a phase is a second.
 *
 * `step` sits at phase 0.5 rather than 0: Rule MARK-CROSS covers
 * `(lastPhase, nextPhase]`, so a mark at the very start of a clip is never
 * crossed on the first step and would make the marker cases vacuous.
 */
const SHEET: SpriteAnimationMetadata = {
    clips: {
        run: {
            frames: [0, 1, 2, 3],
            durationSeconds: 1,
            notifies: { step: { at: 0.5 } },
            passages: { stride: { from: 0.25, to: 0.75 } },
        },
    },
};

/** Which atlas cell is on the quad, read back off the real `uv` attribute. */
function shownCellIndex(geometry: PlaneGeometry): number {
    const uv = geometry.attributes['uv'];
    if (uv === undefined) {
        throw new Error('geometry has no uv attribute');
    }
    // Every cell's first pair is its left edge, and cell N starts at N/4.
    return Math.round(uv.getX(0) * 4);
}

function makeRecorder(): {
    readonly events: MarkerEvent[];
    readonly handlers: NonNullable<UseSpriteClipPlayerOptions['handlers']>;
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

interface MountOptions {
    readonly atlas?: SpriteAtlas | null;
    readonly geometry?: PlaneGeometry | null;
    readonly sheet?: SpriteAnimationMetadata | null;
    readonly options?: UseSpriteClipPlayerOptions;
}

/** What a rerender may change. `atlas` and `geometry` deliberately cannot. */
interface SpriteRenderProps {
    readonly options: UseSpriteClipPlayerOptions;
    readonly sheet: SpriteAnimationMetadata | null;
}

/**
 * Mount the hook with ONE atlas and ONE geometry identity held across renders.
 *
 * `sheet` IS rerenderable, because it is an input a caller genuinely swaps — a
 * game replacing a sprite's clip sheet over the same loaded atlas — and it is
 * the only way to reach the allocation effect's `specs` dependency.
 */
function mountSprite(mount: MountOptions = {}) {
    const atlas = mount.atlas === undefined ? makeAtlas() : mount.atlas;
    const geometry = mount.geometry === undefined ? new PlaneGeometry(1, 1) : mount.geometry;
    const sheet = mount.sheet === undefined ? SHEET : mount.sheet;
    const initial = mount.options ?? { clip: 'run' };

    const rendered = renderHook(
        ({ options, sheet: liveSheet }: SpriteRenderProps) =>
            useSpriteClipPlayer(atlas, geometry, liveSheet, options),
        { initialProps: { options: initial, sheet } },
    );

    return { ...rendered, atlas, geometry, sheet };
}

let frameClockSeconds = 0;

/**
 * One frame of `deltaSeconds`, through the fake root's real subscriber walk.
 *
 * `update` takes an ABSOLUTE timestamp and derives the delta from it, so the
 * running clock is what makes two consecutive calls two frames rather than one
 * frame and a zero-length one.
 */
function advance(deltaSeconds: number): void {
    frameClockSeconds += deltaSeconds;
    act(() => {
        update(frameClockSeconds);
    });
}

beforeEach(() => {
    resetFakeFiberRoot();
    frameClockSeconds = 0;
    emit.mockClear();
    // The store is a module singleton, so a dilated case would leak into every
    // case after it.
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

afterEach(() => {
    cleanup();
    useTimeScaleStore.getState().setAuthoritativePermille(undefined);
});

// ─── cases ──────────────────────────────────────────────────────────────────────

describe('useSpriteClipPlayer drives a run of atlas cells', () => {
    it('seats the clip’s first cell on the quad as soon as it starts', () => {
        const { geometry } = mountSprite();

        expect(shownCellIndex(geometry!)).toBe(0);
    });

    it('walks the cells as the frame loop advances', () => {
        const { geometry } = mountSprite();

        // 4 frames across 1 s: a quarter-second lands on each next cell.
        advance(0.25);
        expect(shownCellIndex(geometry!)).toBe(1);
        advance(0.25);
        expect(shownCellIndex(geometry!)).toBe(2);
        advance(0.25);
        expect(shownCellIndex(geometry!)).toBe(3);
    });

    it('holds the last cell of a once clip past its end', () => {
        const { geometry } = mountSprite();

        advance(5);

        expect(shownCellIndex(geometry!)).toBe(3);
    });

    it('wraps a loop clip back to its first cell', () => {
        const { geometry } = mountSprite({ options: { clip: 'run', loop: 'loop' } });

        advance(1);

        expect(shownCellIndex(geometry!)).toBe(0);
    });

    it('paces the run by the clip-speed layer', () => {
        const { geometry } = mountSprite({ options: { clip: 'run', speed: 0.5 } });

        // Half speed: a quarter-second is now an eighth of the clip, still cell 0.
        advance(0.25);
        expect(shownCellIndex(geometry!)).toBe(0);
        advance(0.25);
        expect(shownCellIndex(geometry!)).toBe(1);
    });

    it('follows the authoritative dilation with no per-call-site wiring', () => {
        // Rule GLOBAL-BY-DEFAULT, reached through the SHARED store rather than
        // through `options.timeScale`. Pinned here rather than only mesh-side:
        // the changeset claims the sprite half follows the authoritative
        // dilation, and a sprite binding that read the store wrong — or not at
        // all — would be invisible to the mesh cases.
        useTimeScaleStore.getState().setAuthoritativePermille(500);
        const { geometry } = mountSprite();

        advance(0.25);

        // Half speed: a quarter-second is an eighth of the clip, still cell 0.
        expect(shownCellIndex(geometry!)).toBe(0);
        advance(0.25);
        expect(shownCellIndex(geometry!)).toBe(1);
    });

    it('lets an explicit timeScale OVERRIDE the authoritative one rather than compose', () => {
        // The other half of GLOBAL-BY-DEFAULT: composing would make this a
        // quarter of the clip per half-second, which lands on a different cell.
        useTimeScaleStore.getState().setAuthoritativePermille(500);
        const { geometry } = mountSprite({ options: { clip: 'run', timeScale: 1 } });

        advance(0.25);

        expect(shownCellIndex(geometry!)).toBe(1);
    });

    it('scales the run by an overriding timeScale', () => {
        const { geometry } = mountSprite({ options: { clip: 'run', timeScale: 0.5 } });

        advance(0.25);
        expect(shownCellIndex(geometry!)).toBe(0);
        advance(0.25);
        expect(shownCellIndex(geometry!)).toBe(1);
    });

    it('re-targets a speed change in flight rather than restarting the run', () => {
        const { geometry, rerender } = mountSprite();

        advance(0.25);
        expect(shownCellIndex(geometry!)).toBe(1);

        rerender({ options: { clip: 'run', speed: 0.5 }, sheet: SHEET });

        // Still on cell 1: a restart would have snapped back to cell 0.
        expect(shownCellIndex(geometry!)).toBe(1);
        advance(0.5);
        expect(shownCellIndex(geometry!)).toBe(2);
    });

    it('re-allocates the backend when the sheet identity changes', () => {
        // The allocation effect's `specs` dependency, reached the only way it
        // can be: a sheet swap over an UNCHANGED atlas and geometry. Without it
        // the backend keeps the old runs while the playback effect (which does
        // key on `sheet`) restarts — so the start answers false and the game gets a
        // spurious authoring fault for a clip its new sheet does carry.
        const { geometry, rerender } = mountSprite({
            sheet: { clips: { run: { frames: [0, 1], durationSeconds: 1 } } },
        });

        advance(0.5);
        // A 2-frame run at phase 0.5 is on its second cell, atlas cell 1.
        expect(shownCellIndex(geometry!)).toBe(1);

        rerender({
            options: { clip: 'run' },
            sheet: { clips: { run: { frames: [3], durationSeconds: 1 } } },
        });

        // The new run's only cell is atlas cell 3 — a value neither the old run
        // nor a reset-to-zero could produce.
        expect(shownCellIndex(geometry!)).toBe(3);
        expect(emit.mock.calls).toEqual([]);
    });

    it('restarts on the new clip’s first cell and closes the outgoing passage exactly once', () => {
        // `run` carries a passage the advance below OPENS and does not close, so
        // the switch happens with one passage still open. Without one there is
        // no `passage-end` to count and no reason to read. `idle` outlasts the
        // advance after the switch and `run` does not, so a `clip-end` in the
        // stream can only have come from the clip the hook abandoned.
        const sheet: SpriteAnimationMetadata = {
            clips: {
                run: {
                    frames: [0, 1, 2, 3],
                    durationSeconds: 1,
                    passages: { stride: { from: 0.25, to: 0.75 } },
                },
                idle: { frames: [1, 3], durationSeconds: 8 },
            },
        };
        const recorder = makeRecorder();
        const { geometry, rerender } = mountSprite({
            sheet,
            options: { clip: 'run', handlers: recorder.handlers },
        });

        advance(0.5);
        expect(shownCellIndex(geometry!)).toBe(2);
        // The passage is open across the switch.
        expect(recorder.events).toEqual([{ kind: 'passage-start', name: 'stride' }]);
        recorder.events.length = 0;

        rerender({ options: { clip: 'idle', handlers: recorder.handlers }, sheet });
        advance(2);

        // `idle` restarts on its own first cell, atlas cell 1 — distinct from
        // both the cell `run` was showing and from cell 0. Its run is TWO cells
        // rather than one because a one-cell run reads as its first cell at
        // EVERY phase, which leaves the restart unfalsifiable; with two, a
        // playback seated far enough past zero shows atlas cell 3 instead.
        expect(shownCellIndex(geometry!)).toBe(1);
        // The WHOLE stream rather than a `toContain`: a SECOND `passage-end` and
        // a stray `clip-end` each fail it. `SpriteClipBackend` holds ONE live
        // playback and releases the previous one itself, so a player-side leak
        // is invisible to the quad — this stream is what surfaces it. And the
        // reason is `'clip-changed'`, not `'stopped'`: nobody asked for a stop,
        // and the sprite backend's inability to blend does not change which of
        // the seven closures this was.
        expect(recorder.events).toEqual([
            { kind: 'passage-end', name: 'stride', reason: 'clip-changed' },
        ]);
    });
});

describe('useSpriteClipPlayer fires the marks the sheet authors', () => {
    it('emits a notify when the playhead crosses it', () => {
        const recorder = makeRecorder();
        mountSprite({ options: { clip: 'run', handlers: recorder.handlers } });

        advance(0.6);

        expect(recorder.events.filter((event) => event.kind === 'notify')).toEqual([
            { kind: 'notify', name: 'step' },
        ]);
    });

    it('opens and closes an authored passage', () => {
        const recorder = makeRecorder();
        mountSprite({ options: { clip: 'run', handlers: recorder.handlers } });

        advance(0.5);
        expect(recorder.events.some((event) => event.kind === 'passage-start')).toBe(true);

        advance(0.5);
        expect(recorder.events.some((event) => event.kind === 'passage-end')).toBe(true);
    });

    it('emits clip-end once a once clip finishes', () => {
        const recorder = makeRecorder();
        mountSprite({ options: { clip: 'run', handlers: recorder.handlers } });

        advance(1.5);

        expect(recorder.events.filter((event) => event.kind === 'clip-end')).toHaveLength(1);
    });

    it('reads the handlers fresh, without restarting the clip in flight', () => {
        const first = makeRecorder();
        const second = makeRecorder();
        const { geometry, rerender } = mountSprite({
            options: { clip: 'run', handlers: first.handlers },
        });

        advance(0.25);
        rerender({ options: { clip: 'run', handlers: second.handlers }, sheet: SHEET });
        advance(0.35);

        // The notify at phase 0.5 lands after the swap, so only the second
        // recorder hears it — and the run did not restart to do it.
        expect(first.events.filter((event) => event.kind === 'notify')).toEqual([]);
        expect(second.events.filter((event) => event.kind === 'notify')).toHaveLength(1);
        expect(shownCellIndex(geometry!)).toBe(2);
    });
});

describe('useSpriteClipPlayer registers exactly one default-priority driver', () => {
    it('subscribes once per mount and never bumps the render priority', () => {
        mountSprite();

        expect(fakeRootState().internal.subscribers).toHaveLength(1);
        // A non-zero priority makes the subscriber responsible for gl.render.
        expect(fakeRootState().internal.priority).toBe(0);
    });

    it('still subscribes when there is nothing to play yet', () => {
        // Rules of hooks: the atlas transitions null → measured across renders
        // of one mounted component, so the subscription cannot be conditional.
        mountSprite({ atlas: null, geometry: null, sheet: null, options: { clip: null } });

        expect(fakeRootState().internal.subscribers).toHaveLength(1);
    });

    it('keeps one subscriber across a rerender', () => {
        const { rerender } = mountSprite();

        rerender({ options: { clip: 'run', speed: 0.5 }, sheet: SHEET });

        expect(fakeRootState().internal.subscribers).toHaveLength(1);
    });
});

describe('useSpriteClipPlayer is null-safe and fail-soft', () => {
    it('drives nothing and reports nothing without an atlas', () => {
        mountSprite({ atlas: null });

        advance(1);

        expect(emit.mock.calls).toEqual([]);
    });

    it('drives nothing and reports nothing without a geometry', () => {
        mountSprite({ geometry: null });

        advance(1);

        expect(emit.mock.calls).toEqual([]);
    });

    it('reports nothing when the caller declares no clip', () => {
        mountSprite({ options: { clip: null } });

        advance(1);

        expect(emit.mock.calls).toEqual([]);
    });

    it('reports nothing for a sheet that is still null while the atlas loads', () => {
        mountSprite({ sheet: null, options: { clip: null } });

        advance(1);

        expect(emit.mock.calls).toEqual([]);
    });

    it('reports an authoring fault for a clip the sheet does not carry', () => {
        mountSprite({ options: { clip: 'missing' } });

        expect(emit).toHaveBeenCalledTimes(1);
        expect(String(emit.mock.calls[0]?.[0]?.message)).toContain('missing');
    });

    it('reports a clip whose frame run reaches past the atlas', () => {
        // The backend drops a run it cannot resolve, so the clip is unplayable
        // — the same answer as a clip that was never authored.
        mountSprite({ sheet: { clips: { run: { frames: [0, 99], durationSeconds: 1 } } } });

        expect(emit).toHaveBeenCalledTimes(1);
    });

    it('reports a clip that declares no usable durationSeconds', () => {
        mountSprite({ sheet: { clips: { run: { frames: [0, 1] } } } });

        expect(emit).toHaveBeenCalledTimes(1);
    });

    it('leaves the quad alone when the geometry carries no writable uv', () => {
        const geometry = new PlaneGeometry(1, 1);
        geometry.deleteAttribute('uv');

        expect(() => mountSprite({ geometry })).not.toThrow();
        expect(emit.mock.calls).toEqual([]);
    });

    it('does not dispose the caller-owned geometry on unmount', () => {
        const geometry = new PlaneGeometry(1, 1);
        const dispose = vi.spyOn(geometry, 'dispose');
        const { unmount } = mountSprite({ geometry });

        unmount();

        // Geometry lifetime belongs to whoever constructed it.
        expect(dispose).not.toHaveBeenCalled();
    });

    it('stops driving the quad once unmounted', () => {
        const { geometry, unmount } = mountSprite();

        unmount();
        const cellAtUnmount = shownCellIndex(geometry!);
        advance(0.5);

        expect(shownCellIndex(geometry!)).toBe(cellAtUnmount);
    });
});

describe('useSpriteClipPlayer hands back the imperative handle', () => {
    it('re-targets the clip-speed layer in flight', () => {
        const { geometry, result } = mountSprite();

        act(() => {
            result.current.setClipSpeed(0.5);
        });
        advance(0.25);

        expect(shownCellIndex(geometry!)).toBe(0);
    });

    it('refuses a negative speed even before anything has loaded', () => {
        const { result } = mountSprite({
            atlas: null,
            geometry: null,
            sheet: null,
            options: { clip: null },
        });

        expect(() => {
            result.current.setClipSpeed(-1);
        }).toThrow(RangeError);
    });

    it('holds one handle identity across rerenders', () => {
        const { result, rerender } = mountSprite();
        const first = result.current;

        rerender({ options: { clip: 'run', speed: 0.5 }, sheet: SHEET });

        expect(result.current).toBe(first);
    });
});
