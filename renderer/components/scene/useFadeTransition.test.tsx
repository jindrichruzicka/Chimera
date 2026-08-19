// @vitest-environment jsdom

import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    gamePhase,
    playerId,
    type PlayerSnapshot,
} from '@chimera-engine/simulation/bridge/api-types.js';
import type { AssetManifest } from '@chimera-engine/simulation/content/AssetManifest.js';
import type { AssetRef, TextureAsset } from '@chimera-engine/simulation/content/AssetRef.js';
import type { AssetManager } from '../../assets/AssetManager.js';
import { AssetManagerContext } from '../../assets/AssetManagerContext.js';
import {
    createStubAssetManager,
    stubManifest,
    textureRef,
} from '../../assets/__test-support__/StubAssetManager.js';
import { FadeContext, FadeProvider, type FadeControl } from '../shell/FadeContext.js';
import type * as ScenePreloadModule from './scenePreload.js';
import { SCENE_READY_RETRY_MS, useFadeTransition } from './useFadeTransition.js';

// Records every run the hook starts and counts its cancels, while DELEGATING to
// the real `startScenePreload` — the outcomes, the budget and the progress
// channel under test here are that module's, and a hand-written double would be
// asserting against itself.
const preloadRuns = vi.hoisted(() => [] as { cancelCalls: number }[]);

vi.mock('./scenePreload.js', async (importOriginal) => {
    const actual = await importOriginal<typeof ScenePreloadModule>();
    return {
        ...actual,
        startScenePreload: (options: Parameters<typeof actual.startScenePreload>[0]) => {
            const run = actual.startScenePreload(options);
            const record = { cancelCalls: 0 };
            preloadRuns.push(record);
            return {
                settled: run.settled,
                cancel: (): void => {
                    record.cancelCalls += 1;
                    run.cancel();
                },
            };
        },
    };
});

const LOCAL_PLAYER = playerId('local-player');

/** Captured before any `vi.useFakeTimers()`, so {@link flushPendingWork} yields for real. */
const realSetTimeout = globalThis.setTimeout;

/**
 * Yields to a REAL macrotask, which drains the whole pending microtask queue in
 * one go.
 *
 * Explicit, and deliberately not a fixed count of `await Promise.resolve()`:
 * the fade → preload → dispatch chain's length is an implementation detail, and
 * a counted flush silently under-drains the moment another `await` joins it.
 */
async function flushPendingWork(): Promise<void> {
    await act(async () => {
        await new Promise<void>((resolve) => {
            realSetTimeout(resolve, 0);
        });
    });
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    preloadRuns.length = 0;
});

beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback): number => {
        return globalThis.setTimeout(() => {
            callback(Date.now());
        }, 16) as unknown as number;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number): void => {
        globalThis.clearTimeout(frameId);
    });
});

