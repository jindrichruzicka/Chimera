// @vitest-environment jsdom

/**
 * renderer/components/r3f/FrameRateLimiter.test.tsx
 *
 * Unit tests for the engine frame-rate limiter — the loop *driver* that paces
 * R3F's `advance()` to the active game's `settings.display.targetFps` instead of
 * presenting frames itself.
 *
 * Rules:
 *  - Mock @react-three/fiber; no real WebGL context required. The fake `advance`
 *    mirrors R3F's `update()` under `frameloop: 'never'` (delta measured against
 *    the clock, then the clock set to the supplied timestamp) so the deltas the
 *    driver hands downstream consumers are observable here.
 *  - Drive a fake requestAnimationFrame with synthetic timestamps.
 *  - Imports only the settings defaults the component's own selector reads; no
 *    electron/, ai/ or apps/* imports.
 */

import { cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ENGINE_DEFAULTS } from '@chimera-engine/simulation/settings/index.js';
import { useSettingsStore } from '../../state/settingsStore';
import { FrameRateLimiter } from './FrameRateLimiter';

// ── @react-three/fiber mock ───────────────────────────────────────────────────

type Frameloop = 'always' | 'demand' | 'never';

interface FiberState {
    advance: ReturnType<typeof vi.fn>;
    frameloop: Frameloop;
    clock: { elapsedTime: number; oldTime: number };
    gl: { render: ReturnType<typeof vi.fn> };
    scene: object;
    camera: object;
}

const fiber = vi.hoisted(() => ({
    useFrame: vi.fn(),
    useThree: vi.fn(),
    /** The module-level export, which advances EVERY root — must stay unused. */
    advance: vi.fn(),
}));

vi.mock('@react-three/fiber', () => ({
    useFrame: fiber.useFrame,
    useThree: fiber.useThree,
    advance: fiber.advance,
}));

let fiberState: FiberState;
/** Deltas R3F would compute from the timestamps the driver advances with. */
let advanceDeltas: number[];

function makeFiberState(frameloop: Frameloop): FiberState {
    const clock = { elapsedTime: 0, oldTime: 0 };
    return {
        // Mirrors @react-three/fiber's update() under 'never'.
        advance: vi.fn((timestamp: number) => {
            advanceDeltas.push(timestamp - clock.elapsedTime);
            clock.oldTime = clock.elapsedTime;
            clock.elapsedTime = timestamp;
        }),
        frameloop,
        clock,
        gl: { render: vi.fn() },
        scene: {},
        camera: {},
    };
}

// ── Fake requestAnimationFrame ────────────────────────────────────────────────

let rafCallbacks: Map<number, (timestamp: number) => void>;
let nextRafHandle: number;
let cancelledHandles: number[];
let clockMs: number;

function installFakeRaf(): void {
    rafCallbacks = new Map();
    nextRafHandle = 1;
    cancelledHandles = [];
    clockMs = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: (timestamp: number) => void): number => {
        const handle = nextRafHandle++;
        rafCallbacks.set(handle, callback);
        return handle;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number): void => {
        cancelledHandles.push(handle);
        rafCallbacks.delete(handle);
    });
}

/** Fire every pending frame callback once at `clockMs + deltaMs`. */
function tick(deltaMs: number): void {
    clockMs += deltaMs;
    const due = [...rafCallbacks.values()];
    // Clear first: each callback re-registers itself for the next frame.
    rafCallbacks.clear();
    for (const callback of due) {
        callback(clockMs);
    }
}