describe('useFadeTransition', () => {
    it('dispatches engine:scene_ready only after fade-out completes', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        const snapshot = makeSnapshot({
            sceneTransition: {
                toSceneId: makeSceneId('engine:post-game'),
                phase: 'preparing',
                startedAtTick: 2,
                params: {},
                playersReady: [],
            },
        });

        function Harness(): React.ReactElement {
            useFadeTransition({
                snapshot,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 32,
                fadeInMs: 32,
            });
            return <div />;
        }

        render(
            <FadeProvider>
                <Harness />
            </FadeProvider>,
        );

        expect(sendAction).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(31);
        expect(sendAction).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        expect(sendAction).toHaveBeenCalledWith({
            type: 'engine:scene_ready',
            playerId: LOCAL_PLAYER,
            tick: snapshot.tick,
            payload: { playerId: LOCAL_PLAYER },
        });
    });

    it('dispatches engine:scene_ready exactly once under a StrictMode root', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        const snapshot = makeSnapshot({
            sceneTransition: {
                toSceneId: makeSceneId('engine:post-game'),
                phase: 'preparing',
                startedAtTick: 2,
                params: {},
                playersReady: [],
            },
        });

        function Harness(): React.ReactElement {
            useFadeTransition({
                snapshot,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 32,
                fadeInMs: 32,
            });
            return <div />;
        }

        // StrictMode as the ROOT element: React simulates a remount, running
        // every effect's cleanup and then its setup again on the SAME instance,
        // with refs preserved. `pnpm dev` runs both Next configs with
        // `reactStrictMode: true`, so this is the shape the barrier meets there.
        render(
            <React.StrictMode>
                <FadeProvider>
                    <Harness />
                </FadeProvider>
            </React.StrictMode>,
        );

        // Bounded, under the retry cadence: `runAllTimersAsync` would spin on
        // the cadence interval, and one elapsed cadence would legitimately
        // re-dispatch — this pin is about the StrictMode remount alone.
        await vi.advanceTimersByTimeAsync(64);

        expect(sendAction).toHaveBeenCalledOnce();
        expect(sendAction).toHaveBeenCalledWith({
            type: 'engine:scene_ready',
            playerId: LOCAL_PLAYER,
            tick: snapshot.tick,
            payload: { playerId: LOCAL_PLAYER },
        });
    });

    it('does not dispatch scene_ready when this player already acknowledged', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        const snapshot = makeSnapshot({
            sceneTransition: {
                toSceneId: makeSceneId('engine:post-game'),
                phase: 'preparing',
                startedAtTick: 2,
                params: {},
                playersReady: [LOCAL_PLAYER],
            },
        });

        function Harness(): React.ReactElement {
            useFadeTransition({
                snapshot,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 1,
                fadeInMs: 1,
            });
            return <div />;
        }

        render(
            <FadeProvider>
                <Harness />
            </FadeProvider>,
        );
        await vi.advanceTimersByTimeAsync(1);

        expect(sendAction).not.toHaveBeenCalled();
    });

    it('does not restart fade-out when another player becomes ready mid-transition', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        const FADE_MS = 32;

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: FADE_MS,
                fadeInMs: FADE_MS,
            });
            return <div />;
        }

        const { rerender } = render(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 3,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [],
                        },
                    })}
                />
            </FadeProvider>,
        );

        // Fade started. Advance 24ms — not yet complete.
        await vi.advanceTimersByTimeAsync(24);
        expect(sendAction).not.toHaveBeenCalled();

        // Another player becomes ready: tick advances, playersReady changes.
        // This must NOT cancel and restart the local player's in-flight fade.
        rerender(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 4,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [playerId('other-player')],
                        },
                    })}
                />
            </FadeProvider>,
        );

        // 8ms more — the original 32ms fade should now be complete.
        await vi.advanceTimersByTimeAsync(8);

        // scene_ready must fire exactly once (fade was NOT restarted).
        expect(sendAction).toHaveBeenCalledOnce();
        expect(sendAction).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'engine:scene_ready', playerId: LOCAL_PLAYER }),
        );
    });

    it('retries scene_ready on newer tick when zero-duration fade sent a stale acknowledgement', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 0,
                fadeInMs: 0,
            });
            return <div />;
        }

        const { rerender } = render(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 3,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [],
                        },
                    })}
                />
            </FadeProvider>,
        );

        // Bounded, under the retry cadence — `runAllTimersAsync` spins on the
        // cadence interval, and this pin is about the EDGE retry alone.
        await vi.advanceTimersByTimeAsync(48);

        expect(sendAction).toHaveBeenCalledTimes(1);
        expect(sendAction).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ type: 'engine:scene_ready', tick: 3 }),
        );

        // Host accepted another player's ready, so the transition tick advanced,
        // but this local player is still missing from playersReady.
        rerender(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 4,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [playerId('other-player')],
                        },
                    })}
                />
            </FadeProvider>,
        );

        await vi.advanceTimersByTimeAsync(48);

        expect(sendAction).toHaveBeenCalledTimes(2);
        expect(sendAction).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ type: 'engine:scene_ready', tick: 4 }),
        );
    });

    it('does not trigger repeated fadeIn while sceneTransition stays null across tick updates', () => {
        const sendAction = vi.fn();
        const fadeControl: FadeControl = {
            phase: 'idle',
            opacity: 0,
            setPhase: vi.fn(),
            fadeOut: vi.fn().mockResolvedValue(undefined),
            fadeIn: vi.fn().mockResolvedValue(undefined),
            claim: () => ({
                isActive: true,
                fadeOut: (durationMs?: number) => fadeControl.fadeOut(durationMs),
                fadeIn: (durationMs?: number) => fadeControl.fadeIn(durationMs),
            }),
        };

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 10,
                fadeInMs: 10,
            });
            return <div />;
        }

        const { rerender } = render(
            <FadeContext.Provider value={fadeControl}>
                <Harness snap={makeSnapshot({ tick: 10, sceneTransition: null })} />
            </FadeContext.Provider>,
        );

        rerender(
            <FadeContext.Provider value={fadeControl}>
                <Harness snap={makeSnapshot({ tick: 11, sceneTransition: null })} />
            </FadeContext.Provider>,
        );
        rerender(
            <FadeContext.Provider value={fadeControl}>
                <Harness snap={makeSnapshot({ tick: 12, sceneTransition: null })} />
            </FadeContext.Provider>,
        );

        expect(fadeControl.fadeIn).not.toHaveBeenCalled();
        expect(sendAction).not.toHaveBeenCalled();
    });
});

describe('useFadeTransition — scene_ready retry cadence', () => {
    // The ack can be LOST: the host's own ack advances the tick while a
    // client's — stamped one tick earlier — is in flight, and the pipeline
    // rejects the stale stamp without applying anything. Every other retry in
    // this hook is edge-triggered on the snapshot CHANGING, and a rejected
    // action changes nothing — in a turn-based game with no ticker, no further
    // broadcast ever arrives, and the barrier deadlocks for every player. The
    // cadence below is the only retry that fires on time instead of on change.
    it('re-dispatches scene_ready on the retry cadence while the barrier stays preparing', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        const snapshot = makeSnapshot({
            sceneTransition: {
                toSceneId: makeSceneId('engine:post-game'),
                phase: 'preparing',
                startedAtTick: 2,
                params: {},
                playersReady: [],
            },
        });

        function Harness(): React.ReactElement {
            useFadeTransition({
                snapshot,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 32,
                fadeInMs: 32,
            });
            return <div />;
        }

        render(
            <FadeProvider>
                <Harness />
            </FadeProvider>,
        );

        await vi.advanceTimersByTimeAsync(48);
        expect(sendAction).toHaveBeenCalledTimes(1);

        // No snapshot ever arrives — the lost-ack world. Each elapsed cadence
        // must re-send, stamped with the latest tick this client has. The
        // boundary is walked with the constant so the pin is on the BINDING:
        // a cadence armed with any other number reds on one of these two
        // steps, where a bare "advance a lot" would keep passing.
        await vi.advanceTimersByTimeAsync(SCENE_READY_RETRY_MS - 49);
        expect(sendAction).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(49);
        expect(sendAction).toHaveBeenCalledTimes(2);
        expect(sendAction).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({ type: 'engine:scene_ready', tick: snapshot.tick }),
        );

        await vi.advanceTimersByTimeAsync(SCENE_READY_RETRY_MS);
        expect(sendAction).toHaveBeenCalledTimes(3);
    });

    // The cadence and the pins the merge gate reads it against. The literal is
    // pinned separately from the boundary walk above: the walk kills a cadence
    // BOUND to another number, this kills the number itself drifting.
    it('SCENE_READY_RETRY_MS is one second, and several retries fit inside the e2e barrier poll', () => {
        expect(SCENE_READY_RETRY_MS).toBe(1_000);
        // 15 s is the e2e suite's SCENE_BARRIER_POLL_MS, pinned on its own
        // side of the module boundary (scene-transition.test.ts) — an import
        // here would breach chimera/no-game-renderer-internals in reverse.
        expect(SCENE_READY_RETRY_MS * 3).toBeLessThan(15_000);
    });

    it('re-stamps each retry with the latest received tick', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 32,
                fadeInMs: 32,
            });
            return <div />;
        }

        const { rerender } = render(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 3,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [],
                        },
                    })}
                />
            </FadeProvider>,
        );

        await vi.advanceTimersByTimeAsync(48);
        expect(sendAction).toHaveBeenCalledTimes(1);

        // Another seat's ack advanced the tick; this seat's is still missing.
        rerender(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 5,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [playerId('other-player')],
                        },
                    })}
                />
            </FadeProvider>,
        );
        await vi.advanceTimersByTimeAsync(1);
        expect(sendAction).toHaveBeenCalledTimes(2);

        // The cadence retry after that must carry tick 5 — the latest
        // received — not a tick captured when the interval was armed.
        await vi.advanceTimersByTimeAsync(SCENE_READY_RETRY_MS);
        expect(sendAction).toHaveBeenCalledTimes(3);
        expect(sendAction).toHaveBeenNthCalledWith(
            3,
            expect.objectContaining({ type: 'engine:scene_ready', tick: 5 }),
        );
    });

    it('arms exactly one cadence under a StrictMode root', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        const snapshot = makeSnapshot({
            sceneTransition: {
                toSceneId: makeSceneId('engine:post-game'),
                phase: 'preparing',
                startedAtTick: 2,
                params: {},
                playersReady: [],
            },
        });

        function Harness(): React.ReactElement {
            useFadeTransition({
                snapshot,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 32,
                fadeInMs: 32,
            });
            return <div />;
        }

        render(
            <React.StrictMode>
                <FadeProvider>
                    <Harness />
                </FadeProvider>
            </React.StrictMode>,
        );

        await vi.advanceTimersByTimeAsync(48);
        expect(sendAction).toHaveBeenCalledTimes(1);

        // A double-armed interval surviving the simulated remount would fire
        // twice per cadence: three calls here instead of two.
        await vi.advanceTimersByTimeAsync(SCENE_READY_RETRY_MS);
        expect(sendAction).toHaveBeenCalledTimes(2);
    });

    // Broadcasts re-parse the transition, so its OBJECT identity changes on
    // every snapshot. An interval hung on that identity is re-armed per
    // broadcast and never reaches its cadence — under a realtime tick stream
    // the retry would silently not exist. The cadence must survive rerenders
    // that change nothing it is keyed on.
    it('keeps its cadence across snapshot rerenders of the same transition', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 32,
                fadeInMs: 32,
            });
            return <div />;
        }

        const preparing = (tick: number): PlayerSnapshot =>
            makeSnapshot({
                tick,
                sceneTransition: {
                    toSceneId: makeSceneId('engine:post-game'),
                    phase: 'preparing',
                    startedAtTick: 2,
                    params: {},
                    playersReady: [],
                },
            });

        const { rerender } = render(
            <FadeProvider>
                <Harness snap={preparing(3)} />
            </FadeProvider>,
        );

        await vi.advanceTimersByTimeAsync(48);
        expect(sendAction).toHaveBeenCalledTimes(1);

        // A broadcast every 400 ms — each advances the tick, so the EDGE
        // retry fires too; what is asserted is that the cadence retry is
        // STILL among the dispatches, which only holds if the rerenders did
        // not re-arm it.
        let tick = 3;
        for (let step = 0; step < 3; step += 1) {
            await vi.advanceTimersByTimeAsync(400);
            tick += 1;
            rerender(
                <FadeProvider>
                    <Harness snap={preparing(tick)} />
                </FadeProvider>,
            );
        }
        // t ≈ 1248: one cadence firing (t=1000) plus three edge retries. With
        // the interval re-armed per rerender, only the edges fire: 4 calls.
        expect(sendAction).toHaveBeenCalledTimes(5);
    });

    // The interval's cleanup is load-bearing, and this is its ONLY
    // dispatch-observable killer: `fadeCompletedKey` is reset when a
    // transition ENDS, not when the key changes, so a survivor from
    // transition A passes its own closure's guard and would ack B before B's
    // fade and preload ever completed. Transition-end and unmount survivors
    // are masked by the key reset and `mountedRef` — a cleanup mutant is
    // invisible there.
    it('a stale cadence from a previous transition never acks the next one', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        // Fade A completes on the spot; fade B never completes — the exact
        // state in which only A's leaked interval could dispatch for B.
        const fadeControl = makeFadeControl({
            fadeOut: vi
                .fn()
                .mockReturnValueOnce(Promise.resolve())
                .mockReturnValue(new Promise<void>(() => undefined)),
        });

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 32,
                fadeInMs: 32,
            });
            return <div />;
        }

        const { rerender } = render(
            <FadeContext.Provider value={fadeControl}>
                <Harness
                    snap={makeSnapshot({
                        tick: 3,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [],
                        },
                    })}
                />
            </FadeContext.Provider>,
        );

        await vi.advanceTimersByTimeAsync(1);
        expect(sendAction).toHaveBeenCalledTimes(1);

        // A NEW transition (different key) before A ever resolved.
        rerender(
            <FadeContext.Provider value={fadeControl}>
                <Harness
                    snap={makeSnapshot({
                        tick: 4,
                        sceneTransition: {
                            toSceneId: makeSceneId('tactics:asset-demo'),
                            phase: 'preparing',
                            startedAtTick: 4,
                            params: {},
                            playersReady: [],
                        },
                    })}
                />
            </FadeContext.Provider>,
        );

        await vi.advanceTimersByTimeAsync(3 * SCENE_READY_RETRY_MS);
        expect(sendAction).toHaveBeenCalledTimes(1);
    });

    it('stops retrying once this player is in playersReady', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 32,
                fadeInMs: 32,
            });
            return <div />;
        }

        const { rerender } = render(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 3,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [],
                        },
                    })}
                />
            </FadeProvider>,
        );

        await vi.advanceTimersByTimeAsync(48);
        expect(sendAction).toHaveBeenCalledTimes(1);

        // The ack landed: the host broadcast a snapshot carrying this player.
        rerender(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 4,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [LOCAL_PLAYER],
                        },
                    })}
                />
            </FadeProvider>,
        );

        await vi.advanceTimersByTimeAsync(3 * SCENE_READY_RETRY_MS);
        expect(sendAction).toHaveBeenCalledTimes(1);
    });

    it('stops retrying when the transition ends', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();

        function Harness({ snap }: { snap: PlayerSnapshot }): React.ReactElement {
            useFadeTransition({
                snapshot: snap,
                localPlayerId: LOCAL_PLAYER,
                sendAction,
                fadeOutMs: 32,
                fadeInMs: 32,
            });
            return <div />;
        }

        const { rerender } = render(
            <FadeProvider>
                <Harness
                    snap={makeSnapshot({
                        tick: 3,
                        sceneTransition: {
                            toSceneId: makeSceneId('engine:post-game'),
                            phase: 'preparing',
                            startedAtTick: 2,
                            params: {},
                            playersReady: [],
                        },
                    })}
                />
            </FadeProvider>,
        );

        await vi.advanceTimersByTimeAsync(48);
        expect(sendAction).toHaveBeenCalledTimes(1);

        rerender(
            <FadeProvider>
                <Harness snap={makeSnapshot({ tick: 5, sceneTransition: null })} />
            </FadeProvider>,
        );

        await vi.advanceTimersByTimeAsync(3 * SCENE_READY_RETRY_MS);
        expect(sendAction).toHaveBeenCalledTimes(1);
    });

    // The cadence must not become a SECOND door to the ack: the barrier's
    // meaning is "fade-out done and scene preload settled", and a retry that
    // fired before the chain completed once would ack a readiness that never
    // happened.
    it('does not dispatch on the cadence while the fade has never completed', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();

        renderPreloadHarness({
            fadeControl: makeFadeControl({
                fadeOut: vi.fn().mockReturnValue(new Promise<void>(() => undefined)),
            }),
            sendAction,
            assetManager: createStubAssetManager(),
            assetManifest: stubManifest([textureRef('arena')]),
            snapshot: makePreloadingSnapshot([]),
        });

        await vi.advanceTimersByTimeAsync(5 * SCENE_READY_RETRY_MS);
        expect(sendAction).not.toHaveBeenCalled();
    });
});