function drive(count: number, deltaMs: number): void {
    for (let i = 0; i < count; i++) {
        tick(deltaMs);
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function setTargetFps(targetFps: 30 | 60 | 120 | 0): void {
    useSettingsStore.setState({
        activeGameId: 'game',
        settings: { game: { ...ENGINE_DEFAULTS, display: { targetFps } } },
    });
}

/** Timestamps (in R3F clock seconds) the store-bound `advance` was called with. */
function advanceCalls(): number[] {
    return fiberState.advance.mock.calls.map((call) => call[0] as number);
}

function mount(): ReturnType<typeof render> {
    return render(<FrameRateLimiter />);
}

// ── Renderer log bridge ───────────────────────────────────────────────────────

interface LoggedEntry {
    level: string;
    message: string;
    source: { module: string };
    error?: { name: string; message: string };
}

let logEmit: ReturnType<typeof vi.fn>;

function loggedErrors(): LoggedEntry[] {
    return logEmit.mock.calls
        .map((call) => call[0] as LoggedEntry)
        .filter((entry) => entry.level === 'error');
}

/**
 * Let a deferred wiring report fire. The report is scheduled a frame out so a
 * cap change that has not yet reached the `<Canvas>` prop does not read as a
 * mis-wiring, so nothing is reported until a frame elapses.
 */
function flushReport(): void {
    tick(0);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
    installFakeRaf();
    advanceDeltas = [];
    fiberState = makeFiberState('never');
    fiber.useThree.mockImplementation((selector: (state: FiberState) => unknown) =>
        selector(fiberState),
    );
    logEmit = vi.fn();
    vi.stubGlobal('__chimera', { logs: { emit: logEmit } });
    useSettingsStore.setState({ activeGameId: null, settings: {} });
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FrameRateLimiter — never presents', () => {
    it.each([30, 60, 120] as const)(
        'registers zero useFrame subscribers and calls gl.render zero times at %i fps',
        (targetFps) => {
            setTargetFps(targetFps);
            mount();
            drive(20, 1000 / 120);

            expect(fiber.useFrame).not.toHaveBeenCalled();
            expect(fiberState.gl.render).not.toHaveBeenCalled();
        },
    );

    it('reads only advance, frameloop and clock — never a presenter', () => {
        setTargetFps(60);
        mount();
        drive(20, 1000 / 120);

        const touched = new Set<string>();
        const probe = new Proxy(fiberState as unknown as Record<string, unknown>, {
            get(target, key): unknown {
                touched.add(String(key));
                return Reflect.get(target, key);
            },
        });
        for (const call of fiber.useThree.mock.calls) {
            (call[0] as (state: unknown) => unknown)(probe);
        }

        // `gl`, `scene` and `camera` are absent: with no handle on them the
        // component cannot present, whatever a future edit does inside the loop.
        expect([...touched].sort()).toEqual(['advance', 'clock', 'frameloop']);
    });
});

describe('FrameRateLimiter — inert cases', () => {
    it('starts no rAF chain and never advances at targetFps 0', () => {
        setTargetFps(0);
        fiberState = makeFiberState('always');
        mount();

        expect(rafCallbacks.size).toBe(0);
        drive(10, 1000 / 60);
        expect(advanceCalls()).toEqual([]);
    });

    it('starts no rAF chain and never advances when settings are unhydrated', () => {
        fiberState = makeFiberState('always');
        mount();

        expect(rafCallbacks.size).toBe(0);
        expect(advanceCalls()).toEqual([]);
    });

    it.each(['always', 'demand'] as const)(
        'stays inert under a capped target when frameloop is %s',
        (frameloop) => {
            setTargetFps(60);
            fiberState = makeFiberState(frameloop);
            mount();
            // The one pending frame here is the deferred wiring report; firing
            // it must leave no chain behind.
            flushReport();

            expect(rafCallbacks.size).toBe(0);
            drive(10, 1000 / 60);
            expect(advanceCalls()).toEqual([]);
        },
    );

    it('starts no rAF chain at targetFps 0 even under frameloop never', () => {
        setTargetFps(0);
        mount();

        expect(rafCallbacks.size).toBe(0);
        expect(advanceCalls()).toEqual([]);
    });

    it('tears the chain down when a live canvas leaves frameloop never', () => {
        setTargetFps(60);
        const { rerender } = mount();
        drive(3, 1000 / 60);
        const beforeTransition = advanceCalls().length;

        fiberState.frameloop = 'always';
        rerender(<FrameRateLimiter />);
        flushReport(); // the mis-wiring report is now the only pending frame

        expect(rafCallbacks.size).toBe(0);
        drive(10, 1000 / 60);
        expect(advanceCalls()).toHaveLength(beforeTransition);
    });

    it('treats a non-numeric targetFps as uncapped', () => {
        // The store mirrors IPC payloads, so the cap is type-checked rather than
        // null-checked: a numeric STRING passes a `?? 0` fallback and would be
        // divided into a frame interval.
        useSettingsStore.setState({
            activeGameId: 'game',
            settings: {
                game: { ...ENGINE_DEFAULTS, display: { targetFps: '60' } },
            } as unknown as ReturnType<typeof useSettingsStore.getState>['settings'],
        });
        mount();

        expect(rafCallbacks.size).toBe(0);
        expect(advanceCalls()).toEqual([]);
    });

    it('reads the engine settings namespace when no game is active', () => {
        useSettingsStore.setState({
            activeGameId: null,
            settings: { __engine__: { ...ENGINE_DEFAULTS, display: { targetFps: 30 } } },
        });
        mount();

        expect(advanceCalls()).toEqual([0]);
        expect(rafCallbacks.size).toBe(1);
    });
});

describe('FrameRateLimiter — half-wired canvas', () => {
    // Both diagnostics vary across the matrix, so no single hardcoded constant
    // satisfies every row.
    it.each([
        [30, 'always'],
        [120, 'demand'],
        [120, 'always'],
    ] as const)(
        'reports once when a %i fps cap is active but frameloop is %s',
        (targetFps, frameloop) => {
            setTargetFps(targetFps);
            fiberState = makeFiberState(frameloop);
            mount();
            flushReport();

            const errors = loggedErrors();
            expect(errors).toHaveLength(1);
            const entry = errors[0];
            expect(entry?.error?.name).toBe('FrameloopWiringError');
            // Attributable, not 'global' — every emitRendererError call site in
            // the renderer names its own module.
            expect(entry?.source.module).toBe('frame-rate-limiter');
            expect(entry?.message).toContain('[FrameRateLimiter]');
            // The message must name the owning root — never instruct the game
            // to wire the prop itself (the r3f barrel does not export the
            // halves) — and carry the two diagnostics that say WHICH canvas is
            // mis-wired.
            expect(entry?.error?.message).toContain('engine wiring defect');
            expect(entry?.error?.message).not.toContain('Pass the other half');
            expect(entry?.error?.message).toContain(`${targetFps} fps`);
            expect(entry?.error?.message).toContain(`'${frameloop}'`);
        },
    );

    it('reports nothing and drives normally under frameloop never', () => {
        setTargetFps(60);
        mount();
        drive(10, 1000 / 60);

        expect(loggedErrors()).toHaveLength(0);
        expect(advanceCalls()).toHaveLength(10);
    });

    it.each(['always', 'demand', 'never'] as const)(
        'reports nothing at targetFps 0 under frameloop %s',
        (frameloop) => {
            setTargetFps(0);
            fiberState = makeFiberState(frameloop);
            mount();
            flushReport();

            expect(loggedErrors()).toHaveLength(0);
        },
    );

    it('reports when a cap is switched on while the canvas keeps its own loop', () => {
        setTargetFps(0);
        fiberState = makeFiberState('always');
        const { rerender } = mount();
        flushReport();
        expect(loggedErrors()).toHaveLength(0);

        // The game hard-coded its <Canvas> and never passed the prop; the player
        // turns a cap on at runtime. Nothing about the canvas changed, so only
        // the targetFps half of the pair can surface this.
        setTargetFps(60);
        rerender(<FrameRateLimiter />);
        flushReport();

        expect(loggedErrors()).toHaveLength(1);
    });

    it('reports when a wired canvas later leaves frameloop never', () => {
        setTargetFps(60);
        const { rerender } = mount();
        flushReport();
        expect(loggedErrors()).toHaveLength(0);

        fiberState.frameloop = 'always';
        rerender(<FrameRateLimiter />);
        flushReport();

        expect(loggedErrors()).toHaveLength(1);
    });

    it('reports nothing when a transient mismatch resolves within the frame', () => {
        setTargetFps(60);
        const { rerender } = mount();

        // The cap and the <Canvas frameloop> prop reach their consumers through
        // two different React roots, so a correctly wired canvas is briefly
        // mismatched on every cap change — the boot hydration from 0 to the
        // default included. Reporting that would fire on every healthy game.
        fiberState.frameloop = 'always';
        rerender(<FrameRateLimiter />);
        fiberState.frameloop = 'never';
        rerender(<FrameRateLimiter />);
        flushReport();

        expect(loggedErrors()).toHaveLength(0);
    });

    it('reports once per mount, not once per render or frame', () => {
        setTargetFps(60);
        fiberState = makeFiberState('always');
        const { rerender } = mount();

        for (let i = 0; i < 5; i++) {
            rerender(<FrameRateLimiter />);
        }
        drive(20, 1000 / 60);

        expect(loggedErrors()).toHaveLength(1);
    });

    it('reports once, not twice, under StrictMode', () => {
        setTargetFps(60);
        fiberState = makeFiberState('always');
        render(
            <React.StrictMode>
                <FrameRateLimiter />
            </React.StrictMode>,
        );
        flushReport();

        // StrictMode mounts, unmounts and remounts; the cancelled first report
        // must not survive as a duplicate. Dev is the only place this report
        // exists, and dev is where StrictMode runs.
        expect(loggedErrors()).toHaveLength(1);
    });

    it('routes the report through the log bridge, never console', () => {
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        setTargetFps(60);
        fiberState = makeFiberState('always');
        mount();
        flushReport();

        expect(logEmit).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        consoleErrorSpy.mockRestore();
    });

    it('survives a missing log bridge without throwing', () => {
        setTargetFps(60);
        fiberState = makeFiberState('always');
        vi.stubGlobal('__chimera', undefined);
        mount();

        expect(() => flushReport()).not.toThrow();
    });
});

describe('FrameRateLimiter — advance contract', () => {
    it('advances eagerly with 0 on mount, before any rAF callback fires', () => {
        setTargetFps(60);
        mount();

        expect(advanceCalls()).toEqual([0]);
        expect(rafCallbacks.size).toBe(1);
    });

    it('advances in the layout phase, before passive effects run', () => {
        setTargetFps(60);
        const order: string[] = [];
        fiberState.advance.mockImplementation(() => {
            order.push('advance');
        });

        function PassiveMarker(): null {
            React.useEffect(() => {
                order.push('passive');
            }, []);
            return null;
        }

        // PassiveMarker is mounted FIRST, so its passive effect would run before
        // a passive limiter effect. Nothing is on screen under 'never' until the
        // first advance, so that frame must not wait for the passive phase.
        render(
            <>
                <PassiveMarker />
                <FrameRateLimiter />
            </>,
        );

        expect(order).toEqual(['advance', 'passive']);
    });

    it('advances in seconds relative to the clock, not raw milliseconds', () => {
        setTargetFps(30);
        mount();
        // First tick seeds the timestamp baseline; the second is a 33 ms step.
        drive(2, 33);

        const calls = advanceCalls();
        expect(calls).toHaveLength(2);
        expect(calls[1]).toBeCloseTo(0.033, 6);
        // A raw performance.now()-style millisecond value would be ~33 here, and
        // R3F would compute a delta of thousands of seconds from it.
        expect(calls[1]).toBeLessThan(1);
    });

    it('advances with monotonically increasing timestamps from the eager first call', () => {
        setTargetFps(60);
        mount();
        drive(12, 1000 / 60);

        const calls = advanceCalls();
        expect(calls[0]).toBe(0);
        expect(calls.length).toBeGreaterThan(2);
        for (let i = 1; i < calls.length; i++) {
            expect(calls[i]).toBeGreaterThan(calls[i - 1]!);
        }
    });

    it('never hands R3F a negative delta when the cap changes mid-session', () => {
        setTargetFps(60);
        const { rerender } = mount();
        drive(121, 1000 / 60); // ~2 s of paced frames

        setTargetFps(30);
        rerender(<FrameRateLimiter />);
        drive(4, 1000 / 60);

        // Restarting the timestamp origin at 0 would hand every downstream
        // consumer (PerfProbe, useTween, useModelAnimation) minus the whole
        // elapsed session as one delta. `setFrameloop` did not run, so the R3F
        // clock still holds the old reading.
        expect(Math.min(...advanceDeltas)).toBeGreaterThanOrEqual(0);
    });

    it('reads the store-bound advance and the root clock through useThree selectors', () => {
        setTargetFps(60);
        mount();

        const storeBound = Symbol('store-bound advance');
        const rootClock = { elapsedTime: 7, oldTime: 6 };
        const probe = {
            advance: storeBound,
            frameloop: 'never',
            clock: rootClock,
        } as unknown as FiberState;
        const selectors = fiber.useThree.mock.calls.map(
            (call) => call[0] as (state: FiberState) => unknown,
        );

        expect(selectors.some((selector) => selector(probe) === storeBound)).toBe(true);
        // Identity, not shape: `clock` is a dependency-list entry, so a selector
        // returning a fresh object would restart the chain on every render.
        expect(selectors.some((selector) => selector(probe) === rootClock)).toBe(true);
        // The module-level export advances every root in `_roots`, not this one.
        expect(fiber.advance).not.toHaveBeenCalled();
    });
});

describe('FrameRateLimiter — pacing cadence', () => {
    it('advances every frame when the native rate matches the cap (60 fps on 60 Hz)', () => {
        setTargetFps(60);
        mount();
        // 10 frames at ~16.667 ms (60 Hz) → 10 advances counting the eager one
        // (jitter tolerance keeps the cadence from collapsing to half rate).
        drive(10, 1000 / 60);

        expect(advanceCalls()).toHaveLength(10);
    });

    it('halves the advance rate when native runs at double the cap (60 fps on 120 Hz)', () => {
        setTargetFps(60);
        mount();
        // 12 frames at ~8.333 ms (120 Hz) → ~6 advances (60 fps cap).
        drive(12, 1000 / 120);

        expect(advanceCalls()).toHaveLength(6);
    });

    it('caps a high-refresh display to a low target (30 fps on 120 Hz)', () => {
        setTargetFps(30);
        mount();
        // 12 frames at ~8.333 ms (120 Hz) → ~3 advances (30 fps cap).
        drive(12, 1000 / 120);

        expect(advanceCalls()).toHaveLength(3);
    });

    it('carries the fractional remainder so an off-multiple refresh keeps the cap', () => {
        setTargetFps(60);
        mount();
        // 100 Hz under a 60 cap: 1 s of frames must yield 60 advances. Zeroing
        // the accumulator instead of keeping the remainder costs every third
        // one (two 10 ms ticks per advance → 50).
        drive(101, 10);

        expect(advanceCalls()).toHaveLength(61); // 60 paced + the eager frame
    });

    it('does not queue catch-up advances after a long stall', () => {
        setTargetFps(60);
        mount();
        drive(1, 1000 / 60); // seeds the baseline
        const beforeStall = advanceCalls().length;

        tick(2000);
        expect(advanceCalls()).toHaveLength(beforeStall + 1); // once, not ~120 times

        // The accumulator was clamped to one interval, so the next native-rate
        // frame advances again rather than waiting out the stall.
        tick(1000 / 60);
        expect(advanceCalls()).toHaveLength(beforeStall + 2);
    });

    it('resumes the normal cadence after a stall instead of running free', () => {
        setTargetFps(30);
        mount();
        drive(1, 1000 / 120); // seeds the baseline
        tick(2000);
        const afterStall = advanceCalls().length;

        drive(12, 1000 / 120);

        // Clamped to one interval → 4 advances at the 30 cap. Subtracting the
        // interval without clamping leaves ~2 s banked and every one of the 12
        // frames advances.
        expect(advanceCalls()).toHaveLength(afterStall + 4);
    });
});

describe('FrameRateLimiter — teardown', () => {
    it('cancels the outstanding frame on unmount and stops advancing', () => {
        setTargetFps(60);
        const { unmount } = mount();
        drive(2, 1000 / 60);
        const beforeUnmount = advanceCalls().length;

        unmount();

        expect(cancelledHandles).toHaveLength(1);
        expect(rafCallbacks.size).toBe(0);
        drive(10, 1000 / 60);
        expect(advanceCalls()).toHaveLength(beforeUnmount);
    });

    it('cancels the outstanding frame when targetFps changes, leaving one chain', () => {
        setTargetFps(60);
        const { rerender } = mount();
        drive(2, 1000 / 60);

        setTargetFps(30);
        rerender(<FrameRateLimiter />);

        expect(cancelledHandles).toHaveLength(1);
        expect(rafCallbacks.size).toBe(1);
    });

    it('restarts pacing at the new cap after a targetFps change', () => {
        setTargetFps(120);
        const { rerender } = mount();
        drive(4, 1000 / 120);

        setTargetFps(30);
        rerender(<FrameRateLimiter />);
        fiberState.advance.mockClear();
        // 12 frames at 120 Hz under a 30 cap → 2 advances (no eager call is
        // counted here; the effect re-ran and already fired it before the clear).
        drive(12, 1000 / 120);

        expect(advanceCalls()).toHaveLength(2);
    });

    it('leaves exactly one live chain under StrictMode', () => {
        setTargetFps(60);
        render(
            <React.StrictMode>
                <FrameRateLimiter />
            </React.StrictMode>,
        );

        expect(rafCallbacks.size).toBe(1);

        fiberState.advance.mockClear();
        drive(10, 1000 / 60);
        // One chain → 9 tick-driven advances (the first tick seeds the baseline),
        // not 18 from a doubled chain.
        expect(advanceCalls()).toHaveLength(9);
    });
});