describe('useFadeTransition — entering scene asset preload', () => {
    // ── the two conjuncts, one dedicated killer each ─────────────────────────

    it('withholds scene_ready while the fade-out is still running, preload settled or not', async () => {
        const sendAction = vi.fn();
        const ref = textureRef('arena');
        // The fade never resolves, and the preload is reachable only THROUGH it,
        // so a dispatch here means the fade wait was dropped from the chain.
        const fadeControl = makeFadeControl({
            fadeOut: vi.fn().mockReturnValue(new Promise<void>(() => undefined)),
        });

        renderPreloadHarness({
            fadeControl,
            sendAction,
            assetManager: createStubAssetManager(),
            assetManifest: stubManifest([ref]),
            snapshot: makePreloadingSnapshot([ref]),
        });
        await flushPendingWork();

        expect(sendAction).not.toHaveBeenCalled();
    });

    it('withholds scene_ready while the entering scene’s assets are still loading', async () => {
        const sendAction = vi.fn();
        const ref = textureRef('arena');

        renderPreloadHarness({
            sendAction,
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
            snapshot: makePreloadingSnapshot([ref]),
        });
        await flushPendingWork();

        expect(sendAction).not.toHaveBeenCalled();
    });

    // ── fail open: every outcome acks the barrier ────────────────────────────

    it('dispatches scene_ready once every declared ref has loaded', async () => {
        const sendAction = vi.fn();
        const ref = textureRef('arena');

        renderPreloadHarness({
            sendAction,
            assetManager: createStubAssetManager({ [String(ref)]: 'resolve' }),
            assetManifest: stubManifest([ref]),
            snapshot: makePreloadingSnapshot([ref]),
        });
        await flushPendingWork();

        expect(sendAction).toHaveBeenCalledOnce();
    });

    it('dispatches scene_ready when a declared ref FAILS to load', async () => {
        const sendAction = vi.fn();
        const ref = textureRef('arena');

        renderPreloadHarness({
            sendAction,
            assetManager: createStubAssetManager({ [String(ref)]: 'reject' }),
            assetManifest: stubManifest([ref]),
            snapshot: makePreloadingSnapshot([ref]),
        });
        await flushPendingWork();

        expect(sendAction).toHaveBeenCalledOnce();
    });

    it('dispatches scene_ready when the preload budget elapses first', async () => {
        vi.useFakeTimers();
        const sendAction = vi.fn();
        const ref = textureRef('arena');

        renderPreloadHarness({
            sendAction,
            preloadTimeoutMs: 40,
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
            snapshot: makePreloadingSnapshot([ref]),
        });
        await flushPendingWork();
        expect(sendAction).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(40);
        await flushPendingWork();

        // The host barrier waits for EVERY player and only evaluates its own
        // timeout when an action is applied, and a turn-based game has no
        // ticker — so a client that withheld its ack on a bad disk would freeze
        // the match with no host timeout able to fire.
        expect(sendAction).toHaveBeenCalledOnce();
    });

    it('dispatches scene_ready for a scene that declares no required assets', async () => {
        const sendAction = vi.fn();

        renderPreloadHarness({
            sendAction,
            assetManager: createStubAssetManager(),
            assetManifest: stubManifest([textureRef('arena')]),
            snapshot: makePreloadingSnapshot([]),
        });
        await flushPendingWork();

        expect(sendAction).toHaveBeenCalledOnce();
    });

    // ── nothing starts once the caller has moved on ──────────────────────────
    //
    // A fade is 300 ms by default, and the unmount-only cancel has already run
    // by the time it resolves — so a run started here is UNCANCELLABLE: it
    // registers a manifest and loads into a borrowed manager whose unique
    // disposer has gone (Invariant #21), and keeps reporting progress at a
    // caller that stopped listening.

    it('starts no preload when the fade resolves after unmount', async () => {
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'hang' });
        const releaseFade = deferredFade();

        const { unmount } = renderPreloadHarness({
            fadeControl: releaseFade.control,
            sendAction: vi.fn(),
            assetManager,
            assetManifest: stubManifest([ref]),
            snapshot: makePreloadingSnapshot([ref]),
        });
        await flushPendingWork();

        unmount();
        releaseFade.resolve();
        await flushPendingWork();

        expect(preloadRuns).toHaveLength(0);
        expect(assetManager.registered).toHaveLength(0);
    });

    it('starts no preload when the fade resolves after the transition target changed', async () => {
        const leaving = textureRef('arena');
        const entering = textureRef('lobby');
        const assetManager = createStubAssetManager({
            [String(leaving)]: 'hang',
            [String(entering)]: 'hang',
        });
        const assetManifest = stubManifest([leaving, entering]);
        const releaseFade = deferredFade();
        const sendAction = vi.fn();

        const { rerender } = renderPreloadHarness({
            fadeControl: releaseFade.control,
            sendAction,
            assetManager,
            assetManifest,
            snapshot: makePreloadingSnapshot([leaving]),
        });
        await flushPendingWork();

        rerender(
            makePreloadHarnessTree({
                fadeControl: releaseFade.control,
                sendAction,
                assetManager,
                assetManifest,
                snapshot: makePreloadingSnapshot([entering], {
                    toSceneId: 'engine:lobby',
                    tick: 4,
                }),
            }),
        );
        // Releases BOTH fades; only the surviving transition may start a run.
        releaseFade.resolve();
        await flushPendingWork();

        expect(preloadRuns).toHaveLength(1);
        expect(assetManager.registered).toHaveLength(1);
        expect(assetManager.registered[0]?.entries).toContainEqual(
            expect.objectContaining({ ref: entering, priority: 'critical' }),
        );
    });

    // ── a run that waits on nothing measures nothing ─────────────────────────
    //
    // One case per input `startScenePreload` skips on, never one fixture
    // tripping several: the hook asks that module's own predicate, and each
    // conjunct needs its own killer.

    it.each([
        [
            'the entering scene declares no refs',
            (): PreloadHarnessOptions => ({
                sendAction: vi.fn(),
                assetManager: createStubAssetManager(),
                assetManifest: stubManifest([textureRef('arena')]),
                snapshot: makePreloadingSnapshot([]),
            }),
        ],
        [
            'the game ships no manifest',
            (): PreloadHarnessOptions => ({
                sendAction: vi.fn(),
                assetManager: createStubAssetManager(),
                assetManifest: undefined,
                snapshot: makePreloadingSnapshot([textureRef('arena')]),
            }),
        ],
        [
            'no asset manager is in context',
            (): PreloadHarnessOptions => ({
                sendAction: vi.fn(),
                assetManager: null,
                assetManifest: stubManifest([textureRef('arena')]),
                snapshot: makePreloadingSnapshot([textureRef('arena')]),
            }),
        ],
    ])('reports no fraction when %s', async (_case, build) => {
        const onPreloadProgress = vi.fn();

        renderPreloadHarness({ ...build(), onPreloadProgress });
        await flushPendingWork();

        // The run's own no-op path reports `1` — 100% of an empty list. Passing
        // that on would author a measurement nobody took, which is the same
        // fabrication the contract refuses for `0`.
        expect(onPreloadProgress.mock.calls.map(([fraction]) => fraction)).not.toContain(1);
        expect(onPreloadProgress).not.toHaveBeenCalledWith(0);
    });

    it('reports 0 the moment a measured run starts', async () => {
        const onPreloadProgress = vi.fn();
        const ref = textureRef('arena');

        renderPreloadHarness({
            sendAction: vi.fn(),
            onPreloadProgress,
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
            snapshot: makePreloadingSnapshot([ref]),
        });
        await flushPendingWork();

        expect(onPreloadProgress).toHaveBeenCalledWith(0);
    });

    // ── cancellation is NOT the transition effect's cleanup ──────────────────

    it('keeps a pending preload running when another player acknowledges mid-transition', async () => {
        const sendAction = vi.fn();
        const onPreloadProgress = vi.fn();
        const first = textureRef('arena');
        const second = textureRef('floor');
        const assetManager = createStubAssetManager({
            [String(first)]: 'deferred',
            [String(second)]: 'hang',
        });

        const { rerender } = renderPreloadHarness({
            sendAction,
            onPreloadProgress,
            assetManager,
            assetManifest: stubManifest([first, second]),
            snapshot: makePreloadingSnapshot([first, second]),
        });
        await flushPendingWork();
        expect(preloadRuns).toHaveLength(1);

        // The effect depends on the freshly parsed `sceneTransition` OBJECT, so
        // a remote ack re-runs it on the very next state frame. A cancel hung on
        // that effect's cleanup would kill this client's own run right here.
        rerender(
            makePreloadHarnessTree({
                sendAction,
                onPreloadProgress,
                assetManager,
                assetManifest: stubManifest([first, second]),
                snapshot: makePreloadingSnapshot([first, second], {
                    tick: 4,
                    playersReady: [playerId('other-player')],
                }),
            }),
        );
        await flushPendingWork();

        expect(preloadRuns[0]?.cancelCalls).toBe(0);

        assetManager.settleDeferred(first);
        await flushPendingWork();

        expect(onPreloadProgress).toHaveBeenCalledWith(0.5);
    });

    it('cancels the pending run and acks nothing when the transition target changes', async () => {
        const sendAction = vi.fn();
        const leaving = textureRef('arena');
        const entering = textureRef('lobby');
        const assetManager = createStubAssetManager({
            [String(leaving)]: 'deferred',
            [String(entering)]: 'hang',
        });

        const { rerender } = renderPreloadHarness({
            sendAction,
            assetManager,
            assetManifest: stubManifest([leaving, entering]),
            snapshot: makePreloadingSnapshot([leaving]),
        });
        await flushPendingWork();
        expect(preloadRuns).toHaveLength(1);

        rerender(
            makePreloadHarnessTree({
                sendAction,
                assetManager,
                assetManifest: stubManifest([leaving, entering]),
                snapshot: makePreloadingSnapshot([entering], {
                    toSceneId: 'engine:lobby',
                    tick: 4,
                }),
            }),
        );
        await flushPendingWork();

        expect(preloadRuns[0]?.cancelCalls).toBeGreaterThan(0);

        // The abandoned run settles AFTER the swap: without the identity
        // re-check on the far side of the await it would ack the transition the
        // client already left.
        assetManager.settleDeferred(leaving);
        await flushPendingWork();

        expect(sendAction).not.toHaveBeenCalled();
    });

    it('cancels the pending run on unmount', async () => {
        const ref = textureRef('arena');

        const { unmount } = renderPreloadHarness({
            sendAction: vi.fn(),
            assetManager: createStubAssetManager({ [String(ref)]: 'hang' }),
            assetManifest: stubManifest([ref]),
            snapshot: makePreloadingSnapshot([ref]),
        });
        await flushPendingWork();
        expect(preloadRuns).toHaveLength(1);

        unmount();

        expect(preloadRuns[0]?.cancelCalls).toBeGreaterThan(0);
    });

    // ── the progress channel ─────────────────────────────────────────────────

    it('reports null progress once the transition ends', async () => {
        const onPreloadProgress = vi.fn();
        const ref = textureRef('arena');
        const assetManager = createStubAssetManager({ [String(ref)]: 'resolve' });
        const assetManifest = stubManifest([ref]);

        const { rerender } = renderPreloadHarness({
            sendAction: vi.fn(),
            onPreloadProgress,
            assetManager,
            assetManifest,
            snapshot: makePreloadingSnapshot([ref]),
        });
        await flushPendingWork();
        expect(onPreloadProgress).toHaveBeenLastCalledWith(1);

        rerender(
            makePreloadHarnessTree({
                sendAction: vi.fn(),
                onPreloadProgress,
                assetManager,
                assetManifest,
                snapshot: makeSnapshot({ tick: 5, sceneTransition: null }),
            }),
        );
        await flushPendingWork();

        expect(onPreloadProgress).toHaveBeenLastCalledWith(null);
    });
});

// ── preload fixtures ─────────────────────────────────────────────────────────

function makeFadeControl(overrides: Partial<FadeControl> = {}): FadeControl {
    const control: FadeControl = {
        phase: 'idle',
        opacity: 0,
        setPhase: vi.fn(),
        fadeOut: vi.fn().mockResolvedValue(undefined),
        fadeIn: vi.fn().mockResolvedValue(undefined),
        // Delegates through `control`, so a session inherits whatever a case
        // overrode. Several cases pin the ack against a fade that never
        // resolves; a session with its own resolved stub would turn those into
        // instant fades and leave them green while measuring nothing.
        claim: () => ({
            isActive: true,
            fadeOut: (durationMs?: number) => control.fadeOut(durationMs),
            fadeIn: (durationMs?: number) => control.fadeIn(durationMs),
        }),
        ...overrides,
    };
    return control;
}

function makePreloadingSnapshot(
    requiredAssets: readonly AssetRef<TextureAsset>[],
    overrides: {
        readonly toSceneId?: string;
        readonly tick?: number;
        readonly playersReady?: readonly ReturnType<typeof playerId>[];
    } = {},
): PlayerSnapshot {
    return makeSnapshot({
        tick: overrides.tick ?? 3,
        sceneTransition: {
            toSceneId: makeSceneId(overrides.toSceneId ?? 'engine:post-game'),
            phase: 'preparing',
            startedAtTick: 2,
            params: {},
            playersReady: overrides.playersReady ?? [],
            requiredAssets,
        },
    });
}

interface PreloadHarnessOptions {
    readonly snapshot: PlayerSnapshot;
    readonly sendAction: ReturnType<typeof vi.fn>;
    /** `null` stands for "no `AssetManagerContext` above this tree". */
    readonly assetManager: AssetManager | null;
    /** `undefined` stands for "this game ships no manifest". */
    readonly assetManifest: AssetManifest | undefined;
    readonly onPreloadProgress?: (fraction: number | null) => void;
    readonly preloadTimeoutMs?: number;
    readonly fadeControl?: FadeControl;
}

/** A `FadeControl` whose fade-out the test decides the moment of. */
function deferredFade(): { readonly control: FadeControl; readonly resolve: () => void } {
    const resolvers: (() => void)[] = [];
    const deferredFadeOut = (): Promise<void> =>
        new Promise<void>((resolve) => {
            resolvers.push(resolve);
        });
    return {
        control: {
            phase: 'idle',
            opacity: 0,
            setPhase: () => undefined,
            fadeOut: deferredFadeOut,
            fadeIn: () => Promise.resolve(),
            // The same deferred fade, so a session defers too — the whole point
            // of this double is a fade-out that has not finished.
            claim: () => ({
                isActive: true,
                fadeOut: deferredFadeOut,
                fadeIn: () => Promise.resolve(),
            }),
        },
        resolve: () => {
            for (const resolveFade of resolvers.splice(0)) {
                resolveFade();
            }
        },
    };
}

/**
 * Declared at module scope, NOT rebuilt per tree: a fresh component identity on
 * a rerender makes React unmount and remount the subtree, which would discard
 * the very refs the run's lifetime lives in — and would then report a cancel
 * that the code under test never asked for.
 */
function PreloadHarness(options: PreloadHarnessOptions): React.ReactElement {
    useFadeTransition({
        snapshot: options.snapshot,
        localPlayerId: LOCAL_PLAYER,
        sendAction: options.sendAction,
        ...(options.assetManifest === undefined ? {} : { assetManifest: options.assetManifest }),
        ...(options.onPreloadProgress === undefined
            ? {}
            : { onPreloadProgress: options.onPreloadProgress }),
        ...(options.preloadTimeoutMs === undefined
            ? {}
            : { preloadTimeoutMs: options.preloadTimeoutMs }),
    });
    return <div />;
}

function makePreloadHarnessTree(options: PreloadHarnessOptions): React.ReactElement {
    return (
        <AssetManagerContext.Provider value={options.assetManager}>
            <FadeContext.Provider value={options.fadeControl ?? sharedInstantFadeControl}>
                <PreloadHarness {...options} />
            </FadeContext.Provider>
        </AssetManagerContext.Provider>
    );
}

/**
 * A fade that completes on the spot, shared so a rerender does not hand the hook
 * a fresh `FadeControl` identity mid-transition.
 */
const sharedInstantFadeControl: FadeControl = {
    phase: 'idle',
    opacity: 0,
    setPhase: () => undefined,
    fadeOut: () => Promise.resolve(),
    fadeIn: () => Promise.resolve(),
    claim: () => ({
        isActive: true,
        fadeOut: () => Promise.resolve(),
        fadeIn: () => Promise.resolve(),
    }),
};

function renderPreloadHarness(options: PreloadHarnessOptions): ReturnType<typeof render> {
    return render(makePreloadHarnessTree(options));
}

function makeSceneId(raw: string): NonNullable<PlayerSnapshot['sceneId']> {
    return raw as NonNullable<PlayerSnapshot['sceneId']>;
}

function makeSnapshot(overrides: Partial<PlayerSnapshot> = {}): PlayerSnapshot {
    return {
        tick: 3,
        viewerId: LOCAL_PLAYER,
        players: { [LOCAL_PLAYER]: { id: LOCAL_PLAYER } },
        entities: {},
        phase: gamePhase('playing'),
        sceneId: makeSceneId('engine:game'),
        sceneTransition: null,
        events: [],
        gameResult: null,
        commitments: {},
        undoMeta: { canUndo: false, canRedo: false },
        isMyTurn: true,
        ...overrides,
    };
}
